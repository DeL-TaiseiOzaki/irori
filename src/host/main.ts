import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import squirrelStartup from 'electron-squirrel-startup';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import chokidar, { type FSWatcher } from 'chokidar';
import { dispatchHost, type HostHandlers } from '../domain/host-requests';
import { FileService } from './files';
import { AgentService } from '../agents/service';
import { CloudService } from '../cloud/service';
import { WorkspaceCloudStorage } from '../cloud/storage';
import { WorkspaceService, inspectRepository } from './workspaces';
import { GitService } from '../git/service';
import { isAppDocument } from './trust';
import type { HostEvent, Space } from '../domain/types';
import type { GoogleOAuth } from '../cloud/oauth';
declare const IRORI_DISTRIBUTION_GOOGLE_OAUTH: GoogleOAuth | null;
let window: BrowserWindow | undefined;
let closing = false;
const watchers: FSWatcher[] = [];
if (process.platform === 'win32') app.setAppUserModelId('com.squirrel.irori.irori');
if (squirrelStartup) app.quit();
if (process.env.IRORI_DATA_DIR) app.setPath('userData', path.resolve(process.env.IRORI_DATA_DIR));
app
  .whenReady()
  .then(async () => {
    if (squirrelStartup) return;
    const files = new FileService(app.getPath('userData'));
    await files.init();
    const emit = (event: HostEvent) => {
      if (window && !window.isDestroyed()) window.webContents.send('irori:event', event);
    };
    const agents = new AgentService(files, (event) => emit({ type: 'agent', event }));
    const workspaces = new WorkspaceService(files);
    const cloud = new CloudService(
      new WorkspaceCloudStorage(files, workspaces),
      (url) => shell.openExternal(url),
      undefined,
      app.isPackaged ? (IRORI_DISTRIBUTION_GOOGLE_OAUTH ?? {}) : undefined,
    );
    files.cloud = cloud;
    let fileMutations = 0;
    const git = new GitService(files, () => !agents.busy && !cloud.busy && fileMutations === 0);
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
      if (agents.busy || git.busy)
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
      gitStatus: (id) => git.status(id),
      gitDiff: (...args) => git.diff(...args),
      gitHistory: (...args) => git.history(...args),
      gitCommitDiff: (...args) => git.commitDiff(...args),
      gitConflict: (...args) => git.conflict(...args),
      gitStage: (...args) => changed(args[0], () => git.stage(...args)),
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
        if (cloud.busy || agents.busy || git.busy)
          throw Error('操作の完了後に登録を削除してください。');
        await cloud.removeWorkspace(id, () => workspaces.remove(id));
      },
      cloudSetup: () => cloud.setup(),
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
        if (agents.busy || git.busy)
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
        if (agents.busy || cloud.busy || git.busy)
          throw Error('Stop ongoing operations before registering a space');
        const inspection = await inspectRepository(root);
        if (inspection.kind === 'unavailable') throw Error(inspection.detail);
        const space = await changeFiles(() => files.register(root, name, category));
        watch(space);
        return space;
      },
      entries: (...args) => files.entries(...args),
      read: (...args) => files.read(...args),
      save: (doc) => {
        if (agents.busy)
          throw Error('エージェント実行中は保存できません。停止後に変更を確認してください。');
        return changeFiles(() => files.save(doc));
      },
      draft: (doc) => files.draft(doc),
      createNote: (...args) => {
        if (agents.busy) throw Error('Stop the agent before creating a note');
        return changeFiles(() => files.createNote(...args));
      },
      openExternal: async (...args) => {
        const filename = await files.resolve(...args);
        await openFile(filename);
      },
      agents: () => agents.available(),
      agentSession: (...args) => agents.session(...args),
      resetAgentSession: (...args) => agents.resetSession(...args),
      start: (input) => {
        if (git.busy || fileMutations) throw Error('Git 操作・保存の完了後に実行してください。');
        if (cloud.busy) throw Error('クラウド接続の準備中です。完了後に実行してください。');
        return agents.start(input);
      },
      cancel: () => agents.cancel(),
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
        if (agents.busy) {
          const answer = await dialog.showMessageBox(window!, {
            message: '実行中のエージェントを停止して閉じますか？',
            buttons: ['戻る', '停止して閉じる'],
            cancelId: 0,
          });
          if (answer.response !== 1) return;
        }
        await agents.cancel();
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
