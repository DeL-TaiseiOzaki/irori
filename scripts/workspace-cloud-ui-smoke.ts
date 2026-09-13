import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, chmod, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { KnowledgeStore } from '../src/knowledge/store';

if (process.platform === 'win32') {
  console.log(
    'Workspace Drive UI uses a POSIX protocol fixture; native Windows mounts remain unverified.',
  );
  process.exit(0);
}
const base = await mkdtemp(path.join(tmpdir(), 'irori workspace Drive 日本語 '));
const files = new FileService(path.join(base, 'device'));
await files.init();
const kb = path.join(base, 'Existing KB');
await mkdir(kb);
const space = await files.register(kb, '既存KB', 'personal');
await writeFile(path.join(kb, 'note.md'), '# Earlier retained source\n');
const knowledge = new KnowledgeStore(files.dataDir, (ref) => files.resolve(ref.scopeId, ref.path));
const retainedRun = await knowledge.begin(randomUUID(), {
  scopeId: space.scopeId,
  agent: 'codex',
  prompt: 'fixture only',
  notePath: 'note.md',
});
await knowledge.finish(retainedRun, 'completed');
await writeFile(path.join(kb, 'note.md'), '# Preserved note\n');
const accounts = [
  { id: randomUUID(), name: 'Account one', provider: 'google-drive', state: 'ready' },
  { id: randomUUID(), name: 'Account two', provider: 'google-drive', state: 'ready' },
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
const launch = () =>
  electron.launch({
    args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), '.'],
    env,
  });
let app = await launch();
try {
  let page = await app.firstWindow();
  await page.getByLabel('ワークスペース名').fill('Drive workspace');
  await page.getByRole('button', { name: 'ワークスペースを作成', exact: true }).click();
  await page.getByRole('button', { name: 'クラウド接続', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Drive workspace のクラウド接続' })).toBeVisible();
  for (const [index, account] of accounts.entries()) {
    await page.getByLabel('使用するクラウドアカウント').selectOption(account.id);
    await expect(page.locator('.folder-row')).toHaveCount(2);
    await page.locator('.folder-row').first().getByRole('radio').check();
    await page.getByLabel('contents内のフォルダ名').fill(`資料 ${index + 1}`);
    await page.getByRole('button', { name: '接続先を登録', exact: true }).click();
    await expect(page.locator('.connection-card')).toHaveCount(index + 1);
  }
  const profiles = await page.evaluate(() => window.irori.workspaces());
  expect(profiles[0].scopeIds).toEqual([]);
  const root = await page.evaluate((id) => window.irori.workspaceCloud(id), profiles[0].id);
  expect(root.workspace).toBe(true);
  const declarations = JSON.parse(
    await readFile(path.join(root.root, '.irori/cloud-mounts.json'), 'utf8'),
  );
  expect(declarations.map((item: { name: string }) => item.name)).toEqual(['資料 1', '資料 2']);
  expect(
    await readFile(path.join(kb, '.irori/cloud-mounts.json'), 'utf8').catch(() => null),
  ).toBeNull();
  await page.getByRole('dialog').getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.getByRole('region', { name: 'ワークスペースの Google Drive' })).toContainText(
    '資料 1',
  );
  await page.locator('.workspace-switch').click();
  await page.getByRole('button', { name: 'Drive workspace の登録を削除', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Drive 接続を登録解除');
  await page.getByRole('button', { name: 'Drive workspace を編集', exact: true }).click();
  await page.getByRole('checkbox', { name: /既存KB/ }).check();
  await page.getByRole('button', { name: '変更を保存して開く', exact: true }).click();
  await expect(page.getByRole('button', { name: 'クラウド接続', exact: true })).toBeEnabled();
  expect(
    (await page.evaluate((id) => window.irori.cloudConnections(id), profiles[0].id)).map(
      (item) => item.mountId,
    ),
  ).toEqual(declarations.map((item: { mountId: string }) => item.mountId));
  await page.getByRole('button', { name: 'note', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toContainText('Preserved note');
  await page.getByRole('button', { name: '参照に追加', exact: true }).click();
  await page.getByRole('button', { name: 'AIに相談', exact: true }).click();
  await expect(page.getByLabel('選択した参照資料', { exact: true })).toContainText('note.md');
  await page.getByRole('button', { name: '資料と成果物', exact: true }).click();
  const records = page.getByRole('dialog', { name: '資料と成果物' });
  await records.locator('summary').first().click();
  await records.getByRole('button', { name: '保持版を見る', exact: true }).click();
  await expect(records.getByLabel('保持した資料の版')).toContainText('Earlier retained source');
  await records.getByLabel('成果物に関連する実行').selectOption(retainedRun.id);
  await records.getByRole('button', { name: 'この版を成果物として登録', exact: true }).click();
  await expect(records.getByRole('status')).toContainText('成果物の版');
  await records.getByLabel('送信準備の Drive フォルダ').selectOption(declarations[0].mountId);
  await records.getByRole('button', { name: '送信準備として保持', exact: true }).click();
  await expect(records.getByRole('status')).toContainText('Drive にはまだ送信していません');
  await expect(records).toContainText('送信待ち・端末に保持');
  const restoredFile = path.join(base, 'restored.md');
  await app.evaluate(({ dialog }, filename) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
  }, restoredFile);
  await records.getByRole('button', { name: '別ファイルに復元', exact: true }).last().click();
  await expect.poll(() => readFile(restoredFile, 'utf8')).toBe('# Preserved note\n');
  await page.screenshot({ path: 'test-results/irori-knowledge.png' });
  await records.getByRole('button', { name: '閉じる', exact: true }).click();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/irori-workspace-drive.png' });
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.locator('.workspace-card').filter({ hasText: 'Drive workspace' }).click();
  await page.getByRole('button', { name: 'note', exact: true }).click();
  await page.getByRole('button', { name: '資料と成果物', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '資料と成果物' })).toContainText(
    '送信待ち・端末に保持',
  );
  await page
    .getByRole('dialog', { name: '資料と成果物' })
    .getByRole('button', { name: '閉じる', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Drive フォルダを接続' })).toBeEnabled();
  await page.getByRole('button', { name: 'Drive フォルダを接続' }).click();
  await expect(page.locator('.connection-card')).toHaveCount(2);
  await page.getByRole('dialog').getByRole('button', { name: '閉じる', exact: true }).click();
  await page.locator('.workspace-switch').click();
  await page.getByLabel('ワークスペース名').fill('Separate workspace');
  await page.getByRole('button', { name: 'ワークスペースを作成', exact: true }).click();
  await page.getByRole('button', { name: 'クラウド接続', exact: true }).click();
  await expect(page.locator('.connection-card')).toHaveCount(0);
  await expect(page.locator('.account-row')).toHaveCount(2);
  expect(await readFile(path.join(kb, 'note.md'), 'utf8')).toBe('# Preserved note\n');
  expect((await page.evaluate(() => window.irori.spaces())).map((item) => item.scopeId)).toEqual([
    space.scopeId,
  ]);
  console.log(
    'Workspace Drive UI passed: empty workspace, two accounts, independent KB membership, deletion guard, restart and separate-workspace isolation. Protocol fixture only.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
