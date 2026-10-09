import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  folderConnected,
  folderDisconnected,
  hibachiChanged,
  hibachiList,
  hibachiRegistered,
  hibachiRemoved,
  iroriCommandHelp,
  layerChosen,
  routineList,
  workspaceSaved,
  routineRunRefused,
  routineStarted,
  type ListedHibachi,
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
import { knowledgeFolder, layerFolder, layerLabel, type NamedLayer } from '../domain/layers';
import { categoryName } from '../domain/brains';
import type { Routine, RoutineRef, RunRoutine } from '../domain/routines';
import { brainAgentNames } from '../domain/you';
import type { CloudService } from '../cloud/service';
import { githubCloneURL, type GitService } from '../git/service';
import type { FileService } from './files';
import { inspectRepository, type WorkspaceService } from './workspaces';
import { githubRepository } from '../domain/git';
import { renameLayerFolder } from './layer-folders';

/** What the `irori` command reaches in the host. */
export interface AgentSetupHost {
  files: FileService;
  git: Pick<GitService, 'clone' | 'create' | 'abandon' | 'firstCommit'>;
  workspaces: Pick<WorkspaceService, 'list' | 'save'> & Partial<Pick<WorkspaceService, 'forget'>>;
  cloud: Pick<
    CloudService,
    'addLocal' | 'connect' | 'connections' | 'disconnect' | 'edit' | 'suspend' | 'resume'
  >;
  /** Where new hibachis go when the command names no parent folder. */
  defaultParent: () => Promise<string>;
  /** Registers through the host's own guards and starts watching the hibachi. */
  register?: (root: string, name: string, category: Category) => Promise<Space>;
  /** Changes a hibachi's name, category or layer names, as its settings do. */
  update?: (scopeId: string, change: SpaceChange) => Promise<Space>;
  /** Names or renames a hibachi's knowledge or contents folder, carrying what names it (ADR 024). */
  renameLayer?: (scopeId: string, layer: NamedLayer, name: string) => Promise<LayerFolderRename>;
  /** Declares a folder the hibachi has as contents too. */
  declareContents?: (scopeId: string, folder: string) => Promise<Space>;
  /** Takes a hibachi off this device and out of every workspace; `trash` moves its folder there. */
  remove?: (scopeId: string, trash: boolean) => Promise<void>;
  /** The irori agent's routines and those of the workspace's hibachis, as checked for a run. */
  routines?: (workspaceId: string | undefined) => Promise<Routine[]>;
  /** Starts a routine as 実行 does, without a review: only reviewed files run (ADR 016 D4). */
  runRoutine?: (ref: RoutineRef, input: RunRoutine) => Promise<string>;
  /** Whether a run of the hibachi's own agent is in progress there. */
  running?: (scopeId: string) => boolean;
  /** Tells the window what changed: the hibachis and a workspace, or one hibachi's files. */
  announce?: (change: { workspace?: WorkspaceProfile; scopeId?: string }) => void;
  home?: string;
}

/** Where a request to the irori agent came from. */
export interface SetupContext {
  /** The workspace the request was sent in, which new hibachis join. */
  workspaceId?: string;
  /** The CLI and model the request runs on, for the agent steps of a routine it starts. */
  agent?: { agent: AgentId; model?: string };
  /** The request is an agent step of a routine, which starts none (D6). */
  inRoutine?: boolean;
}

type Joined = 'joined' | 'member' | 'no workspace';

/**
 * Carries out the irori agent's `irori` command: what the person does in
 * irori's dialogs to set hibachis up (ADR 025, ADR 030). Clones and new
 * hibachis go only into new folders, so they wait for no run; a change to a
 * registered hibachi waits for its own agent, as connecting a folder does.
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
    const command = parseIroriCommand(argv);
    switch (command.kind) {
      case 'help':
        return iroriCommandHelp(await this.host.defaultParent());
      case 'list':
        return this.list(context);
      case 'routines': {
        if (!this.host.routines) throw Error('Routines are not available here.');
        const workspace = await this.workspace(context);
        const spaces = this.host.files.list();
        return routineList(
          (await this.host.routines(workspace?.id)).map((routine) => ({
            ...routine,
            hibachi: spaces.find((space) => space.scopeId === routine.ref.owner)?.name,
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
        return this.connect(command, cwd);
      case 'disconnect':
        return this.disconnect(command, cwd);
      case 'set':
        return this.set(command, cwd);
      case 'layer':
        return this.layer(command, cwd);
      case 'workspace':
        return this.saveWorkspace(command, cwd, context);
      case 'remove':
        return this.remove(command, cwd, context);
      case 'run':
        return this.startRoutine(command, cwd, context);
    }
  }
  private async workspace(context: SetupContext) {
    if (!context.workspaceId) return undefined;
    return (await this.host.workspaces.list()).find((item) => item.id === context.workspaceId);
  }
  private async list(context: SetupContext) {
    const workspace = await this.workspace(context);
    const spaces = this.host.files.list();
    const hibachis: ListedHibachi[] = [];
    for (const space of spaces)
      hibachis.push({
        name: space.name,
        root: space.root,
        repository: (await inspectRepository(space.root)).repository,
        inWorkspace: !!workspace?.scopeIds.includes(space.scopeId),
        category: categoryName(space.category),
        knowledge: knowledgeFolder(space),
        contents: space.contents,
        connections: (await this.host.cloud.connections(space.scopeId).catch(() => [])).map(
          (item) => ({
            name: item.name,
            contentsRoot: item.contentsRoot,
            state: item.state,
            readOnly: item.access === 'read-only',
          }),
        ),
      });
    const names = (scopeIds: string[]) =>
      scopeIds.map((id) => spaces.find((space) => space.scopeId === id)?.name ?? 'unavailable');
    return hibachiList(
      hibachis,
      await this.host.defaultParent(),
      workspace?.name,
      (await this.host.workspaces.list()).map((item) => ({
        name: item.name,
        hibachis: names(item.scopeIds),
      })),
    );
  }
  /** Adds the hibachi to the request's workspace, unless it is in it already. */
  private async join(scopeId: string, context: SetupContext) {
    const workspace = await this.workspace(context);
    let joined: Joined = 'no workspace';
    let saved: WorkspaceProfile | undefined;
    if (workspace?.scopeIds.includes(scopeId)) joined = 'member';
    else if (workspace) {
      saved = await this.host.workspaces.save(
        workspace.name,
        [...workspace.scopeIds, scopeId],
        workspace.id,
      );
      joined = 'joined';
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
        return hibachiRegistered(
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
    return hibachiRegistered(
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
    return hibachiRegistered(
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
      return hibachiRegistered(
        {
          name: found.name,
          root: found.root,
          repository: (await inspectRepository(found.root)).repository,
        },
        { already: true, joined: await this.join(found.scopeId, context) },
      );
    const inspection = await inspectRepository(root);
    if (inspection.kind === 'unavailable')
      throw Error(`${JSON.stringify(root)} cannot be a hibachi: ${inspection.detail}`);
    const space = await this.register(
      inspection.root,
      command.name ?? path.basename(inspection.root),
      command.category ?? 'personal',
    );
    return hibachiRegistered(
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
    const owner = command.hibachi ? this.hibachi(command.hibachi, cwd).scopeId : undefined;
    let found = (await this.host.routines(workspace.id)).filter(
      (routine) =>
        (routine.name === command.routine || routine.ref.folder === command.routine) &&
        (!owner || routine.ref.owner === owner),
    );
    // Without --hibachi, the irori agent's own routine of that name comes first.
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
            hibachi: spaces.find((space) => space.scopeId === routine.ref.owner)?.name,
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
  /** The registered hibachi a command names: by name, sub-agent name or folder. */
  private hibachi(name: string, cwd: string) {
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
    if (found.length === 1) return found[0];
    if (found.length)
      throw Error(
        `More than one hibachi is named "${name}". Name it by its folder: ${found.map((space) => JSON.stringify(space.root)).join(', ')}.`,
      );
    throw Error(`No hibachi is named "${name}". Run "irori list" for their names and folders.`);
  }
  private async connect(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'connect' }>,
    cwd: string,
  ) {
    const space = this.hibachi(command.hibachi, cwd);
    if (this.host.running?.(space.scopeId))
      throw Error(
        `The hibachi "${space.name}" has its own agent running. Connect the folder after that run finishes.`,
      );
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
  /** Refuses a change to a hibachi while its own agent works there. */
  private idle(space: Space, change: string) {
    if (this.host.running?.(space.scopeId))
      throw Error(
        `The hibachi "${space.name}" has its own agent running. ${change} after that run finishes.`,
      );
  }
  private async disconnect(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'disconnect' }>,
    cwd: string,
  ) {
    const space = this.hibachi(command.hibachi, cwd);
    this.idle(space, 'Take the folder out');
    const wanted = command.name.replace(/^.*[\\/]/, '');
    const connection = (await this.host.cloud.connections(space.scopeId)).find(
      (item) => item.name === wanted,
    );
    if (!connection)
      throw Error(
        `The hibachi "${space.name}" has no connected folder named "${wanted}". Run "irori list" for them.`,
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
  ) {
    const space = this.hibachi(command.hibachi, cwd);
    this.idle(space, "Change the hibachi's settings");
    const change: SpaceChange = {
      ...(command.name && { name: command.name }),
      ...(command.category && { category: command.category }),
      ...(command.labels && { labels: command.labels }),
    };
    const next = await (this.host.update ?? ((id, c) => this.host.files.update(id, c)))(
      space.scopeId,
      change,
    );
    this.host.announce?.({ workspace: undefined });
    return hibachiChanged({
      name: next.name,
      category: categoryName(next.category),
      ...(command.labels && {
        labels: {
          knowledge: layerLabel(next, 'Knowledge_Base'),
          contents: layerLabel(next, 'contents'),
        },
      }),
    });
  }
  private async layer(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'layer' }>,
    cwd: string,
  ) {
    const space = this.hibachi(command.hibachi, cwd);
    const word = command.layer === 'contents' ? 'contents' : 'knowledge';
    this.idle(space, `Choose its ${word} folder`);
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
        folder,
        previous: renamed.previous,
        moved: moves,
        links: renamed.links,
        notes: renamed.notes,
        skipped: renamed.skipped,
        notice: renamed.notice,
      });
    } finally {
      // The window reads the hibachi's layers again, then its files.
      this.host.announce?.({ workspace: undefined });
      this.host.announce?.({ scopeId: space.scopeId });
    }
  }
  private async saveWorkspace(
    command: Extract<ReturnType<typeof parseIroriCommand>, { kind: 'workspace' }>,
    cwd: string,
    context: SetupContext,
  ) {
    const spaces = command.hibachis.map((name) => this.hibachi(name, cwd));
    const existing = (await this.host.workspaces.list()).find((item) => item.name === command.name);
    if (command.leave && !existing) throw Error(`There is no workspace named "${command.name}".`);
    const ids = spaces.map((space) => space.scopeId);
    const scopeIds = command.leave
      ? existing!.scopeIds.filter((id) => !ids.includes(id))
      : [...(existing?.scopeIds ?? []), ...ids];
    const saved = await this.host.workspaces.save(command.name, scopeIds, existing?.id);
    this.host.announce?.({ workspace: saved });
    const all = this.host.files.list();
    return workspaceSaved(
      {
        name: saved.name,
        hibachis: saved.scopeIds.map(
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
    const space = this.hibachi(command.hibachi, cwd);
    this.idle(space, 'Remove it');
    if (this.host.remove) await this.host.remove(space.scopeId, command.trash);
    else {
      if (command.trash) throw Error('The trash is not available here.');
      await this.host.files.unregister(space.scopeId);
      await this.host.workspaces.forget?.(space.scopeId);
    }
    // The workspace on show lets the hibachi go.
    this.host.announce?.({ workspace: await this.workspace(context) });
    return hibachiRemoved(space, command.trash);
  }
}
