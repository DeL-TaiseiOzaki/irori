import { _electron as electron, expect, type Locator, type Page } from '@playwright/test';
import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { chooseJapanese } from '../tests/fixtures/japanese-interface';

// Ctrl+F finds words in the file on show, whatever shows it: a note in the rich view
// (across bold, and inside a code block), code in the source view, a CSV table past its
// first page, a PDF, Word, PowerPoint and every sheet of a spreadsheet. A disposable KB
// holds the files; no provider or model process is started.
const base = await mkdtemp(path.join(tmpdir(), 'irori find in file UI '));
const root = path.join(base, 'Find KB');
await mkdir(path.join(root, 'materials'), { recursive: true });
const fixtures = path.resolve('tests/fixtures/viewers');
for (const name of ['sample.pdf', 'sample.docx', 'sample.pptx', 'sample.xlsx', 'picture.png'])
  await copyFile(path.join(fixtures, name), path.join(root, 'materials', name));
await writeFile(
  path.join(root, 'note.md'),
  [
    '# 検索の試験',
    '',
    'irori は一行目にあります。IRORI は大文字です。',
    '',
    '二段落目の **ir**ori は太字をまたぎます。',
    '',
    '```python',
    'print("irori in code")',
    '```',
    '',
    '最後の irori。',
    '',
  ].join('\n'),
);
await writeFile(
  path.join(root, 'materials', 'hello.py'),
  'def hello():\n    return "Hello, こんにちは"\n',
);
await writeFile(
  path.join(root, 'materials', 'table.csv'),
  [
    'name,note',
    ...Array.from({ length: 150 }, (_, i) => `row ${i + 1},${i === 139 ? 'needle here' : 'hay'}`),
  ].join('\n') + '\n',
);
const files = new FileService(path.join(base, 'device'));
await files.init();
await files.register(root, '検索のKB', 'personal');
await chooseJapanese(files.dataDir);
const env = { ...process.env, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), '.'],
  env,
});
const errors: string[] = [];
await mkdir('test-results', { recursive: true });
const command = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Two elements on screen that do not overlap. */
async function expectApart(a: Locator, b: Locator) {
  const [one, two] = [(await a.boundingBox())!, (await b.boundingBox())!];
  expect(
    one.y + one.height <= two.y ||
      two.y + two.height <= one.y ||
      one.x + one.width <= two.x ||
      two.x + two.width <= one.x,
  ).toBe(true);
}

/** The text of the highlight the find bar paints over a document's DOM (PDF, Word, slides). */
const painted = (page: Page, name: string) =>
  page.evaluate(
    (key) => [...(CSS.highlights.get(key)?.values() ?? [])].map((range) => String(range)),
    name,
  );

try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.getByRole('checkbox', { name: /検索のKB/ }).check();
  await page.getByRole('button', { name: '選択したスペースを開く', exact: true }).click();
  const bar = page.getByRole('search', { name: 'ファイル内検索' });
  const field = bar.getByRole('textbox', { name: 'ファイル内を検索' });
  const count = bar.getByRole('status');

  // A note in the rich view; the menu offers the bar beside its shortcut.
  await page.getByRole('button', { name: 'note', exact: true }).click();
  const editor = page.locator('.ProseMirror');
  await expect(editor).toContainText('最後の irori');
  await page.getByRole('button', { name: 'その他', exact: true }).click();
  await page.getByRole('menuitem', { name: /ファイル内を検索/ }).click();
  await expect(field).toBeFocused();
  await field.fill('irori');
  // Case does not matter, a word across bold counts once, and a code block counts too.
  await expect(count).toHaveText('1 / 5');
  // The word across bold is drawn in two pieces, one in each run.
  await expect(editor.locator('.find-hit')).toHaveCount(6);
  await expect(editor.locator('.milkdown-code-block .find-hit')).toHaveCount(1);
  await expect(editor.locator('.find-hit.current')).toHaveText('irori');
  await field.press('Enter');
  await expect(count).toHaveText('2 / 5');
  await expect(editor.locator('.find-hit.current')).toHaveText('IRORI');
  await field.press('Enter');
  await field.press('Enter');
  await expect(count).toHaveText('4 / 5');
  await expect(editor.locator('.milkdown-code-block .find-hit.current')).toHaveText('irori');
  await page.screenshot({ path: 'test-results/irori-find-note.png' });
  await field.press('Enter');
  await field.press('Enter');
  await expect(count).toHaveText('1 / 5');
  await field.press('Shift+Enter');
  await expect(count).toHaveText('5 / 5');
  // Escape leaves the occurrence selected in the note, and its marks go.
  await field.press('Escape');
  await expect(bar).toBeHidden();
  await expect(editor.locator('.find-hit')).toHaveCount(0);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('irori');
  // What is selected is what the bar looks for next.
  await page.keyboard.press(`${command}+f`);
  await expect(field).toHaveValue('irori');
  await expect(count).toHaveText('5 / 5');
  // An edit while the bar is open is counted again.
  await editor.locator('p', { hasText: '最後の' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' もう一つの irori');
  await expect(count).toHaveText(/ \/ 6$/);

  // Code in the source view: the bar, not CodeMirror's own search panel.
  await page.getByRole('button', { name: 'materials', exact: true }).click();
  await page.getByRole('button', { name: 'hello.py', exact: true }).click();
  const code = page.locator('.cm-content').first();
  await expect(code).toContainText('def hello():');
  // The bar stays open on the next file and searches it.
  await expect(count).toHaveText('見つかりません');
  await code.click();
  await page.keyboard.press(`${command}+f`);
  await expect(page.locator('.cm-search')).toHaveCount(0);
  await expect(field).toBeFocused();
  await field.fill('HELLO');
  await expect(count).toHaveText('1 / 2');
  await expect(code.locator('.find-hit.current')).toHaveText('hello');
  await page.keyboard.press('F3');
  await expect(count).toHaveText('2 / 2');
  await expect(code.locator('.find-hit.current')).toHaveText('Hello');

  // A CSV table: an occurrence past the first hundred rows turns the page.
  await page.getByRole('button', { name: 'table.csv', exact: true }).click();
  const table = page.locator('.csv-preview');
  await expect(table).toContainText('150 行 · 2 列');
  await field.fill('needle');
  await expect(count).toHaveText('1 / 1');
  await expect(table.locator('.find-hit.current')).toHaveText('needle');
  await expect(table.locator('.actions')).toContainText('101–150');

  // A PDF: every page's text is counted; the page with the occurrence is marked when drawn.
  await page.getByRole('button', { name: 'sample.pdf', exact: true }).click();
  const viewer = page.locator('.file-viewer');
  await expect(viewer.locator('.viewer-bar')).toContainText('2 ページ');
  await field.fill('helvetica');
  await expect(count).toHaveText('1 / 1');
  await expect.poll(() => painted(page, 'irori-find-current')).toEqual(['Helvetica']);
  // The bar sits above the viewer's own bar, leaving its buttons free.
  await expectApart(bar, viewer.locator('.viewer-bar'));
  await page.screenshot({ path: 'test-results/irori-find-pdf.png' });
  await field.fill('資料');
  await expect(count).toHaveText('1 / 1');
  await expect.poll(() => painted(page, 'irori-find-current')).toEqual(['資料']);

  // Word pages, in a shadow root of their own.
  await page.getByRole('button', { name: 'sample.docx', exact: true }).click();
  await expect(viewer.locator('.word-document section.docx').first()).toContainText('議事録');
  await field.fill('IRORI');
  await expect(count).toHaveText('1 / 2');
  await expect.poll(() => painted(page, 'irori-find-current')).toEqual(['irori']);
  await field.press('Enter');
  await expect(count).toHaveText('2 / 2');
  await page.screenshot({ path: 'test-results/irori-find-word.png' });

  // Slides.
  await page.getByRole('button', { name: 'sample.pptx', exact: true }).click();
  await expect(viewer.locator('.slide-deck section.frame')).toHaveCount(3);
  await field.fill('大阪');
  await expect(count).toHaveText('1 / 1');
  await expect.poll(() => painted(page, 'irori-find-current')).toEqual(['大阪']);

  // A spreadsheet: every sheet is searched, and the occurrence opens its sheet and page.
  await page.getByRole('button', { name: 'sample.xlsx', exact: true }).click();
  const sheet = viewer.locator('.sheet-view');
  await expect(sheet).toContainText('251 行 · 7 列');
  expect(await painted(page, 'irori-find')).toEqual([]);
  await field.fill('二枚目');
  await expect(count).toHaveText('1 / 1');
  await expect(sheet.getByRole('tab', { name: 'メモ' })).toHaveAttribute('aria-selected', 'true');
  await expect(sheet.locator('.find-hit.current')).toHaveText('二枚目');
  await field.fill('東京');
  await expect(count).toHaveText('1 / 125');
  await expect(sheet.getByRole('tab', { name: '売上' })).toHaveAttribute('aria-selected', 'true');
  await field.press('Shift+Enter');
  await expect(count).toHaveText('125 / 125');
  await expect(sheet.locator('.actions')).toContainText('201–251');
  await expect(sheet.locator('.find-hit.current')).toBeVisible();
  // The paging buttons stay free, and the sheet tabs in view with the bar open.
  await expectApart(bar, sheet.locator('.actions'));
  await expect(sheet.getByRole('tablist', { name: 'シート' })).toBeInViewport();
  await page.screenshot({ path: 'test-results/irori-find-sheet.png' });

  // An image has no text to find, and its menu does not offer the bar.
  await page.getByRole('button', { name: 'picture.png', exact: true }).click();
  await expect(viewer.locator('.image-view img')).toBeVisible();
  await expect(count).toHaveText('検索できません');
  await bar.getByRole('button', { name: '検索を閉じる' }).click();
  await expect(bar).toBeHidden();
  await page.getByRole('button', { name: 'その他', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '再読み込み' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /ファイル内を検索/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  expect(errors).toEqual([]);
  console.log(
    'Find in file UI passed: Ctrl+F and the note menu open one bar over a rich note (case folded, across bold, inside a code block, selected on Escape, recounted on an edit), code in the source view without its own panel, a CSV table turning to the page of an occurrence, a PDF, Word and slides marked where they draw their text, and every sheet of a spreadsheet; an image has nothing to find. No provider calls.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
