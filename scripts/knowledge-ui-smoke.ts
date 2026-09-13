import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { KnowledgeStore } from '../src/knowledge/store';

// Real disposable files and persisted records; no provider/model process is started.
const base = await mkdtemp(path.join(tmpdir(), 'irori records UI '));
const root = path.join(base, 'Knowledge');
const otherRoot = path.join(base, 'References');
await mkdir(root);
await mkdir(otherRoot);
const files = new FileService(path.join(base, 'device'));
await files.init();
const space = await files.register(root, '記録のKB', 'personal');
const other = await files.register(otherRoot, '参照KB', 'team');
await writeFile(path.join(root, '資料.md'), '# Earlier source\n');
await writeFile(path.join(root, 'editing.md'), '# Editing\n');
await writeFile(path.join(otherRoot, 'reference.md'), '# Separate reference\n');
const store = new KnowledgeStore(files.dataDir, (ref) => files.resolve(ref.scopeId, ref.path));
const first = await store.begin(randomUUID(), {
  scopeId: space.scopeId,
  agent: 'codex',
  prompt: 'record fixture',
  notePath: '資料.md',
  sources: [{ scopeId: other.scopeId, path: 'reference.md' }],
});
await store.finish(first, 'completed');
await writeFile(path.join(root, 'report.pptx'), Buffer.from([80, 75, 3, 4, 0, 1]));
const artifact = await store.artifact({ scopeId: space.scopeId, path: 'report.pptx' }, first.id);
await writeFile(path.join(root, '資料.md'), '# Latest source\n');
const second = await store.begin(randomUUID(), {
  scopeId: space.scopeId,
  agent: 'claude',
  prompt: 'record fixture',
  notePath: '資料.md',
});
await store.finish(second, 'completed');
const unrelated = await store.begin(randomUUID(), {
  scopeId: space.scopeId,
  agent: 'pi',
  prompt: 'record fixture',
  notePath: 'editing.md',
});
await store.finish(unrelated, 'completed');
await rename(path.join(root, '資料.md'), path.join(root, '移動先.md'));
const env = { ...process.env, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const launch = () =>
  electron.launch({
    args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), '.'],
    env,
  });
let app = await launch();
const errors: string[] = [];
try {
  let page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  // Keep the other scope outside this workspace until after the guarded navigation test.
  await page.getByRole('checkbox', { name: /記録のKB/ }).check();
  await page.getByLabel('ワークスペース名').fill('Record workspace');
  await page.getByRole('button', { name: '選択したスペースを開く', exact: true }).click();
  await page.getByRole('button', { name: 'editing', exact: true }).click();
  const editor = page.locator('.ProseMirror');
  await expect(editor).toContainText('Editing');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' saved before navigation');
  await page.getByRole('button', { name: '資料と成果物', exact: true }).click();
  let panel = page.getByRole('dialog', { name: '資料と成果物', exact: true });
  const search = () => panel.getByLabel('資料・成果物の記録を検索');
  await search().fill('ＲＥＰＯＲＴ.ＰＰＴＸ');
  await expect(panel.locator('details')).toHaveCount(1);
  const artifacts = panel.getByLabel('登録された成果物', { exact: true });
  await artifacts.getByRole('button', { name: '現在の場所・関連記録', exact: true }).click();
  let preview = panel.getByLabel('保持した資料の版', { exact: true });
  await expect(preview).toContainText('現在のファイルは保持版と一致');
  await expect(preview).toContainText('この資料の成果物登録');
  await artifacts.getByRole('button', { name: '関連する実行へ', exact: true }).click();
  await expect(search()).toHaveValue('');
  await expect(panel.locator(`[id="run-${first.id}"] > summary`)).toBeFocused();
  // Cross-scope records are retained, but navigation never silently adds a workspace member.
  await panel
    .locator(`[id="run-${first.id}"] li`)
    .filter({ hasText: 'reference.md' })
    .getByRole('button', { name: '現在の場所・関連記録', exact: true })
    .click();
  await preview.getByRole('button', { name: '現在のファイルを開く', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('ワークスペースに追加');
  await search().fill('not-present');
  await expect(panel).toContainText('一致する実行はありません');
  await search().fill(first.id);
  await panel.locator('summary').click();
  await panel
    .locator('li')
    .filter({ hasText: '資料.md' })
    .getByRole('button', { name: '保持版を見る', exact: true })
    .click();
  await expect(preview).toContainText('Earlier source');
  await expect(preview).toContainText('ファイルが見つかりません');
  await preview.getByLabel('資料の移動先のパス').fill('移動先.md');
  await preview.getByRole('button', { name: 'この移動先に再接続' }).click();
  await expect(panel.getByRole('alert')).toContainText('版が一致しません');
  await search().fill(second.id);
  await panel.locator('summary').click();
  await panel.locator('details').getByRole('button', { name: '保持版を見る', exact: true }).click();
  await expect(preview).toContainText('Latest source');
  await expect(preview.getByRole('button', { name: '現在のファイルを開く' })).toBeDisabled();
  await preview.getByLabel('資料の移動先のパス').fill('移動先.md');
  await preview.getByRole('button', { name: 'この移動先に再接続' }).click();
  await expect(panel.getByRole('status')).toContainText('資料 ID を移動先に再接続');
  await expect(preview).toContainText('現在の登録先: 移動先.md');
  await expect(preview).toContainText('別の版');
  await expect(preview).toContainText('この版');
  // A reverse link also clears an active filter, expands and focuses the selected run.
  await preview.getByRole('button', { name: /codex.*別の版/ }).click();
  await expect(search()).toHaveValue('');
  await expect(panel.locator(`[id="run-${first.id}"] > summary`)).toBeFocused();
  await preview.getByRole('button', { name: '現在のファイルを開く', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(editor).toContainText('Latest source');
  expect(await readFile(path.join(root, 'editing.md'), 'utf8')).toContain(
    'saved before navigation',
  );
  const observed = await page.evaluate(
    (source) => window.irori.locateSource(source),
    second.sources[0],
  );
  expect(observed).toEqual({
    state: 'matching',
    current: { scopeId: space.scopeId, path: '移動先.md' },
  });
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.locator('.workspace-card').filter({ hasText: 'Record workspace' }).click();
  await page.getByRole('button', { name: '移動先', exact: true }).click();
  await page.getByRole('button', { name: '資料と成果物', exact: true }).click();
  panel = page.getByRole('dialog', { name: '資料と成果物', exact: true });
  await search().fill(first.id);
  await panel.locator('summary').click();
  await panel
    .locator('li')
    .filter({ hasText: '資料.md' })
    .getByRole('button', { name: '保持版を見る', exact: true })
    .click();
  preview = panel.getByLabel('保持した資料の版', { exact: true });
  await expect(preview).toContainText('Earlier source');
  await expect(preview).toContainText('現在の登録先: 移動先.md');
  await expect(preview).toContainText('保持版から変更');
  const history = await page.evaluate((id) => window.irori.knowledgeHistory(id), space.scopeId);
  expect(history.runs.find((run) => run.id === first.id)?.sources).toEqual(first.sources);
  expect(history.artifacts[0]).toEqual(artifact);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/irori-source-navigation.png' });
  await panel.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.locator('.workspace-switch').click();
  await page.getByRole('button', { name: 'Record workspace を編集', exact: true }).click();
  await page.getByRole('checkbox', { name: /参照KB/ }).check();
  await page.getByRole('button', { name: '変更を保存して開く', exact: true }).click();
  await page.getByRole('button', { name: '移動先', exact: true }).click();
  await page.getByRole('button', { name: '資料と成果物', exact: true }).click();
  panel = page.getByRole('dialog', { name: '資料と成果物', exact: true });
  await search().fill(first.id);
  await panel.locator('summary').click();
  await panel
    .locator('li')
    .filter({ hasText: 'reference.md' })
    .getByRole('button', { name: '現在の場所・関連記録', exact: true })
    .click();
  preview = panel.getByLabel('保持した資料の版', { exact: true });
  await expect(preview).toContainText('所属: 参照KB');
  await preview.getByRole('button', { name: '現在のファイルを開く', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.ProseMirror')).toContainText('Separate reference');
  expect(errors).toEqual([]);
  console.log(
    'Knowledge UI passed: record search, binary artifact links, workspace membership guard, version-aware rebind, reverse navigation, saved edits and restart. No model execution.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
