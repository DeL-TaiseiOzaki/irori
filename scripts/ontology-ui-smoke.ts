import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { page as pageText, vocabulary } from '../tests/fixtures/ontology';
import { SettingsService } from '../src/host/settings';
import { chooseJapanese } from '../tests/fixtures/japanese-interface';

const base = await mkdtemp(path.join(tmpdir(), 'irori ontology UI 日本語 '));
const files = new FileService(path.join(base, 'device'));
await files.init();
// This suite exercises the vault agent, which is off until turned on (ADR 021).
await new SettingsService(files.dataDir).save({ vaultAgent: true });
// A knowledge base that declares nothing: there is no ontology to apply.
const plainRoot = path.join(base, 'Knowledge');
await mkdir(path.join(plainRoot, 'notes'), { recursive: true });
await files.register(plainRoot, '知識の地図', 'personal');
await writeFile(path.join(plainRoot, 'notes/概念.md'), '# 知識をつなぐ\n');
// An OKF bundle that declares its types and relations, with one page that parts from them.
const root = path.join(base, 'Bundle');
await mkdir(root);
await files.register(root, '知識の束', 'personal');
const write = async (relative: string, text: string) => {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), text);
};
const csv = '﻿id,label,unknown\r\nroot,ナレッジ,"keep, this"\r\nresearch,調査,"two\r\nlines"\r\n';
const drifted = pageText({ type: 'synthesis', title: '障害対応' }, [
  '{ rel: abuot, target: アルファ.md }',
  '{ rel: part_of, target: アルファ.md }',
]);
for (const [relative, text] of [
  ['.property/property.json', JSON.stringify(vocabulary)],
  ['Knowledge_Base/index.md', '---\nokf_version: "0.2"\n---\n\n# Index\n'],
  ['Knowledge_Base/wiki/アルファ.md', pageText({ type: 'project', title: 'アルファ計画' })],
  [
    'Knowledge_Base/wiki/サービス.md'.normalize('NFD'),
    pageText({ type: 'org', title: 'サービス' }, [
      '{ rel: same_as, target: https://example.com/service }',
    ]),
  ],
  [
    'Knowledge_Base/wiki/再試行の予算.md',
    pageText({ type: 'concept', title: '再試行の予算', sources: true }, [
      '{ rel: about, target: アルファ.md }',
      '{ rel: uses, target: 監視.md }',
    ]),
  ],
  ['Knowledge_Base/wiki/監視.md', pageText({ type: 'concept', title: '監視', sources: true })],
  ['Knowledge_Base/wiki/障害対応.md', drifted],
  ['Knowledge_Base/data/table.csv', csv],
])
  await write(relative, text);
await chooseJapanese(files.dataDir);
const env = { ...process.env, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), '.'],
  env,
});
const page = await app.firstWindow();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(String(error)));
const open = () => page.getByRole('button', { name: 'オントロジー', exact: true }).first();
const region = () => page.getByRole('region', { name: 'オントロジー', exact: true });
try {
  await page.getByRole('checkbox', { name: /知識の地図/ }).check();
  await page.getByRole('checkbox', { name: /知識の束/ }).check();
  await page.getByRole('button', { name: '選択したスペースを開く', exact: true }).click();

  // Nothing declared: the view says so, and draws nothing.
  await open().click();
  let panel = region();
  await expect(panel).toContainText('この KB は種類と関係を宣言していません');
  await expect(panel.locator('.react-flow__node')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /索引を/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(open()).toBeFocused();
  await open().click();
  await page.getByRole('button', { name: 'vault agent', exact: true }).click();
  await expect(page.getByLabel('エージェントへの指示')).toHaveValue(/\.property\/property\.json/);

  // The bundle: the declaration is drawn as types and the relations between them.
  await page
    .getByRole('navigation', { name: 'vault' })
    .getByRole('button', { name: /^知識の束・AI/ })
    .click();
  await open().click();
  panel = region();
  // Four types, and the three ends that name none: from any page, to any page, a URL.
  await expect(panel.locator('.react-flow__node')).toHaveCount(7);
  // about 3, part_of 6 (two of them from a type to itself), uses 1, same_as 3.
  await expect(panel.locator('.react-flow__edge')).toHaveCount(13);
  await expect(panel.getByRole('status').filter({ hasText: 'の宣言を' })).toContainText(
    '5 ページに当てはめました: 種類 4・関係 4',
  );
  await expect(panel).toContainText('宣言と違う点 3 件');
  await expect(panel).toContainText('宣言にない種類');
  await expect(panel).toContainText('（代わりに concept）');
  await expect(panel).toContainText('宣言にない関係');
  const findings = panel.locator('details').filter({ hasText: '宣言と違うページ' });
  await expect(findings).toContainText('宣言にない種類「synthesis」です（代わりに concept）。');
  await expect(findings).toContainText('宣言にない関係「abuot」です。');
  await expect(findings).toContainText(
    '関係「part_of」は、種類「synthesis」のページからは使えません。',
  );
  // The tables say what each type means and requires, and what each relation goes from and to.
  const types = panel.locator('details').filter({ hasText: '意味' }).first();
  await expect(types.getByRole('row').filter({ hasText: 'concept' }).first()).toContainText(
    'One reusable claim.',
  );
  await expect(types.getByRole('row').filter({ hasText: 'concept' }).first()).toContainText(
    'type, title, sources',
  );
  await expect(
    panel.getByRole('row').filter({ hasText: 'This record belongs to the target.' }),
  ).toContainText('person, org, project');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/irori-ontology.png' });

  // A finding opens its page.
  await findings
    .getByRole('button', { name: 'Knowledge_Base/wiki/障害対応.md', exact: true })
    .first()
    .click();
  await expect(page.locator('.ProseMirror')).toContainText('Body.');
  // The page is put right on disk: the view follows without being asked.
  await open().click();
  panel = region();
  await expect(panel).toContainText('宣言と違う点 3 件');
  await write(
    'Knowledge_Base/wiki/障害対応.md',
    pageText({ type: 'concept', title: '障害対応', sources: true }, [
      '{ rel: about, target: アルファ.md }',
    ]),
  );
  await expect(panel).toContainText('宣言どおり');
  await expect(panel).toContainText('すべてのページが宣言どおりです。');
  await expect(panel).not.toContainText('宣言にない関係');

  // The folder indexes of the bundle are written from the same pages (ADR 028), and nothing else is.
  const folderLine = panel.getByRole('status').filter({ hasText: 'フォルダの索引' });
  await expect(folderLine).toContainText('追加 1・変更 1');
  await panel.getByRole('button', { name: '索引を更新', exact: true }).click();
  await expect(folderLine).toContainText('フォルダの索引はページと一致しています');
  await expect(panel).toContainText('コミットすると共有されます');
  expect(await readFile(path.join(root, 'Knowledge_Base/index.md'), 'utf8')).toBe(
    '---\nokf_version: "0.2"\n---\n\n# Folders\n\n* [wiki](wiki/)\n',
  );
  expect(await readFile(path.join(root, 'Knowledge_Base/wiki/index.md'), 'utf8')).toBe(
    '# Concepts\n\n* [再試行の予算](再試行の予算.md)\n* [監視](監視.md)\n* [障害対応](障害対応.md)\n\n' +
      '# Organizations\n\n* [サービス](サービス.md)\n\n' +
      '# Projects\n\n* [アルファ計画](アルファ.md)\n',
  );
  expect((await readdir(path.join(root, 'Knowledge_Base'))).sort()).toEqual([
    'data',
    'index.md',
    'wiki',
  ]);

  // The graph index an earlier irori generated is left as it is, and named.
  const former = 'id,label,note,parentId,group\n';
  await write('Knowledge_Base/ontology/entities.csv', former);
  await expect(panel).toContainText('以前の irori が作ったグラフ索引（Knowledge_Base/ontology/）');
  expect(await readFile(path.join(root, 'Knowledge_Base/ontology/entities.csv'), 'utf8')).toBe(
    former,
  );
  await page.screenshot({ path: 'test-results/irori-ontology-follows.png' });
  // The button that wrote the indexes was disabled while it worked, and gave its focus away.
  await panel.focus();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  // A CSV is a table: unknown columns stay, and an unchanged file is never written.
  const knowledge = page
    .locator('.brain-panel')
    .getByRole('region', { name: 'Knowledge', exact: true });
  await knowledge.getByRole('button', { name: 'data', exact: true }).click();
  await knowledge.getByRole('button', { name: 'table.csv', exact: true }).click();
  await expect(page.getByRole('region', { name: 'CSV の表', exact: true })).toContainText(
    'keep, this',
  );
  await expect(page.getByText('保存済み', { exact: true })).toBeVisible();
  expect(await readFile(path.join(root, 'Knowledge_Base/data/table.csv'), 'utf8')).toBe(csv);
  // Table and source are the note's views, chosen from its menu.
  const view = async (name: string) => {
    await page.getByRole('button', { name: 'その他', exact: true }).click();
    await page.getByRole('menuitemradio', { name, exact: true }).click();
  };
  await view('ソース');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('new,New row,preserved\r\n');
  await view('表');
  await expect(page.getByRole('region', { name: 'CSV の表', exact: true })).toContainText(
    'New row',
  );
  // Unsaved text holds the view back, as it does every view that reads the files.
  await expect(open()).toBeDisabled();
  await page.getByRole('button', { name: /^保存/ }).click();
  await expect(page.getByText('保存済み', { exact: true })).toBeVisible();
  const saved = await readFile(path.join(root, 'Knowledge_Base/data/table.csv'), 'utf8');
  expect(saved.startsWith(csv)).toBe(true);
  expect(saved).toContain('new,New row');
  await expect(open()).toBeEnabled();
  expect(errors).toEqual([]);
  // A crashed renderer cannot acknowledge a final draft flush; close the host without hanging.
  const crashed = page.waitForEvent('crash');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer(),
  );
  await crashed;
  console.log(
    'Ontology UI passed: undeclared knowledge base, declaration diagram, types and relations applied to the pages, findings that open their page and follow the files, folder index generation, the former graph index left alone, stage view keyboard handling, CSV no-op/source save. No provider calls.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true, maxRetries: 5 });
}
