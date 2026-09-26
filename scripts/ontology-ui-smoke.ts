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
// A second KB is an OKF bundle with no declaration: its graph index is generated from the pages.
const bundleRoot = path.join(base, 'Bundle');
await mkdir(bundleRoot);
await files.register(bundleRoot, '知識の束', 'personal');
const pageText = (type: string, title: string, relations: string[] = []) =>
  `---\ntype: ${type}\ntitle: ${title}\n${
    relations.length ? `relations:\n${relations.map((entry) => `  - ${entry}`).join('\n')}\n` : ''
  }---\n\n# ${title}\n`;
const bundlePage = async (relative: string, text: string) => {
  await mkdir(path.dirname(path.join(bundleRoot, relative)), { recursive: true });
  await writeFile(path.join(bundleRoot, relative), text);
};
for (const [relative, text] of [
  ['Knowledge_Base/index.md', '---\nokf_version: "0.2"\n---\n\n# Index\n'],
  ['Knowledge_Base/wiki/index.md', '# wiki\n'],
  ['Knowledge_Base/entities/index.md', '# entities\n'],
  [
    'Knowledge_Base/entities/サービス.md'.normalize('NFD'),
    pageText('product', 'サービス', ['{ rel: same_as, target: https://example.com/service }']),
  ],
  [
    'Knowledge_Base/wiki/再試行の予算.md',
    pageText('concept', '再試行の予算', ['{ rel: uses, target: ../entities/サービス.md }']),
  ],
  [
    'Knowledge_Base/wiki/障害対応.md',
    pageText('synthesis', '障害対応', [
      '{ rel: refines, target: 再試行の予算.md }',
      '{ rel: uses, target: ../entities/サービス.md }',
    ]),
  ],
  ['Knowledge_Base/wiki/監視.md', pageText('concept', '監視')],
])
  await bundlePage(relative, text);
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
  await page.getByRole('checkbox', { name: /知識の束/ }).check();
  await page.getByRole('button', { name: '選択したスペースを開く', exact: true }).click();
  await page.getByRole('button', { name: 'グラフ（オントロジー）', exact: true }).click();
  let panel = page.getByRole('region', { name: 'オントロジー', exact: true });
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
  await page.getByRole('button', { name: 'グラフ（オントロジー）', exact: true }).click();
  panel = page.getByRole('region', { name: 'オントロジー', exact: true });
  // The entity list and the CSV files open from the graph's table button.
  await panel.getByRole('button', { name: 'エンティティとノートの一覧', exact: true }).click();
  await panel.getByRole('button', { name: 'エンティティ CSV を開く' }).click();
  await expect(page.getByRole('region', { name: 'CSV の表', exact: true })).toContainText(
    'keep, this',
  );
  await expect(page.getByText('保存済み', { exact: true })).toBeVisible();
  expect(await readFile(path.join(root, fixture.declaration.entities.path), 'utf8')).toBe(
    fixture.entities,
  );
  // Table and source are the note's views, chosen from its menu.
  const view = async (name: string) => {
    await page.getByRole('button', { name: /^その他（/ }).click();
    await page.getByRole('menuitemradio', { name, exact: true }).click();
  };
  await view('ソース');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('new,New entity,,root,New group,preserved\r\n');
  await view('表');
  await expect(page.getByRole('region', { name: 'CSV の表', exact: true })).toContainText(
    'New entity',
  );
  await expect(
    page.getByRole('button', { name: 'グラフ（オントロジー）', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: /^保存/ }).click();
  await expect(page.getByText('保存済み', { exact: true })).toBeVisible();
  const saved = await readFile(path.join(root, fixture.declaration.entities.path), 'utf8');
  expect(saved.startsWith(fixture.entities)).toBe(true);
  expect(saved).toContain('new,New entity');
  await page.getByRole('button', { name: 'グラフ（オントロジー）', exact: true }).click();
  panel = page.getByRole('region', { name: 'オントロジー', exact: true });
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
  await expect(
    panel.getByRole('button', {
      name: /グラフ索引を更新|ページからグラフ索引を再生成|グラフ索引を作成/,
    }),
  ).toHaveCount(0);
  await expect(panel.locator('.react-flow__node')).toHaveCount(0);
  await writeFile(path.join(root, fixture.declaration.entities.path), saved);
  await expect(panel.locator('.react-flow__node')).toHaveCount(5);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'グラフ（オントロジー）', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'グラフ（オントロジー）', exact: true }).click();
  await page.getByRole('button', { name: 'AI に相談', exact: true }).click();
  await expect(page.getByLabel('エージェントへの指示')).toHaveValue(/\.irori\/ontology.json/);
  // The bundle KB: no declaration, so the panel offers to generate the graph index.
  await page
    .getByRole('navigation', { name: 'Brain' })
    .getByRole('button', { name: /^知識の束・AI/ })
    .click();
  await page.getByRole('button', { name: 'グラフ（オントロジー）', exact: true }).click();
  panel = page.getByRole('region', { name: 'オントロジー', exact: true });
  await expect(panel).toContainText('グラフ索引を作成できます');
  await panel.getByRole('button', { name: 'グラフ索引を作成', exact: true }).click();
  const freshness = panel.getByRole('status').filter({ hasText: 'グラフ索引' });
  await expect(freshness).toContainText('一致しています');
  await expect(freshness).toContainText('関係 1 件は除外');
  await expect(panel).toContainText('Knowledge_Base/ontology/ をコミットすると');
  await expect(panel.locator('.react-flow__node')).toHaveCount(3);
  await expect(panel.locator('.react-flow__edge')).toHaveCount(3);
  const entitiesPath = path.join(bundleRoot, 'Knowledge_Base/ontology/entities.csv');
  expect(await readFile(entitiesPath, 'utf8')).toBe(
    'id,label,note,parentId,group\n' +
      'entities/サービス,サービス,Knowledge_Base/entities/サービス.md,,product\n' +
      'wiki/再試行の予算,再試行の予算,Knowledge_Base/wiki/再試行の予算.md,,concept\n' +
      'wiki/障害対応,障害対応,Knowledge_Base/wiki/障害対応.md,,synthesis\n',
  );
  expect(await readFile(path.join(bundleRoot, 'Knowledge_Base/ontology/index.md'), 'utf8')).toMatch(
    /generates/,
  );
  // One page's relations change on disk: the panel says what an update would do, then does it.
  await bundlePage(
    'Knowledge_Base/wiki/障害対応.md',
    pageText('synthesis', '障害対応', [
      '{ rel: refines, target: 再試行の予算.md }',
      '{ rel: watches, target: 監視.md }',
    ]),
  );
  await expect(freshness).toContainText('一致しません');
  await expect(freshness).toContainText('エンティティ +1 / −0、関係 +1 / −1');
  await expect(panel.locator('.react-flow__node')).toHaveCount(3);
  await panel.getByRole('button', { name: 'グラフ索引を更新', exact: true }).click();
  await expect(freshness).toContainText('一致しています');
  await expect(panel.locator('.react-flow__node')).toHaveCount(4);
  await expect(panel.locator('.react-flow__edge')).toHaveCount(3);
  expect(await readFile(entitiesPath, 'utf8')).toContain(
    'wiki/監視,監視,Knowledge_Base/wiki/監視.md,,concept\n',
  );
  // Invalid generated CSV can be regenerated, while declared CSV above cannot.
  const relationsPath = path.join(bundleRoot, 'Knowledge_Base/ontology/relations.csv');
  const correctRelations = await readFile(relationsPath, 'utf8');
  for (const broken of [
    'sourceId,relation,targetId\nwiki/障害対応,uses,missing\n',
    'x'.repeat(2 * 1024 * 1024 + 1),
  ]) {
    await writeFile(relationsPath, broken);
    await expect(panel.getByRole('alert')).toBeVisible();
    await panel.getByRole('button', { name: 'ページからグラフ索引を再生成', exact: true }).click();
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(freshness).toContainText('一致しています');
    await expect(panel.locator('.react-flow__node')).toHaveCount(4);
    expect(await readFile(relationsPath, 'utf8')).toBe(correctRelations);
  }
  // The CSV stays portable NFC; opening uses the actual decomposed name on disk.
  await panel.getByRole('button', { name: 'エンティティとノートの一覧', exact: true }).click();
  await panel
    .getByRole('button', {
      name: 'Knowledge_Base/entities/サービス.md'.normalize('NFD'),
      exact: true,
    })
    .click();
  await expect(page.locator('.ProseMirror')).toContainText('サービス');
  await page.getByRole('button', { name: 'グラフ（オントロジー）', exact: true }).click();
  panel = page.getByRole('region', { name: 'オントロジー', exact: true });
  await panel.locator('.react-flow__node').filter({ hasText: '監視' }).click();
  await expect(panel.getByRole('button', { name: '関連ノートを開く' })).toBeVisible();
  await page.screenshot({ path: 'test-results/irori-graph-index.png' });
  expect(errors).toEqual([]);
  // A crashed renderer cannot acknowledge a final draft flush; close the host without hanging.
  const crashed = page.waitForEvent('crash');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer(),
  );
  await crashed;
  console.log(
    'Ontology UI passed: CSV no-op/source save, hierarchy/subgraph filters, note links, external invalidation, stage view keyboard handling, graph index generation/update/repair, declared-pair protection and decomposed note names. No provider calls.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true, maxRetries: 5 });
}
