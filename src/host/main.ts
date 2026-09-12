import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import chokidar, { type FSWatcher } from 'chokidar';
import { z } from 'zod';
import { FileService } from './files';
import { AgentService } from '../agents/service';
import type { HostEvent, Space } from '../domain/types';
let window: BrowserWindow | undefined;
let closing = false;
const watchers: FSWatcher[] = [];
if (process.env.IRORI_DATA_DIR) app.setPath('userData', path.resolve(process.env.IRORI_DATA_DIR));
app
  .whenReady()
  .then(async () => {
    const files = new FileService(app.getPath('userData'));
    await files.init();
    const emit = (event: HostEvent) => {
      if (window && !window.isDestroyed()) window.webContents.send('irori:event', event);
    };
    const agents = new AgentService(files, (event) => emit({ type: 'agent', event }));
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
    const entry = path.resolve(__dirname, '../dist/index.html');
    const trustedURL = pathToFileURL(entry).href;
    window = new BrowserWindow({
      width: 1440,
      height: 940,
      minWidth: 980,
      minHeight: 680,
      backgroundColor: '#faf9f6',
      title: 'irori',
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
    const text = z.string().max(2 * 1024 * 1024),
      id = z.uuid(),
      rel = z.string().max(4096);
    const doc = z.object({
      scopeId: id,
      path: rel,
      text,
      hash: z.string().regex(/^[a-f0-9]{64}$/),
    });
    ipcMain.handle('irori', async (event, method: unknown, ...args: unknown[]) => {
      try {
        if (event.sender !== window?.webContents || event.senderFrame?.url !== trustedURL)
          throw Error('Untrusted renderer');
        let value: unknown;
        switch (method) {
          case 'spaces':
            value = files.list();
            break;
          case 'chooseFolder': {
            const choice = await dialog.showOpenDialog(window!, {
              properties: ['openDirectory'],
              title: 'KBフォルダを選択',
            });
            value = choice.canceled ? null : choice.filePaths[0];
            break;
          }
          case 'register': {
            if (agents.busy) throw Error('Stop the agent before registering a space');
            const s = await files.register(
              rel.parse(args[0]),
              z.string().min(1).max(120).parse(args[1]),
              z.enum(['personal', 'team', 'organization']).parse(args[2]),
            );
            watch(s);
            value = s;
            break;
          }
          case 'entries':
            value = await files.entries(id.parse(args[0]), rel.parse(args[1]));
            break;
          case 'read':
            value = await files.read(id.parse(args[0]), rel.parse(args[1]));
            break;
          case 'save':
            if (agents.busy)
              throw Error('エージェント実行中は保存できません。停止後に変更を確認してください。');
            value = await files.save(doc.parse(args[0]));
            break;
          case 'draft':
            value = await files.draft(doc.parse(args[0]));
            break;
          case 'createNote':
            if (agents.busy) throw Error('Stop the agent before creating a note');
            value = await files.createNote(id.parse(args[0]), z.string().max(120).parse(args[1]));
            break;
          case 'openExternal': {
            const filename = await files.resolve(id.parse(args[0]), rel.parse(args[1]));
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
            break;
          }
          case 'agents':
            value = await agents.available();
            break;
          case 'start':
            value = agents.start(
              z
                .object({
                  scopeId: id,
                  agent: z.enum(['claude', 'codex']),
                  prompt: z.string().min(1).max(32000),
                  notePath: rel.optional(),
                  newSession: z.boolean().optional(),
                })
                .parse(args[0]),
            );
            break;
          case 'cancel':
            value = await agents.cancel();
            break;
          case 'respond':
            value = agents.respond(
              id.parse(args[0]),
              z.boolean().parse(args[1]),
              args[2] === undefined
                ? undefined
                : z.record(z.string(), z.string().max(16000)).parse(args[2]),
            );
            break;
          default:
            throw Error('Unknown host operation');
        }
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    });
    window.on('close', (event) => {
      if (closing) return;
      event.preventDefault();
      void (async () => {
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
