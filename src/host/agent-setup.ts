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
  type ListedVault,
} from '../../prompts';
import { parseIroriCommand } from '../domain/irori-command';
import type {
  AgentId,
  Category,
  LayerFolderRename,
  Space,
  SpaceChange,
  WorkspaceProfile,
} from '../domain/types';
import {
  knowledgeFolder,
  layerFolder,
  layerLabel,
  shownFolder,
  type NamedLayer,
} from '../domain/layers';
import { categoryName } from '../domain/brains';
import type { Routine, RoutineRef, RunRoutine } from '../domain/routines';
import type { NewComment, NoteComment } from '../domain/comments';
import type { GraphIndexUpdate } from '../domain/graph-index';
import { owner } from '../domain/scopes';
import { brainAgentNames } from '../domain/you';
import type { CloudService } from '../cloud/service';
import { githubCloneURL, type GitService } from '../git/service';
import type { FileService } from './files';
import { inspectRepository, type WorkspaceService } from './workspaces';
import { githubRepository, repositoryFolder } from '../domain/git';
import { renameLayerFolder } from './layer-folders';
import type { WorkFolders } from './work-folders';

/** What the `irori` command reaches in the host. */
export interface AgentSetupHost {
  files: FileService;
  git: Pick<GitService, 'clone' | 'create' | 'abandon' | 'firstCommit'>;
  workspaces: Pick<WorkspaceService, 'list' | 'update'> & Partial<Pick<WorkspaceService, 'forget'>>;
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
  >;
  /** The folder each vault's agents work in. */
  work?: Pick<WorkFolders, 'folder' | 'choose'>;
  /** Where new vaults go when the command names no parent folder. */
  defaultParent: () => Promise<string>;
  /** Registers through the host's own guards and starts watching the vault. */
  register?: (root: string, name: string, category: Category) => Promise<Space>;
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
  /** Writes the vault's graph index and folder indexes, as 索引を更新 does. */
  updateIndex?: (scopeId: string) => Promise<GraphIndexUpdate>;
  /** Starts a routine as 実行 does, without a review: only reviewed files run (ADR 016 D4). */
  runRoutine?: (ref: RoutineRef, input: RunRoutine) => Promise<string>;
  /** Whether a run of the vault's own agent is in progress there. */
  running?: (scopeId: string) => boolean;
  /** Tells the window what changed: the vaults and a workspace, or one vault's files. */
  announce?: (change: { workspace?: WorkspaceProfile; scopeId?: string }) => void;
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
  /** The request is an agent step of a routine, which starts none (D6). */
  inRoutine?: boolean;
}

type Joined = 'joined' | 'member' | 'no workspace';

/** Forms only the irori agent has: they register, group or remove vaults, or start routines. */
const irori = new Set(['clone', 'create', 'add', 'workspace', 'remove', 'run']);

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
    switch (command.kind) {
      case 'help':
        return iroriCommandHelp(await this.host.defaultParent(), !!context.vault);
      case 'list':
        return this.list(context);
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
        return this.clone(command, cwd, context);
      case 'create':
        return this.create(command, cwd, context);
      case 'add':
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
        category: categoryName(space.category),
        knowledge: shownFolder(knowledgeFolder(space)),
        contents: space.contents,
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
    const names = (scopeIds: string[]) =>
      scopeIds.map((id) => spaces.find((space) => space.scopeId === id)?.name ?? 'unavailable');
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
  private register(root: string, name: string, category: Category) {
    return this.host.register
      ? this.host.register(root, name, category)
      : this.host.files.register(root, name, category);
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
      command.category ?? 'personal',
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
        command.category ?? 'personal',
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
    command: { name?: string; category?: Category },
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
      command.category ?? 'personal',
    );
    return vaultRegistered(
      { name: space.name, root: space.root, repository: inspection.repository },
      { already: false, joined: await this.join(space.scopeId, context) },
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
    const routine = found[0];
    if (routine.problem) throw Error(routineRunRefused.problem(routine.problem));
    if (routine.needs) throw Error(routineRunRefused.needs(routine.needs.text));
    if (routine.review !== 'reviewed') throw Error(routineRunRefused.review(routine.review));
    if (routine.running) throw Error(routineRunRefused.running);
    await this.host.runRoutine(routine.ref, {
      workspaceId: workspace.id,
      agents: context.agent ? { [routine.ref.owner]: context.agent } : {},
    });
    return routineStarted(
      routine.name,
      routine.steps.some((step) => step.kind === 'agent'),
    );
  }
  /** The registered vault a command names: by name, sub-agent name or folder. */
  private vault(name: string, cwd: string, scope?: string) {
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
    if (found.length === 1) return this.allowed(found[0], scope);
    if (found.length)
      throw Error(
        `More than one vault is named "${name}". Name it by its folder: ${found.map((space) => JSON.stringify(space.root)).join(', ')}.`,
      );
    throw Error(`No vault is named "${name}". Run "irori list" for their names and folders.`);
  }
  /** Refuses another vault to a vault agent's command. */
  private allowed(space: Space, scope: string | undefined) {
    if (scope && space.scopeId !== scope)
      throw Error(
        `You are the vault agent of another vault; "${space.name}" is not yours. Ask the person to ask the irori agent.`,
      );
    return space;
  }
  /** The vault a file is in, and the file's path in it, refused outside the vaults this run reaches. */
  private located(cwd: string, file: string, scope: string | undefined) {
    const absolute = this.folder(cwd, file);
    const space = owner(this.host.files.list(), absolute);
    if (!space || absolute === space.root)
      throw Error(`${JSON.stringify(file)} is not a file in a vault.`);
    return {
      space: this.allowed(space, scope),
      path: path.relative(space.root, absolute).split(path.sep).join('/'),
    };
  }

  private async connect(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'connect' }>,
    cwd: string,
    context: SetupContext,
  ) {
    const space = this.vault(command.vault, cwd, context.vault);
    if (this.host.running?.(space.scopeId))
      throw Error(
        `The vault "${space.name}" has its own agent running. Connect the folder after that run finishes.`,
      );
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
    const space = this.vault(command.vault, cwd, context.vault);
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
  private async set(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'set' }>,
    cwd: string,
    context: SetupContext,
  ) {
    const space = this.vault(command.vault, cwd, context.vault);
    this.idle(space, "Change the vault's settings", context.vault);
    const change: SpaceChange = {
      ...(command.name && { name: command.name }),
      ...(command.category && { category: command.category }),
      ...(command.labels && { labels: command.labels }),
      // An icon or color keeps the other one.
      ...(command.look && { appearance: { ...space.appearance, ...command.look } }),
    };
    const next = await (this.host.update ?? ((id, c) => this.host.files.update(id, c)))(
      space.scopeId,
      change,
    );
    this.host.announce?.({ workspace: undefined });
    return vaultChanged({
      name: next.name,
      category: categoryName(next.category),
      ...(command.look && {
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
    });
  }
  private async work(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'work' }>,
    cwd: string,
    context: SetupContext,
  ) {
    const space = this.vault(command.vault, cwd, context.vault);
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
    const space = this.vault(command.vault, cwd, context.vault);
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
    const spaces = command.vaults.map((name) => this.vault(name, cwd));
    const ids = spaces.map((space) => space.scopeId);
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
    const all = this.host.files.list();
    return workspaceSaved(
      {
        name: saved.name,
        vaults: saved.scopeIds.map(
          (id) => all.find((space) => space.scopeId === id)?.name ?? 'unavailable',
        ),
      },
      { created: !existing, current: saved.id === context.workspaceId },
    );
  }
  private async remove(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'remove' }>,
    cwd: string,
    context: SetupContext,
  ) {
    const space = this.vault(command.vault, cwd);
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
    if (!this.host.moveNote) throw Error('Moving notes is not available here.');
    const from = this.located(cwd, command.note, context.vault);
    let to = this.located(cwd, command.destination, context.vault);
    if (to.space.scopeId !== from.space.scopeId) throw Error('A note moves within its own vault.');
    // A folder as the destination keeps the note's name.
    const folder = await fs
      .stat(path.join(to.space.root, to.path))
      .then((stat) => stat.isDirectory())
      .catch(() => false);
    if (folder) to = { ...to, path: `${to.path}/${path.posix.basename(from.path)}` };
    const moved = await this.host.moveNote(from.space.scopeId, from.path, to.path);
    this.host.announce?.({ scopeId: from.space.scopeId });
    return noteMoved(from.space.name, from.path, moved);
  }
  private async trashNote(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'trash' }>,
    cwd: string,
    context: SetupContext,
  ) {
    if (!this.host.trashNote) throw Error("irori's trash is not available here.");
    const note = this.located(cwd, command.note, context.vault);
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
    const file = this.located(cwd, command.file, context.vault);
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
    const file = this.located(cwd, command.file, context.vault);
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
    const here = owner(this.host.files.list(), this.folder(cwd, '.'));
    const space = command.vault
      ? this.vault(command.vault, cwd, context.vault)
      : context.vault
        ? this.host.files.get(context.vault)
        : here
          ? this.allowed(here, undefined)
          : undefined;
    if (!space) throw Error('Name the vault: "irori index <vault>".');
    const update = await this.host.updateIndex(space.scopeId);
    this.host.announce?.({ scopeId: space.scopeId });
    return indexUpdated(space.name, update);
  }
}
