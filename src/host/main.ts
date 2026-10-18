import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  safeStorage,
  shell,
} from 'electron';
import { setLanguage, t } from '../domain/i18n';
import squirrelStartup from 'electron-squirrel-startup';
import path from 'node:path';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import chokidar, { type FSWatcher } from 'chokidar';
import { dispatchHost, type HostHandlers } from '../domain/host-requests';
import { webAddress } from '../domain/links';
import { FileService, readViewerBytes, watcherIgnored, watchRegistrationChanges } from './files';
import { SettingsService } from './settings';
import { SearchService } from './search';
import { resolveLink } from './links';
import { referringLinks, relink } from './relink';
import { carryMove, renameLayerFolder } from './layer-folders';
import { appendUpload, discardUpload } from './entries';
import { classify } from '../domain/scopes';
import { DraftService } from './drafts';
import { writeExclusive } from './local-json';
import { UpdateService } from './updates';
import { platformInstaller } from './update-installers';
import { version as appVersion } from '../../package.json';
import { ImageService, imageType } from './images';
import { KnowledgeStore } from '../knowledge/store';
import { DriveLeftovers } from '../cloud/leftovers';
import { AgentService } from '../agents/service';
import { YourAiService } from './you';
import { DeviceIdentity } from './device';
import { migrateConversations } from '../agents/conversation-migration';
import { migrateToVault } from './vault-rename';
import { brainAgentNames, sharedSchemaId } from '../domain/you';
import { AuthorshipStore } from '../knowledge/authorship';
import { CloudService } from '../cloud/service';
import { RepositoryGit } from '../cloud/repositories';
import { WorkFolders } from './work-folders';
import { AgentPaths } from './agent-paths';
import { WorkspaceService, inspectRepository } from './workspaces';
import { GitService } from '../git/service';
import { GitHubCli } from '../git/github';
import { EnvironmentService } from './environment';
import { gitScope } from '../domain/git';
import { isAppDocument } from './trust';
import { readOntology } from './ontology';
import { GraphIndexService } from './graph-index';
import { brokenLinks } from '../domain/vault-move';
import { noteDirectory, openDailyNote, readNotesDeclaration } from './notes';
import { readPageProperties } from './properties';
import {
  addNoteComment,
  moveFolderComments,
  moveNoteComments,
  readNoteComments,
  removeNoteComment,
  resolveNoteComment,
} from './comments';
import { readFolderSkills, readSkillReach, readSkills } from './skills';
import { SchemaSettingsService } from './schema-settings';
import { RoutineService } from './routines';
import { PythonRuntime } from './python-runtime';
import { reversibleStorage, SecretStore } from './keystore';
import { AgentSetup } from './agent-setup';
import { removeSpace } from './remove-space';
import { spaceFolder } from './schema-folder';
import { TerminalService } from '../terminal/service';
import {
  nativeThemeSource,
  type Category,
  type DeviceSettings,
  type EntryMove,
  type HostEvent,
  type Space,
} from '../domain/types';
import type { NoteRef } from '../domain/note-operations';
import { isDamaged } from '../domain/conversation';
import { WindowTabs } from '../domain/workspace-tabs';
import { startDictation } from './dictation';
import { SerialQueue } from './serial-queue';
/** irori's windows (ADR 051): each keeps its own workspace tabs over the one host. */
const windows = new Set<BrowserWindow>();
/** The window a dialog belongs to: the one in front, else the newest. */
const front = () => BrowserWindow.getFocusedWindow() ?? [...windows].at(-1)!;
let closing = false;
const watchers = new Map<string, FSWatcher>();
if (process.platform === 'win32') app.setAppUserModelId('com.squirrel.irori.irori');
if (squirrelStartup) app.quit();
if (process.env.IRORI_DATA_DIR) app.setPath('userData', path.resolve(process.env.IRORI_DATA_DIR));
const ownsDeviceData = !squirrelStartup && app.requestSingleInstanceLock();
if (!ownsDeviceData) app.quit();
app.on('second-instance', () => {
  const window = [...windows].at(-1);
  if (window?.isMinimized()) window.restore();
  window?.show();
  window?.focus();
});
app
  .whenReady()
  .then(async () => {
    if (!ownsDeviceData) return;
    const files = new FileService(app.getPath('userData'));
    await files.init();
    // Your AI's folder is the device's, not a KB's: its record is read before any run.
    const you = new YourAiService(files.dataDir);
    // Records written while vaults were called hibachis take the new name first (ADR 033).
    await migrateToVault(files.dataDir, (await you.load()).root).catch((error) =>
      console.warn('Records could not be renamed to vault', String(error)),
    );
    const settings = new SettingsService(app.getPath('userData'));
    // The chosen theme reaches Chromium before the window exists, so the first
    // paint is already the reader's, without the renderer having to repaint.
    let languageChanged = () => {};
    const saveSettings = async (patch: Partial<DeviceSettings>) => {
      const next = await settings.save(patch);
      nativeTheme.themeSource = nativeThemeSource(next.theme);
      setLanguage(next.language);
      languageChanged();
      return next;
    };
    const device = await settings.read();
    nativeTheme.themeSource = nativeThemeSource(device.theme);
    // Dialogs and messages the host writes follow the reader's language too.
    setLanguage(device.language);
    const search = new SearchService(files);
    const graphIndex = new GraphIndexService(files, search);
    const drafts = new DraftService(files);
    /** Tells every window, or only `to`. */
    const emit = (event: HostEvent, to?: BrowserWindow) => {
      for (const window of to ? [to] : windows)
        if (!window.isDestroyed()) window.webContents.send('irori:event', event);
    };
    const tabs = new WindowTabs();
    // A terminal is its window's: its output goes there alone once the window is known.
    const terminalOwners = new Map<string, BrowserWindow>();
    const updates = new UpdateService({
      currentVersion: appVersion,
      platform: process.platform,
      arch: process.arch,
      installer: app.isPackaged ? platformInstaller(process.platform, process.execPath) : undefined,
      directory: path.join(app.getPath('userData'), 'updates'),
      onState: (state) => emit({ type: 'update', state }),
    });
    // This process is the version an earlier update switched to, or one that never finished.
    void updates.cleanup().catch((error) => console.warn('Update cleanup failed', String(error)));
    const workspaces = new WorkspaceService(files);
    // Folders on this device in contents (ADR 019); Drive is reached through its own app (ADR 023).
    const cloud = new CloudService(files, (filename) => shell.trashItem(filename));
    // GitHub repositories in contents, cloned on this device (ADR 046).
    cloud.repositories = new RepositoryGit();
    files.cloud = cloud;
    const images = new ImageService(files, cloud);
    const knowledge = new KnowledgeStore(files.dataDir, (ref) =>
      files.resolve(ref.scopeId, ref.path),
    );
    const leftovers = new DriveLeftovers(files.dataDir);
    // The notes are read through the Git service declared below, once a note is open.
    const authorship = new AuthorshipStore(files.dataDir, (ref) =>
      git.noted(ref.scopeId, ref.path),
    );
    const terminals = new TerminalService(
      files,
      (event) => {
        const owner = terminalOwners.get(event.id);
        if (event.type === 'exit') terminalOwners.delete(event.id);
        emit({ type: 'terminal', event }, owner);
      },
      (scopeId) => you.rootOf(scopeId),
    );
    // Conversations kept per space, CLI and checkout become conversations (ADR 017 D8),
    // once and before any run; a failure leaves the old records to try again next start.
    const identity = new DeviceIdentity(files.dataDir);
    await migrateConversations(files.dataDir, {
      deviceId: () => identity.id(),
      youId: (await you.load()).id,
      spaceName: (scopeId) => files.list().find((space) => space.scopeId === scopeId)?.name,
    }).catch((error) => console.warn('Saved conversations could not be migrated', String(error)));
    // The Schema settings take a vault's id, the irori agent's, whose folder is its
    // Schema, or the shared Schema's, kept inside that folder (ADR 027).
    const schemaFolder = async (scopeId: string) =>
      scopeId === sharedSchemaId
        ? you.sharedFolder()
        : you.rootOf(scopeId)
          ? you.schemaFolder()
          : spaceFolder(files, scopeId);
    const schemaSettings = new SchemaSettingsService(files, search, schemaFolder);
    const agents = new AgentService(
      files,
      (event) => emit({ type: 'agent', event }),
      knowledge,
      authorship,
      you,
    );
    let fileMutations = 0;
    const github = new GitHubCli();
    const git = new GitService(
      files,
      () => !agents.anyBusy && !cloud.busy && fileMutations === 0 && !routines.busy,
      authorship,
      undefined,
      github,
    );
    // A folder waited for or lost is linked again by itself only as a person's
    // connect would be: not while a run or Git operation works in the vault.
    cloud.mayLink = (scopeId) => !agents.busy(scopeId) && !git.busy;
    cloud.onLinked = (scopeId) => emit({ type: 'files', scopeId });
    // Where each vault's agents keep their scratch, rather than the system's temporary folder.
    const work = new WorkFolders(files);
    const agentPaths = new AgentPaths({ files, you, workspaces: () => workspaces.list() });
    cloud.workFolder = (scopeId) => work.folder(scopeId);
    agents.workFolder = async (scopeId) => {
      // Contents is not watched: the explorer is told when the first run makes the folder.
      const before = (await work.folder(scopeId)).path;
      const there = await lstat(before).then(
        () => true,
        () => false,
      );
      const folder = await work.prepare(scopeId);
      if (!there) emit({ type: 'files', scopeId });
      return folder;
    };
    // Secrets are sealed with the OS-held key. A source run may stand in a reversible
    // store for the UI smoke, whose display has no keychain; a packaged app never does.
    const secrets = new SecretStore(
      path.join(files.dataDir, 'secrets.json'),
      !app.isPackaged && process.env.IRORI_TEST_KEYSTORE === 'reversible'
        ? reversibleStorage
        : safeStorage,
    );
    // Python for routines is uv in irori's data, downloaded only when the person adds it.
    const python = new PythonRuntime({ dataDir: files.dataDir });
    // Routines run only when the person presses 実行; their records stay on this device.
    const routines = new RoutineService({
      dataDir: files.dataDir,
      files,
      you,
      agents,
      workspaces: () => workspaces.list(),
      settings: () => settings.read(),
      gitStatus: (id) => git.status(id),
      secrets,
      canStart: canStartAgent,
      emit: (run) => emit({ type: 'routine', run }),
      runtime: process.execPath,
      python,
    });
    await routines
      .init()
      .catch((error) => console.warn('Routine records could not be checked', String(error)));
    function canStartAgent() {
      if (git.busy || fileMutations)
        throw Error(
          t(
            'Git 操作・保存の完了後に実行してください。',
            'Wait for Git operations and saving to finish.',
          ),
        );
      if (cloud.busy)
        throw Error(
          t(
            'クラウド接続の準備中です。完了後に実行してください。',
            'The cloud connection is being prepared. Try again when it finishes.',
          ),
        );
    }
    async function changeFiles<T>(fn: () => Promise<T>) {
      if (git.busy)
        throw Error(
          t(
            'Git 操作の完了後に保存・登録してください。',
            'Save or register after the Git operation finishes.',
          ),
        );
      fileMutations++;
      try {
        return await fn();
      } finally {
        fileMutations--;
      }
    }
    const watchTimers = new Map<string, NodeJS.Timeout>();
    function watch(space: Space, spaces = files.list()) {
      const existing = watchers.get(space.scopeId);
      if (existing) return existing;
      const watcher = chokidar.watch(space.root, {
        ignoreInitial: true,
        depth: 6,
        followSymlinks: false,
        ignored: watcherIgnored(space, spaces),
      });
      watcher.on('all', () => {
        if (watchers.get(space.scopeId) !== watcher) return;
        clearTimeout(watchTimers.get(space.scopeId));
        watchTimers.set(
          space.scopeId,
          setTimeout(() => {
            if (watchers.get(space.scopeId) !== watcher) return;
            watchTimers.delete(space.scopeId);
            if (!closing && files.list().some((item) => item.scopeId === space.scopeId))
              emit({ type: 'files', scopeId: space.scopeId });
          }, 150),
        );
      });
      watcher.on('error', (error) => console.warn('Watcher error', String(error)));
      watchers.set(space.scopeId, watcher);
      return watcher;
    }
    const initialSpaces = files.list();
    initialSpaces.forEach((space) => watch(space, initialSpaces));
    const stopWatchingRegistrations = watchRegistrationChanges(files, {
      watchers,
      watch,
      refreshed: (scopeId) => {
        if (files.list().some((space) => space.scopeId === scopeId))
          emit({ type: 'files', scopeId });
      },
      closing: () => closing,
      error: (error) => console.warn('Watchers could not be refreshed', String(error)),
    });
    const defaultParent = async () => path.dirname((await you.load()).root);
    const registerWatched = (root: string, name: string, category: Category) =>
      changeFiles(async () => {
        const space = await files.register(root, name, category);
        watch(space);
        return space;
      });
    /** Lets go of a vault's folder before it is removed, and says how to take it up again. */
    const releaseSpace = async (space: Space) => {
      await terminals.closeScope(space.scopeId);
      const connected = await cloud.suspend(space.scopeId);
      await watchers.get(space.scopeId)?.close();
      watchers.delete(space.scopeId);
      return async () => {
        watch(space);
        await cloud.resume(space.scopeId, connected);
      };
    };
    const setupWait = t(
      'Git 操作・接続・ルーティンが終わってからもう一度実行してください。',
      'Run it again after the Git operation, connection or routine finishes.',
    );
    // The irori agent's `irori` command: vaults it registers join the request's workspace.
    const setup = new AgentSetup({
      files,
      git,
      workspaces,
      cloud,
      work,
      defaultParent,
      register: registerWatched,
      // As the settings and explorer do, but the irori agent's own hold on a vault does not count.
      update: (scopeId, change) => {
        if (cloud.busy || git.busy) throw Error(setupWait);
        return changeFiles(() => files.update(scopeId, change));
      },
      renameLayer: (scopeId, layer, name) => {
        if (cloud.busy || git.busy) throw Error(setupWait);
        return changeFiles(() =>
          renameLayerFolder({ files, cloud, knowledge, authorship }, scopeId, layer, name),
        );
      },
      declareContents: (scopeId, folder) => {
        if (cloud.busy || git.busy) throw Error(setupWait);
        return changeFiles(() => files.declareContents(scopeId, folder));
      },
      remove: (scopeId, trash) => {
        if (cloud.busy || git.busy || routines.busy) throw Error(setupWait);
        return changeFiles(() =>
          removeSpace(
            {
              files,
              workspaces,
              keep: async () => [(await you.load()).root, files.dataDir],
              release: releaseSpace,
              trash: (folder) => shell.trashItem(folder),
            },
            scopeId,
            trash,
          ),
        );
      },
      routines: (workspaceId, only) => routines.list(workspaceId, only),
      moveNote: (scopeId, from, to) =>
        agentChange(scopeId, async () => {
          const moved = await moveKnowledgeEntry(scopeId, from, to);
          return { path: moved.entry.path, notice: moved.notice, links: moved.links };
        }),
      trashNote: (scopeId, notePath) =>
        agentChange(scopeId, async () => {
          const doc = await files.read(scopeId, notePath);
          await files.trashNote({ scopeId, path: notePath, hash: doc.hash });
        }),
      addComment: (scopeId, file, comment, by) =>
        agentChange(scopeId, () => addNoteComment(files, git, scopeId, file, comment, by)),
      removeComment: (scopeId, file, id) =>
        agentChange(scopeId, () => resolveNoteComment(files, scopeId, file, id)),
      updateIndex: (scopeId) => agentChange(scopeId, () => graphIndex.update(scopeId)),
      runRoutine: (ref, input) => routines.run(ref, input),
      running: (scopeId) => agents.running(scopeId),
      announce: ({ workspace, scopeId }) =>
        emit(scopeId ? { type: 'files', scopeId } : { type: 'vaults', workspace }),
    });
    agents.setup = (argv, cwd, context) => setup.run(argv, cwd, context);
    // An MCP server's link opens only after the person agreed in the request.
    agents.openUrl = async (url) => {
      const address = webAddress(url);
      if (address) await shell.openExternal(address.href);
    };
    // The environment kept on the GitHub account (ADR 026).
    const environment = new EnvironmentService({
      files,
      workspaces,
      github,
      git,
      settings: { read: () => settings.read(), save: (patch) => saveSettings(patch) },
      secrets,
      agentRoot: async () => (await you.load()).root,
      register: registerWatched,
      defaultParent,
      appVersion,
    });
    const entry = await realpath(path.resolve(__dirname, '../dist/index.html'));
    const icon = path.resolve(__dirname, '../assets/irori-icon.png');
    app.dock?.setIcon(icon);
    async function changed<T>(scopeId: string, operation: () => Promise<T>) {
      try {
        return await operation();
      } finally {
        emit({ type: 'files', scopeId });
      }
    }
    /** A change to a vault's files that waits for its runs and for connection setup. */
    function changeVault<T>(scopeId: string, refusal: string, operation: () => Promise<T>) {
      return changeFiles(() =>
        changed(scopeId, async () => {
          if (agents.busy(scopeId) || cloud.busy) throw Error(refusal);
          return operation();
        }),
      );
    }
    /**
     * Moves a note and carries what names it: material IDs, comments, the record of
     * human-written lines and, with `links`, the links into it.
     */
    async function moveNoteCarrying(ref: NoteRef, destination: string, links: boolean) {
      const source = await knowledge.capture(ref);
      if (source.hash !== ref.hash)
        throw Error(t('ノートが変更されています。', 'The note has changed.'));
      const next = await files.moveNote(ref, destination, links);
      if (next.path === ref.path) return next;
      // The record is rebound to the bytes as moved, before any link is rewritten.
      let notice = await knowledge.rebind(source, { scopeId: next.scopeId, path: next.path }).then(
        () => undefined,
        () =>
          t(
            'ノートは移動しましたが、資料 ID を再接続できませんでした。',
            'The note moved, but its material IDs could not be reconnected.',
          ),
      );
      const addNotice = (more: string) => {
        notice = [notice, more].filter(Boolean).join(' ');
      };
      try {
        await moveNoteComments(files, ref.scopeId, ref.path, next.path);
      } catch {
        addNotice(
          t(
            'ノートは移動しましたが、コメントを移せませんでした。',
            'The note moved, but its comments could not be moved with it.',
          ),
        );
      }
      try {
        await authorship.carry(ref, next, next.text);
      } catch {
        addNotice(
          t(
            'ノートは移動しましたが、人の行の記録を引き継げませんでした。',
            'The note moved, but the record of human-written lines could not be carried over.',
          ),
        );
      }
      if (!links) return { ...next, notice };
      const update = await relink(files, search, next, ref.path, async (before, after) => {
        try {
          await authorship.carry(before, after, before.text, after.text);
        } catch {
          addNotice(
            t(
              `${after.path} のリンクは更新しましたが、人の行の記録を引き継げませんでした。`,
              `Links in ${after.path} were updated, but the record of human-written lines could not be carried over.`,
            ),
          );
        }
      });
      return { ...update.doc, notice, links: update.links };
    }
    /** Whether a path of knowledge is a Markdown note: a file whose name ends in `.md`. */
    async function isNote(scopeId: string, rel: string) {
      if (!/\.md$/i.test(rel)) return false;
      return (await lstat(await files.resolve(scopeId, rel))).isFile();
    }
    /**
     * Moves a file or folder within knowledge, as the explorer does. A note that
     * stays a note moves as one (`moveNoteCarrying`); anything else moves as it
     * is, and what names its paths follows it (`carryMove`).
     */
    async function moveKnowledgeEntry(
      scopeId: string,
      from: string,
      to: string,
    ): Promise<EntryMove> {
      if (/\.md$/i.test(to) && (await isNote(scopeId, from))) {
        const doc = await files.read(scopeId, from);
        const moved = await moveNoteCarrying({ scopeId, path: from, hash: doc.hash }, to, true);
        return {
          entry: {
            path: moved.path,
            name: path.posix.basename(moved.path),
            directory: false,
            layer: 'Knowledge_Base',
            note: true,
          },
          notice: 'notice' in moved ? moved.notice : undefined,
          links: 'links' in moved ? moved.links : undefined,
        };
      }
      const { entry, files: moved } = await files.moveEntry(scopeId, from, to);
      if (from === to) return { entry };
      const carried = await carryMove(
        { files, knowledge, authorship },
        scopeId,
        { from, to },
        moved,
      );
      return {
        entry,
        links: { self: 0, ...carried.links, incomplete: false },
        ...(carried.notices.length ? { notice: carried.notices.join(' ') } : {}),
      };
    }
    /**
     * The links a move of `rel` into another vault would break (ADR 038), from
     * the vault's Markdown in knowledge; `incomplete` past 5,000 notes.
     */
    async function vaultMoveLinks(scopeId: string, rel: string) {
      const notes: { path: string; text: string }[] = [];
      const folders = [''];
      let incomplete = false;
      for (let at = 0; at < folders.length && !incomplete; at++)
        for (const entry of await files.entries(scopeId, folders[at])) {
          if (entry.blocked || entry.layer !== 'Knowledge_Base') continue;
          if (entry.directory) folders.push(entry.path);
          else if (entry.note) {
            if (notes.length >= 5000) {
              incomplete = true;
              break;
            }
            const doc = await files.read(scopeId, entry.path).catch(() => undefined);
            if (doc && !doc.viewer) notes.push({ path: entry.path, text: doc.text });
          }
        }
      return { links: brokenLinks(notes, rel), incomplete };
    }
    /** Moves a file or folder of knowledge into another vault's, with its comments (ADR 038). */
    async function moveToVault(
      scopeId: string,
      from: string,
      toScopeId: string,
      directory: string,
    ) {
      if (agents.busy(toScopeId)) throw Error(organizing());
      const { entry } = await files.moveAcross(scopeId, from, toScopeId, directory, (filename) =>
        shell.trashItem(filename),
      );
      const kept = await moveFolderComments(
        files,
        scopeId,
        { from, to: entry.path },
        toScopeId,
      ).catch(() => [from]);
      return {
        entry,
        ...(kept.length && {
          notice: t(
            `${kept.length} 件のファイルのコメントを移せませんでした。`,
            `Comments on ${kept.length} files could not be moved.`,
          ),
        }),
      };
    }
    /** Deletes a file or folder of knowledge: a note to irori's deleted notes, the rest to the system trash. */
    async function trashKnowledgeEntry(scopeId: string, target: string) {
      if (await isNote(scopeId, target)) {
        const doc = await files.read(scopeId, target);
        await files.trashNote({ scopeId, path: target, hash: doc.hash });
      } else await files.trashEntry(scopeId, target, (filename) => shell.trashItem(filename));
    }
    /** A change an agent asks for with the `irori` command, during its own run (ADR 031). */
    function agentChange<T>(scopeId: string, operation: () => Promise<T>) {
      return changeFiles(() =>
        changed(scopeId, async () => {
          if (cloud.busy || git.busy) throw Error(setupWait);
          return operation();
        }),
      );
    }
    /** A Schema setting changes what the brain's AI reads, so it waits for runs, Git and connections. */
    function changeSchema<T>(scopeId: string, operation: () => Promise<T>) {
      return changeVault(
        scopeId,
        t(
          '実行と接続の準備が終わってから Schema を変更してください。',
          'Wait for runs and connection setup to finish before changing the Schema.',
        ),
        operation,
      );
    }
    const organizing = () =>
      t(
        '実行と接続の準備が終わってからノートを整理してください。',
        'Wait for runs and connection setup to finish before organizing notes.',
      );
    /** Refuses a change to the device's registrations while any run, connection or Git operation is under way. */
    function whenIdle(refusal: string) {
      if (agents.anyBusy || cloud.busy || git.busy) throw Error(refusal);
    }
    function changeCloud<T>(scopeId: string, operation: () => Promise<T>) {
      if (agents.busy(scopeId) || git.busy)
        throw Error(
          t(
            '実行を停止してからクラウド接続を変更してください。',
            'Stop the run before changing cloud connections.',
          ),
        );
      return changed(scopeId, operation);
    }
    async function openFile(filename: string) {
      const choice = await dialog.showMessageBox(front(), {
        type: 'question',
        message: t('外部アプリで開きますか？', 'Open in an external app?'),
        detail: filename,
        buttons: [t('キャンセル', 'Cancel'), t('開く', 'Open')],
        defaultId: 0,
        cancelId: 0,
      });
      if (choice.response === 1) {
        const error = await shell.openPath(filename);
        if (error) throw Error(error);
      }
    }
    const handlers = {
      draftRead: (key) => drafts.read(key),
      draftWrite: (...args) => drafts.write(...args),
      checkForUpdates: () => updates.check(),
      openUpdatePage: (target) => updates.open(target, (url) => shell.openExternal(url)),
      updateState: () => updates.state(),
      installUpdate: () => updates.install(),
      cancelUpdate: () => updates.cancel(),
      restartToUpdate: async () => {
        // The same shutdown as closing the last window; the switch happens once it is agreed.
        if (!(await stop(() => updates.restart()))) return false;
        closeAll();
        return true;
      },
      moveNote: (ref, destination, links) =>
        changeVault(ref.scopeId, organizing(), () => moveNoteCarrying(ref, destination, links)),
      trashNote: (ref) => changeVault(ref.scopeId, organizing(), () => files.trashNote(ref)),
      trashedNotes: (id) => files.trashedNotes(id),
      restoreNote: (id, trashId) =>
        changeVault(
          id,
          t(
            '実行と接続の準備が終わってから復元してください。',
            'Wait for runs and connection setup to finish before restoring.',
          ),
          () => files.restoreNote(id, trashId),
        ),
      search: (...args) => search.search(...args),
      backlinks: (...args) => search.backlinks(...args),
      referringLinks: (...args) => referringLinks(files, search, ...args),
      resolveLink: (...args) => resolveLink(files, ...args),
      knowledgeHistory: (id) => {
        files.get(id);
        return knowledge.history(id);
      },
      restoreSource: async (source) => {
        const bytes = await knowledge.bytes(source);
        const choice = await dialog.showSaveDialog(front(), {
          title: t('保持版を別ファイルに復元', 'Restore the kept copy to another file'),
          defaultPath: path.basename(source.path),
        });
        if (choice.canceled || !choice.filePath) return;
        await writeExclusive(choice.filePath, bytes, 0o600);
      },
      sourceText: (source) => knowledge.sourceText(source),
      locateSource: (source) => knowledge.locate(source),
      rebindSource: (source, next) => changeFiles(() => knowledge.rebind(source, next)),
      registerArtifact: (source, runId) => changeFiles(() => knowledge.artifact(source, runId)),
      recoverableCloudWrites: () => leftovers.prepared(),
      unsentDriveChanges: async () => (await leftovers.unsent()).length,
      exportUnsentDriveChanges: async () => {
        const choice = await dialog.showOpenDialog(front(), {
          title: t('保存先のフォルダ', 'Folder to save to'),
          properties: ['openDirectory', 'createDirectory'],
        });
        if (choice.canceled || !choice.filePaths[0]) return null;
        const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
        const folder = path.join(choice.filePaths[0], `irori-drive-unsent-${stamp}`);
        const count = await leftovers.exportUnsent(folder);
        return { folder, count };
      },
      // Validation runs at the boundary; the host checks the address again
      // rather than trusting that it did.
      openUrl: async (url) => {
        const address = webAddress(url);
        if (!address)
          throw Error(
            t(
              'http または https のリンクだけを開けます。',
              'Only http or https links can be opened.',
            ),
          );
        await shell.openExternal(address.href);
      },
      deviceSettings: () => settings.read(),
      saveDeviceSettings: (patch) => saveSettings(patch),
      terminalShells: () => terminals.available(),
      writeTerminal: (...args) => terminals.write(...args),
      resizeTerminal: (...args) => terminals.resize(...args),
      acknowledgeTerminal: (...args) => terminals.acknowledge(...args),
      closeTerminal: (id) => terminals.close(id),
      gitStatus: (id) => git.status(id),
      gitDiff: (...args) => git.diff(...args),
      gitHistory: (...args) => git.history(...args),
      gitCommitDiff: (...args) => git.commitDiff(...args),
      gitConflict: (...args) => git.conflict(...args),
      gitStage: (...args) => changed(gitScope(args[0]), () => git.stage(...args)),
      gitStageMany: (...args) => changed(gitScope(args[0]), () => git.stageMany(...args)),
      gitCommit: (...args) => changed(gitScope(args[0]), () => git.commit(...args)),
      gitSync: (...args) =>
        changed(gitScope(args[0]), async () => {
          const before = files.list().find((space) => space.scopeId === gitScope(args[0]));
          try {
            return await git.sync(...args);
          } finally {
            // A pulled `.irori/scope.json` was taken in (ADR 028): the window reads the vaults again.
            const after = files.list().find((space) => space.scopeId === gitScope(args[0]));
            if (before && after && before !== after) emit({ type: 'vaults' });
          }
        }),
      gitResolve: (...args) => changed(gitScope(args[0]), () => git.resolve(...args)),
      gitSubmodules: (id) => git.submodules(id),
      gitSubmoduleAdd: (...args) => changed(args[0], () => git.addSubmodule(...args)),
      gitSubmoduleInit: (...args) => changed(args[0], () => git.initSubmodules(...args)),
      gitClone: (input) => git.clone(input),
      gitInit: (id) => changed(id, () => git.init(id)),
      githubAccount: () => git.githubAccount(),
      environment: () => environment.state(),
      saveEnvironment: (passphrase) => environment.save(passphrase),
      restoreEnvironment: async (input) => {
        whenIdle(
          t(
            '実行中の処理が終わってから環境を復元してください。',
            'Restore the environment after the running operations finish.',
          ),
        );
        const result = await environment.restore(input);
        emit({ type: 'vaults' });
        return result;
      },
      gitPublish: (...args) => changed(args[0], () => git.publish(...args)),
      gitOpenRepository: async (id) => {
        await shell.openExternal(await git.repositoryURL(id));
      },
      repositories: inspectRepository,
      workspaces: () => workspaces.list(),
      saveWorkspace: (...args) => workspaces.save(...args),
      saveWorkspaceGroups: (...args) => workspaces.saveGroups(...args),
      removeWorkspace: async (id) => {
        whenIdle(
          t(
            '操作の完了後に登録を削除してください。',
            'Remove it after the current operation finishes.',
          ),
        );
        await workspaces.remove(id);
      },
      ontology: (id) => readOntology(files, id),
      graphIndexStatus: (id) => graphIndex.status(id),
      updateGraphIndex: (id) =>
        changeVault(
          id,
          t(
            '実行と接続の準備が終わってから索引を更新してください。',
            'Wait for runs and connection setup to finish before updating the indexes.',
          ),
          () => graphIndex.update(id),
        ),
      skills: async (id) =>
        id === sharedSchemaId || you.rootOf(id)
          ? readFolderSkills(await schemaFolder(id))
          : readSkills(files, id),
      skillReach: (id) => readSkillReach(files, id),
      schemaSettings: (id) => schemaSettings.list(id),
      readSchemaFile: (...args) => schemaSettings.read(...args),
      writeSchemaFile: (id, rel, text, expected) =>
        changeSchema(id, () => schemaSettings.write(id, rel, text, expected)),
      moveSkill: (id, name, to) => changeSchema(id, () => schemaSettings.moveSkill(id, name, to)),
      cloudConnections: (id) => cloud.connections(id),
      connectCloud: (...args) => changeCloud(args[0], () => cloud.connect(...args)),
      disconnectCloud: (...args) => changeCloud(args[0], () => cloud.disconnect(...args)),
      renameCloud: (...args) => changeCloud(args[0], () => cloud.edit(...args)),
      removeCloud: (...args) => changeCloud(args[0], () => cloud.edit(...args)),
      setCloudAccess: (...args) => changeCloud(args[0], () => cloud.setAccess(...args)),
      openCloudFolder: async (...args) => {
        const error = await shell.openPath(await cloud.folder(...args));
        if (error) throw Error(error);
      },
      createCloudNote: (scopeId, directory, name) =>
        changeFiles(() => changed(scopeId, () => cloud.createNote(scopeId, directory, name))),
      createEntry: (scopeId, directory, entry) =>
        changeFiles(() =>
          changed(scopeId, () =>
            classify(files.get(scopeId), directory) === 'contents'
              ? cloud.createEntry(scopeId, directory, entry)
              : files.createEntry(scopeId, directory, entry),
          ),
        ),
      appendEntry: (upload, bytes) => changeFiles(() => appendUpload(upload, bytes)),
      discardEntry: (upload) => discardUpload(upload),
      moveEntry: (scopeId, from, to) =>
        classify(files.get(scopeId), from) === 'contents'
          ? changeFiles(() =>
              changed(scopeId, async () => ({ entry: await cloud.moveEntry(scopeId, from, to) })),
            )
          : changeVault(scopeId, organizing(), () => moveKnowledgeEntry(scopeId, from, to)),
      trashEntry: (scopeId, target) =>
        classify(files.get(scopeId), target) === 'contents'
          ? changeFiles(() => changed(scopeId, () => cloud.deleteEntry(scopeId, target)))
          : changeVault(scopeId, organizing(), () => trashKnowledgeEntry(scopeId, target)),
      vaultMoveLinks: (scopeId, target) => vaultMoveLinks(scopeId, target),
      moveToVault: (scopeId, from, toScopeId, directory) =>
        changeVault(scopeId, organizing(), () =>
          changed(toScopeId, () => moveToVault(scopeId, from, toScopeId, directory)),
        ),
      copyEntryPath: async (scopeId, target, absolute) => {
        const parts = target.split('/').filter(Boolean);
        if (parts.some((part) => part === '.' || part === '..'))
          throw Error(t('vault の中のパスではありません。', 'Not a path inside the vault.'));
        // The shared Schema and the irori agent's keep their files outside any vault.
        const root = (await schemaFolder(scopeId)).root;
        clipboard.writeText(absolute ? path.join(root, ...parts) : parts.join('/'));
      },
      revealEntry: async (scopeId, target) =>
        shell.showItemInFolder(
          scopeId === sharedSchemaId || you.rootOf(scopeId)
            ? path.join(
                (await schemaFolder(scopeId)).root,
                ...target.split('/').filter((part) => part && part !== '..'),
              )
            : await files.resolve(scopeId, target, true),
        ),
      addLocalFolder: (input) => changeCloud(input.scopeId, () => cloud.addLocal(input)),
      addRepository: (input) => changeCloud(input.scopeId, () => cloud.addRepository(input)),
      cloneRepository: (...args) => changeCloud(args[0], () => cloud.cloneRepository(...args)),
      updateRepository: (...args) => changeCloud(args[0], () => cloud.updateRepository(...args)),
      bindLocalFolder: (...args) => changeCloud(args[0], () => cloud.bindLocal(...args)),
      switchCloudToLocal: (...args) => changeCloud(args[0], () => cloud.switchToLocal(...args)),
      spaces: () => files.list(),
      workFolder: (scopeId) => work.folder(scopeId),
      setWorkFolder: async (scopeId, folder) => {
        const chosen = await work.choose(scopeId, folder);
        emit({ type: 'files', scopeId });
        return chosen;
      },
      openWorkFolder: async (scopeId) => {
        const error = await shell.openPath(await work.prepare(scopeId));
        if (error) throw Error(error);
      },
      chooseFolder: async () => {
        const choice = await dialog.showOpenDialog(front(), {
          properties: ['openDirectory'],
          title: t('KBフォルダを選択', 'Choose a KB folder'),
        });
        return choice.canceled ? null : choice.filePaths[0];
      },
      register: async (root, name, category) => {
        whenIdle(
          t(
            '実行中の処理を止めてから登録してください。',
            'Stop ongoing operations before registering a space.',
          ),
        );
        const inspection = await inspectRepository(root);
        if (inspection.kind === 'unavailable') throw Error(inspection.detail);
        return registerWatched(root, name, category);
      },
      createSpace: async (input) => {
        whenIdle(
          t(
            '実行中の処理の完了後に作成してください。',
            'Create it after the operation in progress finishes.',
          ),
        );
        const root = await git.create(input);
        let space: Space;
        try {
          space = await changeFiles(() => files.register(root, input.name, input.category));
        } catch (error) {
          await git.abandon(root);
          throw error;
        }
        watch(space);
        return { space, notice: await git.firstCommit(space.scopeId) };
      },
      updateSpace: async (scopeId, change) => {
        if (agents.busy(scopeId) || cloud.busy || git.busy)
          throw Error(
            t(
              '実行・Git 操作・接続が終わってから vault の設定を変えてください。',
              "Change the vault's settings after the run, Git operation and connection finish.",
            ),
          );
        return changeFiles(() => files.update(scopeId, change));
      },
      removeSpace: async (scopeId, trash) => {
        if (agents.busy(scopeId) || cloud.busy || git.busy || routines.busy)
          throw Error(
            t(
              '実行・Git 操作・接続が終わってから vault を削除してください。',
              'Remove the vault after the run, Git operation and connection finish.',
            ),
          );
        await changeFiles(() =>
          removeSpace(
            {
              files,
              workspaces,
              keep: async () => [(await you.load()).root, files.dataDir],
              release: releaseSpace,
              trash: (folder) => shell.trashItem(folder),
            },
            scopeId,
            trash,
          ),
        );
      },
      renameLayerFolder: (scopeId, layer, name) =>
        changeVault(
          scopeId,
          t(
            '実行と接続の準備が終わってからフォルダ名を変えてください。',
            'Wait for runs and connection setup to finish before renaming the folder.',
          ),
          () => renameLayerFolder({ files, cloud, knowledge, authorship }, scopeId, layer, name),
        ),
      saveSpaceIcon: (scopeId, bytes) =>
        changeFiles(() => files.saveIcon(scopeId, bytes, imageType(bytes))),
      entries: (...args) => files.entries(...args),
      read: (...args) => files.read(...args),
      saveImage: (...args) => changeFiles(() => images.save(...args)),
      readImage: (...args) => images.read(...args),
      viewerBytes: async (id, rel) => readViewerBytes(await files.resolve(id, rel), rel),
      save: (doc) =>
        changeFiles(async () => {
          // The bytes this save replaces: only the lines it introduces are the
          // person's, since the file already carried the rest.
          const before = await files.read(doc.scopeId, doc.path).catch(() => undefined);
          const saved = await files.save(doc);
          // The save does not wait on it: the store orders its own reads, so the
          // editor's next request sees this observation either way.
          // A connected folder's file is outside the KB's Git history: no authorship record.
          if (before?.hash === doc.hash && !saved.cloud)
            void authorship
              .observe({ scopeId: saved.scopeId, path: saved.path }, saved.text, before.text)
              .catch(() => {});
          return saved;
        }),
      draft: (doc) => files.draft(doc),
      createNote: (id, name, directory) =>
        changeFiles(async () =>
          files.createNote(id, name, directory ?? (await noteDirectory(files, id))),
        ),
      notesDeclaration: (id) => readNotesDeclaration(files, id),
      pageProperties: (id) => readPageProperties(files, git, id),
      dailyNote: (id) => changeFiles(() => openDailyNote(files, id)),
      openExternal: async (...args) => {
        const filename = await files.resolve(...args);
        await openFile(filename);
      },
      noteAuthorship: (id, p, text) => authorship.view({ scopeId: id, path: p }, text),
      noteComments: (id, p) => readNoteComments(files, id, p),
      addNoteComment: (id, p, comment) =>
        changeFiles(() => addNoteComment(files, git, id, p, comment)),
      removeNoteComment: (id, p, commentId) =>
        changeFiles(() => removeNoteComment(files, id, p, commentId)),
      agents: () => agents.available(),
      agentModels: (agent) => agents.models(agent),
      agentCommands: (scopeId, agent) => agents.commands(scopeId, agent),
      agentConversations: (scopeId, workspaceId) => agents.conversationList(scopeId, workspaceId),
      agentConversation: (...args) => agents.conversation(...args),
      createConversation: (...args) => agents.createConversation(...args),
      renameConversation: (...args) => agents.renameConversation(...args),
      pinConversation: (...args) => agents.pinConversation(...args),
      archiveConversation: (...args) => agents.archiveConversation(...args),
      deleteConversation: (id) => agents.deleteConversation(id),
      queueAgentMessage: (input) => agents.queueMessage(input),
      removeQueuedMessage: (...args) => agents.removeQueued(...args),
      startNextQueued: (scopeId, conversationId, workspaceId) =>
        agents.startNextQueued(scopeId, conversationId, canStartAgent, workspaceId),
      showWorkspace: async (workspaceId) => {
        await you.load();
        you.show(workspaceId);
      },
      iroriAgentFolder: async (workspaceId) => {
        await you.load();
        return you.folderOf(workspaceId);
      },
      setIroriAgentFolder: (workspaceId, folder) =>
        you.choose(
          workspaceId,
          folder,
          files.list().map((space) => space.root),
        ),
      openIroriAgentFolder: async (workspaceId) => {
        await you.load();
        const folder = you.folderOf(workspaceId).path;
        await mkdir(folder, { recursive: true });
        const error = await shell.openPath(folder);
        if (error) throw Error(error);
      },
      agentPathRoots: (workspaceId) => agentPaths.roots(workspaceId),
      locateAgentPath: (query) => agentPaths.locate(query),
      yourAi: () => you.status(),
      createYourAi: () => you.create(),
      addYourAiSkills: () => you.addStandardSkills(),
      yourAiEntries: (rel) => you.entries(rel),
      yourAiRead: (rel) => you.read(rel),
      yourAiBrains: async (scopeIds) => {
        const names = brainAgentNames(files.list());
        const brains = scopeIds.map((scopeId) => files.get(scopeId));
        const definitions = await you.definitions(brains.map((brain) => names.get(brain.scopeId)!));
        return brains.map((brain) => ({
          scopeId: brain.scopeId,
          name: brain.name,
          category: brain.category,
          agent: names.get(brain.scopeId)!,
          root: brain.root,
          definitions: definitions.get(names.get(brain.scopeId)!) ?? [],
        }));
      },
      start: (input) => {
        canStartAgent();
        return agents.startAccepted(input);
      },
      routines: (workspaceId) => routines.list(workspaceId),
      createRoutine: (owner, name, text) => routines.create(owner, name, text),
      routineSource: (ref) => routines.source(ref),
      revealRoutine: async (ref) => {
        const error = await shell.openPath(await routines.folder(ref));
        if (error) throw Error(error);
      },
      deleteRoutine: (ref) => routines.remove(ref, (folder) => shell.trashItem(folder)),
      saveRoutineSource: (ref, text, version) => routines.saveSource(ref, text, version),
      reviewRoutine: (ref) => routines.review(ref),
      runRoutine: (ref, input) => routines.run(ref, input),
      stopRoutine: (ref) => routines.stop(ref),
      routineRuns: (ref) => routines.runs(ref),
      installPython: async () => {
        await python.install();
      },
      secrets: () => secrets.list(),
      setSecret: (name, value) => secrets.set(name, value),
      deleteSecret: (name) => secrets.delete(name),
      cancel: (scopeId, conversationId) => agents.cancel(scopeId, conversationId),
      respond: (...args) => agents.respond(...args),
      stageAttachment: (name, bytes) => agents.attachments.stage(name, bytes),
      discardAttachment: (id) => agents.attachments.discard(id),
      attachmentImage: (id) => agents.attachments.image(id),
      openAttachment: async (id) => openFile(await agents.attachments.opened(id)),
      // The field to type into has the focus already; the system's dictation types there.
      dictate: () => startDictation(),
    } satisfies Omit<HostHandlers, WindowMethod>;
    type WindowMethod = 'openTerminal' | 'windowTabs' | 'otherWindows';
    /** The operations as one window calls them: what it opens is its own (ADR 051). */
    const windowHandlers = new WeakMap<BrowserWindow, HostHandlers>();
    function handlersOf(window: BrowserWindow) {
      const id = window.webContents.id;
      let own = windowHandlers.get(window);
      own ??= {
        ...handlers,
        openTerminal: async (...args) => {
          const session = await terminals.open(...args);
          terminalOwners.set(session.id, window);
          return session;
        },
        windowTabs: (open) => {
          tabs.set(id, open);
          for (const other of windows) if (other !== window) emit({ type: 'windows' }, other);
        },
        otherWindows: () => tabs.elsewhere(id),
      } satisfies HostHandlers;
      windowHandlers.set(window, own);
      return own;
    }
    ipcMain.handle('irori', async (event, method: unknown, ...args: unknown[]) => {
      try {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (
          !window ||
          !windows.has(window) ||
          event.senderFrame !== event.sender.mainFrame ||
          !(await isAppDocument(event.senderFrame.url, entry))
        )
          throw Error('Untrusted renderer');
        return { ok: true, value: await dispatchHost(handlersOf(window), method, args) };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    });
    // One shutdown at a time, whether the last window is closing or an update restarts irori.
    let stopping: Promise<boolean> | undefined;
    function stop(restart?: () => Promise<void>) {
      stopping ??= shutDown(restart).finally(() => {
        stopping = undefined;
      });
      return stopping;
    }
    // Stops what irori runs before its last window closes. `restart` switches to a prepared update
    // once the person has agreed and every draft is safe; if it fails, the window stays open.
    async function shutDown(restart?: () => Promise<void>) {
      if (git.busy) {
        await dialog.showMessageBox(front(), {
          message: restart
            ? t(
                'Git 操作の完了後に再起動してください。',
                'Restart after the Git operation finishes.',
              )
            : t(
                'Git 操作の完了後にウィンドウを閉じてください。',
                'Close the window after the Git operation finishes.',
              ),
          buttons: [t('戻る', 'Back')],
        });
        return false;
      }
      for (const window of windows) if (!(await flushDraft(window))) return false;
      if (agents.anyBusy || terminals.busy || routines.busy) {
        const answer = await dialog.showMessageBox(front(), {
          message: restart
            ? t(
                '実行中のエージェント・ルーティン・ターミナルを停止して再起動しますか？',
                'Stop the running agents, routines and terminals and restart?',
              )
            : t(
                '実行中のエージェント・ルーティン・ターミナルを停止して閉じますか？',
                'Stop the running agents, routines and terminals and close?',
              ),
          buttons: [
            t('戻る', 'Back'),
            restart
              ? t('停止して再起動', 'Stop and restart')
              : t('停止して閉じる', 'Stop and close'),
          ],
          cancelId: 0,
        });
        if (answer.response !== 1) return false;
      }
      await routines.stopAll();
      await agents.cancel();
      try {
        await drafts.idle();
        await agents.flush();
      } catch {
        await dialog.showMessageBox(front(), {
          type: 'error',
          message: t(
            '会話履歴を保存できませんでした。',
            'Could not save the conversation history.',
          ),
        });
        return false;
      }
      await restart?.();
      await terminals.closeAll();
      await git.close();
      try {
        await cloud.close();
      } catch (error) {
        await dialog.showMessageBox(front(), {
          type: 'error',
          message: t(
            'クラウド接続を終了できませんでした。',
            'Could not close the cloud connections.',
          ),
          detail: String(error),
        });
        return false;
      }
      stopWatchingRegistrations();
      await Promise.all([...watchers.values()].map((w) => w.close()));
      return true;
    }
    /** The renderer persists drafts continuously; this gives it an explicit final opportunity. */
    async function flushDraft(window: BrowserWindow) {
      try {
        if (!window.webContents.isCrashed())
          await window.webContents.executeJavaScript('window.iroriFlushDraft?.()');
        return true;
      } catch (error) {
        if (window.webContents.isCrashed()) return true;
        await dialog.showMessageBox(window, {
          type: 'error',
          message: t('下書きを保存できませんでした。', 'Could not save the draft.'),
          detail: String(error),
        });
        return false;
      }
    }
    /**
     * What a window leaves behind when others stay open, as closing all its tabs would
     * (ADR 037, 051): its terminals, the runs of vaults no other window has open and the
     * irori agent's conversations of workspaces no other window has.
     */
    async function windowShare(window: BrowserWindow) {
      const only = tabs.only(window.webContents.id);
      const yours = (await you.load()).id;
      const conversations = agents.busy(yours)
        ? (
            await Promise.all(
              only.workspaces.map((workspace) => agents.conversationList(yours, workspace)),
            )
          ).flatMap((rows) =>
            rows.flatMap((row) => (!isDamaged(row) && row.running ? [row.id] : [])),
          )
        : [];
      return {
        vaults: only.scopeIds,
        running: only.scopeIds.filter((scopeId) => agents.busy(scopeId)),
        conversations,
        terminals: [...terminalOwners].flatMap(([id, owner]) =>
          owner === window && terminals.isOpen(id) ? [id] : [],
        ),
        stop: async () => {
          await Promise.all([
            ...only.scopeIds.map((scopeId) => agents.cancel(scopeId)),
            ...conversations.map((id) => agents.cancel(yours, id)),
            ...[...terminalOwners].flatMap(([id, owner]) =>
              owner === window ? [terminals.close(id)] : [],
            ),
          ]);
          // Its vaults' cloud folders are let go unless another window has the vault.
          for (const scopeId of only.scopeIds) {
            if (!files.list().some((space) => space.scopeId === scopeId)) continue;
            for (const connection of await cloud.connections(scopeId).catch(() => []))
              if (['mounted', 'waiting', 'error'].includes(connection.state))
                await changeCloud(scopeId, () =>
                  cloud.disconnect(scopeId, connection.mountId),
                ).catch((error) => console.warn('Cloud folder stayed connected', String(error)));
          }
        },
      };
    }
    /** Closes one of several windows once the person agrees to stop what is only its own. */
    async function closeWindow(window: BrowserWindow) {
      if (!(await flushDraft(window))) return false;
      const share = await windowShare(window);
      if (share.running.length || share.conversations.length || share.terminals.length) {
        const answer = await dialog.showMessageBox(window, {
          message: t(
            'このウィンドウだけで開いているエージェント・ターミナルを停止して閉じますか？',
            'Stop the agents and terminals open only in this window and close it?',
          ),
          buttons: [t('戻る', 'Back'), t('停止して閉じる', 'Stop and close')],
          cancelId: 0,
        });
        if (answer.response !== 1) return false;
      }
      await share.stop();
      return true;
    }
    function closeAll() {
      closing = true;
      for (const window of windows) window.close();
    }
    // Windows close one at a time, so the last one is always known to be the last.
    const closings = new SerialQueue();
    const leaving = new WeakSet<BrowserWindow>();
    app.on('before-quit', (event) => {
      if (closing) return;
      // Quitting stops irori as closing its last window would, asking once.
      event.preventDefault();
      void closings.run(async () => {
        if (!closing && (await stop())) closeAll();
      });
    });
    function createWindow() {
      const from = BrowserWindow.getFocusedWindow() ?? [...windows].at(-1);
      const bounds = from && !from.isMaximized() && !from.isFullScreen() && from.getBounds();
      const window = new BrowserWindow({
        width: bounds ? bounds.width : 1440,
        height: bounds ? bounds.height : 940,
        // A new window steps down from the one it came from rather than covering it.
        ...(bounds && { x: bounds.x + 28, y: bounds.y + 28 }),
        minWidth: 980,
        minHeight: 680,
        backgroundColor: '#faf9f6',
        title: 'irori',
        icon,
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
        },
      });
      const id = window.webContents.id;
      windows.add(window);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      // A drive or sync app often gets ready while irori is in the background.
      window.on('focus', () => void cloud.retry(undefined, true));
      // A reloaded/crashed renderer cannot keep controlling its old sessions. Alone, it
      // stopped everything; beside other windows, only what was its own.
      const stopRendererSessions = () => {
        if (windows.size <= 1) {
          void terminals.closeAll();
          void routines.stopAll();
          void agents.cancel();
        } else
          void windowShare(window)
            .then((share) => share.stop())
            .catch((error) => console.warn('Window sessions could not be stopped', String(error)));
        tabs.forget(id);
      };
      window.webContents.on('render-process-gone', stopRendererSessions);
      window.webContents.on('did-start-loading', stopRendererSessions);
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
        callback(false),
      );
      window.on('close', (event) => {
        if (closing || leaving.has(window)) return;
        event.preventDefault();
        void closings.run(async () => {
          if (closing || window.isDestroyed()) return;
          if (windows.size > 1) {
            if (!(await closeWindow(window))) return;
            leaving.add(window);
            window.close();
          } else if (await stop()) closeAll();
        });
      });
      window.on('closed', () => {
        windows.delete(window);
        tabs.forget(id);
        for (const [terminal, owner] of terminalOwners)
          if (owner === window) terminalOwners.delete(terminal);
        emit({ type: 'windows' });
      });
      return window.loadFile(entry);
    }
    /** The menu, in the reader's language: File carries New Window (ADR 051). */
    const setMenu = () => {
      const newWindow = {
        id: 'new-window',
        label: t('新しいウィンドウ', 'New Window'),
        accelerator: 'CmdOrCtrl+Shift+N',
        click: () => void createWindow().catch((error) => console.error(error)),
      };
      const mac = process.platform === 'darwin';
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          ...(mac ? [{ role: 'appMenu' as const }] : []),
          {
            label: t('ファイル', 'File'),
            submenu: [
              newWindow,
              { type: 'separator' },
              mac ? { role: 'close' as const } : { role: 'quit' as const },
            ],
          },
          { role: 'editMenu' },
          { role: 'viewMenu' },
          { role: 'windowMenu' },
        ]),
      );
      app.dock?.setMenu(Menu.buildFromTemplate([newWindow]));
    };
    setMenu();
    languageChanged = setMenu;
    await createWindow();
    // An installed irori looks for a newer published version by itself; a development run and
    // the package smoke (IRORI_AUTOMATIC_UPDATE_CHECKS=0) only check when asked.
    if (app.isPackaged && process.env.IRORI_AUTOMATIC_UPDATE_CHECKS !== '0') updates.watch();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('window-all-closed', () => app.quit());
