import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import chokidar, { type FSWatcher } from 'chokidar';
import { dispatchHost, type HostHandlers } from '../domain/host-requests';
import type { AgentEvent, HostEvent, Space } from '../domain/types';
import type { RemoteFolders, RemoteHostAbout } from '../domain/remote-hosts';
import { t } from '../domain/i18n';
import { within } from '../domain/scopes';
import { FileService, watcherIgnored } from '../host/files';
import { SearchService } from '../host/search';
import { BundleService } from '../host/bundle';
import { ImageService } from '../host/images';
import { WorkFolders } from '../host/work-folders';
import { SchemaSettingsService } from '../host/schema-settings';
import { inspectRepository } from '../host/workspaces';
import { readSkills } from '../host/skills';
import { vaultReads } from '../host/vault-reads';
import { KnowledgeStore } from '../knowledge/store';
import { AuthorshipStore } from '../knowledge/authorship';
import { CloudService } from '../cloud/service';
import { RepositoryGit } from '../cloud/repositories';
import { GitService } from '../git/service';
import { approveGitConfig, GitConfigApprovals } from '../git/config-approval';
import { AgentService } from '../agents/service';
import { readAgentDefinitions, vaultAgentDefinition } from '../agents/agent-definitions';
import type { HandOffResult, RemoteBrief } from '../agents/remote-vaults';
import {
  forwardedReads,
  hostOperations,
  isForwardedRead,
  type ForwardedRead,
  type HandOffState,
  type HostOperation,
} from './protocol';

/** What a vault host asks the person's device: only the person can answer there. */
export type HostQuestion =
  | { question: 'approveConfig'; params: { label?: string; files: string[] }[] }
  | { question: 'approveGitConfig'; params: { folder: string; found: string[] } };

export interface VaultHostOptions {
  /** Where this host keeps its own records: its vaults, conversations and indexes. */
  dataDir: string;
  emit(event: HostEvent): void;
  /** Asks the person's device; while none is attached the answer waits. */
  ask(question: HostQuestion): Promise<unknown>;
}

/** How long a finished hand-off's report is kept for the device that handed it. */
const reportKept = 24 * 60 * 60 * 1000;
/** The most folders one listing names. */
const folderLimit = 500;

/**
 * irori's vault services for the vaults on an SSH host, without a window
 * (ADR 061). It answers the HostAPI's reads as the main process does, registers
 * vaults, takes files into their work folders and runs their agents on tasks the
 * irori agent hands over from the person's device.
 */
export async function createVaultHost({ dataDir, emit, ask }: VaultHostOptions) {
  const files = new FileService(dataDir);
  await files.init();
  // Contents is read through the connection service here too; nothing it deletes goes to a trash.
  const cloud = new CloudService(files);
  cloud.repositories = new RepositoryGit();
  files.cloud = cloud;
  const search = new SearchService(files);
  const bundle = new BundleService(files, search);
  const images = new ImageService(files, cloud);
  const knowledge = new KnowledgeStore(files.dataDir, (ref) =>
    files.resolve(ref.scopeId, ref.path),
  );
  const authorship = new AuthorshipStore(files.dataDir, (ref) => git.noted(ref.scopeId, ref.path));
  const agents = new AgentService(
    files,
    (event) => emit({ type: 'agent', event }),
    knowledge,
    authorship,
  );
  // As on the person's device, Git and the CLIs run configuration that runs
  // programs only once the person has seen it; the question goes to that device.
  approveGitConfig(
    new GitConfigApprovals(
      path.join(files.dataDir, 'git-config-approvals.json'),
      async (folder, found) =>
        (await ask({ question: 'approveGitConfig', params: { folder, found } })) === true,
    ),
  );
  agents.approveConfig = async (found) =>
    (await ask({ question: 'approveConfig', params: found })) === true;
  const git = new GitService(files, () => !agents.anyBusy && !cloud.busy, authorship);
  const work = new WorkFolders(files);
  cloud.workFolder = (scopeId) => work.folder(scopeId);
  agents.workFolder = async (scopeId) => {
    const before = (await work.folder(scopeId)).path;
    const there = await fs.lstat(before).then(
      () => true,
      () => false,
    );
    const folder = await work.prepare(scopeId);
    if (!there) emit({ type: 'files', scopeId });
    return folder;
  };
  const schemaSettings = new SchemaSettingsService(files, search);
  agents.nestedInstructions = (scopeId) => schemaSettings.nestedInstructions(scopeId);

  // A change under a vault's folder reaches the window as it does on the person's device.
  let closing = false;
  const watchers = new Map<string, FSWatcher>();
  const timers = new Map<string, NodeJS.Timeout>();
  const watch = (space: Space) => {
    if (watchers.has(space.scopeId)) return;
    const watcher = chokidar.watch(space.root, {
      ignoreInitial: true,
      depth: 6,
      followSymlinks: false,
      ignored: watcherIgnored(space, files.list()),
    });
    watcher.on('all', () => {
      clearTimeout(timers.get(space.scopeId));
      timers.set(
        space.scopeId,
        setTimeout(() => {
          timers.delete(space.scopeId);
          if (!closing && watchers.get(space.scopeId) === watcher)
            emit({ type: 'files', scopeId: space.scopeId });
        }, 150),
      );
    });
    watcher.on('error', (error) => console.warn('Watcher error', String(error)));
    watchers.set(space.scopeId, watcher);
  };
  const unwatch = async (scopeId: string) => {
    clearTimeout(timers.get(scopeId));
    timers.delete(scopeId);
    const watcher = watchers.get(scopeId);
    watchers.delete(scopeId);
    await watcher?.close();
  };
  files.list().forEach(watch);

  const reads = {
    ...vaultReads({ files, search, bundle, images, git, knowledge, authorship, work }),
    skills: (id) => readSkills(files, id),
    schemaSettings: (id) => schemaSettings.list(id),
    readSchemaFile: (...args) => schemaSettings.read(...args),
  } satisfies Pick<HostHandlers, ForwardedRead>;
  // `dispatchHost` checks the arguments as the main process does; only the reads are here.
  const forwarded = Object.fromEntries(
    forwardedReads.map((method) => [method, reads[method]]),
  ) as unknown as HostHandlers;

  /** Hand-offs by their run: the events still unanswered, and how each ended. */
  const handOffs = new Map<
    string,
    {
      pending: Map<string, AgentEvent>;
      result: Promise<HandOffResult>;
      ended?: HandOffResult;
      cancel(): Promise<void>;
    }
  >();
  const forget = (runId: string) => handOffs.delete(runId);

  const busy = () =>
    t(
      'この SSH ホストで実行中の処理が終わってから行ってください。',
      'Do this after what is running on this SSH host finishes.',
    );

  const own: {
    [K in HostOperation]: (...args: import('zod').infer<(typeof hostOperations)[K]>) => unknown;
  } = {
    spaces: () => files.list(),
    folders: async (requested): Promise<RemoteFolders> => {
      const folder = await fs.realpath(requested ?? os.homedir());
      const names = (await fs.readdir(folder, { withFileTypes: true }))
        .filter((entry) => !entry.name.startsWith('.') && entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
      const parent = path.dirname(folder);
      return {
        path: folder,
        ...(parent !== folder && { parent }),
        folders: await Promise.all(
          names.slice(0, folderLimit).map(async (name) => {
            const at = path.join(folder, name);
            const vault = await fs.stat(path.join(at, '.irori', 'scope.json')).then(
              (info) => info.isFile(),
              () => false,
            );
            return { name, path: at, ...(vault && { vault }) };
          }),
        ),
        ...(names.length > folderLimit && { more: true }),
      };
    },
    registerVault: async (root, name, category) => {
      if (agents.anyBusy || git.busy) throw Error(busy());
      const inspection = await inspectRepository(root);
      if (inspection.kind === 'unavailable') throw Error(inspection.detail);
      const space = await files.register(root, name, category);
      watch(space);
      return space;
    },
    unregisterVault: async (scopeId) => {
      if (agents.busy(scopeId) || git.busy) throw Error(busy());
      await unwatch(scopeId);
      await files.unregister(scopeId);
    },
    brief: async (scopeId, agent): Promise<RemoteBrief> => {
      const definition = vaultAgentDefinition(
        (await readAgentDefinitions(files.get(scopeId).root)).definitions,
        agent,
      );
      return definition?.description ? { description: definition.description } : {};
    },
    sendFile: async (scopeId, name, bytes) => {
      const space = files.get(scopeId);
      const folder = await work.prepare(scopeId);
      const extension = path.extname(name);
      const stem = name.slice(0, name.length - extension.length);
      // Under its name, or the first free one; nothing there is replaced.
      for (let count = 1; count < 1000; count++) {
        const target = path.join(folder, count === 1 ? name : `${stem} ${count}${extension}`);
        try {
          await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
          throw error;
        }
        emit({ type: 'files', scopeId });
        // As the vault's agent names it: inside the vault when the work folder is.
        const root = await fs.realpath(space.root);
        const placed = await fs.realpath(target);
        return within(root, placed)
          ? path.relative(root, placed).split(path.sep).join('/')
          : placed;
      }
      throw Error('No free name was found in the work folder.');
    },
    handOff: async (task, from) => {
      const pending = new Map<string, AgentEvent>();
      const started = await agents.startHanded(task, { conversationId: from }, (event) => {
        if (event.type === 'permission' || event.type === 'question')
          pending.set(event.requestId!, event);
        else if (event.type === 'status' && event.resolved) pending.delete(event.resolved);
      });
      const entry: NonNullable<ReturnType<typeof handOffs.get>> = {
        pending,
        result: started.result,
        cancel: started.cancel,
      };
      handOffs.set(started.runId, entry);
      void started.result.then((ended) => {
        entry.ended = ended;
        pending.clear();
        // The device that handed the task collects the report; one that never returns leaves it to lapse.
        setTimeout(() => forget(started.runId), reportKept).unref();
      });
      return { runId: started.runId };
    },
    handOffState: (runId): HandOffState => {
      const entry = handOffs.get(runId);
      if (!entry) return { state: 'unknown' };
      return entry.ended
        ? { state: 'done', ...entry.ended }
        : { state: 'running', pending: [...entry.pending.values()] };
    },
    awaitHandOff: async (runId): Promise<HandOffResult> => {
      const entry = handOffs.get(runId);
      if (!entry) throw Error('This hand-off is not known on the host.');
      return entry.result;
    },
    cancelHandOff: async (runId) => {
      await handOffs.get(runId)?.cancel();
    },
    forgetHandOff: (runId) => void forget(runId),
    respond: (...args) => agents.respond(...args),
    status: () => ({ running: agents.anyBusy }),
  };

  const about = (): RemoteHostAbout => ({
    user: os.userInfo().username,
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    home: os.homedir(),
  });

  return {
    about,
    /** Whether an agent run is in progress here. */
    get running() {
      return agents.anyBusy;
    },
    /**
     * Whether a hand-off's report still waits for the device that handed the task:
     * until that device has collected it, or a day has passed since the run ended.
     */
    get waiting() {
      return handOffs.size > 0;
    },
    /** Answers one operation; what it refuses, it refuses in the words the window shows. */
    async call(method: string, args: unknown[]): Promise<unknown> {
      if (isForwardedRead(method)) return dispatchHost(forwarded, method, args);
      if (!Object.hasOwn(hostOperations, method)) throw Error('Unknown vault host operation');
      const operation = method as HostOperation;
      const checked = hostOperations[operation].safeParse(args);
      if (!checked.success)
        throw Error(
          [...new Set(checked.error.issues.map((issue) => issue.message))].slice(0, 3).join(' '),
        );
      return (own[operation] as (...args: unknown[]) => unknown)(...(checked.data as unknown[]));
    },
    /** Stops what runs here and lets go of the vaults' folders. */
    async close() {
      closing = true;
      await agents.cancel().catch(() => {});
      await agents.flush().catch(() => {});
      await git.close().catch(() => {});
      await cloud.close().catch(() => {});
      for (const timer of timers.values()) clearTimeout(timer);
      await Promise.all([...watchers.values()].map((watcher) => watcher.close()));
      approveGitConfig(undefined);
    },
  };
}
export type VaultHost = Awaited<ReturnType<typeof createVaultHost>>;
