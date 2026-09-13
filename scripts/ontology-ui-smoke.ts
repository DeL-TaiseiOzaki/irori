import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { ontologyFixture as fixture } from '../tests/fixtures/ontology';

const base = await mkdtemp(path.join(tmpdir(), 'irori ontology UI 日本語 '));
const root = path.join(base, 'Knowledge');
await mkdir(root);
const files = new FileService(path.join(base, 'device'));
await files.init();
const space = await files.register(root, '知識の地図', 'personal');
await mkdir(path.join(root, 'ontology'));
await mkdir(path.join(root, 'notes'));
await writeFile(path.join(root, '.irori/ontology.json'), JSON.stringify(fixture.declaration));
await writeFile(path.join(root, fixture.declaration.entities.path), fixture.entities);
await writeFile(path.join(root, fixture.declaration.relations.path), fixture.relations);
await writeFile(path.join(root, 'notes/概念.md'), '# 知識をつなぐ\n');
await writeFile(path.join(root, 'notes/調査.md'), '# 調査のノート\n');
const env = { ...process.env, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), '.'],
  env,
});
const page = await app.firstWindow();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(String(error)));
try {
  await page.getByRole('checkbox', { name: /知識の地図/ }).check();
  await page.getByRole('button', { name: '選択したスペースを開く', exact: true }).click();
  await page.getByRole('button', { name: 'オントロジー', exact: true }).click();
  let panel = page.getByRole('dialog', { name: 'オントロジー', exact: true });
  await expect(panel.locator('.react-flow__node')).toHaveCount(4);
  await expect(panel.locator('.react-flow__edge')).toHaveCount(5);
  await panel.getByLabel('サブグラフ', { exact: true }).selectOption('調査');
  await expect(panel.locator('.react-flow__node')).toHaveCount(2);
  await expect(panel.locator('.react-flow__edge')).toHaveCount(2);
  await panel.getByLabel('親子関係だけを表示').check();
  await expect(panel.locator('.react-flow__edge')).toHaveCount(1);
  await panel.getByRole('button', { name: '絞り込みを解除' }).click();
  await panel.getByLabel('階層の起点', { exact: true }).selectOption('research');
  await expect(panel.locator('.react-flow__node')).toHaveCount(2);
  await panel.getByRole('button', { name: '絞り込みを解除' }).click();
  await panel.locator('.react-flow__node').filter({ hasText: 'ナレッジ' }).click();
  await expect(panel.getByRole('button', { name: '関連ノートを開く' })).toBeVisible();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/irori-ontology.png' });
  await panel.getByRole('button', { name: '関連ノートを開く' }).click();
  await expect(page.locator('.ProseMirror')).toContainText('知識をつなぐ');
  await page.getByRole('button', { name: 'オントロジー', exact: true }).click();
  panel = page.getByRole('dialog', { name: 'オントロジー', exact: true });
  await panel.getByRole('button', { name: 'エンティティ CSV を開く' }).click();
  await expect(page.getByRole('region', { name: 'CSV の表', exact: true })).toContainText(
    'keep, this',
  );
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  expect(await readFile(path.join(root, fixture.declaration.entities.path), 'utf8')).toBe(
    fixture.entities,
  );
  await page.getByRole('button', { name: 'ソース', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('new,New entity,,root,New group,preserved\r\n');
  await page.getByRole('button', { name: '表', exact: true }).click();
  await expect(page.getByRole('region', { name: 'CSV の表', exact: true })).toContainText(
    'New entity',
  );
  await expect(page.getByRole('button', { name: 'オントロジー', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /^保存/ }).click();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  const saved = await readFile(path.join(root, fixture.declaration.entities.path), 'utf8');
  expect(saved.startsWith(fixture.entities)).toBe(true);
  expect(saved).toContain('new,New entity');
  await page.getByRole('button', { name: 'オントロジー', exact: true }).click();
  panel = page.getByRole('dialog', { name: 'オントロジー', exact: true });
  await expect(panel.locator('.react-flow__node')).toHaveCount(5);
  await writeFile(
    path.join(root, fixture.declaration.entities.path),
    saved.replace('new,New entity', 'root,New entity'),
  );
  expect(
    await page.evaluate(
      (id) =>
        window.irori.ontology(id).then(
          () => 'accepted',
          (error) => String(error),
        ),
      space.scopeId,
    ),
  ).toContain('重複');
  await expect(panel.getByRole('alert')).toContainText('重複');
  await expect(panel.locator('.react-flow__node')).toHaveCount(0);
  await writeFile(path.join(root, fixture.declaration.entities.path), saved);
  await expect(panel.locator('.react-flow__node')).toHaveCount(5);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'オントロジー', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'オントロジー', exact: true }).click();
  await page.getByRole('button', { name: '構築・表示設定をエージェントに相談' }).click();
  await expect(page.getByLabel('エージェントへの指示')).toHaveValue(/\.irori\/ontology.json/);
  expect(errors).toEqual([]);
  // A crashed renderer cannot acknowledge a final draft flush; close the host without hanging.
  const crashed = page.waitForEvent('crash');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer(),
  );
  await crashed;
  console.log(
    'Ontology UI passed: CSV no-op/source save, hierarchy/subgraph filters, note links, external invalidation and dialog keyboard handling. No provider calls.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true, maxRetries: 5 });
}
