import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';

// Real disposable notes linking to each other by relative path, as the recommended
// knowledge base writes them. No provider or model process is started.
const base = await mkdtemp(path.join(tmpdir(), 'irori links UI '));
const root = path.join(base, 'Knowledge');
await mkdir(path.join(root, 'wiki'), { recursive: true });
const files = new FileService(path.join(base, 'device'));
await files.init();
await files.register(root, 'リンクのKB', 'personal');
await writeFile(
  path.join(root, 'topic.md'),
  '# 出発点\n\n[下の階層へ](wiki/deep.md)\n\n[まだ無いページ](planned.md)\n',
);
await writeFile(
  path.join(root, 'wiki', 'deep.md'),
  '# 深いページ\n\n[上の階層へ](../arrival.md)\n',
);
await writeFile(path.join(root, 'arrival.md'), '# 到着点\n');
const env = { ...process.env, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), '.'],
  env,
});
const errors: string[] = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.getByRole('checkbox', { name: /リンクのKB/ }).check();
  await page.getByLabel('ワークスペース名').fill('Link workspace');
  await page.getByRole('button', { name: '選択したスペースを開く', exact: true }).click();
  await page.getByRole('button', { name: 'topic', exact: true }).click();
  const editor = page.locator('.ProseMirror');
  await expect(editor).toContainText('出発点');

  // A plain click belongs to the editor: it places the cursor and opens nothing.
  await editor.getByRole('link', { name: '下の階層へ' }).click();
  await expect(editor).toContainText('出発点');

  // The modifier follows the link, down into a folder and back out of it.
  await editor.getByRole('link', { name: '下の階層へ' }).click({ modifiers: ['ControlOrMeta'] });
  await expect(editor).toContainText('深いページ');
  await editor.getByRole('link', { name: '上の階層へ' }).click({ modifiers: ['ControlOrMeta'] });
  await expect(editor).toContainText('到着点');

  // A page that has not been written yet is named, and the note stays open.
  await page.getByRole('button', { name: 'topic', exact: true }).click();
  await expect(editor).toContainText('出発点');
  await editor
    .getByRole('link', { name: 'まだ無いページ' })
    .click({ modifiers: ['ControlOrMeta'] });
  const notice = page.locator('p.hint[role="status"]');
  await expect(notice).toContainText('リンク先のファイルがまだありません');
  await expect(notice).toContainText('planned.md');
  await expect(editor).toContainText('出発点');

  // Unsaved work is carried through the link, not lost to it.
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' 追記');
  await editor.getByRole('link', { name: '下の階層へ' }).click({ modifiers: ['ControlOrMeta'] });
  await expect(editor).toContainText('深いページ');
  await page.getByRole('button', { name: 'topic', exact: true }).click();
  await expect(editor).toContainText('追記');

  // The reverse: which notes point at the one being read, kept current while the
  // list is open, and going to one of them lands on its link.
  await page.getByRole('button', { name: 'arrival', exact: true }).click();
  await expect(editor).toContainText('到着点');
  const backlinksButton = page.getByRole('button', { name: 'リンク元', exact: true });
  const backlinks = page.getByRole('dialog', { name: 'リンク元', exact: true });
  await backlinksButton.click();
  await expect(backlinks).toContainText('1 件のリンク');
  const backlink = backlinks.getByRole('button', { name: /wiki\/deep\.md/ });
  await expect(backlink).toContainText('3 行目');
  await expect(backlink).toContainText('[上の階層へ](../arrival.md)');

  // A note written while the list is open joins it with nothing pressed.
  await writeFile(path.join(root, 'late.md'), '# 遅れて書いたページ\n\n[**到着点**](arrival.md)\n');
  await expect(backlinks).toContainText('2 件のリンク');
  const late = backlinks.getByRole('button', { name: /late\.md/ });
  await expect(late).toContainText('3 行目');

  // A formatted label is not on screen as written: the note opens and the notice says so.
  await late.click();
  await expect(backlinks).toBeHidden();
  await expect(editor).toContainText('遅れて書いたページ');
  await expect(notice).toHaveText(
    'リンクを安全に特定できませんでした。ファイルの更新、または表示されない Markdown 記法が含まれる可能性があります。3 行目を確認してください。',
  );

  // A plain label is selected in the note that carries it.
  await page.getByRole('button', { name: 'arrival', exact: true }).click();
  await expect(editor).toContainText('到着点');
  await backlinksButton.click();
  await backlink.click();
  await expect(backlinks).toBeHidden();
  await expect(editor).toContainText('深いページ');
  await expect(notice).toHaveText('3 行目のリンクを選択しました。');
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe('上の階層へ');

  // A note nothing points at says so.
  await page.getByRole('button', { name: 'topic', exact: true }).click();
  await expect(editor).toContainText('出発点');
  await backlinksButton.click();
  await expect(backlinks).toContainText('このノートへのリンクはありません。');
  await backlinks.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(backlinks).toBeHidden();

  // Renaming a page rewrites the links that led to it; the dialog says what will change.
  await page.getByRole('button', { name: 'arrival', exact: true }).click();
  await expect(editor).toContainText('到着点');
  await page.getByRole('button', { name: '名前・場所', exact: true }).click();
  const move = page.getByRole('dialog', { name: 'ノートの名前と場所', exact: true });
  await expect(move).toContainText('参照元 2 件のノートにある 2 件のリンク');
  await move.getByLabel('ノート名', { exact: true }).fill('到着');
  await move.getByRole('button', { name: '変更する', exact: true }).click();
  await expect(move).toHaveCount(0);
  const status = page.locator('.doc-toolbar');
  await expect(status).toContainText('参照元 2 件のノートの 2 件のリンクを更新しました。');
  expect(await readFile(path.join(root, 'wiki', 'deep.md'), 'utf8')).toBe(
    '# 深いページ\n\n[上の階層へ](../到着.md)\n',
  );
  expect(await readFile(path.join(root, 'late.md'), 'utf8')).toBe(
    '# 遅れて書いたページ\n\n[**到着点**](到着.md)\n',
  );
  await backlinksButton.click();
  await expect(backlinks).toContainText('[上の階層へ](../到着.md)');
  await backlinks.getByRole('button', { name: /wiki\/deep\.md/ }).click();
  await expect(editor).toContainText('深いページ');
  await editor.getByRole('link', { name: '上の階層へ' }).click({ modifiers: ['ControlOrMeta'] });
  await expect(editor).toContainText('到着点');
  await expect(page.locator('.document-location')).toContainText('到着.md');

  // Moving a page into a folder rewrites its own links so they still lead where they did.
  await page.getByRole('button', { name: 'topic', exact: true }).click();
  await expect(editor).toContainText('出発点');
  await page.getByRole('button', { name: '名前・場所', exact: true }).click();
  await expect(move).toContainText('このノートを参照するリンクはありません。');
  await move.getByLabel('移動先フォルダ', { exact: true }).fill('wiki');
  await move.getByRole('button', { name: '変更する', exact: true }).click();
  await expect(move).toHaveCount(0);
  await expect(status).toContainText('このノート内 2 件のリンクを更新しました。');
  const movedTopic = await readFile(path.join(root, 'wiki', 'topic.md'), 'utf8');
  expect(movedTopic).toContain('[下の階層へ](deep.md)');
  expect(movedTopic).toContain('](../planned.md)');
  await editor.getByRole('link', { name: '下の階層へ' }).click({ modifiers: ['ControlOrMeta'] });
  await expect(editor).toContainText('深いページ');

  if (errors.length) throw Error(`Renderer errors: ${errors.join('\n')}`);
  console.log(
    'Link UI smoke passed: relative links followed down, up and to a missing page, and back to the link from a list that keeps itself current; links rewritten by a rename and a move.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
