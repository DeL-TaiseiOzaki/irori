import { _electron as electron, expect, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';

// Hibachis gathered into a named group in the rail: made and filled from each
// hibachi's menu, closed and opened by the group's button, kept across a restart,
// renamed and ungrouped from the group's menu.
const base = await mkdtemp(path.join(tmpdir(), 'irori rail groups UI '));
const files = new FileService(path.join(base, 'device'));
await files.init();
const ids: string[] = [];
for (const name of ['Home', 'Paper', 'Data']) {
  const root = path.join(base, name);
  await mkdir(path.join(root, 'Knowledge_Base'), { recursive: true });
  await writeFile(path.join(root, 'Knowledge_Base', 'welcome.md'), `# ${name}\n`);
  ids.push((await files.register(root, name, 'personal')).scopeId);
}
await new WorkspaceService(files).save('Lab', ids);
const env = { ...process.env, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const errors: string[] = [];
const launch = () =>
  electron.launch({
    args: [
      ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      '.',
    ],
    env,
  });
const rail = (page: Page) => page.getByRole('navigation', { name: 'hibachi' });
const hibachi = (page: Page, name: string) =>
  rail(page).getByRole('button', { name: new RegExp(`^${name}・AI`) });
const group = (page: Page, name: string) => rail(page).getByRole('button', { name, exact: true });
const saved = async () =>
  JSON.parse(await readFile(path.join(files.dataDir, 'workspaces.json'), 'utf8'))[0].groups;
async function open(page: Page) {
  page.on('pageerror', (error) => errors.push(String(error)));
  await expect(page.getByRole('heading', { name: 'ワークスペースを選択' })).toBeVisible();
  await page.locator('.workspace-card').filter({ hasText: 'Lab' }).click();
  await expect(hibachi(page, 'Home')).toBeVisible();
}

let app = await launch();
try {
  const page = await app.firstWindow();
  await open(page);

  await hibachi(page, 'Paper').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '新しいグループ', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新しいグループ' });
  await dialog.getByRole('textbox', { name: 'グループ名' }).fill('研究');
  await dialog.getByRole('button', { name: '作成', exact: true }).click();
  await expect(group(page, '研究')).toHaveAttribute('aria-expanded', 'true');

  await hibachi(page, 'Data').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '「研究」に入れる', exact: true }).click();
  const members = rail(page).getByRole('group', { name: '研究' });
  await expect(members.getByRole('button', { name: /・AI/ })).toHaveCount(2);
  await expect
    .poll(saved)
    .toEqual([{ id: expect.any(String), name: '研究', scopeIds: [ids[1], ids[2]], open: true }]);

  // Closed, the group is one button and its hibachis leave the rail.
  await group(page, '研究').click();
  await expect(group(page, '研究')).toHaveAttribute('aria-expanded', 'false');
  await expect(hibachi(page, 'Paper')).toHaveCount(0);
  await expect(hibachi(page, 'Data')).toHaveCount(0);
  await expect(hibachi(page, 'Home')).toBeVisible();
  await expect.poll(async () => (await saved())[0].open).toBe(false);
  await page.screenshot({ path: 'test-results/rail-groups-closed.png' });
} finally {
  await app.close();
}

app = await launch();
try {
  const page = await app.firstWindow();
  await open(page);
  await expect(group(page, '研究')).toHaveAttribute('aria-expanded', 'false');
  await group(page, '研究').click();
  await expect(hibachi(page, 'Paper')).toBeVisible();
  // An open group's hibachi is chosen like any other.
  await hibachi(page, 'Paper').click();
  await expect(hibachi(page, 'Paper')).toHaveAttribute('aria-current', 'true');
  await page.screenshot({ path: 'test-results/rail-groups-open.png' });

  await group(page, '研究').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '名前を変更', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'グループ名を変更' });
  await rename.getByRole('textbox', { name: 'グループ名' }).fill('論文');
  await rename.getByRole('button', { name: '変更', exact: true }).click();
  await expect(group(page, '論文')).toBeVisible();

  await hibachi(page, 'Data').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'グループから外す', exact: true }).click();
  await expect(
    rail(page).getByRole('group', { name: '論文' }).getByRole('button', { name: /・AI/ }),
  ).toHaveCount(1);

  await group(page, '論文').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'グループを解除', exact: true }).click();
  await expect(group(page, '論文')).toHaveCount(0);
  for (const name of ['Home', 'Paper', 'Data']) await expect(hibachi(page, name)).toBeVisible();
  await expect.poll(saved).toBeUndefined();
} finally {
  await app.close();
}
expect(errors).toEqual([]);
console.log('Rail groups UI passed: grouped, closed, kept across restart, renamed and ungrouped.');
