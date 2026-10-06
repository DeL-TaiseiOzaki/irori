import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell } from 'electron';
import { setLanguage, t } from '../domain/i18n';
import squirrelStartup from 'electron-squirrel-startup';
import path from 'node:path';
import { realpath, open as openFileHandle } from 'node:fs/promises';
import chokidar, { type FSWatcher } from 'chokidar';
import { dispatchHost, type HostHandlers } from '../domain/host-requests';
import { webAddress } from '../domain/links';
import { FileService, readViewerBytes } from './files';
import { SettingsService } from './settings';
import { SearchService } from './search';
import { resolveLink } from './links';
import { referringLinks, relink } from './relink';
import { renameLayerFolder } from './layer-folders';
import { DraftService } from './drafts';
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
import { brainAgentNames } from '../domain/you';
import { AuthorshipStore } from '../knowledge/authorship';
import { CloudService } from '../cloud/service';
import { WorkspaceService, inspectRepository } from './workspaces';
import { GitService } from '../git/service';
import { GitHubCli } from '../git/github';
import { EnvironmentService } from './environment';
import { gitScope } from '../domain/git';
import { isAppDocument } from './trust';
import { readOntology } from './ontology';
import { GraphIndexService } from './graph-index';
import { noteDirectory, openDailyNote, readNotesDeclaration } from './notes';
import { readPageProperties } from './properties';
import { addNoteComment, moveNoteComments, readNoteComments, removeNoteComment } from './comments';
import { readFolderSkills, readSkillReach, readSkills } from './skills';
import { SchemaSettingsService } from './schema-settings';
import { RoutineService } from './routines';
import { reversibleStorage, SecretStore } from './keystore';
import { AgentSetup } from './agent-setup';
import { removeSpace } from './remove-space';
import { spaceFolder } from './schema-folder';
import { TerminalService } from '../terminal/service';
import {
  nativeThemeSource,
  type Category,
  type DeviceSettings,
  type HostEvent,
  type Space,
} from '../domain/types';
let window: BrowserWindow | undefined;
let closing = false;
const watchers = new Map<string, FSWatcher>();
if (process.platform === 'win32') app.setAppUserModelId('com.squirrel.irori.irori');
if (squirrelStartup) app.quit();
if (process.env.IRORI_DATA_DIR) app.setPath('userData', path.resolve(process.env.IRORI_DATA_DIR));
const ownsDeviceData = !squirrelStartup && app.requestSingleInstanceLock();
if (!ownsDeviceData) app.quit();
app.on('second-instance', () => {
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
    const settings = new SettingsService(app.getPath('userData'));
    // The chosen theme reaches Chromium before the window exists, so the first
    // paint is already the reader's, without the renderer having to repaint.
    const saveSettings = async (patch: Partial<DeviceSettings>) => {
      const next = await settings.save(patch);
      nativeTheme.themeSource = nativeThemeSource(next.theme);
      setLanguage(next.language);
      return next;
    };
    const device = await settings.read();
    nativeTheme.themeSource = nativeThemeSource(device.theme);
    // Dialogs and messages the host writes follow the reader's language too.
    setLanguage(device.language);
    const search = new SearchService(files);
    const graphIndex = new GraphIndexService(files, search);
    const drafts = new DraftService(files);
    const emit = (event: HostEvent) => {
      if (window && !window.isDestroyed()) window.webContents.send('irori:event', event);
    };
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
    const terminals = new TerminalService(files, (event) => emit({ type: 'terminal', event }));
    const workspaces = new WorkspaceService(files);
    // Folders on this device in contents (ADR 019); Drive is reached through its own app (ADR 023).
    const cloud = new CloudService(files, (filename) => shell.trashItem(filename));
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
    // Your AI's folder is the device's, not a KB's: its record is read before any run.
    const you = new YourAiService(files.dataDir);
    await you.load();
    // Conversations kept per space, CLI and checkout become conversations (ADR 017 D8),
    // once and before any run; a failure leaves the old records to try again next start.
    const identity = new DeviceIdentity(files.dataDir);
    await migrateConversations(files.dataDir, {
      deviceId: () => identity.id(),
      youId: (await you.load()).id,
      spaceName: (scopeId) => files.list().find((space) => space.scopeId === scopeId)?.name,
    }).catch((error) => console.warn('Saved conversations could not be migrated', String(error)));
    // The Schema settings take a hibachi's id or the irori agent's, whose folder is its Schema.
    const schemaFolder = async (scopeId: string) =>
      you.rootOf(scopeId) ? you.schemaFolder() : spaceFolder(files, scopeId);
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
    // Secrets are sealed with the OS-held key. A source run may stand in a reversible
    // store for the UI smoke, whose display has no keychain; a packaged app never does.
    const secrets = new SecretStore(
      path.join(files.dataDir, 'secrets.json'),
      !app.isPackaged && process.env.IRORI_TEST_KEYSTORE === 'reversible'
        ? reversibleStorage
        : safeStorage,
    );
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
    function watch(space: Space) {
      let timer: NodeJS.Timeout | undefined;
      const watcher = chokidar.watch(space.root, {
        ignoreInitial: true,
        depth: 6,
        followSymlinks: false,
        ignored: (p: string) => {
          const rel = path.relative(space.root, p).replaceAll('\\', '/');
          return (
            rel.split('/').some((x) => ['.git', 'node_modules'].includes(x)) ||
            // The declaration as it is now: its contents folder can be renamed (ADR 024).
            (files.list().find((item) => item.scopeId === space.scopeId) ?? space).contents.some(
              (c) => rel === c || rel.startsWith(c + '/'),
            )
          );
        },
      });
      watcher.on('all', () => {
        clearTimeout(timer);
        timer = setTimeout(() => emit({ type: 'files', scopeId: space.scopeId }), 150);
      });
      watcher.on('error', (error) => console.warn('Watcher error', String(error)));
      watchers.set(space.scopeId, watcher);
    }
    files.list().forEach(watch);
    const defaultParent = async () => path.dirname((await you.load()).root);
    const registerWatched = (root: string, name: string, category: Category) =>
      changeFiles(async () => {
        const space = await files.register(root, name, category);
        watch(space);
        return space;
      });
    // The irori agent's `irori` command: hibachis it registers join the request's workspace.
    const setup = new AgentSetup({
      files,
      git,
      workspaces,
      cloud,
      defaultParent,
      register: registerWatched,
      running: (scopeId) => agents.running(scopeId),
      announce: ({ workspace, scopeId }) =>
        emit(scopeId ? { type: 'files', scopeId } : { type: 'hibachis', workspace }),
    });
    agents.setup = (argv, cwd, context) => setup.run(argv, cwd, context);
    // The environment kept on the GitHub account (ADR 026).
    const environment = new EnvironmentService({
      files,
      workspaces,
      github,
      git,
      settings: { read: () => settings.read(), save: (patch) => saveSettings(patch) },
      agentRoot: async () => (await you.load()).root,
      register: registerWatched,
      defaultParent,
      appVersion,
    });
    const entry = await realpath(path.resolve(__dirname, '../dist/index.html'));
    const icon = path.resolve(__dirname, '../assets/irori-icon.png');
    app.dock?.setIcon(icon);
    window = new BrowserWindow({
      width: 1440,
      height: 940,
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
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // A reloaded/crashed renderer cannot keep controlling its old sessions.
    const stopRendererSessions = () => {
      void terminals.closeAll();
      void routines.stopAll();
      void agents.cancel();
    };
    window.webContents.on('render-process-gone', stopRendererSessions);
    window.webContents.on('did-start-loading', stopRendererSessions);
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false),
    );
    async function changed<T>(scopeId: string, operation: () => Promise<T>) {
      try {
        return await operation();
      } finally {
        emit({ type: 'files', scopeId });
      }
    }
    /** A Schema setting changes what the brain's AI reads, so it waits for runs, Git and connections. */
    function changeSchema<T>(scopeId: string, operation: () => Promise<T>) {
      return changeFiles(() =>
        changed(scopeId, async () => {
          if (agents.busy(scopeId) || cloud.busy)
            throw Error(
              t(
                '実行と接続の準備が終わってから Schema を変更してください。',
                'Wait for runs and connection setup to finish before changing the Schema.',
              ),
            );
          return operation();
        }),
      );
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
      const choice = await dialog.showMessageBox(window!, {
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
        // The same shutdown as closing the window; the switch happens once it is agreed.
        if (!(await stop(() => updates.restart()))) return false;
        closing = true;
        window?.close();
        return true;
      },
      moveNote: (ref, destination, links) =>
        changeFiles(() =>
          changed(ref.scopeId, async () => {
            if (agents.busy(ref.scopeId) || cloud.busy)
              throw Error(
                t(
                  '実行と接続の準備が終わってからノートを整理してください。',
                  'Wait for runs and connection setup to finish before organizing notes.',
                ),
              );
            const source = await knowledge.capture(ref);
            if (source.hash !== ref.hash)
              throw Error(t('ノートが変更されています。', 'The note has changed.'));
            const next = await files.moveNote(ref, destination, links);
            if (next.path === ref.path) return next;
            // The record is rebound to the bytes as moved, before any link is rewritten.
            let notice = await knowledge
              .rebind(source, { scopeId: next.scopeId, path: next.path })
              .then(
                () => undefined,
                () =>
                  t(
                    'ノートは移動しましたが、資料 ID を再接続できませんでした。',
                    'The note moved, but its material IDs could not be reconnected.',
                  ),
              );
            try {
              await moveNoteComments(files, ref.scopeId, ref.path, next.path);
            } catch {
              notice = [
                notice,
                t(
                  'ノートは移動しましたが、コメントを移せませんでした。',
                  'The note moved, but its comments could not be moved with it.',
                ),
              ]
                .filter(Boolean)
                .join(' ');
            }
            try {
              await authorship.carry(ref, next, next.text);
            } catch {
              notice = [
                notice,
                t(
                  'ノートは移動しましたが、人の行の記録を引き継げませんでした。',
                  'The note moved, but the record of human-written lines could not be carried over.',
                ),
              ]
                .filter(Boolean)
                .join(' ');
            }
            if (!links) return { ...next, notice };
            const update = await relink(files, search, next, ref.path, async (before, after) => {
              try {
                await authorship.carry(before, after, before.text, after.text);
              } catch {
                notice = [
                  notice,
                  t(
                    `${after.path} のリンクは更新しましたが、人の行の記録を引き継げませんでした。`,
                    `Links in ${after.path} were updated, but the record of human-written lines could not be carried over.`,
                  ),
                ]
                  .filter(Boolean)
                  .join(' ');
              }
            });
            return { ...update.doc, notice, links: update.links };
          }),
        ),
      trashNote: (ref) =>
        changeFiles(() =>
          changed(ref.scopeId, async () => {
            if (agents.busy(ref.scopeId) || cloud.busy)
              throw Error(
                t(
                  '実行と接続の準備が終わってからノートを整理してください。',
                  'Wait for runs and connection setup to finish before organizing notes.',
                ),
              );
            return files.trashNote(ref);
          }),
        ),
      trashedNotes: (id) => files.trashedNotes(id),
      restoreNote: (id, trashId) =>
        changeFiles(() =>
          changed(id, async () => {
            if (agents.busy(id) || cloud.busy)
              throw Error(
                t(
                  '実行と接続の準備が終わってから復元してください。',
                  'Wait for runs and connection setup to finish before restoring.',
                ),
              );
            return files.restoreNote(id, trashId);
          }),
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
        const choice = await dialog.showSaveDialog(window!, {
          title: t('保持版を別ファイルに復元', 'Restore the kept copy to another file'),
          defaultPath: path.basename(source.path),
        });
        if (choice.canceled || !choice.filePath) return;
        const file = await openFileHandle(choice.filePath, 'wx', 0o600);
        try {
          await file.writeFile(bytes);
          await file.sync();
        } finally {
          await file.close();
        }
      },
      sourceText: (source) => knowledge.sourceText(source),
      locateSource: (source) => knowledge.locate(source),
      rebindSource: (source, next) => changeFiles(() => knowledge.rebind(source, next)),
      registerArtifact: (source, runId) => changeFiles(() => knowledge.artifact(source, runId)),
      recoverableCloudWrites: () => leftovers.prepared(),
      unsentDriveChanges: async () => (await leftovers.unsent()).length,
      exportUnsentDriveChanges: async () => {
        const choice = await dialog.showOpenDialog(window!, {
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
      openTerminal: (...args) => terminals.open(...args),
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
      gitSync: (...args) => changed(gitScope(args[0]), () => git.sync(...args)),
      gitResolve: (...args) => changed(gitScope(args[0]), () => git.resolve(...args)),
      gitSubmodules: (id) => git.submodules(id),
      gitSubmoduleAdd: (...args) => changed(args[0], () => git.addSubmodule(...args)),
      gitSubmoduleInit: (...args) => changed(args[0], () => git.initSubmodules(...args)),
      gitClone: (input) => git.clone(input),
      gitInit: (id) => changed(id, () => git.init(id)),
      githubAccount: () => git.githubAccount(),
      environment: () => environment.state(),
      saveEnvironment: () => environment.save(),
      restoreEnvironment: async (input) => {
        if (agents.anyBusy || cloud.busy || git.busy)
          throw Error(
            t(
              '実行中の処理が終わってから環境を復元してください。',
              'Restore the environment after the running operations finish.',
            ),
          );
        const result = await environment.restore(input);
        emit({ type: 'hibachis' });
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
        if (cloud.busy || agents.anyBusy || git.busy)
          throw Error(
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
        changeFiles(() =>
          changed(id, async () => {
            if (agents.busy(id) || cloud.busy)
              throw Error(
                t(
                  '実行と接続の準備が終わってからグラフ索引を更新してください。',
                  'Wait for runs and connection setup to finish before updating the graph index.',
                ),
              );
            return graphIndex.update(id);
          }),
        ),
      skills: async (id) =>
        you.rootOf(id) ? readFolderSkills(await you.schemaFolder()) : readSkills(files, id),
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
      moveCloudEntry: (scopeId, from, to) =>
        changeFiles(() => changed(scopeId, () => cloud.moveEntry(scopeId, from, to))),
      deleteCloudEntry: (scopeId, target) =>
        changeFiles(() => changed(scopeId, () => cloud.deleteEntry(scopeId, target))),
      addLocalFolder: (input) => changeCloud(input.scopeId, () => cloud.addLocal(input)),
      bindLocalFolder: (...args) => changeCloud(args[0], () => cloud.bindLocal(...args)),
      switchCloudToLocal: (...args) => changeCloud(args[0], () => cloud.switchToLocal(...args)),
      spaces: () => files.list(),
      chooseFolder: async () => {
        const choice = await dialog.showOpenDialog(window!, {
          properties: ['openDirectory'],
          title: t('KBフォルダを選択', 'Choose a KB folder'),
        });
        return choice.canceled ? null : choice.filePaths[0];
      },
      register: async (root, name, category) => {
        if (agents.anyBusy || cloud.busy || git.busy)
          throw Error('Stop ongoing operations before registering a space');
        const inspection = await inspectRepository(root);
        if (inspection.kind === 'unavailable') throw Error(inspection.detail);
        const space = await changeFiles(() => files.register(root, name, category));
        watch(space);
        return space;
      },
      createSpace: async (input) => {
        if (agents.anyBusy || cloud.busy || git.busy)
          throw Error(
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
              '実行・Git 操作・接続が終わってから hibachi の設定を変えてください。',
              "Change the hibachi's settings after the run, Git operation and connection finish.",
            ),
          );
        return changeFiles(() => files.update(scopeId, change));
      },
      removeSpace: async (scopeId, trash) => {
        if (agents.busy(scopeId) || cloud.busy || git.busy || routines.busy)
          throw Error(
            t(
              '実行・Git 操作・接続が終わってから hibachi を削除してください。',
              'Remove the hibachi after the run, Git operation and connection finish.',
            ),
          );
        await changeFiles(() =>
          removeSpace(
            {
              files,
              workspaces,
              keep: async () => [(await you.load()).root, files.dataDir],
              release: async (space) => {
                await terminals.closeScope(space.scopeId);
                const connected = await cloud.suspend(space.scopeId);
                await watchers.get(space.scopeId)?.close();
                watchers.delete(space.scopeId);
                return async () => {
                  watch(space);
                  await cloud.resume(space.scopeId, connected);
                };
              },
              trash: (folder) => shell.trashItem(folder),
            },
            scopeId,
            trash,
          ),
        );
      },
      renameLayerFolder: (scopeId, layer, name) =>
        changeFiles(() =>
          changed(scopeId, async () => {
            if (agents.busy(scopeId) || cloud.busy)
              throw Error(
                t(
                  '実行と接続の準備が終わってからフォルダ名を変えてください。',
                  'Wait for runs and connection setup to finish before renaming the folder.',
                ),
              );
            return renameLayerFolder({ files, cloud, knowledge, authorship }, scopeId, layer, name);
          }),
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
      agentConversations: (scopeId) => agents.conversationList(scopeId),
      agentConversation: (...args) => agents.conversation(...args),
      createConversation: (...args) => agents.createConversation(...args),
      renameConversation: (...args) => agents.renameConversation(...args),
      pinConversation: (...args) => agents.pinConversation(...args),
      archiveConversation: (...args) => agents.archiveConversation(...args),
      deleteConversation: (id) => agents.deleteConversation(id),
      queueAgentMessage: (input) => agents.queueMessage(input),
      removeQueuedMessage: (...args) => agents.removeQueued(...args),
      startNextQueued: (scopeId, conversationId) =>
        agents.startNextQueued(scopeId, conversationId, canStartAgent),
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
      reviewRoutine: (ref) => routines.review(ref),
      runRoutine: (ref, input) => routines.run(ref, input),
      stopRoutine: (ref) => routines.stop(ref),
      routineRuns: (ref) => routines.runs(ref),
      secrets: () => secrets.list(),
      setSecret: (name, value) => secrets.set(name, value),
      deleteSecret: (name) => secrets.delete(name),
      cancel: (scopeId, conversationId) => agents.cancel(scopeId, conversationId),
      respond: (...args) => agents.respond(...args),
    } satisfies HostHandlers;
    ipcMain.handle('irori', async (event, method: unknown, ...args: unknown[]) => {
      try {
        if (
          event.sender !== window?.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          !(await isAppDocument(event.senderFrame.url, entry))
        )
          throw Error('Untrusted renderer');
        return { ok: true, value: await dispatchHost(handlers, method, args) };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    });
    // One shutdown at a time, whether the window is closing or an update restarts irori.
    let stopping: Promise<boolean> | undefined;
    function stop(restart?: () => Promise<void>) {
      stopping ??= shutDown(restart).finally(() => {
        stopping = undefined;
      });
      return stopping;
    }
    // Stops what the window owns before it closes. `restart` switches to a prepared update
    // once the person has agreed and every draft is safe; if it fails, the window stays open.
    async function shutDown(restart?: () => Promise<void>) {
      if (git.busy) {
        await dialog.showMessageBox(window!, {
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
      // The renderer persists drafts continuously; give it an explicit final opportunity.
      try {
        if (!window?.webContents.isCrashed())
          await window?.webContents.executeJavaScript('window.iroriFlushDraft?.()');
      } catch (error) {
        if (!window?.webContents.isCrashed()) {
          await dialog.showMessageBox(window!, {
            type: 'error',
            message: t('下書きを保存できませんでした。', 'Could not save the draft.'),
            detail: String(error),
          });
          return false;
        }
      }
      if (agents.anyBusy || terminals.busy || routines.busy) {
        const answer = await dialog.showMessageBox(window!, {
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
        await dialog.showMessageBox(window!, {
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
        await dialog.showMessageBox(window!, {
          type: 'error',
          message: t(
            'クラウド接続を終了できませんでした。',
            'Could not close the cloud connections.',
          ),
          detail: String(error),
        });
        return false;
      }
      await Promise.all([...watchers.values()].map((w) => w.close()));
      return true;
    }
    window.on('close', (event) => {
      if (closing) return;
      event.preventDefault();
      void stop().then((done) => {
        if (!done) return;
        closing = true;
        window?.close();
      });
    });
    await window.loadFile(entry);
    // An installed irori looks for a newer published version by itself; a development run and
    // the package smoke (IRORI_AUTOMATIC_UPDATE_CHECKS=0) only check when asked.
    if (app.isPackaged && process.env.IRORI_AUTOMATIC_UPDATE_CHECKS !== '0') updates.watch();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('window-all-closed', () => app.quit());
