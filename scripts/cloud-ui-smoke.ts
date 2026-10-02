import { _electron as electron, expect } from '@playwright/test';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  readlink,
  lstat,
  chmod,
  stat,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { CloudService } from '../src/cloud/service';

// Folders on this computer, shown in contents through a link (ADR 019), and Google
// Drive connections from before 0.1.67, which irori no longer makes itself (ADR 023).
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
// Two Drive connections as irori 0.1.66 wrote them; the first had its empty mount point.
const retired = ['共有 資料', '古い 接続'].map((name, i) => ({
  schemaVersion: 1,
  mountId: randomUUID(),
  scopeId: spaces[0].scopeId,
  provider: 'google-drive',
  folderId: `folder-${i}`,
  parentId: 'root',
  folderName: `Drive ${name}`,
  contentsRoot: 'contents',
  name,
  access: i === 0 ? 'read-only' : 'read-write',
}));
await writeFile(path.join(spaces[0].root, '.irori/cloud-mounts.json'), JSON.stringify(retired));
const placeholder = path.join(spaces[0].root, 'contents', retired[0].name);
await mkdir(placeholder, { recursive: true });
const identity = await stat(placeholder);
await chmod(placeholder, 0);
await mkdir(path.join(files.dataDir, 'cloud-bindings'));
const retiredBinding = path.join(
  files.dataDir,
  'cloud-bindings',
  `${spaces[0].scopeId}-${retired[0].mountId}.json`,
);
await writeFile(
  retiredBinding,
  JSON.stringify({
    scopeId: spaces[0].scopeId,
    mountId: retired[0].mountId,
    root: spaces[0].root,
    accountId: randomUUID(),
    placeholder: { dev: identity.dev, ino: identity.ino },
  }),
);
// A change rclone never uploaded, still in its write cache on this device.
const cache = path.join(files.dataDir, 'rclone', 'cache');
await mkdir(path.join(cache, 'vfsMeta', 'x'), { recursive: true });
await mkdir(path.join(cache, 'vfs', 'x'), { recursive: true });
await writeFile(
  path.join(cache, 'vfsMeta', 'x', 'a.md'),
  JSON.stringify({
    ModTime: '2026-10-01T00:00:00Z',
    ATime: '2026-10-01T00:00:00Z',
    Size: 5,
    Rs: [],
    Fingerprint: '',
    Dirty: true,
  }),
);
await writeFile(path.join(cache, 'vfs', 'x', 'a.md'), 'Unsent');
// Folders a sync app keeps on this device.
const drive = path.join(base, 'Google Drive 同期', 'マイドライブ', '共有 資料');
const research = path.join(base, 'Dropbox', '研究');
for (const folder of [drive, research]) await mkdir(folder, { recursive: true });
await writeFile(path.join(drive, 'memo.md'), '# 共有メモ\n');
await writeFile(path.join(research, 'memo.md'), '# 研究メモ\n');
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
  // The start screen offers what Drive connections left, and saves it to a folder.
  const leftovers = page.getByRole('button', { name: 'Drive の未送信分 1', exact: true });
  await leftovers.click();
  const recovery = page.getByRole('dialog', { name: 'Drive の未送信分', exact: true });
  await expect(recovery).toContainText('変更されたファイル 1');
  const saveTo = path.join(base, 'Saved');
  await mkdir(saveTo);
  await choose(saveTo);
  await recovery.getByRole('button', { name: 'フォルダに保存', exact: true }).click();
  await expect(recovery.getByRole('status')).toContainText('irori-drive-unsent-');
  await expect(recovery).toContainText('ありません。');
  const [saved] = await readdir(saveTo);
  expect(await readFile(path.join(saveTo, saved, 'x', 'a.md'), 'utf8')).toBe('Unsent');
  await recovery.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(leftovers).toHaveCount(0);
  await page.getByRole('checkbox', { name: /個人KB/ }).check();
  await page.getByRole('checkbox', { name: /チームKB/ }).check();
  await page.getByLabel('ワークスペース名').fill('連携確認');
  await page.getByRole('button', { name: '選択したスペースを開く' }).click();
  await page.getByRole('button', { name: '個人KB のクラウド接続', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'クラウド接続' });
  // Choosing a folder is the only way to connect one: there is no Drive sign-in.
  await expect(dialog.getByRole('button', { name: 'フォルダを選ぶ', exact: true })).toBeVisible();
  for (const name of ['Google Drive', 'このコンピューター', 'アカウントを追加'])
    await expect(dialog.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(dialog.locator('.account-row, .folder-row')).toHaveCount(0);
  const cards = dialog.locator('.connection-card');
  await expect(cards).toHaveCount(2);
  const shared = cards.filter({ hasText: 'contents/共有 資料/' });
  const old = cards.filter({ hasText: 'contents/古い 接続/' });
  for (const card of [shared, old]) {
    await expect(card.locator('.connection-state')).toHaveText('終了');
    await expect(card).toContainText('Google Drive');
    await expect(card).toContainText('直接接続は終了しました');
    await expect(card.getByRole('button', { name: 'フォルダに切り替える' })).toBeVisible();
    await expect(card.getByRole('button', { name: '再接続' })).toHaveCount(0);
  }
  // Let the dialog finish fading in before the evidence image.
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/irori-cloud-retired.png' });
  // Switched to the same folder as Drive for desktop keeps it, under the same name.
  await choose(drive);
  await shared.getByRole('button', { name: 'フォルダに切り替える', exact: true }).click();
  await expect(shared.locator('.connection-state')).toHaveText('接続済み');
  await expect(shared).toContainText('このコンピューター');
  await expect(shared).toContainText('読み取り専用');
  expect(await readlink(placeholder)).toBe(drive);
  const local = JSON.parse(
    await readFile(path.join(spaces[0].root, '.irori/local-folders.json'), 'utf8'),
  );
  expect(local.map((item: any) => [item.mountId, item.name, item.access])).toEqual([
    [retired[0].mountId, '共有 資料', 'read-only'],
  ]);
  expect(JSON.stringify(local)).not.toContain(base);
  expect(
    JSON.parse(await readFile(path.join(spaces[0].root, '.irori/cloud-mounts.json'), 'utf8')),
  ).toEqual([retired[1]]);
  expect(await lstat(retiredBinding).catch(() => undefined)).toBeUndefined();
  // The other one is unregistered; its files stay in Drive.
  await old.getByRole('button', { name: '接続先の操作' }).click();
  await page.getByRole('menuitem', { name: '登録を解除', exact: true }).click();
  await expect(cards).toHaveCount(1);
  expect(
    JSON.parse(await readFile(path.join(spaces[0].root, '.irori/cloud-mounts.json'), 'utf8')),
  ).toEqual([]);
  // A new folder on this computer, registered and connected through a link.
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
} finally {
  await app.close();
}
// After a restart, one hibachi's unreadable record does not stop another's folder connecting.
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
  // Nothing is left to save, so the start screen does not offer it.
  await expect(page.getByRole('button', { name: /Drive の未送信分/ })).toHaveCount(0);
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
  expect(await readlink(placeholder)).toBe(drive);
  expect(errors).toEqual([]);
  await writeFile(
    'test-results/cloud-ui-smoke.json',
    JSON.stringify(
      {
        transport: 'folders on this computer through links; no Google Drive connection',
        checks: [
          'start screen offers changes rclone never uploaded and saves them to a chosen folder',
          'the connection dialog offers only choosing a folder, with no Drive sign-in',
          'retired Drive connections shown as ended, switched to a folder keeping name and access',
          'a retired connection unregistered, its empty mount point removed on switching',
          'a folder on this computer registered and connected through a link',
          'duplicate-name rejection',
          'dialog text contrast in light and dark themes',
          'disconnect removes only the link; unregistering keeps the folder files',
          'restart reconnects folders; one unreadable record does not stop another hibachi',
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
