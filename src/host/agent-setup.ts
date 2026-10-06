import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  folderConnected,
  hibachiList,
  hibachiRegistered,
  iroriCommandHelp,
  routineList,
  type ListedHibachi,
} from '../../prompts';
import { parseIroriCommand } from '../domain/irori-command';
import type { Category, Space, WorkspaceProfile } from '../domain/types';
import type { Routine } from '../domain/routines';
import { brainAgentNames } from '../domain/you';
import type { CloudService } from '../cloud/service';
import { githubCloneURL, type GitService } from '../git/service';
import type { FileService } from './files';
import { githubRepository, inspectRepository, type WorkspaceService } from './workspaces';

/** What the `irori` command reaches in the host. */
export interface AgentSetupHost {
  files: FileService;
  git: Pick<GitService, 'clone' | 'create' | 'abandon' | 'firstCommit'>;
  workspaces: Pick<WorkspaceService, 'list' | 'save'>;
  cloud: Pick<CloudService, 'addLocal' | 'connect'>;
  /** Where new hibachis go when the command names no parent folder. */
  defaultParent: () => Promise<string>;
  /** Registers through the host's own guards and starts watching the hibachi. */
  register?: (root: string, name: string, category: Category) => Promise<Space>;
  /** The irori agent's routines and those of the workspace's hibachis, as checked for a run. */
  routines?: (workspaceId: string | undefined) => Promise<Routine[]>;
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
}

type Joined = 'joined' | 'member' | 'no workspace';

/**
 * Carries out the irori agent's `irori` command. Every command adds: a
 * hibachi registered on this device and joined to the request's workspace,
 * or a folder connected to a hibachi's contents. Clones and new hibachis go
 * only into new folders, so they wait for no run.
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
    }
  }
  private async workspace(context: SetupContext) {
    if (!context.workspaceId) return undefined;
    return (await this.host.workspaces.list()).find((item) => item.id === context.workspaceId);
  }
  private async list(context: SetupContext) {
    const workspace = await this.workspace(context);
    const hibachis: ListedHibachi[] = [];
    for (const space of this.host.files.list())
      hibachis.push({
        name: space.name,
        root: space.root,
        repository: (await inspectRepository(space.root)).repository,
        inWorkspace: !!workspace?.scopeIds.includes(space.scopeId),
      });
    return hibachiList(hibachis, await this.host.defaultParent(), workspace?.name);
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
}
