import { _electron as electron } from '@playwright/test';
import { preview } from 'vite';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const temporary = await mkdtemp(path.join(tmpdir(), 'irori-website-'));
const server = await preview({
  configFile: 'website/vite.config.ts',
  preview: { port: 0, host: '127.0.0.1' },
});
const address = server.httpServer.address();
assert(address && typeof address !== 'string');
const url = `http://127.0.0.1:${address.port}/`;
const harness = path.join(temporary, 'website.cjs');
await writeFile(
  harness,
  `const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1440, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }});
  window.loadURL(${JSON.stringify(url)});
});
app.on('window-all-closed', () => app.quit());`,
);
// The harness tests a static website; no desktop HostAPI, user KB or provider is loaded.
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ),
);
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({
    args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), harness],
    env,
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.reload();
  await page.locator('.download-card').last().waitFor();
  assert.equal(await page.title(), 'irori — ノートから、次の仕事へ。');
  assert.equal(await page.locator('.download-card button:disabled').count(), 3);
  assert.equal(await page.locator('.download-card a').count(), 0);
  await page.getByRole('link', { name: 'ダウンロードについて' }).click();
  await page.waitForURL('**/#download');
  await page.getByText('ブラウザで使うアプリですか？', { exact: true }).click();
  assert(
    await page
      .locator('details[open]')
      .innerText()
      .then((value) => value.includes('デスクトップアプリ')),
  );
  assert(
    await page
      .locator('.app-preview img')
      .evaluate((image) => (image as HTMLImageElement).naturalWidth > 0),
  );
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/irori-website-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: 'test-results/irori-website-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'Website smoke passed: real browser, navigation, FAQ, unavailable downloads, screenshot asset and mobile layout.',
  );
} finally {
  await app?.close();
  await new Promise<void>((resolve, reject) =>
    server.httpServer.close((error) => (error ? reject(error) : resolve())),
  );
  await rm(temporary, { recursive: true, force: true });
}
