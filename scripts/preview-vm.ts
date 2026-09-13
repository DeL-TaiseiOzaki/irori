import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';

const root = fileURLToPath(new URL('../', import.meta.url));
const state = path.join(root, '.local/vm-preview');
const data = path.join(state, 'device');
const publicDir = path.join(state, 'public');
const port = Number(process.env.IRORI_PREVIEW_PORT ?? 6080);
const vncPort = Number(process.env.IRORI_PREVIEW_VNC_PORT ?? 5908);
if (process.platform !== 'linux' || !process.env.DISPLAY)
  throw Error('Run npm run preview:vm on Linux.');
for (const value of [port, vncPort])
  if (!Number.isInteger(value) || value < 1024 || value > 65535)
    throw Error('Invalid preview port');
for (const value of [port, vncPort])
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(value, '127.0.0.1', () => server.close(() => resolve()));
  });
await fs.access(path.join(root, 'dist-host/main.cjs'));
const novnc = path.join(root, '.local/preview-tools/node_modules/@novnc/novnc');
await fs.access(path.join(novnc, 'core/rfb.js')).catch(() => {
  throw Error('Run npm run setup:preview first.');
});
await fs.mkdir(state, { recursive: true, mode: 0o700 });
await fs.mkdir(publicDir, { recursive: true, mode: 0o700 });
await fs.cp(novnc, path.join(publicDir, 'novnc'), { recursive: true });
await fs.copyFile(path.join(root, 'scripts/preview-vm.html'), path.join(publicDir, 'index.html'));
await fs.copyFile(path.join(root, 'assets/irori-icon.png'), path.join(publicDir, 'irori-icon.png'));
const passwordFile = path.join(state, 'password');
const password = randomBytes(6).toString('base64url'); // VNC's eight-byte password limit.
await fs.writeFile(passwordFile, password + '\n', { mode: 0o600 });
await fs.chmod(passwordFile, 0o600);
const files = new FileService(data);
await files.init();
const samples = [
  {
    folder: 'personal',
    name: '個人・お試しKB',
    category: 'personal' as const,
    note: '# irori を触ってみる\n\nこのノートは自由に書き換えられます。変更はこの VM に保存されます。\n\n## 試せる操作\n\n- この文章を編集して保存する\n- 「ソース」で Markdown を直接編集する\n- 「ノートを作成」でページを追加する\n- 左側で個人・チームのスペースを切り替える\n- 「AIに相談」で4種類のハーネスを選択する\n- 「クラウド接続」で接続設定と前提条件を見る\n\n| 機能 | 現在の状態 |\n| --- | --- |\n| ノート編集・保存 | この画面で操作できます |\n| ネイティブAI | VM の CLI と認証を使用します |\n| Google Drive | この VM では OAuth 設定とマウント環境の準備が必要です |\n\n日本語が直接入力できない場合は、画面上部の「日本語入力」を使ってください。\n',
  },
  {
    folder: 'team',
    name: 'チーム・お試しKB',
    category: 'team' as const,
    note: '# チームのメモ\n\n別のスペースとして開いています。個人用のノートやエージェントの会話とは分かれています。\n\n## 議題\n\n- 今週の進捗\n- 共有する資料\n- 次に試したい操作\n',
  },
];
const spaces = [];
for (const sample of samples) {
  const folder = path.join(state, 'samples', sample.folder);
  await fs.mkdir(folder, { recursive: true });
  const space =
    files.list().find((item) => item.root === folder) ??
    (await files.register(folder, sample.name, sample.category));
  spaces.push(space);
  for (const [name, text] of [
    ['ようこそ.md', sample.note],
    [
      'AGENTS.md',
      'This is a disposable irori demonstration KB. Work only inside this folder. Preserve the user’s Japanese text and unrelated notes.\n',
    ],
  ]) {
    try {
      await fs.writeFile(path.join(folder, name), text, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}
const workspaces = new WorkspaceService(files);
if (!(await workspaces.list()).some((item) => item.name === 'irori を試す'))
  await workspaces.save(
    'irori を試す',
    spaces.map((space) => space.scopeId),
  );

const children: ChildProcess[] = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(code);
  }, 1000);
}
function launch(command: string, args: string[], name: string, env = process.env) {
  const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const log = createWriteStream(path.join(state, name + '.log'), { mode: 0o600 });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  child.on('error', (error) => {
    console.error(`${name}: ${error.message}`);
    stop(1);
  });
  child.on('exit', (code) => {
    log.end();
    if (!stopping) stop(code ?? 0);
  });
  return child;
}
async function ready(value: number) {
  for (let n = 0; n < 100; n++) {
    if (stopping) throw Error('Preview process stopped');
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.connect(value, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error('Preview service did not start');
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
try {
  launch('openbox', [], 'window-manager');
  launch(
    'x11vnc',
    [
      '-display',
      process.env.DISPLAY!,
      '-localhost',
      '-noipv6',
      '-rfbport',
      String(vncPort),
      '-passwdfile',
      passwordFile,
      '-forever',
      '-shared',
      '-xkb',
      '-noxdamage',
    ],
    'vnc',
  );
  await ready(vncPort);
  launch('websockify', ['--web', publicDir, `127.0.0.1:${port}`, `127.0.0.1:${vncPort}`], 'web');
  await ready(port);
  const env: NodeJS.ProcessEnv = { ...process.env, IRORI_DATA_DIR: data };
  delete env.ELECTRON_RUN_AS_NODE;
  const nativeBin = path.join(root, '.local/harnesses/node_modules/.bin');
  try {
    await fs.access(nativeBin);
    env.PATH = [env.PATH, nativeBin].join(path.delimiter);
  } catch {
    /* Normal native PATH remains available. */
  }
  const { default: electron } = await import('electron');
  launch(
    electron as unknown as string,
    [root, ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
    'irori',
    env,
  );
  const url = `http://127.0.0.1:${port}/`;
  await fs.writeFile(
    path.join(state, 'runtime.json'),
    JSON.stringify({
      pid: process.pid,
      display: process.env.DISPLAY,
      url,
      vncPort,
      childPids: children.map((child) => child.pid),
    }),
    { mode: 0o600 },
  );
  console.log(
    `irori VM preview: ${url}\nPassword: ${password}\nForward port ${port} privately in VS Code, then open the URL in your local browser.\nSample notes persist in .local/vm-preview/samples. Close the irori window to finish; save work before stopping the launcher.`,
  );
} catch (error) {
  console.error(String(error));
  stop(1);
}
