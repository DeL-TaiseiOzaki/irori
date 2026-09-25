import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';

// A brain's name, category, icon and colour are chosen in one sheet and kept in
// the KB's .irori/scope.json, so they survive a restart and travel with the KB.
const base = await mkdtemp(path.join(tmpdir(), 'irori brain settings UI '));
const files = new FileService(path.join(base, 'device'));
await files.init();
const roots: string[] = [];
for (const name of ['Product', 'Research']) {
  const root = path.join(base, name);
  await mkdir(path.join(root, 'Knowledge_Base'), { recursive: true });
  await writeFile(path.join(root, 'Knowledge_Base', 'note.md'), `# ${name}\n`);
  roots.push(root);
}
const product = await files.register(roots[0], 'Product', 'team');
const research = await files.register(roots[1], 'Research', 'personal');
await new WorkspaceService(files).save('Lab', [product.scopeId, research.scopeId]);
const scope = async () =>
  JSON.parse(await readFile(path.join(roots[0], '.irori', 'scope.json'), 'utf8'));
// A one-pixel PNG.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const env = { ...process.env, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const launch = () =>
  electron.launch({
    args: [
      ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      '.',
    ],
    env,
  });
const errors: string[] = [];
let app = await launch();
try {
  let page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.locator('.workspace-card').filter({ hasText: 'Lab' }).click();
  const rail = page.getByRole('navigation', { name: 'Brain' });
  const sheet = page.getByRole('dialog', { name: 'Brain の設定' });
  const open = async () => {
    await page.getByRole('button', { name: 'Brain のメニュー', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Brain の設定', exact: true }).click();
    await expect(sheet).toBeVisible();
  };

  // Name, no category, a symbol and a colour.
  await open();
  await expect(sheet.getByRole('radio', { name: 'チーム', exact: true })).toBeChecked();
  await sheet.getByRole('textbox', { name: '名前' }).fill('Product Lab');
  await sheet.getByRole('radio', { name: 'なし', exact: true }).check();
  await sheet.getByRole('radio', { name: '記号', exact: true }).check();
  await sheet.getByRole('radio', { name: 'ロケット', exact: true }).check();
  await sheet.getByRole('radio', { name: '藍', exact: true }).check();
  await expect(sheet.locator('.preview-map')).toContainText('Product Lab');
  await page.screenshot({ path: 'test-results/irori-brain-settings.png' });
  await sheet.getByRole('button', { name: '保存', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(rail.getByRole('button', { name: /^Product Lab・AI/ })).toBeVisible();
  await expect(page.locator('.brain-names')).toHaveText('Product Lab');
  const stored = await scope();
  expect(stored.name).toBe('Product Lab');
  expect('category' in stored).toBe(false);
  expect(stored.appearance).toEqual({ icon: { kind: 'glyph', glyph: 'rocket' }, color: 'ai' });
  expect(stored.scopeId).toBe(product.scopeId);

  // Letters: two at most, and the sheet says so before saving.
  await open();
  await sheet.getByRole('radio', { name: '文字', exact: true }).check();
  const letters = sheet.getByRole('textbox', { name: '表示する文字' });
  await letters.fill('ABC');
  await expect(sheet.getByRole('alert')).toContainText('1〜2 文字');
  await expect(sheet.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await letters.fill('PL');
  await sheet.getByRole('button', { name: '保存', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(rail.locator('.rail-brain .brain-tile').first()).toHaveText('PL');
  expect((await scope()).appearance).toEqual({ icon: { kind: 'text', text: 'PL' }, color: 'ai' });

  // Cancelling leaves the brain as it was.
  await open();
  await sheet.getByRole('radio', { name: '桜', exact: true }).check();
  await sheet.getByRole('button', { name: 'キャンセル', exact: true }).click();
  expect((await scope()).appearance.color).toBe('ai');

  // An image, kept in .irori and shown on the rail.
  await open();
  await sheet.getByRole('radio', { name: '画像', exact: true }).check();
  await expect(sheet.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await sheet.getByLabel('アイコンの画像').setInputFiles({
    name: 'icon.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect(sheet.locator('.brain-sheet-hero img')).toBeVisible();
  await sheet.getByRole('button', { name: '保存', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  const image = (await scope()).appearance.icon;
  expect(image.kind).toBe('image');
  expect(image.path).toMatch(/^\.irori\/icon-[a-f0-9]{12}\.png$/);
  expect(await readFile(path.join(roots[0], image.path))).toEqual(png);
  await expect(rail.locator('.rail-brain .brain-tile img').first()).toBeVisible();
  // The other brain is untouched.
  expect(
    JSON.parse(await readFile(path.join(roots[1], '.irori', 'scope.json'), 'utf8')).appearance,
  ).toBeUndefined();
  await app.close();

  // The look travels with the KB: a restart reads it back.
  app = await launch();
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await expect(
    page.locator('.workspace-card').filter({ hasText: 'Lab' }).locator('img'),
  ).toBeVisible();
  await page.locator('.workspace-card').filter({ hasText: 'Lab' }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Brain' })
      .getByRole('button', { name: /^Product Lab・AI/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Brain' }).locator('.rail-brain .brain-tile img').first(),
  ).toBeVisible();
  expect(
    (await readdir(path.join(roots[0], '.irori'))).filter((name) => name.startsWith('icon-')),
  ).toHaveLength(1);
  expect(errors).toEqual([]);
  console.log(
    'Brain settings UI passed: name, no category, symbol, colour, letters with their limit, cancel, image icon, restart.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
