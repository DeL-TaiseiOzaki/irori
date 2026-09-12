import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const container = args.includes('--container');
const linux = process.platform === 'linux';

if (container && !linux) {
  console.error('start:container は Linux 検証環境専用です。通常は npm start を使用してください。');
  process.exit(1);
}
if (linux && process.getuid?.() === 0 && !container && !args.includes('--no-sandbox')) {
  console.error(
    'root では通常の Electron 起動ができません。\n' +
      'この Linux 検証環境では npm run start:container を実行してください。\n' +
      'この専用コマンドは Chromium のサンドボックスを無効にします。通常のデスクトップでは一般ユーザーで npm start を使用してください。',
  );
  process.exit(1);
}
if (linux && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  console.error(
    'GUI の表示先がありません。デスクトップセッションで起動してください。\n' +
      '画面なしの動作確認: xvfb-run -a npm run test:ui\n' +
      'Xvfb で起動するだけでは、手元の画面やブラウザにウィンドウは表示されません。',
  );
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const launchArgs = args.filter((arg) => arg !== '--container');
if (container && !launchArgs.includes('--no-sandbox')) launchArgs.push('--no-sandbox');
if (container) console.log('Linux 検証用: Chromium のサンドボックスを無効にして起動します。');

let electron;
try {
  electron = (await import('electron')).default;
} catch (error) {
  console.error('Electron を準備できません。npm run setup:electron を実行してください。');
  console.error(error.message);
  process.exit(1);
}
const child = spawn(electron, [project, ...launchArgs], { stdio: 'inherit', cwd: project, env });
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
