import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  commentAdded,
  commentResolved,
  folderConnected,
  folderDisconnected,
  repositoryConnected,
  vaultChanged,
  vaultList,
  vaultRegistered,
  vaultRemoved,
  indexUpdated,
  ontologyChecked,
  callRefused,
  iroriCommandHelp,
  layerChosen,
  workFolderChosen,
  noteMoved,
  noteTrashed,
  routineList,
  workspaceSaved,
  routineRunRefused,
  routineStarted,
  sshHostList,
  hostFolders,
  hostAdded,
  noteMovedAcross,
  entryCopied,
  routineStopped,
  connectionChanged,
  strayList,
  strayAdopted,
  strayRemoved,
  standardSkills,
  pythonInstalled,
  workspaceRenamed,
  workspaceDeleted,
  workspaceGrouped,
  type ListedVault,
} from '../../prompts';
import { parseIroriCommand } from '../domain/irori-command';
import type {
  AgentId,
  Category,
  Entry,
  EntryMove,
  LayerFolderRename,
  Space,
  SpaceChange,
  VaultGroup,
  WorkspaceProfile,
} from '../domain/types';
import { randomUUID } from 'node:crypto';
import type { SshConfigHost } from '../domain/remote-hosts';
import type { YourAiService } from './you';
import {
  defaultLayerLabel,
  hasLayer,
  knowledgeFolder,
  layerFolder,
  layerLabel,
  namedLayers,
  shownFolder,
  vaultLayers,
  type NamedLayer,
} from '../domain/layers';
import { categoryName } from '../domain/brains';
import type { Routine, RoutineRef, RunRoutine } from '../domain/routines';
import type { NewComment, NoteComment } from '../domain/comments';
import type { IndexUpdate } from '../domain/bundle';
import type { Ontology } from '../domain/ontology';
import { ownLayer, owner } from '../domain/scopes';
import { brainAgentNames } from '../domain/you';
import type { CloudService } from '../cloud/service';
import { githubCloneURL, type GitService } from '../git/service';
import type { FileService } from './files';
import { inspectRepository, type WorkspaceService } from './workspaces';
import { imageType } from './images';
import { githubRepository, repositoryFolder } from '../domain/git';
import { renameLayerFolder } from './layer-folders';
import type { WorkFolders } from './work-folders';
import type { RemoteHosts } from './remote-hosts';

/** What the `irori` command reaches in the host. */
export interface AgentSetupHost {
  files: FileService;
  git: Pick<GitService, 'clone' | 'create' | 'abandon' | 'firstCommit'>;
  workspaces: Pick<WorkspaceService, 'list' | 'update'> &
    Partial<Pick<WorkspaceService, 'forget' | 'save' | 'remove' | 'saveGroups'>>;
  cloud: Pick<
    CloudService,
    | 'addLocal'
    | 'addRepository'
    | 'bindLocal'
    | 'cloneRepository'
    | 'connect'
    | 'connections'
    | 'disconnect'
    | 'edit'
    | 'suspend'
    | 'resume'
  > &
    Partial<Pick<CloudService, 'setAccess' | 'strays' | 'adoptStray' | 'removeStray'>>;
  /** The folder each vault's agents work in. */
  work?: Pick<WorkFolders, 'folder' | 'choose'>;
  /** Where new vaults go when the command names no parent folder. */
  defaultParent: () => Promise<string>;
  /** The person's SSH hosts and their vaults, where `--host` makes a vault (ADR 061, ADR 074). */
  remote?: Pick<
    RemoteHosts,
    'hosts' | 'list' | 'register' | 'create' | 'folders' | 'saveHost' | 'unregister'
  >;
  /** The hosts the person's ssh configuration names, offered as SSH hosts to add. */
  sshConfigHosts?: () => Promise<SshConfigHost[]>;
  /** Moves knowledge into another vault's, as the explorer's move to a vault does (ADR 038). */
  moveToVault?: (
    scopeId: string,
    from: string,
    toScopeId: string,
    directory: string,
  ) => Promise<EntryMove>;
  /** How many links such a move would break. */
  vaultMoveLinks?: (
    scopeId: string,
    from: string,
  ) => Promise<{ links: number; incomplete: boolean }>;
  /** Copies a file or folder into a folder of any vault, as the explorer's paste does. */
  copyEntry?: (
    scopeId: string,
    from: string,
    toScopeId: string,
    directory: string,
  ) => Promise<Entry>;
  /** Ends a routine's run in progress, as 停止 does. */
  stopRoutine?: (ref: RoutineRef) => Promise<void>;
  /** Downloads uv for the Python steps of routines, as the routines page does. */
  installPython?: () => Promise<void>;
  /** The irori agent's standard skills, as its screen adds them. */
  skills?: Pick<
    YourAiService,
    'standardSkillState' | 'addStandardSkills' | 'replaceStandardSkills'
  >;
  /** Registers through the host's own guards and starts watching the vault. */
  register?: (
    root: string,
    name: string,
    category?: Category,
    layers?: NamedLayer[],
  ) => Promise<Space>;
  /** Changes a vault's name, category or layer names, as its settings do. */
  update?: (scopeId: string, change: SpaceChange) => Promise<Space>;
  /** Names or renames a vault's knowledge or contents folder, carrying what names it (ADR 024). */
  renameLayer?: (scopeId: string, layer: NamedLayer, name: string) => Promise<LayerFolderRename>;
  /** Declares a folder the vault has as contents too. */
  declareContents?: (scopeId: string, folder: string) => Promise<Space>;
  /** Takes a vault off this device and out of every workspace; `trash` moves its folder there. */
  remove?: (scopeId: string, trash: boolean) => Promise<void>;
  /** The irori agent's routines and those of the workspace's vaults, or one vault's alone. */
  routines?: (workspaceId: string | undefined, only?: string) => Promise<Routine[]>;
  /** Moves a note, file or folder of knowledge as the explorer does: links, comments and records follow (ADR 031). */
  moveNote?: (
    scopeId: string,
    from: string,
    to: string,
  ) => Promise<{
    path: string;
    links?: { notes: number; links: number; skipped: string[] };
    notice?: string;
  }>;
  /** Moves a knowledge note to irori's trash, from which the person restores it. */
  trashNote?: (scopeId: string, notePath: string) => Promise<void>;
  /** Adds a comment to a file, signed as the agent. */
  addComment?: (
    scopeId: string,
    file: string,
    comment: NewComment,
    by: string,
  ) => Promise<NoteComment[]>;
  /** Removes one comment from a file, refusing an id it does not hold. */
  removeComment?: (scopeId: string, file: string, id: string) => Promise<NoteComment[]>;
  /** Writes the vault's folder indexes, as 索引を更新 does. */
  updateIndex?: (scopeId: string) => Promise<IndexUpdate>;
  /** The vault's declared types and relations applied to its pages (ADR 060). Writes nothing. */
  checkOntology?: (scopeId: string) => Promise<Ontology>;
  /** Starts a routine as 実行 does, without a review: only reviewed files run (ADR 016 D4). */
  runRoutine?: (ref: RoutineRef, input: RunRoutine) => Promise<string>;
  /** Whether a run of the vault's own agent is in progress there. */
  running?: (scopeId: string) => boolean;
  /** Tells the window what changed: the vaults and a workspace, or one vault's files. */
  announce?: (change: { workspace?: WorkspaceProfile; scopeId?: string }) => void;
  /**
   * Asks the person before a command that widens what agents reach or starts
   * work (`confirmed`); without it, as in tests, the command runs.
   */
  confirm?: (command: string, by: string) => Promise<boolean>;
  home?: string;
}

/** Where a request came from. */
export interface SetupContext {
  /**
   * The vault whose own agent runs the command (ADR 031). It reaches that
   * vault alone and none of the forms that register, group or remove
   * vaults or start routines.
   */
  vault?: string;
  /** Who signs what the agent writes in irori's name, such as a comment. */
  by?: string;
  /** The workspace the request was sent in, which new vaults join. */
  workspaceId?: string;
  /** The CLI, model and thinking level the request runs on, for the agent steps of a routine it starts. */
  agent?: { agent: AgentId; model?: string; effort?: string };
  /** The vaults handed to an irori-agent run; other vaults are refused for mutations. */
  handedScopes?: string[];
  /** The request is an agent step of a routine, which starts none (D6). */
  inRoutine?: boolean;
}

type Joined = 'joined' | 'member' | 'no workspace';

/** Forms only the irori agent has: they register, group or remove vaults, or start routines. */
const irori = new Set([
  'clone',
  'create',
  'add',
  'hosts',
  'workspace',
  'remove',
  'run',
  'stop',
  'skills',
  'install',
]);
/**
 * Forms the person confirms each time: they add a folder agents may write in,
 * clone, create, register or remove a vault, or start a routine with its secrets. Any process
 * the agent starts holds the command too, so a request alone is not enough.
 */
const confirmed = new Set([
  'clone',
  'create',
  'add',
  'connect',
  'work',
  'remove',
  'run',
  'install',
]);
/** The forms the person confirms only in one of their variants. */
const confirmedWhen = (command: ReturnType<typeof parseIroriCommand>) =>
  confirmed.has(command.kind) ||
  (command.kind === 'hosts' && !!command.add) ||
  (command.kind === 'workspace' && !!command.delete) ||
  (command.kind === 'strays' && !!command.remove) ||
  (command.kind === 'skills' && command.update);

/**
 * Carries out the irori agent's `irori` command: what the person does in
 * irori's dialogs to set vaults up (ADR 025, ADR 030). Clones and new
 * vaults go only into new folders, so they wait for no run; a change to a
 * registered vault waits for its own agent, as connecting a folder does.
 */
export class AgentSetup {
  constructor(private host: AgentSetupHost) {}
  private get home() {
    return this.host.home ?? os.homedir();
  }
  /** A folder the agent named, from its working folder, with `~` as the home folder. */
  private folder(cwd: string, value: string) {
    const expanded =
      value === '~'
        ? this.home
        : /^~[\\/]/.test(value)
          ? path.join(this.home, value.slice(2))
          : value;
    return path.resolve(cwd, expanded);
  }
  private async parent(cwd: string, value?: string) {
    const parent = value ? this.folder(cwd, value) : await this.host.defaultParent();
    await fs.mkdir(parent, { recursive: true });
    return parent;
  }
  async run(argv: string[], cwd: string, context: SetupContext = {}): Promise<string> {
    // The agent service answers `irori call` itself where it hands work over.
    if (argv[0] === 'call') throw Error(callRefused(!!context.vault));
    const command = parseIroriCommand(argv);
    if (context.vault && irori.has(command.kind))
      throw Error(
        `"irori ${command.kind}" is the irori agent's. Ask the person to ask the irori agent in irori mode.`,
      );
    const relativePathArg =
      command.kind === 'add'
        ? !command.host && !path.isAbsolute(command.folder) && !/^~(?:[\\/]|$)/.test(command.folder)
        : command.kind === 'connect'
          ? !command.repository &&
            !path.isAbsolute(command.folder) &&
            !/^~(?:[\\/]|$)/.test(command.folder)
          : command.kind === 'work'
            ? !!command.folder &&
              !path.isAbsolute(command.folder) &&
              !/^~(?:[\\/]|$)/.test(command.folder)
            : (command.kind === 'clone' || command.kind === 'create') && !command.host
              ? !!command.parent &&
                !path.isAbsolute(command.parent) &&
                !/^~(?:[\\/]|$)/.test(command.parent)
              : false;
    const shownCommand = `irori ${argv.join(' ')}${relativePathArg ? ` (in ${cwd})` : ''}`.slice(
      0,
      2000,
    );
    if (
      confirmedWhen(command) &&
      this.host.confirm &&
      !(await this.host.confirm(shownCommand, context.by ?? 'agent'))
    )
      throw Error(
        `The person did not allow "irori ${command.kind}". Do not try it again unless they ask.`,
      );
    switch (command.kind) {
      case 'help':
        return iroriCommandHelp(await this.host.defaultParent(), !!context.vault);
      case 'list':
        return this.list(context);
      case 'hosts':
        return this.hosts(command);
      case 'routines': {
        if (!this.host.routines) throw Error('Routines are not available here.');
        const workspace = context.vault ? undefined : await this.workspace(context);
        const spaces = this.host.files.list();
        return routineList(
          (await this.host.routines(workspace?.id, context.vault)).map((routine) => ({
            ...routine,
            vault: spaces.find((space) => space.scopeId === routine.ref.owner)?.name,
          })),
          workspace?.name,
        );
      }
      case 'clone':
      case 'create':
        if (command.host) return this.onHost(command, command.host, context);
        return command.kind === 'clone'
          ? this.clone(command, cwd, context)
          : this.create(command, cwd, context);
      case 'add':
        if (command.host) return this.onHost(command, command.host, context);
        return this.add(this.folder(cwd, command.folder), command, context);
      case 'connect':
        return this.connect(command, cwd, context);
      case 'disconnect':
        return this.disconnect(command, cwd, context);
      case 'set':
        return this.set(command, cwd, context);
      case 'layer':
        return this.layer(command, cwd, context);
      case 'work':
        return this.work(command, cwd, context);
      case 'workspace':
        return this.saveWorkspace(command, cwd, context);
      case 'remove':
        return this.remove(command, cwd, context);
      case 'run':
        return this.startRoutine(command, cwd, context);
      case 'stop':
        return this.stopRoutine(command, cwd, context);
      case 'copy':
        return this.copy(command, cwd, context);
      case 'connection':
        return this.connection(command, cwd, context);
      case 'strays':
        return this.strays(command, cwd, context);
      case 'skills':
        return this.standardSkills(command);
      case 'install': {
        if (!this.host.installPython) throw Error('Installing Python is not available here.');
        await this.host.installPython();
        return pythonInstalled();
      }
      case 'move':
        return this.moveNote(command, cwd, context);
      case 'trash':
        return this.trashNote(command, cwd, context);
      case 'comment':
        return this.comment(command, cwd, context);
      case 'resolve':
        return this.resolve(command, cwd, context);
      case 'index':
        return this.index(command, cwd, context);
      case 'check':
        return this.check(command, cwd, context);
    }
  }
  private async workspace(context: SetupContext) {
    if (!context.workspaceId) return undefined;
    return (await this.host.workspaces.list()).find((item) => item.id === context.workspaceId);
  }
  private async list(context: SetupContext) {
    const workspace = await this.workspace(context);
    const spaces = this.host.files.list();
    const vaults: ListedVault[] = [];
    // A vault agent sees its own vault alone.
    for (const space of spaces.filter((item) => !context.vault || item.scopeId === context.vault))
      vaults.push({
        name: space.name,
        root: space.root,
        repository: (await inspectRepository(space.root)).repository,
        inWorkspace: !!workspace?.scopeIds.includes(space.scopeId),
        ...(space.category && { category: categoryName(space.category) }),
        ...(hasLayer(space, 'Knowledge_Base') && {
          knowledge: shownFolder(knowledgeFolder(space)),
        }),
        ...(hasLayer(space, 'contents') && { contents: space.contents }),
        without: namedLayers
          .filter((layer) => !hasLayer(space, layer))
          .map((layer) => defaultLayerLabel(layer)),
        ...(ownLayer(space) !== 'Knowledge_Base' && { own: defaultLayerLabel(ownLayer(space)) }),
        connections: (await this.host.cloud.connections(space.scopeId).catch(() => [])).map(
          (item) => ({
            name: item.name,
            contentsRoot: item.contentsRoot,
            state: item.state,
            readOnly: item.access === 'read-only',
            ...(item.provider === 'github' && { repository: githubRepository(item.url) }),
          }),
        ),
        ...(this.host.work && { work: (await this.host.work.folder(space.scopeId)).path }),
      });
    // The vaults on SSH hosts, which only the irori agent sees.
    const far = context.vault ? [] : (this.host.remote?.list() ?? []);
    for (const space of far)
      vaults.push({
        name: space.name,
        root: space.root,
        host: space.host.name,
        inWorkspace: !!workspace?.scopeIds.includes(space.scopeId),
        ...(space.category && { category: categoryName(space.category) }),
        ...(hasLayer(space, 'Knowledge_Base') && {
          knowledge: shownFolder(knowledgeFolder(space)),
        }),
        ...(hasLayer(space, 'contents') && { contents: space.contents }),
        without: namedLayers
          .filter((layer) => !hasLayer(space, layer))
          .map((layer) => defaultLayerLabel(layer)),
      });
    const names = (scopeIds: string[]) =>
      scopeIds.map(
        (id) => [...spaces, ...far].find((space) => space.scopeId === id)?.name ?? 'unavailable',
      );
    return vaultList(
      vaults,
      await this.host.defaultParent(),
      workspace?.name,
      context.vault
        ? []
        : (await this.host.workspaces.list()).map((item) => ({
            name: item.name,
            vaults: names(item.scopeIds),
          })),
      !!context.vault,
    );
  }
  /** Adds the vault to the request's workspace, unless it is in it already. */
  private async join(scopeId: string, context: SetupContext) {
    const workspace = await this.workspace(context);
    let joined: Joined = 'no workspace';
    let saved: WorkspaceProfile | undefined;
    if (workspace) {
      // Read again when saved: another run may have changed the workspace meanwhile.
      ({ saved } = await this.host.workspaces.update(workspace, (current) =>
        current && !current.scopeIds.includes(scopeId) ? [...current.scopeIds, scopeId] : undefined,
      ));
      joined = saved ? 'joined' : 'member';
    }
    this.host.announce?.({ workspace: saved });
    return joined;
  }
  private async registered(root: string) {
    const real = await fs.realpath(root).catch(() => root);
    return this.host.files.list().find((space) => space.root === real);
  }
  private register(root: string, name: string, category?: Category, layers?: NamedLayer[]) {
    return this.host.register
      ? this.host.register(root, name, category, layers)
      : this.host.files.register(root, name, category, layers);
  }
  private async clone(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'clone' }>,
    cwd: string,
    context: SetupContext,
  ) {
    const repository = githubRepository(command.url);
    if (!repository || !githubCloneURL(command.url))
      throw Error(
        `"${command.url}" is not a GitHub repository. Give its URL or owner/name, for example octo/notes.`,
      );
    const same = (other?: string) => other?.toLowerCase() === repository.toLowerCase();
    // A repository registered already joins the workspace rather than being cloned again.
    for (const space of this.host.files.list())
      if (same((await inspectRepository(space.root)).repository))
        return vaultRegistered(
          { name: space.name, root: space.root, repository },
          { already: true, joined: await this.join(space.scopeId, context) },
        );
    const parent = await this.parent(cwd, command.parent);
    const folder = command.folder ?? repository.split('/')[1];
    const destination = path.join(parent, folder);
    const existing = await fs.stat(destination).catch(() => undefined);
    if (existing) {
      // The same repository cloned there before is registered as it is.
      if (existing.isDirectory() && same((await inspectRepository(destination)).repository))
        return this.add(destination, command, context);
      throw Error(
        `${JSON.stringify(destination)} already exists. Name another folder with --folder, or register a checkout with "irori add".`,
      );
    }
    const cloned = await this.host.git.clone({ url: command.url, parent, name: folder }, true);
    const space = await this.register(
      cloned.path,
      command.name ?? repository.split('/')[1],
      command.category,
      command.layers,
    );
    return vaultRegistered(
      { name: space.name, root: space.root, repository },
      { already: false, joined: await this.join(space.scopeId, context), notice: cloned.notice },
    );
  }
  private async create(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'create' }>,
    cwd: string,
    context: SetupContext,
  ) {
    const parent = await this.parent(cwd, command.parent);
    const root = await this.host.git.create({ parent, folder: command.folder }, true);
    let space: Space;
    try {
      space = await this.register(
        root,
        command.name ?? command.folder,
        command.category,
        command.layers,
      );
    } catch (error) {
      await this.host.git.abandon(root);
      throw error;
    }
    const notice = await this.host.git.firstCommit(space.scopeId, true);
    return vaultRegistered(
      { name: space.name, root: space.root },
      { already: false, joined: await this.join(space.scopeId, context), notice },
    );
  }
  private async add(
    root: string,
    command: { name?: string; category?: Category; layers?: NamedLayer[] },
    context: SetupContext,
  ) {
    const found = await this.registered(root);
    if (found)
      return vaultRegistered(
        {
          name: found.name,
          root: found.root,
          repository: (await inspectRepository(found.root)).repository,
        },
        { already: true, joined: await this.join(found.scopeId, context) },
      );
    const inspection = await inspectRepository(root);
    if (inspection.kind === 'unavailable')
      throw Error(`${JSON.stringify(root)} cannot be a vault: ${inspection.detail}`);
    const space = await this.register(
      inspection.root,
      command.name ?? path.basename(inspection.root),
      command.category,
      command.layers,
    );
    return vaultRegistered(
      { name: space.name, root: space.root, repository: inspection.repository },
      { already: false, joined: await this.join(space.scopeId, context) },
    );
  }
  private get remote() {
    if (!this.host.remote) throw Error('SSH hosts are not available here.');
    return this.host.remote;
  }
  /** The SSH host a command names, by its name or its destination. */
  private sshHost(name: string) {
    const hosts = this.remote.hosts();
    const wanted = name.trim().toLowerCase();
    const found = hosts.filter(
      (item) => item.name.toLowerCase() === wanted || item.destination.toLowerCase() === wanted,
    );
    if (found.length === 1) return found[0];
    if (found.length)
      throw Error(
        `More than one SSH host is named "${name}": ${found.map((item) => item.destination).join(', ')}. Name it by its destination.`,
      );
    throw Error(
      hosts.length
        ? `No SSH host is named "${name}". irori has ${hosts.map((item) => JSON.stringify(item.name)).join(', ')}; "irori hosts" lists them. Another host is added by the person in irori's settings, under SSH ホスト (SSH hosts).`
        : `irori has no SSH hosts. The person adds "${name}" in irori's settings, under SSH ホスト (SSH hosts), first.`,
    );
  }
  /** A folder on a host: absolute, or taken from the host's home folder. */
  private async hostFolder(hostId: string, value?: string) {
    if (value?.startsWith('/')) return value;
    const home = (await this.remote.folders(hostId)).path;
    if (!value || value === '~') return home;
    return path.posix.join(home, value.startsWith('~/') ? value.slice(2) : value);
  }
  /** `irori hosts`: the SSH hosts, or the folders in a folder of one. */
  private async hosts(command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'hosts' }>) {
    if (command.add) {
      const { destination, name, port } = command.add;
      const same = this.remote
        .hosts()
        .find((item) => item.destination === destination && item.port === port);
      if (same) return hostAdded(same.name, destination, true);
      const saved = await this.remote.saveHost({
        name: name ?? destination.slice(0, 60),
        destination,
        ...(port && { port }),
      });
      return hostAdded(saved.name, destination, false);
    }
    if (!command.host) {
      const vaults = this.host.remote?.list() ?? [];
      const hosts = this.host.remote?.hosts() ?? [];
      const configured = (await this.host.sshConfigHosts?.().catch(() => [])) ?? [];
      return sshHostList(
        hosts.map((item) => ({
          name: item.name,
          destination: item.port ? `${item.destination}:${item.port}` : item.destination,
          state: item.state,
          vaults: vaults.filter((vault) => vault.host.id === item.id).map((vault) => vault.name),
        })),
        configured
          .filter((item) => !hosts.some((host) => host.destination === item.alias))
          .map((item) => item.alias),
      );
    }
    const host = this.sshHost(command.host);
    return hostFolders(
      host.name,
      await this.remote.folders(host.id, await this.hostFolder(host.id, command.folder)),
    );
  }
  /**
   * `irori clone`, `create` and `add` with `--host` (ADR 074): the vault is made
   * or registered on that SSH host, as the window's 「SSH ホストのフォルダを vault にする」
   * does, and joins the request's workspace.
   */
  private async onHost(
    command: Extract<
      ReturnType<typeof parseIroriCommand>,
      { kind: 'clone' } | { kind: 'create' } | { kind: 'add' }
    >,
    name: string,
    context: SetupContext,
  ) {
    const host = this.sshHost(name);
    const before = new Set(this.remote.list().map((vault) => vault.scopeId));
    let vault: Space;
    let notice: string | undefined;
    let repository: string | undefined;
    if (command.kind === 'add') {
      const root = await this.hostFolder(host.id, command.folder);
      vault = await this.remote.register(
        host.id,
        root,
        command.name ?? (path.posix.basename(root) || root),
        command.category,
        command.layers,
      );
    } else {
      if (command.kind === 'clone') {
        repository = githubRepository(command.url);
        if (!repository || !githubCloneURL(command.url))
          throw Error(
            `"${command.url}" is not a GitHub repository. Give its URL or owner/name, for example octo/notes.`,
          );
      }
      const folder =
        command.kind === 'clone' ? (command.folder ?? repository!.split('/')[1]) : command.folder;
      ({ vault, notice } = await this.remote.create(host.id, {
        ...(command.parent && { parent: await this.hostFolder(host.id, command.parent) }),
        folder,
        name: command.name ?? (command.kind === 'clone' ? repository!.split('/')[1] : folder),
        ...(command.category && { category: command.category }),
        ...(command.layers && { layers: command.layers }),
        ...(command.kind === 'clone' && { url: command.url }),
      }));
    }
    return vaultRegistered(
      { name: vault.name, root: vault.root, host: host.name, repository },
      {
        already: before.has(vault.scopeId),
        joined: await this.join(vault.scopeId, context),
        notice,
      },
    );
  }
  /**
   * Starts a routine the person asked the irori agent to run (ADR 016 D6). It
   * runs only as reviewed on this device, so the agent cannot run files the
   * person has not seen. The routine's secrets go to its programs inside the
   * host; the agent gets back only that it started.
   */
  private async startRoutine(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'run' }>,
    cwd: string,
    context: SetupContext,
  ) {
    if (!this.host.routines || !this.host.runRoutine)
      throw Error('Routines are not available here.');
    if (context.inRoutine) throw Error(routineRunRefused.inRoutine);
    const { routine, workspace } = await this.findRoutine(command, cwd, context);
    if (routine.problem) throw Error(routineRunRefused.problem(routine.problem));
    if (routine.needs) throw Error(routineRunRefused.needs(routine.needs.text));
    if (routine.review !== 'reviewed') throw Error(routineRunRefused.review(routine.review));
    if (routine.running) throw Error(routineRunRefused.running);
    await this.host.runRoutine!(routine.ref, {
      workspaceId: workspace.id,
      agents: context.agent ? { [routine.ref.owner]: context.agent } : {},
    });
    return routineStarted(
      routine.name,
      routine.steps.some((step) => step.kind === 'agent'),
    );
  }
  /** `irori stop`: ends the routine's run in progress, as 停止 does. */
  private async stopRoutine(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'stop' }>,
    cwd: string,
    context: SetupContext,
  ) {
    if (!this.host.stopRoutine) throw Error('Routines are not available here.');
    const { routine } = await this.findRoutine(command, cwd, context);
    if (!routine.running) return routineStopped(routine.name, false);
    await this.host.stopRoutine(routine.ref);
    return routineStopped(routine.name, true);
  }
  /** The one routine a command names, among this request's workspace's. */
  private async findRoutine(
    command: { routine: string; vault?: string },
    cwd: string,
    context: SetupContext,
  ) {
    if (!this.host.routines) throw Error('Routines are not available here.');
    const workspace = await this.workspace(context);
    if (!workspace) throw Error(routineRunRefused.noWorkspace);
    const owner = command.vault ? this.vault(command.vault, cwd).scopeId : undefined;
    let found = (await this.host.routines(workspace.id)).filter(
      (routine) =>
        (routine.name === command.routine || routine.ref.folder === command.routine) &&
        (!owner || routine.ref.owner === owner),
    );
    // Without --vault, the irori agent's own routine of that name comes first.
    if (!owner && found.some((routine) => routine.owner === 'irori'))
      found = found.filter((routine) => routine.owner === 'irori');
    if (!found.length) throw Error(routineRunRefused.notFound(command.routine));
    if (found.length > 1) {
      const spaces = this.host.files.list();
      throw Error(
        routineRunRefused.ambiguous(
          command.routine,
          found.map((routine) => ({
            folder: routine.ref.folder,
            vault: spaces.find((space) => space.scopeId === routine.ref.owner)?.name,
          })),
        ),
      );
    }
    return { routine: found[0], workspace };
  }
  /** The registered vault a command names: by name, sub-agent name or folder. */
  private vault(name: string, cwd: string, scope?: string, handed?: string[]) {
    const spaces = this.host.files.list();
    const agents = brainAgentNames(spaces);
    const folder = this.folder(cwd, name);
    const wanted = name.trim().toLowerCase();
    const found = spaces.filter(
      (space) =>
        space.name.trim().toLowerCase() === wanted ||
        agents.get(space.scopeId) === name.trim() ||
        space.root === folder,
    );
    if (found.length === 1) return this.allowed(found[0], scope, handed);
    if (found.length)
      throw Error(
        `More than one vault is named "${name}". Name it by its folder: ${found.map((space) => JSON.stringify(space.root)).join(', ')}.`,
      );
    if (this.remote_(name).length)
      throw Error(
        `"${name}" is a vault on an SSH host. This form reaches vaults on this computer; on an SSH host, "irori workspace" and "irori remove" do, and its own agent does the rest.`,
      );
    throw Error(`No vault is named "${name}". Run "irori list" for their names and folders.`);
  }
  /** The vaults on SSH hosts a command's word names, by name or folder there. */
  private remote_(name: string) {
    const wanted = name.trim().toLowerCase();
    return (this.host.remote?.list() ?? []).filter(
      (vault) => vault.name.trim().toLowerCase() === wanted || vault.root === name,
    );
  }
  /** A vault on this computer or on an SSH host, for the forms that reach both. */
  private anyVault(name: string, cwd: string): Space & { host?: { id: string; name: string } } {
    const far = this.remote_(name);
    let here: Space | undefined;
    try {
      here = this.vault(name, cwd);
    } catch (error) {
      if (!far.length) throw error;
    }
    if ((here ? 1 : 0) + far.length > 1)
      throw Error(
        `More than one vault is named "${name}". Name it by its folder: ${[...(here ? [here] : []), ...far].map((space) => JSON.stringify(space.root)).join(', ')}.`,
      );
    return here ?? far[0];
  }
  /** A folder of a vault this run reaches, its root included. */
  private async locatedFolder(
    cwd: string,
    folder: string,
    scope: string | undefined,
    handed?: string[],
  ) {
    const absolute = this.folder(cwd, folder);
    const space = owner(this.host.files.list(), absolute);
    const directory = await fs
      .stat(absolute)
      .then((stat) => stat.isDirectory())
      .catch(() => false);
    if (!space || !directory) throw Error(`${JSON.stringify(folder)} is not a folder in a vault.`);
    return {
      space: this.allowed(space, scope, handed),
      path: path.relative(space.root, absolute).split(path.sep).join('/'),
    };
  }
  /** Refuses another vault to a vault agent's command, or an unhanded vault when scopes were handed. */
  private allowed(space: Space, scope: string | undefined, handed?: string[]) {
    if (scope && space.scopeId !== scope)
      throw Error(
        `You are the vault agent of another vault; "${space.name}" is not yours. Ask the person to ask the irori agent.`,
      );
    if (!scope && handed && !handed.includes(space.scopeId))
      throw Error(
        `The vault "${space.name}" was not handed to this request. Ask the person to include it.`,
      );
    return space;
  }
  /** The vault a file is in, and the file's path in it, refused outside the vaults this run reaches. */
  private located(cwd: string, file: string, scope: string | undefined, handed?: string[]) {
    const absolute = this.folder(cwd, file);
    const space = owner(this.host.files.list(), absolute);
    if (!space || absolute === space.root)
      throw Error(`${JSON.stringify(file)} is not a file in a vault.`);
    return {
      space: this.allowed(space, scope, handed),
      path: path.relative(space.root, absolute).split(path.sep).join('/'),
    };
  }

  private async connect(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'connect' }>,
    cwd: string,
    context: SetupContext,
  ) {
    // A folder connected only adds to contents, so it goes on during the vault's run (ADR 042 D2).
    const space = this.vault(command.vault, cwd, context.vault, context.handedScopes);
    if (command.repository) return this.connectRepository(space, command, cwd);
    const folder = this.folder(cwd, command.folder);
    const contentsRoot = space.contents[0];
    const connection = await this.host.cloud.addLocal({
      scopeId: space.scopeId,
      path: folder,
      contentsRoot,
      name: command.name ?? path.basename(folder),
      access: command.readOnly ? 'read-only' : 'read-write',
    });
    try {
      await this.host.cloud.connect(space.scopeId, connection.mountId);
    } finally {
      this.host.announce?.({ scopeId: space.scopeId });
    }
    return folderConnected(space.name, {
      name: connection.name,
      contentsRoot,
      readOnly: command.readOnly,
      folder,
    });
  }
  /**
   * Shows a GitHub repository in the vault's contents (ADR 046), from a clone
   * irori makes in `--into` or an existing one. A repository the vault already
   * records but this computer has no clone of is cloned for that record.
   */
  private async connectRepository(
    space: Space,
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'connect' }>,
    cwd: string,
  ) {
    const { into, existing, branch } = command.repository!;
    if (!into && !existing)
      throw Error(
        'Say where the clone goes with --into <folder>, or name a clone already on this computer with --existing <folder>. Ask the person which they want.',
      );
    const folder = this.folder(cwd, (into ?? existing)!);
    const wanted = githubRepository(command.folder)!.toLowerCase();
    const recorded = (await this.host.cloud.connections(space.scopeId)).find(
      (item) => item.provider === 'github' && githubRepository(item.url)?.toLowerCase() === wanted,
    );
    if (recorded && recorded.state !== 'unconfigured')
      throw Error(
        `The vault "${space.name}" already shows this repository as ${recorded.contentsRoot}/${recorded.name}. Run "irori list" for its state.`,
      );
    let connection = recorded;
    try {
      if (connection && into)
        await this.host.cloud.cloneRepository(space.scopeId, connection.mountId, folder);
      else if (connection)
        await this.host.cloud.bindLocal(space.scopeId, connection.mountId, folder);
      else
        connection = await this.host.cloud.addRepository({
          scopeId: space.scopeId,
          url: command.folder,
          ...(branch && { branch }),
          folder,
          existing: !into,
          contentsRoot: space.contents[0],
          name: command.name ?? repositoryFolder(command.folder),
          access: command.readOnly ? 'read-only' : 'read-write',
        });
      await this.host.cloud.connect(space.scopeId, connection.mountId);
    } finally {
      this.host.announce?.({ scopeId: space.scopeId });
    }
    const clone = (await this.host.cloud.connections(space.scopeId)).find(
      (item) => item.mountId === connection!.mountId,
    );
    return repositoryConnected(space.name, {
      name: connection.name,
      contentsRoot: connection.contentsRoot,
      readOnly: connection.access === 'read-only',
      repository: githubRepository(command.folder)!,
      folder: into
        ? path.join(folder, clone?.folderName ?? repositoryFolder(command.folder))
        : folder,
      cloned: !!into,
    });
  }
  /** Refuses a change to a vault while its own agent works there. */
  private idle(space: Space, change: string, scope: string | undefined) {
    // A vault agent changes its own vault during its own run.
    if (!scope && this.host.running?.(space.scopeId))
      throw Error(
        `The vault "${space.name}" has its own agent running. ${change} after that run finishes.`,
      );
  }
  private async disconnect(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'disconnect' }>,
    cwd: string,
    context: SetupContext,
  ) {
    const space = this.vault(command.vault, cwd, context.vault, context.handedScopes);
    this.idle(space, 'Take the folder out', context.vault);
    const wanted = command.name.replace(/^.*[\\/]/, '');
    const connection = (await this.host.cloud.connections(space.scopeId)).find(
      (item) => item.name === wanted,
    );
    if (!connection)
      throw Error(
        `The vault "${space.name}" has no connected folder named "${wanted}". Run "irori list" for them.`,
      );
    try {
      await this.host.cloud.disconnect(space.scopeId, connection.mountId);
      await this.host.cloud.edit(space.scopeId, connection.mountId);
    } finally {
      this.host.announce?.({ scopeId: space.scopeId });
    }
    return folderDisconnected(space.name, connection);
  }
  /** `irori connection`: renames a connected folder, or chooses whether agents may change it. */
  private async connection(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'connection' }>,
    cwd: string,
    context: SetupContext,
  ) {
    const space = this.vault(command.vault, cwd, context.vault, context.handedScopes);
    this.idle(space, 'Change the connected folder', context.vault);
    const wanted = command.name.replace(/^.*[\\/]/, '');
    const connection = (await this.host.cloud.connections(space.scopeId)).find(
      (item) => item.name === wanted,
    );
    if (!connection)
      throw Error(
        `The vault "${space.name}" has no connected folder named "${wanted}". Run "irori list" for them.`,
      );
    try {
      if (command.access && command.access !== connection.access) {
        if (connection.provider === 'github' || !this.host.cloud.setAccess)
          throw Error(
            'A GitHub repository is read-only or editable as it was connected: disconnect it and connect it again, with --editable or without.',
          );
        await this.host.cloud.setAccess(space.scopeId, connection.mountId, command.access);
      }
      if (command.rename && command.rename !== connection.name) {
        // A connection is renamed while it is not linked, then linked again.
        const linked = connection.state === 'mounted' || connection.state === 'waiting';
        if (linked) await this.host.cloud.disconnect(space.scopeId, connection.mountId);
        await this.host.cloud.edit(space.scopeId, connection.mountId, command.rename);
        if (linked) await this.host.cloud.connect(space.scopeId, connection.mountId);
      }
    } finally {
      this.host.announce?.({ scopeId: space.scopeId });
    }
    return connectionChanged(space.name, {
      contentsRoot: connection.contentsRoot,
      name: command.rename ?? connection.name,
      readOnly: (command.access ?? connection.access) === 'read-only',
    });
  }
  /** `irori strays`: what a vault's contents holds that no connection names, adopted or removed. */
  private async strays(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'strays' }>,
    cwd: string,
    context: SetupContext,
  ) {
    const space = this.vault(command.vault, cwd, context.vault, context.handedScopes);
    const { strays, adoptStray, removeStray } = this.host.cloud;
    if (!strays || !adoptStray || !removeStray) throw Error('Contents is not available here.');
    const found = await strays.call(this.host.cloud, space.scopeId);
    const wanted = command.adopt ?? command.remove;
    if (!wanted) return strayList(space.name, found);
    const matches = found.filter(
      (item) => item.name === wanted || `${item.contentsRoot}/${item.name}` === wanted,
    );
    if (matches.length !== 1)
      throw Error(
        matches.length
          ? `More than one stray is named "${wanted}": name it as <contents folder>/<name>.`
          : `The vault "${space.name}" has no stray named "${wanted}". Run "irori strays ${command.vault}" for them.`,
      );
    const [stray] = matches;
    this.idle(space, 'Change its contents', context.vault);
    try {
      if (command.adopt) {
        const connection = await adoptStray.call(
          this.host.cloud,
          space.scopeId,
          stray.contentsRoot,
          stray.name,
          command.folder ? this.folder(cwd, command.folder) : undefined,
        );
        return strayAdopted(space.name, stray, connection.state);
      }
      await removeStray.call(this.host.cloud, space.scopeId, stray.contentsRoot, stray.name);
      return strayRemoved(space.name, stray);
    } finally {
      this.host.announce?.({ scopeId: space.scopeId });
    }
  }
  /** `irori skills`: adds the standard skills the irori agent's folder lacks, and with --update renews the changed ones. */
  private async standardSkills(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'skills' }>,
  ) {
    if (!this.host.skills) throw Error('The standard skills are not available here.');
    const state = await this.host.skills.standardSkillState();
    if (state.missing.length) await this.host.skills.addStandardSkills();
    if (command.update && state.changed.length)
      await this.host.skills.replaceStandardSkills(state.changed);
    return standardSkills({
      added: state.missing,
      updated: command.update ? state.changed : [],
      differ: command.update ? [] : state.changed,
    });
  }
  private async set(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'set' }>,
    cwd: string,
    context: SetupContext,
  ) {
    // A vault's name, category, look and layer names: its run keeps what it was told,
    // so they change during it as in the vault's settings (ADR 020 D5).
    const space = this.vault(command.vault, cwd, context.vault, context.handedScopes);
    // Its layers sort its files anew, so they wait for another's run as its folders do.
    if (command.layers || command.own) this.idle(space, 'Choose its layers', context.vault);
    let look = command.look;
    if (command.iconImage) {
      const file = this.folder(cwd, command.iconImage);
      const info = await fs.stat(file).catch(() => undefined);
      if (!info?.isFile()) throw Error(`${JSON.stringify(command.iconImage)} is not a file.`);
      if (info.size > 2 * 1024 * 1024) throw Error('An icon image is at most 2 MiB.');
      const bytes = new Uint8Array(await fs.readFile(file));
      const saved = await this.host.files.saveIcon(space.scopeId, bytes, imageType(bytes));
      look = { ...look, icon: { kind: 'image', path: saved } };
    }
    const change: SpaceChange = {
      ...(command.name && { name: command.name }),
      ...(command.category && { category: command.category }),
      ...(command.labels && { labels: command.labels }),
      ...(command.layers && { layers: command.layers }),
      ...(command.own && { rootLayer: command.own === 'contents' ? 'contents' : null }),
      // An icon or color keeps the other one.
      ...(look && { appearance: { ...space.appearance, ...look } }),
    };
    const next = await (this.host.update ?? ((id, c) => this.host.files.update(id, c)))(
      space.scopeId,
      change,
    );
    this.host.announce?.({ workspace: undefined });
    return vaultChanged({
      name: next.name,
      ...(next.category && { category: categoryName(next.category) }),
      ...(look && {
        look: {
          color: next.appearance?.color,
          icon:
            next.appearance?.icon?.kind === 'glyph'
              ? next.appearance.icon.glyph
              : next.appearance?.icon?.kind === 'text'
                ? next.appearance.icon.text
                : next.appearance?.icon && 'an image',
        },
      }),
      ...(command.labels && {
        labels: {
          knowledge: layerLabel(next, 'Knowledge_Base'),
          contents: layerLabel(next, 'contents'),
        },
      }),
      ...(command.layers && {
        layers: ['Schema', ...vaultLayers(next).map((layer) => defaultLayerLabel(layer))],
      }),
      ...((command.layers || command.own) && { own: defaultLayerLabel(ownLayer(next)) }),
    });
  }
  private async work(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'work' }>,
    cwd: string,
    context: SetupContext,
  ) {
    const space = this.vault(command.vault, cwd, context.vault, context.handedScopes);
    if (!this.host.work) throw Error('irori cannot choose work folders here.');
    const chosen = await this.host.work.choose(
      space.scopeId,
      command.folder === undefined ? null : this.folder(cwd, command.folder),
    );
    return workFolderChosen(space.name, chosen);
  }
  private async layer(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'layer' }>,
    cwd: string,
    context: SetupContext,
  ) {
    const space = this.vault(command.vault, cwd, context.vault, context.handedScopes);
    const word = command.layer === 'contents' ? 'contents' : 'knowledge';
    this.idle(space, `Choose its ${word} folder`, context.vault);
    try {
      if (command.also) {
        await (
          this.host.declareContents ?? ((id, folder) => this.host.files.declareContents(id, folder))
        )(space.scopeId, command.folder);
        return layerChosen(space.name, word, { folder: command.folder, also: true });
      }
      const isFolder = (folder: string) =>
        fs
          .lstat(path.join(space.root, folder))
          .then((stat) => stat.isDirectory())
          .catch(() => false);
      // The current folder moves only when it is there and the chosen one is not.
      const moves =
        (await isFolder(layerFolder(space, command.layer))) && !(await isFolder(command.folder));
      const renamed = await (
        this.host.renameLayer ??
        ((id, layer, name) => renameLayerFolder({ files: this.host.files }, id, layer, name))
      )(space.scopeId, command.layer, command.folder);
      const folder =
        command.layer === 'contents' ? renamed.space.contents[0] : knowledgeFolder(renamed.space);
      return layerChosen(space.name, word, {
        folder: shownFolder(folder),
        previous: shownFolder(renamed.previous),
        // To or from the root, what moved is the entries (ADR 035).
        moved: renamed.entries ? renamed.entries.length > 0 : moves,
        links: renamed.links,
        notes: renamed.notes,
        skipped: renamed.skipped,
        notice: renamed.notice,
      });
    } finally {
      // The window reads the vault's layers again, then its files.
      this.host.announce?.({ workspace: undefined });
      this.host.announce?.({ scopeId: space.scopeId });
    }
  }
  private async saveWorkspace(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'workspace' }>,
    cwd: string,
    context: SetupContext,
  ) {
    const spaces = command.vaults.map((name) => this.anyVault(name, cwd));
    const ids = spaces.map((space) => space.scopeId);
    const all = [...this.host.files.list(), ...(this.host.remote?.list() ?? [])];
    const named = (scopeIds: string[]) =>
      scopeIds.map((id) => all.find((space) => space.scopeId === id)?.name ?? 'unavailable');
    if (command.rename || command.delete || command.group !== undefined) {
      const workspace = (await this.host.workspaces.list()).find(
        (item) => item.name === command.name,
      );
      if (!workspace) throw Error(`There is no workspace named "${command.name}".`);
      if (command.rename) {
        if (!this.host.workspaces.save) throw Error('Renaming workspaces is not available here.');
        const saved = await this.host.workspaces.save(
          command.rename,
          workspace.scopeIds,
          workspace.id,
        );
        this.host.announce?.({ workspace: saved });
        return workspaceRenamed(command.name, saved.name);
      }
      if (command.delete) {
        if (!this.host.workspaces.remove) throw Error('Deleting workspaces is not available here.');
        await this.host.workspaces.remove(workspace.id);
        this.host.announce?.({});
        return workspaceDeleted(workspace.name, named(workspace.scopeIds));
      }
      if (!this.host.workspaces.saveGroups) throw Error('Groups are not available here.');
      const outside = spaces.filter((space) => !workspace.scopeIds.includes(space.scopeId));
      if (outside.length)
        throw Error(
          `${outside.map((space) => `"${space.name}"`).join(', ')} ${outside.length === 1 ? 'is' : 'are'} not in the workspace "${workspace.name}". Add ${outside.length === 1 ? 'it' : 'them'} first with irori workspace "${workspace.name}" <vault>.`,
        );
      // A vault is in one group at most: it leaves the one it was in.
      let groups: VaultGroup[] = (workspace.groups ?? []).map((group) => ({
        ...group,
        scopeIds: group.scopeIds.filter((id) => !ids.includes(id)),
      }));
      if (command.group) {
        const found = groups.find((group) => group.name === command.group);
        if (found) found.scopeIds.push(...ids);
        else groups.push({ id: randomUUID(), name: command.group, scopeIds: ids, open: true });
      }
      groups = groups.filter((group) => group.scopeIds.length);
      const saved = await this.host.workspaces.saveGroups(workspace.id, groups);
      this.host.announce?.({ workspace: saved });
      return workspaceGrouped(
        saved.name,
        (saved.groups ?? []).map((group) => ({ name: group.name, vaults: named(group.scopeIds) })),
      );
    }
    const { before: existing, saved: written } = await this.host.workspaces.update(
      { name: command.name },
      (current) => {
        if (command.leave && !current)
          throw Error(`There is no workspace named "${command.name}".`);
        return command.leave
          ? current!.scopeIds.filter((id) => !ids.includes(id))
          : [...(current?.scopeIds ?? []), ...ids];
      },
    );
    const saved = written!;
    this.host.announce?.({ workspace: saved });
    return workspaceSaved(
      { name: saved.name, vaults: named(saved.scopeIds) },
      { created: !existing, current: saved.id === context.workspaceId },
    );
  }
  private async remove(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'remove' }>,
    cwd: string,
    context: SetupContext,
  ) {
    const space = this.anyVault(command.vault, cwd);
    if (space.host) {
      // A vault on an SSH host leaves this device's list; its folder stays there (ADR 061).
      if (command.trash)
        throw Error(
          `The vault "${space.name}" is on the SSH host "${space.host.name}": irori takes it off the list only, and its folder stays there. Leave out --trash.`,
        );
      await this.remote.unregister(space.scopeId);
      await this.host.workspaces.forget?.(space.scopeId);
      this.host.announce?.({ workspace: await this.workspace(context) });
      return vaultRemoved(space, false, space.host.name);
    }
    this.idle(space, 'Remove it', context.vault);
    if (this.host.remove) await this.host.remove(space.scopeId, command.trash);
    else {
      if (command.trash) throw Error('The trash is not available here.');
      await this.host.files.unregister(space.scopeId);
      await this.host.workspaces.forget?.(space.scopeId);
    }
    // The workspace on show lets the vault go.
    this.host.announce?.({ workspace: await this.workspace(context) });
    return vaultRemoved(space, command.trash);
  }
  private async moveNote(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'move' }>,
    cwd: string,
    context: SetupContext,
  ) {
    const from = this.located(cwd, command.note, context.vault, context.handedScopes);
    // A folder as the destination keeps the note's name; a vault's root is one too.
    const folder = await this.locatedFolder(
      cwd,
      command.destination,
      context.vault,
      context.handedScopes,
    ).catch(() => undefined);
    if (folder && folder.space.scopeId !== from.space.scopeId) return this.moveAcross(from, folder);
    let to = folder ?? this.located(cwd, command.destination, context.vault, context.handedScopes);
    if (to.space.scopeId !== from.space.scopeId)
      throw Error(
        'A note moves into another vault into one of its folders, keeping its name: name a folder there.',
      );
    if (!this.host.moveNote) throw Error('Moving notes is not available here.');
    if (folder)
      to = {
        ...to,
        path: to.path
          ? `${to.path}/${path.posix.basename(from.path)}`
          : path.posix.basename(from.path),
      };
    const moved = await this.host.moveNote(from.space.scopeId, from.path, to.path);
    this.host.announce?.({ scopeId: from.space.scopeId });
    return noteMoved(from.space.name, from.path, moved);
  }
  /** `irori move` into another vault: as the explorer's move to a vault, links to it break (ADR 038). */
  private async moveAcross(
    from: { space: Space; path: string },
    to: { space: Space; path: string },
  ) {
    if (!this.host.moveToVault) throw Error('Moving into another vault is not available here.');
    const broken = await this.host
      .vaultMoveLinks?.(from.space.scopeId, from.path)
      .catch(() => undefined);
    const moved = await this.host.moveToVault(
      from.space.scopeId,
      from.path,
      to.space.scopeId,
      to.path,
    );
    this.host.announce?.({ scopeId: from.space.scopeId });
    this.host.announce?.({ scopeId: to.space.scopeId });
    return noteMovedAcross(from.space.name, from.path, to.space.name, moved.entry.path, {
      links: broken?.links,
      notice: moved.notice,
    });
  }
  /** `irori copy`: as the explorer's paste, never over an entry; a copy keeps where its links lead. */
  private async copy(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'copy' }>,
    cwd: string,
    context: SetupContext,
  ) {
    if (!this.host.copyEntry) throw Error('Copying is not available here.');
    const from = this.located(cwd, command.source, context.vault, context.handedScopes);
    const to = await this.locatedFolder(
      cwd,
      command.destination,
      context.vault,
      context.handedScopes,
    );
    const entry = await this.host.copyEntry(
      from.space.scopeId,
      from.path,
      to.space.scopeId,
      to.path,
    );
    this.host.announce?.({ scopeId: to.space.scopeId });
    return entryCopied(from.space.name, from.path, to.space.name, entry.path);
  }
  private async trashNote(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'trash' }>,
    cwd: string,
    context: SetupContext,
  ) {
    if (!this.host.trashNote) throw Error("irori's trash is not available here.");
    const note = this.located(cwd, command.note, context.vault, context.handedScopes);
    await this.host.trashNote(note.space.scopeId, note.path);
    this.host.announce?.({ scopeId: note.space.scopeId });
    return noteTrashed(note.space.name, note.path);
  }
  private async comment(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'comment' }>,
    cwd: string,
    context: SetupContext,
  ) {
    if (!this.host.addComment) throw Error('Comments are not available here.');
    const file = this.located(cwd, command.file, context.vault, context.handedScopes);
    const comments = await this.host.addComment(
      file.space.scopeId,
      file.path,
      {
        body: command.body,
        ...(command.quote !== undefined && { quote: command.quote }),
        ...(command.line !== undefined && { line: command.line }),
      },
      context.by ?? 'agent',
    );
    this.host.announce?.({ scopeId: file.space.scopeId });
    return commentAdded(file.path, comments.at(-1)!.id, comments.length);
  }
  private async resolve(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'resolve' }>,
    cwd: string,
    context: SetupContext,
  ) {
    if (!this.host.removeComment) throw Error('Comments are not available here.');
    const file = this.located(cwd, command.file, context.vault, context.handedScopes);
    const left = await this.host.removeComment(file.space.scopeId, file.path, command.id);
    this.host.announce?.({ scopeId: file.space.scopeId });
    return commentResolved(file.path, command.id, left.length);
  }
  private async index(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'index' }>,
    cwd: string,
    context: SetupContext,
  ) {
    if (!this.host.updateIndex) throw Error('Indexes are not available here.');
    const space = this.named(command, cwd, context);
    const update = await this.host.updateIndex(space.scopeId);
    this.host.announce?.({ scopeId: space.scopeId });
    return indexUpdated(space.name, update);
  }
  private async check(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'check' }>,
    cwd: string,
    context: SetupContext,
  ) {
    if (!this.host.checkOntology) throw Error('The check is not available here.');
    const space = this.named(command, cwd, context);
    return ontologyChecked(space.name, await this.host.checkOntology(space.scopeId));
  }
  /** The vault a form names, or without a name the agent's own, or the one it stands in. */
  private named(command: { kind: string; vault?: string }, cwd: string, context: SetupContext) {
    const here = owner(this.host.files.list(), this.folder(cwd, '.'));
    const space = command.vault
      ? this.vault(command.vault, cwd, context.vault, context.handedScopes)
      : context.vault
        ? this.host.files.get(context.vault)
        : here
          ? this.allowed(here, undefined, context.handedScopes)
          : undefined;
    if (!space) throw Error(`Name the vault: "irori ${command.kind} <vault>".`);
    return space;
  }
}
