import { _electron as electron, expect } from '@playwright/test';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';

const temporary = await mkdtemp(path.join(tmpdir(), 'irori-update-ui-'));
const server = createServer(async (request, response) => {
  if (!['/', '/fixture.js', '/fixture.css'].includes(request.url ?? '')) {
    response.writeHead(404).end();
    return;
  }
  const file = request.url === '/' ? 'index.html' : request.url!.slice(1);
  response.setHeader(
    'Content-Type',
    file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html',
  );
  response.end(await readFile(path.join(temporary, file)));
});
let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
try {
  await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
import { UpdateNotice } from './src/app/UpdateNotice';
window.updateFixture = { calls: 0, opened: [], status: 'available' };
const fixture = window.updateFixture;
createRoot(document.getElementById('app')).render(<UpdateNotice
  check={async () => {
    fixture.calls++;
    await new Promise(resolve => setTimeout(resolve, 60));
    return { status: fixture.status, currentVersion: '0.1.3',
      detail: { available: '0.1.4 を利用できます。', current: 'このアプリより新しい公開版はありません。',
        unsupported: 'この環境向けのインストール版はまだ公開されていません。',
        error: '更新情報に接続できませんでした。' }[fixture.status],
      release: { version: '0.1.4', tag: 'v0.1.4-preview.1' }
    };
  }}
  open={async target => { fixture.opened.push(target); }}
/>);`,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    format: 'esm',
    jsx: 'automatic',
    outfile: path.join(temporary, 'fixture.js'),
  });
  await writeFile(
    path.join(temporary, 'index.html'),
    '<!doctype html><html lang="ja"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><div id="app" style="width:280px"></div><script type="module" src="/fixture.js"></script></html>',
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/`;
  const harness = path.join(temporary, 'harness.cjs');
  await writeFile(
    harness,
    `const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 400, height: 500, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.loadURL(${JSON.stringify(url)});
});
app.on('window-all-closed', () => app.quit());`,
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), harness],
    env,
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const check = page.getByRole('button', { name: '更新を確認', exact: true });
  await expect(check).toBeVisible();
  const state = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            updateFixture: { calls: number; opened: string[]; status: string };
          }
        ).updateFixture,
    );
  assert.equal((await state()).calls, 0, 'mount must not check for updates');
  await check.click();
  await expect(page.getByRole('button', { name: '確認中…' })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('0.1.4 を利用できます');
  await page.getByRole('button', { name: '変更点を見る' }).click();
  await page.getByRole('button', { name: 'インストーラーを取得' }).click();
  assert.deepEqual((await state()).opened, ['release', 'download']);
  assert.equal((await state()).calls, 1);
  for (const status of ['current', 'unsupported', 'error']) {
    await page.evaluate((value) => {
      (window as unknown as { updateFixture: { status: string } }).updateFixture.status = value;
    }, status);
    await check.click();
    await expect(check).toBeEnabled();
    await expect(page.getByRole('button', { name: 'インストーラーを取得' })).toHaveCount(0);
    await expect(page.getByRole(status === 'error' ? 'alert' : 'status')).toBeVisible();
  }
  assert.equal((await state()).calls, 4);
  assert.deepEqual(errors, []);
  console.log(
    'Update UI smoke passed: manual check only, available/current/unsupported/offline, explicit browser actions.',
  );
} finally {
  await app?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(temporary, { recursive: true, force: true });
}
