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
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fixture = window.updateFixture = {
  checks: 0, stateCalls: 0, installs: 0, cancels: 0, restarts: 0, opened: [],
  status: 'current', restart: false, listeners: new Set(), state: { install: { phase: 'idle' } },
  emit(state) {
    fixture.state = state;
    for (const listener of fixture.listeners) listener({ type: 'update', state });
  },
};
const release = { version: '0.1.4', tag: 'v0.1.4-preview.1', releaseUrl: '', downloadUrl: '' };
createRoot(document.getElementById('app')).render(<UpdateNotice host={{
  checkForUpdates: async () => {
    fixture.checks++;
    await delay(60);
    return { status: fixture.status, currentVersion: '0.1.3', release,
      detail: { available: '0.1.4 を利用できます。', current: 'このアプリより新しい公開版はありません。',
        unsupported: 'この環境向けのインストール版はまだ公開されていません。',
        error: '更新情報に接続できませんでした。' }[fixture.status],
      ...(fixture.status === 'available' && { install: { available: true } }),
    };
  },
  openUpdatePage: async (target) => { fixture.opened.push(target); },
  updateState: async () => { fixture.stateCalls++; return fixture.state; },
  installUpdate: () => {
    fixture.installs++;
    return new Promise((resolve) => { fixture.finishInstall = resolve; });
  },
  cancelUpdate: async () => { fixture.cancels++; },
  restartToUpdate: async () => {
    fixture.restarts++;
    if (fixture.restart === 'refused') throw new Error('Error: macOS が irori の置き換えを許可しませんでした。');
    return fixture.restart;
  },
  onEvent: (listener) => {
    fixture.listeners.add(listener);
    return () => fixture.listeners.delete(listener);
  },
}} />);`,
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
  type Fixture = {
    checks: number;
    stateCalls: number;
    installs: number;
    cancels: number;
    restarts: number;
    opened: string[];
    status: string;
    restart: boolean | 'refused';
    emit(state: unknown): void;
    finishInstall?: (ready: boolean) => void;
  };
  const state = () =>
    page.evaluate(() => {
      const { listeners: _listeners, ...rest } = (
        window as unknown as { updateFixture: Fixture & { listeners: unknown } }
      ).updateFixture;
      return rest as Fixture;
    });
  const emit = (value: unknown) =>
    page.evaluate((next) => {
      (window as unknown as { updateFixture: Fixture }).updateFixture.emit(next);
    }, value);
  const set = (values: Partial<Pick<Fixture, 'status' | 'restart'>>) =>
    page.evaluate((next) => {
      Object.assign((window as unknown as { updateFixture: Fixture }).updateFixture, next);
    }, values);
  const release = { version: '0.1.4', tag: 'v0.1.4-preview.1', releaseUrl: '', downloadUrl: '' };
  const available = {
    status: 'available',
    currentVersion: '0.1.3',
    detail: '0.1.4 を利用できます。',
    release,
    install: { available: true },
  };
  const check = page.getByRole('button', { name: '更新を確認', exact: true });
  const update = page.getByRole('button', { name: '更新して再起動', exact: true });
  const installer = page.getByRole('button', { name: 'インストーラーを取得', exact: true });
  await expect(check).toBeVisible();
  await expect.poll(async () => (await state()).stateCalls).toBe(1);
  assert.equal((await state()).checks, 0, 'mount reads the host state and requests nothing');
  await expect(page.getByRole('status')).toHaveCount(0);

  // A version irori found by itself is offered without a click.
  await emit({ check: available, install: { phase: 'idle' } });
  await expect(page.getByRole('status')).toContainText('0.1.4 を利用できます');
  await expect(page.getByRole('status')).toContainText('使用中 0.1.3 → 公開版 0.1.4');
  await expect(update).toBeVisible();
  await expect(installer).toHaveCount(0);
  assert.equal((await state()).checks, 0);

  // One button: download with progress and a way out, preparation, then the restart.
  await update.click();
  await expect.poll(async () => (await state()).installs).toBe(1);
  await expect(check).toBeDisabled();
  await emit({
    check: available,
    install: { phase: 'downloading', version: '0.1.4', received: 52428800, total: 209715200 },
  });
  await expect(page.getByRole('status')).toContainText('0.1.4 をダウンロードしています');
  await expect(page.getByRole('progressbar', { name: 'ダウンロードの進み具合' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('25% · 50.0 / 200.0 MB');
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect.poll(async () => (await state()).cancels).toBe(1);
  await emit({ check: available, install: { phase: 'preparing', version: '0.1.4' } });
  await expect(page.getByRole('status')).toContainText('0.1.4 を確認して準備しています');
  await expect(page.getByRole('button', { name: 'キャンセル', exact: true })).toHaveCount(0);
  // The person keeps a running agent: the restart is declined and offered again.
  await emit({ check: available, install: { phase: 'ready', version: '0.1.4' } });
  await page.evaluate(() =>
    (window as unknown as { updateFixture: Fixture }).updateFixture.finishInstall?.(true),
  );
  await expect.poll(async () => (await state()).restarts).toBe(1);
  const restart = page.getByRole('button', { name: '再起動して更新', exact: true });
  await expect(restart).toBeEnabled();
  await expect(page.getByRole('status')).toContainText('0.1.4 に更新する準備ができました');
  await restart.click();
  await expect.poll(async () => (await state()).restarts).toBe(2);
  // A refused switch is reported in the host's own words.
  await set({ restart: 'refused' });
  await restart.click();
  await expect(page.getByRole('alert')).toHaveText(
    'macOS が irori の置き換えを許可しませんでした。',
  );
  assert.equal((await state()).installs, 1, 'a prepared update is not downloaded again');

  // A failed update keeps both the retry and the installer.
  await emit({
    check: available,
    install: {
      phase: 'failed',
      version: '0.1.4',
      detail: 'ダウンロードした更新ファイルが公開版と一致しませんでした。',
    },
  });
  await expect(page.locator('.update-notice-result[role="alert"]')).toContainText(
    '更新できませんでした。ダウンロードした更新ファイルが公開版と一致しませんでした。',
  );
  await expect(page.getByRole('button', { name: 'もう一度更新', exact: true })).toBeVisible();
  await installer.click();
  await expect.poll(async () => (await state()).opened).toEqual(['download']);

  // An installation that cannot replace itself says why and keeps the browser route.
  await emit({
    check: {
      ...available,
      install: {
        available: false,
        detail:
          'この起動方法のアプリはアプリ内で更新できません。インストーラーを取得してください。',
      },
    },
    install: { phase: 'idle' },
  });
  await expect(page.getByRole('status')).toContainText(
    'この起動方法のアプリはアプリ内で更新できません',
  );
  await expect(update).toHaveCount(0);
  await page.getByRole('button', { name: '変更点を見る', exact: true }).click();
  await installer.click();
  await expect
    .poll(async () => (await state()).opened)
    .toEqual(['download', 'release', 'download']);

  // The person's own check still answers every outcome.
  await emit({ install: { phase: 'idle' } });
  for (const status of ['current', 'unsupported', 'error', 'available']) {
    await set({ status });
    await check.click();
    await expect(page.getByRole('button', { name: '確認中…' })).toBeDisabled();
    await expect(check).toBeEnabled();
    await expect(page.getByRole(status === 'error' ? 'alert' : 'status')).toBeVisible();
    await expect(update).toHaveCount(status === 'available' ? 1 : 0);
    await expect(installer).toHaveCount(0);
  }
  assert.equal((await state()).checks, 4);
  assert.deepEqual(errors, []);
  console.log(
    'Update UI smoke passed: automatic offer, one-button download/prepare/restart with cancel, declined and refused restarts, failure and browser fallbacks, manual checks.',
  );
} finally {
  await app?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(temporary, { recursive: true, force: true });
}
