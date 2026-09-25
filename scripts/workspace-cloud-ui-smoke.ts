import { _electron as electron, expect } from '@playwright/test';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  copyFile,
  chmod,
  rm,
  realpath,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';
import { KnowledgeStore } from '../src/knowledge/store';

// Drive folders belong to KBs from 0.1.37. A workspace's own connections from
// earlier versions are seeded here as those versions wrote them, and must be
// movable into a KB, while nothing shows a separate Drive frame any more.
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
const workspaces = new WorkspaceService(files);
const workspace = await workspaces.save('Drive workspace', [space.scopeId]);
const older = await workspaces.save('Older workspace', []);
/** Writes a workspace's Drive connections the way versions before 0.1.37 did. */
async function seedWorkspaceConnections(id: string, names: string[]) {
  const root = path.join(files.dataDir, 'workspace-cloud', id);
  await mkdir(path.join(root, '.irori'), { recursive: true });
  await mkdir(path.join(files.dataDir, 'cloud-bindings'), { recursive: true });
  const records = names.map((name, index) => ({
    schemaVersion: 1,
    mountId: randomUUID(),
    scopeId: id,
    provider: 'google-drive',
    folderId: index === 0 ? 'folder-first' : 'folder-second',
    parentId: 'root',
    folderName: '同じ名前',
    contentsRoot: 'contents',
    name,
    access: 'read-only',
  }));
  await writeFile(path.join(root, '.irori', 'cloud-mounts.json'), JSON.stringify(records));
  for (const [index, record] of records.entries())
    await writeFile(
      path.join(files.dataDir, 'cloud-bindings', `${id}-${record.mountId}.json`),
      JSON.stringify({
        scopeId: id,
        mountId: record.mountId,
        root: await realpath(root),
        accountId: accounts[index % 2].id,
      }),
    );
  return records;
}
const earlier = await seedWorkspaceConnections(workspace.id, ['資料 1', '資料 2']);
await seedWorkspaceConnections(older.id, ['古い資料']);
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
const errors: string[] = [];
let app = await launch();
try {
  let page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.locator('.workspace-card').filter({ hasText: 'Drive workspace' }).click();
  await expect(page.getByRole('button', { name: 'note', exact: true })).toBeVisible();
  // No separate Drive frame: Drive folders are part of a KB's materials.
  await expect(page.getByRole('region', { name: 'ワークスペースの Google Drive' })).toHaveCount(0);
  await page.getByRole('button', { name: 'クラウド接続', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'クラウド接続' });
  await expect(dialog.getByRole('heading', { name: '既存KB のクラウド接続' })).toBeVisible();
  const moving = dialog.locator('.earlier-connections');
  await expect(moving.locator('.connection-card')).toHaveCount(2);
  for (const name of ['資料 1', '資料 2']) {
    await moving
      .locator('.connection-card')
      .filter({ hasText: `${name}/` })
      .getByRole('button', { name: 'この KB に移す', exact: true })
      .click();
    await expect(dialog.locator('.moved-notice')).toContainText(
      `「${name}」をこの KB の資料に移しました`,
    );
  }
  await expect(dialog.locator('.earlier-connections')).toHaveCount(0);
  await expect(dialog.locator('.connection-card')).toHaveCount(2);
  const declared = JSON.parse(await readFile(path.join(kb, '.irori/cloud-mounts.json'), 'utf8'));
  expect(
    declared.map((item: { mountId: string; name: string }) => [item.mountId, item.name]),
  ).toEqual(earlier.map((item) => [item.mountId, item.name]));
  expect(
    JSON.parse(
      await readFile(
        path.join(files.dataDir, 'workspace-cloud', workspace.id, '.irori/cloud-mounts.json'),
        'utf8',
      ),
    ),
  ).toEqual([]);
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.locator('.layer-pane.my-contents')).toContainText('資料 1');

  // Preparing an upload now offers the KB's Drive folders.
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
  await records.getByLabel('送信準備の Drive フォルダ').selectOption(earlier[0].mountId);
  await records.getByRole('button', { name: '送信準備として保持', exact: true }).click();
  await expect(records.getByRole('status')).toContainText('Drive にはまだ送信していません');
  await expect(records).toContainText('送信待ち・端末に保持');
  const restoredFile = path.join(base, 'restored.md');
  await app.evaluate(({ dialog: native }, filename) => {
    native.showSaveDialog = async () => ({ canceled: false, filePath: filename });
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
  page.on('pageerror', (error) => errors.push(String(error)));
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
  await page.getByRole('button', { name: 'クラウド接続', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.connection-card')).toHaveCount(2);
  await page.getByRole('dialog').getByRole('button', { name: '閉じる', exact: true }).click();
  // A workspace that still holds connections of its own can be removed; only its
  // records go.
  await page.locator('.workspace-switch').click();
  await page.getByRole('button', { name: 'Older workspace の登録を削除', exact: true }).click();
  await expect(page.locator('.workspace-card').filter({ hasText: 'Older workspace' })).toHaveCount(
    0,
  );
  expect(
    (await readdir(path.join(files.dataDir, 'cloud-bindings'))).some((name) =>
      name.startsWith(older.id),
    ),
  ).toBe(false);
  expect(await readFile(path.join(kb, 'note.md'), 'utf8')).toBe('# Preserved note\n');
  expect(errors).toEqual([]);
  console.log(
    'Workspace Drive UI passed: no separate Drive frame, earlier workspace connections moved into a KB with their IDs, upload preparation to the KB folder, restart, and removal of a workspace that still held connections. Protocol fixture only.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
