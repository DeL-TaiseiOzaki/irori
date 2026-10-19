import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { t } from '../domain/i18n';
import { languages } from '../domain/i18n';
import { yourAiChoice } from '../domain/conversation';
import { routineRuntimeList } from '../domain/routines';
import {
  lineSpacings,
  markdownFonts,
  pageMargins,
  textSizes,
  themes,
  type Category,
  type DeviceSettings,
  type Space,
} from '../domain/types';
import {
  agentFilesFile,
  environmentFile,
  environmentPreferences,
  environmentRepository,
  keysFile,
  routinesFile,
  type EnvironmentRestore,
  type EnvironmentState,
  type RestoreEnvironment,
} from '../domain/environment';
import { githubOwnerPattern, validRepositoryName } from '../domain/git';
import { normalizeGroups } from '../domain/vault-groups';
import type { GitHubCli } from '../git/github';
import type { GitService } from '../git/service';
import type { FileService } from './files';
import { ifPresent } from './local-json';
import { addRoutine, packRoutines, routineHere, storedRoutines } from './environment-routines';
import { openKeys, sealedKeys, sealKeys } from './environment-keys';
import {
  agentFileHere,
  agentReady,
  packAgentFiles,
  restoreAgentFiles,
  storedAgentFiles,
} from './environment-agent';
import type { SecretStore } from './keystore';
import { fromSavedEnvironment } from './vault-rename';
import { inspectRepository, workspaceProfile, type WorkspaceService } from './workspaces';

const repository = z
  .string()
  .max(141)
  .refine((value) => {
    const [owner, name, ...rest] = value.split('/');
    return !rest.length && githubOwnerPattern.test(owner) && validRepositoryName(name ?? '');
  });

/** The file kept in the account's `irori-settings` repository. */
const stored = z.object({
  schemaVersion: z.literal(1),
  savedAt: z.iso.datetime(),
  appVersion: z.string().max(64).optional(),
  vaults: z
    .array(z.object({ scopeId: z.uuid(), name: z.string().trim().min(1).max(120), repository }))
    .max(500),
  workspaces: z.array(workspaceProfile).max(100),
  preferences: z
    .object({
      theme: z.enum(themes),
      language: z.enum(languages),
      markdownFont: z.enum(markdownFonts),
      pageMargins: z.enum(pageMargins),
      textSize: z.enum(textSizes),
      lineSpacing: z.enum(lineSpacings),
      editorAssistance: z.boolean(),
      vaultAgent: z.boolean(),
      yourAi: yourAiChoice,
      routineRuntimes: routineRuntimeList,
    })
    .partial(),
  agent: z.object({ repository }).optional(),
});
type Stored = z.infer<typeof stored>;

/** What the environment service reaches in the host. */
export interface EnvironmentHost {
  files: Pick<FileService, 'list'>;
  workspaces: Pick<WorkspaceService, 'list' | 'adopt'>;
  github: Pick<
    GitHubCli,
    'login' | 'protocol' | 'repository' | 'createPrivate' | 'readFile' | 'writeFile'
  >;
  git: Pick<GitService, 'clone'>;
  settings: {
    read(): Promise<DeviceSettings>;
    save(patch: Partial<DeviceSettings>): Promise<unknown>;
  };
  /** This device's routine secrets, sealed with its OS-held key. */
  secrets: Pick<SecretStore, 'list' | 'values' | 'update'>;
  /** The irori agent's folder on this device. */
  agentRoot: () => Promise<string>;
  /** Registers through the host's own guards and starts watching the vault. */
  register: (root: string, name: string, category: Category) => Promise<Space>;
  /** Where restored vaults go unless another folder is chosen. */
  defaultParent: () => Promise<string>;
  appVersion?: string;
  now?: () => Date;
}

/** A vault on this device with its GitHub repository, when it has one. */
type Located = { space: Space; repository?: string };

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * Saves this device's environment to the GitHub account the GitHub CLI is
 * signed in to, and restores it on another device (ADR 026). Saving replaces
 * the saved environment; restoring only adds to this device.
 */
export class EnvironmentService {
  constructor(private host: EnvironmentHost) {}
  /** The vaults on this device with their GitHub repositories, when they have one. */
  private async vaults() {
    const found: Located[] = [];
    for (const space of this.host.files.list())
      found.push({ space, repository: (await inspectRepository(space.root)).repository });
    return found;
  }
  private async agentRepository() {
    const root = await this.host.agentRoot();
    const info = await inspectRepository(root);
    return info.kind === 'github' ? info.repository : undefined;
  }
  /** The environment as this device would save it. */
  private async local(here?: Located[], agent?: string): Promise<Stored> {
    here ??= await this.vaults();
    agent ??= await this.agentRepository();
    const vaults = here.flatMap(({ space, repository }) =>
      repository ? [{ scopeId: space.scopeId, name: space.name, repository }] : [],
    );
    const kept = new Set(vaults.map((item) => item.scopeId));
    const workspaces = (await this.host.workspaces.list()).map(({ groups = [], ...profile }) => {
      const scopeIds = profile.scopeIds.filter((id) => kept.has(id));
      const normalized = normalizeGroups(groups, scopeIds);
      return { ...profile, scopeIds, ...(normalized.length && { groups: normalized }) };
    });
    const settings = await this.host.settings.read();
    return {
      schemaVersion: 1,
      savedAt: (this.host.now?.() ?? new Date()).toISOString(),
      ...(this.host.appVersion && { appVersion: this.host.appVersion }),
      vaults,
      workspaces,
      preferences: Object.fromEntries(environmentPreferences.map((key) => [key, settings[key]])),
      ...(agent && { agent: { repository: agent } }),
    };
  }
  /** The account's settings repository, refusing a public one. */
  private async place(create: boolean) {
    const login = await this.host.github.login();
    const full = `${login}/${environmentRepository}`;
    const found = await this.host.github.repository(full);
    if (found && !found.private)
      throw Error(
        t(
          `${full} が公開リポジトリのため、環境を保存・読み込みできません。非公開にするか名前を変えてください。`,
          `${full} is public, so irori does not keep the environment there. Make it private or rename it.`,
        ),
      );
    if (!found && create)
      await this.host.github.createPrivate(
        environmentRepository,
        'irori settings: vaults, workspaces and preferences',
      );
    return { login, full, exists: !!found || create };
  }
  /** A file of the settings repository, checked against its schema. */
  private async readFile<T>(full: string, name: string, schema: z.ZodType<T>) {
    const file = await this.host.github.readFile(full, name);
    if (!file) return undefined;
    let value: unknown;
    try {
      value = JSON.parse(file.text);
    } catch {
      value = undefined;
    }
    const version = (value as { schemaVersion?: unknown } | undefined)?.schemaVersion;
    if (typeof version === 'number' && version > 1)
      throw Error(
        t(
          '保存された環境は新しい irori のものです。irori を更新してください。',
          'The saved environment is from a newer irori. Update irori.',
        ),
      );
    const parsed = schema.safeParse(value);
    if (!parsed.success)
      throw Error(t(`${full} の ${name} を読み込めません。`, `Could not read ${name} in ${full}.`));
    return { sha: file.sha, value: parsed.data };
  }
  private read(full: string) {
    // An environment saved before ADR 033 names vaults hibachis.
    return this.readFile(full, environmentFile, z.preprocess(fromSavedEnvironment, stored));
  }
  /** The irori agent's routines saved beside the environment (ADR 043). */
  private readRoutines(full: string) {
    return this.readFile(full, routinesFile, storedRoutines);
  }
  /** The irori agent's own files saved beside the environment (ADR 048). */
  private readAgentFiles(full: string) {
    return this.readFile(full, agentFilesFile, storedAgentFiles);
  }
  /** The routine secrets saved beside the environment, still sealed (ADR 047). */
  private readKeys(full: string) {
    return this.readFile(full, keysFile, sealedKeys);
  }
  async state(): Promise<EnvironmentState> {
    const { login, full, exists } = await this.place(false);
    const saved = exists ? (await this.read(full))?.value : undefined;
    const savedRoutines = saved ? ((await this.readRoutines(full))?.value.routines ?? []) : [];
    const savedKeys = saved ? (await this.readKeys(full))?.value.names : undefined;
    const savedFiles = saved ? (await this.readAgentFiles(full))?.value.files : undefined;
    const keys = await this.host.secrets.list();
    const here = await this.vaults();
    const agentHere = await this.agentRepository();
    const local = await this.local(here, agentHere);
    const agentRoot = await this.host.agentRoot();
    const routines = await packRoutines(agentRoot);
    const files = await packAgentFiles(agentRoot);
    let missing = 0;
    for (const file of savedFiles ?? [])
      if (!(await agentFileHere(agentRoot, file.path))) missing++;
    return {
      account: login,
      local: {
        vaults: local.vaults.length,
        left: here.filter((item) => !item.repository).map((item) => item.space.name),
        ...(local.agent && { agent: local.agent.repository }),
        routines: routines.routines.length,
        routinesLeft: routines.left,
        agentFiles: files.files.length,
        agentFilesLeft: files.left,
        secrets: keys.names,
        secretsAvailable: keys.available,
      },
      ...(saved && {
        saved: {
          savedAt: saved.savedAt,
          vaults: saved.vaults.map((item) => ({
            ...item,
            here: here.some(
              ({ space, repository }) =>
                space.scopeId === item.scopeId || same(repository, item.repository),
            ),
          })),
          workspaces: saved.workspaces.map((item) => item.name),
          ...(saved.agent && {
            agent: {
              repository: saved.agent.repository,
              here: same(agentHere, saved.agent.repository),
            },
          }),
          routines: await Promise.all(
            savedRoutines.map(async ({ folder, name }) => ({
              folder,
              name,
              here: await routineHere(agentRoot, folder),
            })),
          ),
          ...(savedFiles && { agentFiles: { files: savedFiles.length, missing } }),
          ...(savedKeys && {
            secrets: savedKeys.map((name) => ({ name, here: keys.names.includes(name) })),
          }),
        },
      }),
      parent: await this.host.defaultParent(),
    };
  }
  /**
   * Replaces the saved environment with this device's. With a passphrase the
   * saved secrets are replaced by this device's, sealed with it; without one
   * the saved secrets stay as they are. The irori agent's saved files stay as
   * they are where it is not set up here.
   */
  async save(passphrase?: string): Promise<EnvironmentState> {
    const { full } = await this.place(true);
    // Every file is read first, so a damaged one stops the save before any is written.
    const previous = await this.read(full);
    const previousRoutines = await this.readRoutines(full);
    const previousKeys = passphrase === undefined ? undefined : await this.readKeys(full);
    const previousFiles = await this.readAgentFiles(full);
    const value = await this.local();
    const agentRoot = await this.host.agentRoot();
    const { routines } = await packRoutines(agentRoot);
    const { files } = await packAgentFiles(agentRoot);
    // Opened with the device's key and sealed again in memory, before anything is written.
    const keys =
      passphrase === undefined
        ? undefined
        : await sealKeys(
            await this.host.secrets.values((await this.host.secrets.list()).names),
            passphrase,
            value.savedAt,
          );
    await this.host.github.writeFile(
      full,
      environmentFile,
      `${JSON.stringify(value, null, 2)}\n`,
      'Save the irori environment',
      previous?.sha,
    );
    if (routines.length || previousRoutines)
      await this.host.github.writeFile(
        full,
        routinesFile,
        `${JSON.stringify({ schemaVersion: 1, savedAt: value.savedAt, routines }, null, 2)}\n`,
        "Save the irori agent's routines",
        previousRoutines?.sha,
      );
    if (files.length)
      await this.host.github.writeFile(
        full,
        agentFilesFile,
        `${JSON.stringify({ schemaVersion: 1, savedAt: value.savedAt, files }, null, 2)}\n`,
        "Save the irori agent's files",
        previousFiles?.sha,
      );
    if (keys)
      await this.host.github.writeFile(
        full,
        keysFile,
        `${JSON.stringify(keys, null, 2)}\n`,
        'Save the routine secrets, sealed with a passphrase',
        previousKeys?.sha,
      );
    return this.state();
  }
  private async url(repository: string) {
    return (await this.host.github.protocol()) === 'ssh'
      ? `git@github.com:${repository}.git`
      : `https://github.com/${repository}.git`;
  }
  /**
   * Adds the saved environment to this device: the chosen vaults are cloned
   * and registered, the workspaces are taken in and the preferences applied.
   * Nothing on this device is removed or overwritten but those preferences.
   */
  async restore(input: RestoreEnvironment): Promise<EnvironmentRestore> {
    const { full, exists } = await this.place(false);
    const saved = exists ? (await this.read(full))?.value : undefined;
    if (!saved)
      throw Error(
        t(
          'この GitHub アカウントには保存された環境がありません。',
          'This GitHub account has no saved environment.',
        ),
      );
    const result: EnvironmentRestore = {
      restored: [],
      failed: [],
      workspaces: 0,
      routines: [],
      agentFiles: [],
      agentFilesKept: [],
      secrets: [],
      agent: 'unchanged',
    };
    // A wrong passphrase stops the restore before anything is cloned.
    if (input.secrets?.length) result.secrets = await this.restoreKeys(full, input);
    const parent = input.parent ?? (await this.host.defaultParent());
    await fs.mkdir(parent, { recursive: true });
    // A saved vault's id here: its own, or that of a checkout of the same repository.
    const ids = new Map<string, string>();
    const here = await this.vaults();
    for (const item of saved.vaults) {
      const local = here.find(
        ({ space, repository }) =>
          space.scopeId === item.scopeId || same(repository, item.repository),
      );
      if (local) ids.set(item.scopeId, local.space.scopeId);
    }
    for (const item of saved.vaults) {
      if (ids.has(item.scopeId) || !input.scopeIds.includes(item.scopeId)) continue;
      try {
        const folder = item.repository.split('/')[1];
        const destination = path.join(parent, folder);
        let root: string;
        if (await fs.stat(destination).catch(() => undefined)) {
          // A checkout of the same repository there already is registered as it is.
          const info = await inspectRepository(destination);
          if (!same(info.repository, item.repository))
            throw Error(t(`${destination} はすでにあります。`, `${destination} already exists.`));
          root = info.root;
        } else
          root = (
            await this.host.git.clone(
              { url: await this.url(item.repository), parent, name: folder },
              true,
            )
          ).path;
        const space = await this.host.register(root, item.name, 'personal');
        ids.set(item.scopeId, space.scopeId);
        result.restored.push(space.name);
      } catch (error) {
        result.failed.push({ name: item.name, message: (error as Error).message });
      }
    }
    if (saved.agent && input.agent)
      result.agent = await this.restoreAgent(saved.agent.repository, result);
    // Its files before its routines, which need it set up.
    if (input.agentFiles && result.agent !== 'failed') await this.restoreFiles(full, result);
    if (input.routines?.length) await this.restoreRoutines(full, input.routines, result);
    const mapped = saved.workspaces.map((profile) => {
      const scopeIds = [...new Set(profile.scopeIds.map((id) => ids.get(id) ?? id))];
      const groups = (profile.groups ?? []).map((group) => ({
        ...group,
        scopeIds: group.scopeIds.map((id) => ids.get(id) ?? id),
      }));
      return { ...profile, scopeIds, groups };
    });
    result.workspaces = await this.host.workspaces.adopt(mapped);
    await this.host.settings.save(saved.preferences);
    return result;
  }
  /**
   * Opens the saved secrets with the passphrase and seals the chosen ones this
   * device lacks with its own key. A secret already here is left as it is.
   */
  private async restoreKeys(full: string, input: RestoreEnvironment) {
    const saved = (await this.readKeys(full))?.value;
    if (!saved)
      throw Error(
        t(
          'この GitHub アカウントには保存されたシークレットがありません。',
          'This GitHub account has no saved secrets.',
        ),
      );
    if (!input.passphrase)
      throw Error(
        t('シークレットの復元には合言葉が必要です。', 'Restoring secrets needs the passphrase.'),
      );
    const values = await openKeys(saved, input.passphrase);
    const here = (await this.host.secrets.list()).names;
    const added = Object.fromEntries(
      Object.entries(values).filter(
        ([name]) => input.secrets!.includes(name) && !here.includes(name),
      ),
    );
    if (Object.keys(added).length) await this.host.secrets.update(added);
    return Object.keys(added);
  }
  /** Adds the irori agent's saved files this device lacks, after its folder was cloned if it was. */
  private async restoreFiles(full: string, result: EnvironmentRestore) {
    const saved = (await this.readAgentFiles(full))?.value.files ?? [];
    if (!saved.length) return;
    try {
      const { added, kept } = await restoreAgentFiles(await this.host.agentRoot(), saved);
      result.agentFiles = added;
      result.agentFilesKept = kept;
    } catch (error) {
      result.failed.push({ name: 'irori agent', message: (error as Error).message });
    }
  }
  /**
   * Adds the chosen saved routines to the irori agent's folder, after it was
   * cloned if it was. A routine folder already here is left as it is.
   */
  private async restoreRoutines(full: string, folders: string[], result: EnvironmentRestore) {
    const saved = (await this.readRoutines(full))?.value.routines ?? [];
    const root = await this.host.agentRoot();
    const ready = await agentReady(root);
    for (const routine of saved) {
      if (!folders.includes(routine.folder) || (await routineHere(root, routine.folder))) continue;
      try {
        // Files in an absent folder would keep the irori agent from being set up there.
        if (!ready)
          throw Error(
            t(
              'irori agent が用意されていないため、ルーティンを追加できません。',
              'The irori agent is not set up, so its routines cannot be added.',
            ),
          );
        await addRoutine(root, routine);
        result.routines.push(routine.name);
      } catch (error) {
        result.failed.push({ name: routine.name, message: (error as Error).message });
      }
    }
  }
  /** Clones the irori agent's folder where it is absent or empty. */
  private async restoreAgent(repository: string, result: EnvironmentRestore) {
    const root = await this.host.agentRoot();
    try {
      const entries = await ifPresent(fs.readdir(root));
      if (entries?.length) {
        if (same((await inspectRepository(root)).repository, repository)) return 'unchanged';
        throw Error(t(`${root} にはすでにファイルがあります。`, `${root} already holds files.`));
      }
      if (entries) await fs.rmdir(root);
      else await fs.mkdir(path.dirname(root), { recursive: true });
      await this.host.git.clone(
        { url: await this.url(repository), parent: path.dirname(root), name: path.basename(root) },
        true,
      );
      return 'restored';
    } catch (error) {
      result.failed.push({ name: 'irori agent', message: (error as Error).message });
      return 'failed';
    }
  }
}
