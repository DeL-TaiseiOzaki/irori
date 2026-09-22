import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import squirrelStartup from 'electron-squirrel-startup';
import path from 'node:path';
import { realpath, open as openFileHandle } from 'node:fs/promises';
import chokidar, { type FSWatcher } from 'chokidar';
import { dispatchHost, type HostHandlers } from '../domain/host-requests';
import { webAddress } from '../domain/links';
import { FileService } from './files';
import { SettingsService } from './settings';
import { SearchService } from './search';
import { resolveLink } from './links';
import { referringLinks, relink } from './relink';
import { DraftService } from './drafts';
import { UpdateService } from './updates';
import { version as appVersion } from '../../package.json';
import { ImageService } from './images';
import { KnowledgeStore } from '../knowledge/store';
import { CloudOutbox } from '../cloud/outbox';
import { AgentService } from '../agents/service';
import { AuthorshipStore } from '../knowledge/authorship';
import { CloudService } from '../cloud/service';
import { WorkspaceCloudStorage } from '../cloud/storage';
import { WorkspaceService, inspectRepository } from './workspaces';
import { GitService } from '../git/service';
import { isAppDocument } from './trust';
import { readOntology } from './ontology';
import { GraphIndexService } from './graph-index';
import { noteDirectory, openDailyNote, readNotesDeclaration } from './notes';
import { readSkillReach, readSkills } from './skills';
import { TerminalService } from '../terminal/service';
import { Rclone } from '../cloud/rclone';
import type { HostEvent, Space } from '../domain/types';
import type { GoogleOAuth } from '../cloud/oauth';
declare const IRORI_DISTRIBUTION_GOOGLE_OAUTH: GoogleOAuth | null;
let window: BrowserWindow | undefined;
let closing = false;
const watchers: FSWatcher[] = [];
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
    nativeTheme.themeSource = (await settings.read()).theme;
    const search = new SearchService(files);
    const graphIndex = new GraphIndexService(files, search);
    const drafts = new DraftService(files);
    const updates = new UpdateService({
      currentVersion: appVersion,
      platform: process.platform,
      arch: process.arch,
    });
    const emit = (event: HostEvent) => {
      if (window && !window.isDestroyed()) window.webContents.send('irori:event', event);
    };
    const terminals = new TerminalService(files, (event) => emit({ type: 'terminal', event }));
    const workspaces = new WorkspaceService(files);
    const cloud = new CloudService(
      new WorkspaceCloudStorage(files, workspaces),
      (url) => shell.openExternal(url),
      new Rclone(
        files.dataDir,
        app.isPackaged
          ? path.join(
              app.getAppPath() + '.unpacked',
              'vendor',
              'rclone',
              process.platform === 'win32' ? 'rclone.exe' : 'rclone',
            )
          : undefined,
      ),
      app.isPackaged ? (IRORI_DISTRIBUTION_GOOGLE_OAUTH ?? {}) : undefined,
    );
    files.cloud = cloud;
    const images = new ImageService(files, async (id, rel) => {
      if (files.list().some((space) => space.scopeId === id)) return files.resolve(id, rel);
      await cloud.workspaceRoot(id);
      return cloud.resolve(id, rel);
    });
    const knowledge = new KnowledgeStore(files.dataDir, async (ref) => {
      if (files.list().some((space) => space.scopeId === ref.scopeId))
        return files.resolve(ref.scopeId, ref.path);
      await cloud.workspaceRoot(ref.scopeId);
      return cloud.resolve(ref.scopeId, ref.path);
    });
    const outbox = new CloudOutbox(files.dataDir, knowledge);
    // The notes are read through the Git service declared below, once a note is open.
    const authorship = new AuthorshipStore(files.dataDir, (ref) =>
      git.noted(ref.scopeId, ref.path),
    );
    const agents = new AgentService(
      files,
      (event) => emit({ type: 'agent', event }),
      knowledge,
      authorship,
    );
    let fileMutations = 0;
    const git = new GitService(
      files,
      () => !agents.anyBusy && !cloud.busy && fileMutations === 0,
      authorship,
    );
    function canStartAgent() {
      if (git.busy || fileMutations) throw Error('Git 操作・保存の完了後に実行してください。');
      if (cloud.busy) throw Error('クラウド接続の準備中です。完了後に実行してください。');
    }
    async function changeFiles<T>(fn: () => Promise<T>) {
      if (git.busy) throw Error('Git 操作の完了後に保存・登録してください。');
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
            space.contents.some((c) => rel === c || rel.startsWith(c + '/'))
          );
        },
      });
      watcher.on('all', () => {
        clearTimeout(timer);
        timer = setTimeout(() => emit({ type: 'files', scopeId: space.scopeId }), 150);
      });
      watcher.on('error', (error) => console.warn('Watcher error', String(error)));
      watchers.push(watcher);
    }
    files.list().forEach(watch);
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
    function changeCloud<T>(scopeId: string, operation: () => Promise<T>) {
      if (agents.busy(scopeId) || git.busy)
        throw Error('実行を停止してからクラウド接続を変更してください。');
      return changed(scopeId, operation);
    }
    async function openFile(filename: string) {
      const choice = await dialog.showMessageBox(window!, {
        type: 'question',
        message: '外部アプリで開きますか？',
        detail: filename,
        buttons: ['キャンセル', '開く'],
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
      moveNote: (ref, destination, links) =>
        changeFiles(() =>
          changed(ref.scopeId, async () => {
            if (agents.busy(ref.scopeId) || cloud.busy)
              throw Error('実行と接続の準備が終わってからノートを整理してください。');
            const source = await knowledge.capture(ref);
            if (source.hash !== ref.hash)
              throw Error('ノートが変更されています。開き直して確認してください。');
            const next = await files.moveNote(ref, destination, links);
            if (next.path === ref.path) return next;
            // The record is rebound to the bytes as moved, before any link is rewritten.
            const notice = await knowledge
              .rebind(source, { scopeId: next.scopeId, path: next.path })
              .then(
                () => undefined,
                () =>
                  'ノートは移動しましたが、資料 ID を再接続できませんでした。「資料と成果物」から移動先を再接続してください。',
              );
            if (!links) return { ...next, notice };
            const update = await relink(files, search, next, ref.path);
            return { ...update.doc, notice, links: update.links };
          }),
        ),
      trashNote: (ref) =>
        changeFiles(() =>
          changed(ref.scopeId, async () => {
            if (agents.busy(ref.scopeId) || cloud.busy)
              throw Error('実行と接続の準備が終わってからノートを整理してください。');
            return files.trashNote(ref);
          }),
        ),
      trashedNotes: (id) => files.trashedNotes(id),
      restoreNote: (id, trashId) =>
        changeFiles(() =>
          changed(id, async () => {
            if (agents.busy(id) || cloud.busy)
              throw Error('実行と接続の準備が終わってから復元してください。');
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
          title: '保持版を別ファイルに復元',
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
      pendingCloudWrites: async (id) => {
        await cloud.declarations(id);
        return outbox.list(id);
      },
      prepareCloudWrite: async (id, mountId, source) => {
        const target = (await cloud.declarations(id)).find((item) => item.mountId === mountId);
        if (!target) throw Error('送信先の接続が見つかりません。');
        return outbox.prepare({ ownerId: id, mountId, folderId: target.folderId }, source);
      },
      // Validation runs at the boundary; the host checks the address again
      // rather than trusting that it did.
      openUrl: async (url) => {
        const address = webAddress(url);
        if (!address) throw Error('http または https のリンクだけを開けます。');
        await shell.openExternal(address.href);
      },
      deviceSettings: () => settings.read(),
      saveDeviceSettings: async (patch) => {
        const next = await settings.save(patch);
        nativeTheme.themeSource = next.theme;
        return next;
      },
      openCloudSetupHelp: () =>
        shell.openExternal(
          process.platform === 'win32'
            ? 'https://winfsp.dev/rel/'
            : 'https://rclone.org/install/#installation-with-precompiled-binaries',
        ),
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
      gitStage: (...args) => changed(args[0], () => git.stage(...args)),
      gitStageMany: (...args) => changed(args[0], () => git.stageMany(...args)),
      gitCommit: (...args) => changed(args[0], () => git.commit(...args)),
      gitSync: (...args) => changed(args[0], () => git.sync(...args)),
      gitResolve: (...args) => changed(args[0], () => git.resolve(...args)),
      gitClone: (input) => git.clone(input),
      gitOpenRepository: async (id) => {
        await shell.openExternal(await git.repositoryURL(id));
      },
      repositories: inspectRepository,
      workspaces: () => workspaces.list(),
      saveWorkspace: (...args) => workspaces.save(...args),
      removeWorkspace: async (id) => {
        if (cloud.busy || agents.anyBusy || git.busy)
          throw Error('操作の完了後に登録を削除してください。');
        await cloud.removeWorkspace(id, () => workspaces.remove(id));
      },
      cloudSetup: () => cloud.setup(),
      ontology: (id) => readOntology(files, id),
      graphIndexStatus: (id) => graphIndex.status(id),
      updateGraphIndex: (id) =>
        changeFiles(() =>
          changed(id, async () => {
            if (agents.busy(id) || cloud.busy)
              throw Error('実行と接続の準備が終わってからグラフ索引を更新してください。');
            return graphIndex.update(id);
          }),
        ),
      skills: (id) => readSkills(files, id),
      skillReach: (id) => readSkillReach(files, id),
      workspaceCloud: (id) => cloud.workspaceRoot(id),
      cloudEntries: (...args) => cloud.entries(...args),
      cloudRead: (...args) => cloud.read(...args),
      openCloudFile: async (id, rel) => {
        await cloud.workspaceRoot(id);
        await openFile(await cloud.resolve(id, rel));
      },
      cloudAccounts: () => cloud.accounts.list(),
      addCloudAccount: (name) => cloud.addAccount(name),
      cancelCloudAccount: (id) => cloud.cancelAccount(id),
      removeCloudAccount: (id) => {
        if (agents.anyBusy || git.busy)
          throw Error('実行を停止してからアカウントを登録解除してください。');
        return cloud.removeAccount(id);
      },
      cloudDrives: (id) => cloud.accounts.drives(id),
      cloudFolders: (...args) => cloud.accounts.folders(...args),
      cloudConnections: (id) => cloud.connections(id),
      addCloudAttachment: (input) => changeCloud(input.scopeId, () => cloud.add(input)),
      connectCloud: (...args) => changeCloud(args[0], () => cloud.connect(...args)),
      disconnectCloud: (...args) => changeCloud(args[0], () => cloud.disconnect(...args)),
      renameCloud: (...args) => changeCloud(args[0], () => cloud.edit(...args)),
      removeCloud: (...args) => changeCloud(args[0], () => cloud.edit(...args)),
      bindCloud: (...args) => changeCloud(args[0], () => cloud.bind(...args)),
      spaces: () => files.list(),
      chooseFolder: async () => {
        const choice = await dialog.showOpenDialog(window!, {
          properties: ['openDirectory'],
          title: 'KBフォルダを選択',
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
      entries: (...args) => files.entries(...args),
      read: (...args) => files.read(...args),
      saveImage: (...args) => changeFiles(() => images.save(...args)),
      readImage: (...args) => images.read(...args),
      save: (doc) =>
        changeFiles(async () => {
          // The bytes this save replaces: only the lines it introduces are the
          // person's, since the file already carried the rest.
          const before = await files.read(doc.scopeId, doc.path).catch(() => undefined);
          const saved = await files.save(doc);
          // The save does not wait on it: the store orders its own reads, so the
          // editor's next request sees this observation either way.
          if (before?.hash === doc.hash)
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
      dailyNote: (id) => changeFiles(() => openDailyNote(files, id)),
      openExternal: async (...args) => {
        const filename = await files.resolve(...args);
        await openFile(filename);
      },
      noteAuthorship: (id, p, text) => authorship.view({ scopeId: id, path: p }, text),
      agents: () => agents.available(),
      agentSession: (...args) => agents.session(...args),
      agentConversation: (...args) => agents.conversation(...args),
      queueAgentMessage: (input) => agents.queueMessage(input),
      removeQueuedMessage: (...args) => agents.removeQueued(...args),
      startQueuedMessage: async (...args) => {
        canStartAgent();
        return agents.startQueued(...args, canStartAgent);
      },
      resetAgentSession: (...args) => agents.resetSession(...args),
      start: (input) => {
        canStartAgent();
        return agents.startAccepted(input);
      },
      cancel: (scopeId) => agents.cancel(scopeId),
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
    window.on('close', (event) => {
      if (closing) return;
      event.preventDefault();
      void (async () => {
        if (git.busy) {
          await dialog.showMessageBox(window!, {
            message: 'Git 操作が実行中です。完了後にウィンドウを閉じてください。',
            buttons: ['戻る'],
          });
          return;
        }
        // The renderer persists drafts continuously; give it an explicit final opportunity.
        try {
          if (!window?.webContents.isCrashed())
            await window?.webContents.executeJavaScript('window.iroriFlushDraft?.()');
        } catch (error) {
          if (!window?.webContents.isCrashed()) {
            await dialog.showMessageBox(window!, {
              type: 'error',
              message: '下書きを保存できませんでした。ウィンドウを開いたままにします。',
              detail: String(error),
            });
            return;
          }
        }
        if (agents.anyBusy || terminals.busy) {
          const answer = await dialog.showMessageBox(window!, {
            message: '実行中のエージェント・ターミナルを停止して閉じますか？',
            buttons: ['戻る', '停止して閉じる'],
            cancelId: 0,
          });
          if (answer.response !== 1) return;
        }
        await agents.cancel();
        try {
          await drafts.idle();
          await agents.flush();
        } catch {
          await dialog.showMessageBox(window!, {
            type: 'error',
            message: '会話履歴を保存できませんでした。再試行してください。',
          });
          return;
        }
        await terminals.closeAll();
        await git.close();
        try {
          await cloud.close();
        } catch (error) {
          await dialog.showMessageBox(window!, {
            type: 'error',
            message: 'クラウド接続を終了できませんでした。再試行してください。',
            detail: String(error),
          });
          return;
        }
        await Promise.all(watchers.map((w) => w.close()));
        closing = true;
        window?.close();
      })();
    });
    await window.loadFile(entry);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('window-all-closed', () => app.quit());
