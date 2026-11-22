import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, readlink, lstat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { CloudService } from '../src/cloud/service';
import { chooseJapanese } from '../tests/fixtures/japanese-interface';

// Folders on this computer, shown in contents through a link (ADR 019).
if (process.platform === 'win32') {
  console.log(
    'Cloud UI fixture uses POSIX links and permissions; Windows remains unverified here.',
  );
  process.exit(0);
}
const base = await mkdtemp(path.join(tmpdir(), 'irori cloud UI 日本語 '));
const files = new FileService(path.join(base, 'device'));
await files.init();
const roots = [path.join(base, 'Personal KB'), path.join(base, 'Team KB')];
const spaces: Awaited<ReturnType<typeof files.register>>[] = [];
for (const [i, root] of roots.entries()) {
  await mkdir(root);
  spaces.push(
    await files.register(root, i === 0 ? '個人KB' : 'チームKB', i === 0 ? 'personal' : 'team'),
  );
}
// Folders a sync app keeps on this device.
const drive = path.join(base, 'Google Drive 同期', 'マイドライブ', '共有 資料');
const research = path.join(base, 'Dropbox', '研究');
const sharedLink = path.join(spaces[0].root, 'contents', '共有 資料');
for (const folder of [drive, research]) await mkdir(folder, { recursive: true });
await writeFile(path.join(drive, 'memo.md'), '# 共有メモ\n');
await writeFile(path.join(research, 'memo.md'), '# 研究メモ\n');
await chooseJapanese(files.dataDir);
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
await mkdir('test-results', { recursive: true });
let app = await launch();
// The system folder dialog cannot be driven, so the main process answers it.
const choose = (folder: string) =>
  app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as any;
  }, folder);
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.getByRole('checkbox', { name: /個人KB/ }).check();
  await page.getByRole('checkbox', { name: /チームKB/ }).check();
  await page.getByLabel('ワークスペース名').fill('連携確認');
  await page.getByRole('button', { name: '選択したスペースを開く' }).click();
  await page.getByRole('button', { name: '個人KB のクラウド接続', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'クラウド接続' });
  // A folder on this computer or a GitHub repository (ADR 046): there is no Drive sign-in.
  await expect(dialog.getByRole('button', { name: 'フォルダを選ぶ', exact: true })).toBeVisible();
  for (const name of ['Google Drive', 'アカウントを追加'])
    await expect(dialog.getByRole('button', { name, exact: true })).toHaveCount(0);
  const github = dialog.getByRole('button', { name: 'GitHub', exact: true });
  await github.click();
  await expect(github).toHaveAttribute('aria-pressed', 'true');
  const cloneHere = dialog.getByRole('button', { name: '保存先を選ぶ', exact: true });
  const ownClone = dialog.getByRole('button', { name: '手元のクローンを選ぶ', exact: true });
  await expect(cloneHere).toBeDisabled();
  await dialog.getByLabel('URL').fill('https://gitlab.com/owner/project');
  await expect(dialog.getByRole('alert')).toContainText('GitHub の HTTPS または SSH');
  await expect(ownClone).toBeDisabled();
  await dialog.getByLabel('URL').fill('git@github.com:owner/project.git');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(cloneHere).toBeEnabled();
  await expect(ownClone).toBeEnabled();
  await dialog.getByRole('button', { name: 'このコンピューター', exact: true }).click();
  await expect(dialog.locator('.account-row, .folder-row')).toHaveCount(0);
  const cards = dialog.locator('.connection-card');
  // Register a first local folder kept across restart.
  await choose(drive);
  await dialog.getByRole('button', { name: 'フォルダを選ぶ', exact: true }).click();
  await dialog.getByRole('button', { name: '登録して接続', exact: true }).click();
  const shared = cards.filter({ hasText: 'contents/共有 資料/' });
  await expect(shared.locator('.connection-state')).toHaveText('接続済み');
  await expect(shared).toContainText('このコンピューター');
  expect(await readlink(sharedLink)).toBe(drive);
  const local = JSON.parse(
    await readFile(path.join(spaces[0].root, '.irori/local-folders.json'), 'utf8'),
  );
  expect(JSON.stringify(local)).not.toContain(base);
  // A second folder on this computer, registered and connected through a link.
  await choose(research);
  await dialog.getByRole('button', { name: 'フォルダを選ぶ', exact: true }).click();
  await expect(dialog.locator('.local-path')).toHaveText(research);
  await expect(dialog.getByLabel('フォルダ名')).toHaveValue('研究');
  await expect(dialog.locator('.mount-preview')).toContainText('contents/研究/');
  await expect(dialog.getByRole('switch', { name: '編集を許可' })).toBeChecked();
  await dialog.getByRole('button', { name: '登録して接続', exact: true }).click();
  const researchCard = cards.filter({ hasText: 'contents/研究/' });
  await expect(researchCard.locator('.connection-state')).toHaveText('接続済み');
  await expect(researchCard).toContainText('編集可');
  const link = path.join(spaces[0].root, 'contents', '研究');
  expect(await readlink(link)).toBe(research);
  // The same name again is refused.
  await dialog.getByRole('button', { name: 'フォルダを選ぶ', exact: true }).click();
  await dialog.getByRole('button', { name: '登録して接続', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('同じ名前');
  await expect(cards).toHaveCount(2);
  await page.screenshot({ path: 'test-results/irori-cloud-connections.png' });
  // Dialog text must stay readable on the dialog's own surface in every theme.
  const luminance = (colour: string) => {
    const [r, g, b] = colour
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map((value) => {
        const c = Number(value) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  for (const theme of ['hearth', 'light', 'dark']) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    const surface = await page
      .locator('.connections')
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    const text = await page
      .locator('.connections h3')
      .first()
      .evaluate((element) => getComputedStyle(element).color);
    const [light, dark] = [luminance(surface), luminance(text)].sort((a, b) => b - a);
    expect((light + 0.05) / (dark + 0.05), `${theme} dialog contrast`).toBeGreaterThan(4.5);
  }
  // Buttons fade their background, so let the switch settle before the evidence image.
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/irori-cloud-connections-dark.png' });
  await page.evaluate(() => (document.documentElement.dataset.theme = 'hearth'));
  // Disconnecting removes only the link, and unregistering keeps the folder's files.
  await researchCard.getByRole('button', { name: '接続先の操作' }).click();
  await page.getByRole('menuitem', { name: '接続を解除' }).click();
  await expect(researchCard.locator('.connection-state')).toHaveText('未接続');
  expect(await lstat(link).catch(() => undefined)).toBeUndefined();
  await researchCard.getByRole('button', { name: '接続先の操作' }).click();
  await page.getByRole('menuitem', { name: '登録を解除', exact: true }).click();
  await expect(researchCard).toHaveCount(0);
  expect(await readFile(path.join(research, 'memo.md'), 'utf8')).toBe('# 研究メモ\n');
  // Links whose records went (another device's removal, a Git pull) are listed as
  // unregistered: registered again under their name, or removed without their folder.
  await symlink(research, link);
  const leftover = path.join(spaces[0].root, 'contents', '残り');
  await symlink(research, leftover);
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: '個人KB のクラウド接続', exact: true }).click();
  const strays = dialog.locator('.stray-card');
  await expect(strays).toHaveCount(2);
  const lost = strays.filter({ hasText: 'contents/研究/' });
  await expect(lost.locator('.connection-state')).toHaveText('未登録');
  await expect(lost).toContainText(research);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/irori-cloud-strays.png' });
  await lost.getByRole('button', { name: '接続として登録', exact: true }).click();
  const adopted = dialog
    .locator('.connection-card:not(.stray-card)')
    .filter({ hasText: 'contents/研究/' });
  await expect(adopted.locator('.connection-state')).toHaveText('接続済み');
  expect(await readlink(link)).toBe(research);
  await expect(strays).toHaveCount(1);
  await strays.getByRole('button', { name: 'リンクを削除', exact: true }).click();
  await expect(strays).toHaveCount(0);
  expect(await lstat(leftover).catch(() => undefined)).toBeUndefined();
  expect(await readFile(path.join(research, 'memo.md'), 'utf8')).toBe('# 研究メモ\n');
  await adopted.getByRole('button', { name: '接続先の操作' }).click();
  await page.getByRole('menuitem', { name: '接続を解除' }).click();
  await expect(adopted.locator('.connection-state')).toHaveText('未接続');
  await adopted.getByRole('button', { name: '接続先の操作' }).click();
  await page.getByRole('menuitem', { name: '登録を解除', exact: true }).click();
  await expect(adopted).toHaveCount(0);
} finally {
  await app.close();
}
// After a restart, one vault's unreadable record does not stop another's folder connecting.
const team = path.join(base, 'Box', 'チーム');
await mkdir(team, { recursive: true });
const teamConnection = await new CloudService(files).addLocal({
  scopeId: spaces[1].scopeId,
  path: team,
  contentsRoot: 'contents',
  name: 'チーム資料',
});
const localFile = path.join(spaces[0].root, '.irori/local-folders.json');
const original = await readFile(localFile, 'utf8');
await writeFile(localFile, '{ malformed fixture');
app = await launch();
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.locator('.workspace-card').filter({ hasText: '連携確認' }).click();
  await expect(
    page.getByRole('button', { name: '個人KB のクラウド接続', exact: true }),
  ).toBeEnabled();
  await expect(page.getByText('接続を準備中…', { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      async ([id, mountId]) =>
        (await window.irori.cloudConnections(id)).find((item) => item.mountId === mountId)?.state,
      [spaces[1].scopeId, teamConnection.mountId],
    ),
  ).toBe('mounted');
  expect(await readlink(path.join(spaces[1].root, 'contents', 'チーム資料'))).toBe(team);
  await writeFile(localFile, original);
  await page.getByRole('button', { name: '個人KB のクラウド接続', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'クラウド接続' });
  const card = dialog.locator('.connection-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('contents/共有 資料/');
  await expect(card).toContainText('このコンピューター');
  await card.getByRole('button', { name: '再接続', exact: true }).click();
  await expect(card.locator('.connection-state')).toHaveText('接続済み');
  expect(await readlink(sharedLink)).toBe(drive);
  expect(errors).toEqual([]);
  await writeFile(
    'test-results/cloud-ui-smoke.json',
    JSON.stringify(
      {
        transport: 'folders on this computer through links; no Google Drive connection',
        checks: [
          'the connection dialog offers only choosing a folder, with no Drive sign-in',
          'a folder on this computer registered and connected through a link',
          'duplicate-name rejection',
          'dialog text contrast in light and dark themes',
          'disconnect removes only the link; unregistering keeps the folder files',
          'links left without records listed as unregistered, registered again or removed alone',
          'restart reconnects folders; one unreadable record does not stop another vault',
          'device paths excluded from portable records',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log('Cloud UI fixture checks passed.');
} finally {
  await app.close();
}
