import { _electron as electron } from '@playwright/test';
import { build, preview } from 'vite';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { release, releaseSchema } from '../website/release';

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
  await page
    .locator('.brand .mark')
    .first()
    .evaluate(async (image) => {
      await (image as HTMLImageElement).decode();
      if ((image as HTMLImageElement).naturalWidth !== 1254) throw Error('Brand icon did not load');
    });
  async function checkDownloads(expected: typeof release) {
    assert.equal(
      await page.locator('#release-notes').getAttribute('href'),
      expected.notes ?? 'https://github.com/DeL-TaiseiOzaki/irori/releases',
    );
    for (const [platform, item] of Object.entries(expected.downloads)) {
      const card = page.locator(`.download-card[data-platform="${platform}"]`);
      if (item) {
        assert.equal(await card.locator('a').getAttribute('href'), item.url);
        assert.equal(await card.locator('button').count(), 0);
        assert.equal(
          await card.locator('.artifact-info').innerText(),
          `v${expected.version} · ${item.size}`,
        );
      } else {
        assert.equal(await card.locator('button:disabled').count(), 1);
        assert.equal(await card.locator('a').count(), 0);
      }
    }
  }
  await checkDownloads(release);
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
  const available = releaseSchema.parse({
    version: '0.1.0-fixture',
    notes: 'https://example.invalid/irori/releases/tag/v0.1.0-fixture',
    downloads: {
      'windows-x64': { url: 'https://example.invalid/irori/windows.exe', size: '100 MB' },
      'macos-arm64': { url: 'https://example.invalid/irori/arm64.dmg', size: '101 MB' },
    },
  });
  const fixtures = [
    { version: null, notes: null, downloads: { 'windows-x64': null, 'macos-arm64': null } },
    // One platform published and one still unavailable must render side by side.
    { ...available, downloads: { ...available.downloads, 'macos-arm64': null } },
    available,
  ];
  for (const [index, fixture] of fixtures.entries()) {
    const outDir = path.join(temporary, `site-${index}`);
    // Inject at build time without editing the real manifest or published build output.
    await build({
      configFile: 'website/vite.config.ts',
      logLevel: 'error',
      build: { outDir },
      plugins: [
        {
          name: 'release-fixture',
          enforce: 'pre',
          load(id) {
            if (id === path.resolve('website/releases.json').replaceAll('\\', '/'))
              return JSON.stringify(fixture);
          },
        },
      ],
    });
    const fixtureServer = await preview({
      configFile: 'website/vite.config.ts',
      build: { outDir },
      preview: { port: 0, host: '127.0.0.1' },
    });
    try {
      const fixtureAddress = fixtureServer.httpServer.address();
      assert(fixtureAddress && typeof fixtureAddress !== 'string');
      await page.goto(`http://127.0.0.1:${fixtureAddress.port}/`);
      await page.locator('.download-card').last().waitFor();
      await checkDownloads(fixture);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    } finally {
      await new Promise<void>((resolve, reject) =>
        fixtureServer.httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    'Website smoke passed: real manifest plus unavailable/mixed/available fixtures, navigation, FAQ, images and mobile layout. Fixture downloads are not fetched.',
  );
} finally {
  await app?.close();
  await new Promise<void>((resolve, reject) =>
    server.httpServer.close((error) => (error ? reject(error) : resolve())),
  );
  await rm(temporary, { recursive: true, force: true });
}
