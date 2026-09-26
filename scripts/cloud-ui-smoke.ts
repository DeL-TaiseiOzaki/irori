import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, chmod } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
if (process.platform === 'win32') {
  console.log(
    'Cloud UI protocol fixture uses a POSIX executable; Windows native acceptance remains open.',
  );
  process.exit(0);
}
const base = await mkdtemp(path.join(tmpdir(), 'irori cloud UI 日本語 '));
const files = new FileService(path.join(base, 'device'));
await files.init();
const roots = [path.join(base, 'Personal KB'), path.join(base, 'Team KB')];
const spaces = [];
for (const [i, root] of roots.entries()) {
  await mkdir(root);
  spaces.push(
    await files.register(root, i === 0 ? '個人KB' : 'チームKB', i === 0 ? 'personal' : 'team'),
  );
}
const accounts = [
  { id: randomUUID(), name: '個人アカウント', provider: 'google-drive', state: 'ready' },
  // Signed in with permission to change files; the first account predates that.
  {
    id: randomUUID(),
    name: '仕事アカウント',
    provider: 'google-drive',
    state: 'ready',
    writable: true,
  },
];
await writeFile(path.join(files.dataDir, 'cloud-accounts.json'), JSON.stringify(accounts));
const executable = path.join(base, 'rclone-fixture');
await copyFile('tests/fixtures/rclone-ui.mjs', executable);
await chmod(executable, 0o700);
const env = {
  ...process.env,
  IRORI_DATA_DIR: files.dataDir,
  IRORI_RCLONE_PATH: executable,
} as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
delete env.IRORI_GOOGLE_CLIENT_ID;
delete env.IRORI_GOOGLE_CLIENT_SECRET;
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
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.getByRole('checkbox', { name: /個人KB/ }).check();
  await page.getByRole('checkbox', { name: /チームKB/ }).check();
  await page.getByLabel('ワークスペース名').fill('連携確認');
  await page.screenshot({ path: 'test-results/irori-startup.png' });
  await page.getByRole('button', { name: '選択したスペースを開く' }).click();
  await page.getByRole('button', { name: '個人KB のクラウド接続', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Google アカウントを追加' })).toBeDisabled();
  // An account from before editing existed may only read until it signs in again.
  const olderAccount = page.locator('.account-row').filter({ hasText: '個人アカウント' });
  await expect(olderAccount).toContainText('読み取りのみ許可');
  await expect(olderAccount.getByRole('button', { name: '書き込みを許可' })).toBeVisible();
  await expect(
    page
      .locator('.account-row')
      .filter({ hasText: '仕事アカウント' })
      .getByRole('button', { name: '書き込みを許可' }),
  ).toHaveCount(0);
  await page.getByLabel('使用するクラウドアカウント').selectOption(accounts[0].id);
  await expect(page.locator('.folder-row')).toHaveCount(2);
  // A response from an old account must not overwrite the currently displayed folders.
  await page.locator('.folder-row').nth(1).getByRole('button', { name: '開く' }).click();
  await expect
    .poll(() => readFile(path.join(files.dataDir, 'folder-pending'), 'utf8').catch(() => ''))
    .toBe('pending');
  await page.getByLabel('使用するクラウドアカウント').selectOption(accounts[1].id);
  await page.getByLabel('ドライブ', { exact: true }).selectOption('shared-fixture');
  await expect(page.locator('.folder-row')).toHaveCount(1);
  await expect(page.locator('.folder-row')).toContainText('成果物');
  await writeFile(path.join(files.dataDir, 'folder-release'), 'release');
  await expect
    .poll(() => readFile(path.join(files.dataDir, 'folder-finished'), 'utf8').catch(() => ''))
    .toBe('finished');
  await page.waitForTimeout(100);
  await expect(page.locator('.folder-row')).toHaveCount(1);
  await expect(page.locator('.folder-row')).toContainText('成果物');
  await page.getByLabel('使用するクラウドアカウント').selectOption(accounts[0].id);
  await expect(page.locator('.folder-row')).toHaveCount(2);
  await page.locator('.folder-row').nth(1).getByRole('radio').check();
  await page.getByLabel('contents 内のフォルダ名').fill('調査 資料');
  await expect(page.locator('.mount-preview')).toContainText('contents/調査 資料/');
  const editable = page.getByLabel('irori とエージェントから編集できるようにする');
  await expect(editable).toBeChecked();
  await page.getByRole('button', { name: '接続先を登録', exact: true }).click();
  await expect(page.locator('.connection-card')).toContainText('contents/調査 資料/');
  await page.locator('.folder-row').first().getByRole('radio').check();
  await page.getByLabel('contents 内のフォルダ名').fill('調査 資料');
  await page.getByRole('button', { name: '接続先を登録', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('同じ名前');
  await expect(page.locator('.connection-card')).toHaveCount(1);
  await page.getByLabel('使用するクラウドアカウント').selectOption(accounts[1].id);
  await page.getByLabel('ドライブ', { exact: true }).selectOption('shared-fixture');
  await expect(page.locator('.folder-row')).toHaveCount(1);
  // Opening a folder must still leave a way to connect that folder itself.
  await page.locator('.folder-row').getByRole('button', { name: '開く' }).click();
  await expect(page.getByRole('button', { name: '接続先を登録', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '「成果物」を接続先にする' }).click();
  await expect(page.locator('.mount-preview .mount-source')).toHaveText('成果物');
  await page.getByLabel('contents 内のフォルダ名').fill('納品物');
  await editable.uncheck();
  await expect(page.locator('.attachment-form')).toContainText('読み取り専用で登録します');
  await page.getByRole('button', { name: '接続先を登録', exact: true }).click();
  await expect(page.locator('.connection-card')).toHaveCount(2);
  // An editable connection says why it will mount read-only while its account may only read.
  await expect(page.locator('.connection-card').filter({ hasText: '調査 資料' })).toContainText(
    '読み取りのみ許可されているため',
  );
  const deliveries = page.locator('.connection-card').filter({ hasText: '納品物' });
  await deliveries.getByRole('button', { name: '編集できるようにする' }).click();
  await expect(deliveries.getByRole('button', { name: '読み取り専用にする' })).toBeVisible();
  const stored = JSON.parse(
    await readFile(path.join(spaces[0].root, '.irori/cloud-mounts.json'), 'utf8'),
  );
  expect(stored.map((item: any) => [item.name, item.folderId, item.driveId, item.access])).toEqual([
    ['調査 資料', 'folder-second', undefined, 'read-write'],
    ['納品物', 'shared-folder', 'shared-fixture', 'read-write'],
  ]);
  expect(JSON.stringify(stored)).not.toContain(accounts[0].id);
  expect(JSON.stringify(stored)).not.toContain(base);
  await page.screenshot({ path: 'test-results/irori-cloud-connections.png' });
  // Dialog text must stay readable on the dialog's own surface in both themes.
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
} finally {
  await app.close();
}
// A malformed declaration in one checkout must not prevent attempting the next checkout.
const declarationFile = path.join(spaces[0].root, '.irori/cloud-mounts.json');
const originalDeclaration = await readFile(declarationFile, 'utf8');
const teamConnection = {
  ...JSON.parse(originalDeclaration)[0],
  scopeId: spaces[1].scopeId,
  mountId: randomUUID(),
};
await writeFile(
  path.join(spaces[1].root, '.irori/cloud-mounts.json'),
  JSON.stringify([teamConnection]),
);
await writeFile(
  path.join(files.dataDir, 'cloud-bindings', `${spaces[1].scopeId}-${teamConnection.mountId}.json`),
  JSON.stringify({
    scopeId: spaces[1].scopeId,
    mountId: teamConnection.mountId,
    root: spaces[1].root,
    accountId: accounts[0].id,
  }),
);
await writeFile(declarationFile, '{ malformed fixture');
app = await launch();
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.getByRole('button', { name: '連携確認 を編集', exact: true }).click();
  await page.getByLabel('ワークスペース名').fill('連携確認・更新');
  await page.getByRole('button', { name: '変更を保存して開く' }).click();
  await expect(
    page.getByRole('button', { name: '個人KB のクラウド接続', exact: true }),
  ).toBeEnabled();
  await expect(page.getByText('接続を準備中…', { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      async (id) => (await window.irori.cloudConnections(id))[0].state,
      spaces[1].scopeId,
    ),
  ).toBe('error');
  await writeFile(declarationFile, originalDeclaration);
  await page.getByRole('button', { name: '個人KB のクラウド接続', exact: true }).click();
  await expect(page.locator('.connection-card')).toHaveCount(2);
  await expect(page.locator('.connection-card').first()).toContainText('contents/調査 資料/');
  await expect(page.locator('.connection-card').nth(1)).toContainText('contents/納品物/');
  await page
    .locator('.account-row')
    .first()
    .getByRole('button', { name: 'アカウントの操作' })
    .click();
  await page.getByRole('menuitem', { name: 'アカウントの登録解除' }).click();
  await expect(page.getByRole('dialog', { name: 'クラウド接続' }).getByRole('alert')).toContainText(
    '接続先があります',
  );
  await page
    .locator('.connection-card')
    .first()
    .getByRole('button', { name: '接続先の操作' })
    .click();
  await page.getByRole('menuitem', { name: '名前を変更' }).click();
  await page.getByLabel('新しいマウント先のフォルダ名').fill('新しい 調査資料');
  await page.getByRole('button', { name: '名前を保存' }).click();
  await expect(page.locator('.connection-card').first()).toContainText('contents/新しい 調査資料/');
  await page
    .locator('.connection-card')
    .nth(1)
    .getByRole('button', { name: '接続先の操作' })
    .click();
  await page.getByRole('menuitem', { name: '登録を解除', exact: true }).click();
  await expect(page.locator('.connection-card')).toHaveCount(1);
  await page
    .locator('.account-row')
    .nth(1)
    .getByRole('button', { name: 'アカウントの操作' })
    .click();
  await page.getByRole('menuitem', { name: 'アカウントの登録解除' }).click();
  await expect(page.locator('.account-row')).toHaveCount(1);
  await page
    .getByRole('dialog', { name: 'クラウド接続' })
    .getByRole('button', { name: '閉じる', exact: true })
    .click();
  await page.getByRole('button', { name: 'ワークスペースを選択', exact: true }).click();
  await page.getByRole('button', { name: '連携確認・更新 の登録を削除', exact: true }).click();
  await expect(page.locator('.workspace-card')).toHaveCount(0);
  expect(JSON.parse(await readFile(path.join(files.dataDir, 'workspaces.json'), 'utf8'))).toEqual(
    [],
  );
  const remaining = JSON.parse(
    await readFile(path.join(spaces[0].root, '.irori/cloud-mounts.json'), 'utf8'),
  );
  expect(remaining.map((item: any) => [item.name, item.folderId])).toEqual([
    ['新しい 調査資料', 'folder-second'],
  ]);
  expect(
    JSON.parse(await readFile(path.join(spaces[0].root, '.irori/scope.json'), 'utf8')).scopeId,
  ).toBe(spaces[0].scopeId);
  // Opening another workspace after removing the one that was open does not look up
  // the removed workspace: it has no connections left to close. (個人KB's declaration
  // is still the malformed fixture, which is reported on its own.)
  await page.getByRole('checkbox', { name: 'チームKB' }).check();
  await page.getByRole('textbox', { name: 'ワークスペース名' }).fill('残った Brain');
  await page.getByRole('button', { name: '選択したスペースを開く', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ノートを作成', exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(
    (await page.getByRole('alert').allTextContents()).filter((text) =>
      text.includes('cloud owner'),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
  await writeFile(
    'test-results/cloud-ui-smoke.json',
    JSON.stringify(
      {
        transport: 'explicit rclone protocol fixture',
        nativeGoogleAuthentication: 'not exercised',
        nativeMount: 'not exercised',
        checks: [
          'multi-scope startup profile',
          'two accounts',
          'shared-drive folder selection',
          'an opened folder can itself be connected',
          'editable by default, read-only by choice, switched per connection',
          'an account that may only read offers to allow writing',
          'dialog text contrast in light and dark themes',
          'user-selected Japanese mount names',
          'duplicate-name rejection',
          'provider folder IDs preserved',
          'restart persistence',
          'workspace edit and removal preserving scopes',
          'opening another workspace after removing the open one reports no unknown cloud owner',
          'cloud rename and removal preserving provider identity',
          'account removal refuses referenced accounts',
          'one malformed scope does not stop another scope reconnecting',
          'credentials excluded from portable declarations',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'Cloud UI fixture checks passed; native Google authentication and mount acceptance remain open.',
  );
} finally {
  await app.close();
}
