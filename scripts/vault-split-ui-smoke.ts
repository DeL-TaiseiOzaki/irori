import { _electron as electron, expect, type Page } from '@playwright/test';
import { lstat, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';
import { chooseJapanese } from '../tests/fixtures/japanese-interface';

// A second vault beside the first (ADR 038): opened from the vault panel,
// swapped for another from its menu, and files dragged between the two
// knowledge trees, with the person asked first when links would break.
const base = await mkdtemp(path.join(tmpdir(), 'irori vault split UI '));
const files = new FileService(path.join(base, 'device'));
await files.init();
const roots: Record<string, string> = {};
const ids: string[] = [];
for (const name of ['Home', 'Paper', 'Data']) {
  roots[name] = path.join(base, name);
  await mkdir(path.join(roots[name], 'Knowledge_Base'), { recursive: true });
  ids.push((await files.register(roots[name], name, 'personal')).scopeId);
}
const knowledge = (vault: string, rel: string) => path.join(roots[vault], 'Knowledge_Base', rel);
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const asset = `_assets/image-${createHash('sha256').update(image).digest('hex')}.png`;
await mkdir(path.dirname(knowledge('Home', asset)), { recursive: true });
await writeFile(knowledge('Home', asset), image);
await writeFile(knowledge('Home', 'moving.md'), `# Moving\n\n![figure](${asset})\n`);
await writeFile(knowledge('Home', 'index.md'), '# Index\n\n[Moving](moving.md)\n');
await writeFile(knowledge('Home', 'quiet.md'), '# Quiet\n');
await new WorkspaceService(files).save('Lab', ids);
await chooseJapanese(files.dataDir);
const env = { ...process.env, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const errors: string[] = [];
const exists = (file: string) =>
  lstat(file).then(
    () => true,
    () => false,
  );
const main = (page: Page) => page.locator('.brain-panel:not(.side-panel)');
const side = (page: Page) => page.locator('.side-panel');
const row = (panel: ReturnType<typeof main>, name: string) =>
  panel.getByRole('button', { name, exact: true });

const app = await electron.launch({
  args: [
    ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '.',
  ],
  env,
});
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.setDefaultTimeout(20000);
  await page.locator('.workspace-card').filter({ hasText: 'Lab' }).click();
  await expect(main(page).locator('.brain-names strong')).toHaveText('Home');

  // The vault panel opens the next vault beside it; its menu picks another.
  await main(page).getByRole('button', { name: '横に vault を開く' }).click();
  await expect(side(page).locator('.side-names strong')).toHaveText('Paper');
  await expect(main(page).getByRole('button', { name: '横に vault を開く' })).toHaveCount(0);
  await side(page).getByRole('button', { name: '横の vault: Paper' }).click();
  await page.getByRole('menuitem', { name: 'Data' }).click();
  await expect(side(page).locator('.side-names strong')).toHaveText('Data');
  await side(page).getByRole('button', { name: '横の vault: Data' }).click();
  await page.getByRole('menuitem', { name: 'Paper' }).click();
  await expect(side(page).locator('.side-names strong')).toHaveText('Paper');

  // A note no other note links to moves at once.
  await row(main(page), 'quiet').dragTo(row(side(page), 'Knowledge_Base'));
  await expect(row(side(page), 'quiet')).toBeVisible();
  await expect(row(main(page), 'quiet')).toHaveCount(0);
  expect(await exists(knowledge('Paper', 'quiet.md'))).toBe(true);
  expect(await exists(knowledge('Home', 'quiet.md'))).toBe(false);

  // A linked note asks first; cancelling leaves it where it was.
  await row(main(page), 'moving').dragTo(row(side(page), 'Knowledge_Base'));
  const ask = page.getByRole('dialog', { name: 'Paper へ移動' });
  await expect(ask).toContainText('1 件のリンクが切れます');
  await ask.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(ask).toHaveCount(0);
  expect(await exists(knowledge('Home', 'moving.md'))).toBe(true);
  await row(main(page), 'moving').dragTo(row(side(page), 'Knowledge_Base'));
  await ask.getByRole('button', { name: '移動', exact: true }).click();
  await expect(row(side(page), 'moving')).toBeVisible();
  expect(await exists(knowledge('Home', 'moving.md'))).toBe(false);
  // Its image went with it; the link that led to it stays as written.
  expect(await readFile(knowledge('Paper', asset))).toEqual(image);
  expect(await readFile(knowledge('Home', 'index.md'), 'utf8')).toContain('(moving.md)');

  // The other way, from the vault beside into the vault on show.
  await row(side(page), 'quiet').dragTo(row(main(page), 'Knowledge_Base'));
  await expect(row(main(page), 'quiet')).toBeVisible();
  expect(await exists(knowledge('Home', 'quiet.md'))).toBe(true);

  // A note opened beside brings its vault to the main panel; the two trade places.
  await row(side(page), 'moving').click();
  await expect(main(page).locator('.brain-names strong')).toHaveText('Paper');
  await expect(side(page).locator('.side-names strong')).toHaveText('Home');
  await expect(page.locator('.ProseMirror h1')).toHaveText('Moving');
  await expect(page.locator('.ProseMirror img')).toHaveJSProperty('complete', true);
  expect(
    await page.locator('.ProseMirror img').evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBe(1);
  await page.screenshot({ path: 'test-results/irori-vault-split.png' });

  await side(page).getByRole('button', { name: '横の vault を閉じる' }).click();
  await expect(side(page)).toHaveCount(0);
  await expect(main(page).getByRole('button', { name: '横に vault を開く' })).toBeVisible();
} finally {
  await app.close();
}
expect(errors).toEqual([]);
console.log(
  'Vault split UI passed: opened beside, swapped from its menu, notes dragged both ways, a link-breaking move asked and cancelled, its image carried, and the panels traded on open.',
);
