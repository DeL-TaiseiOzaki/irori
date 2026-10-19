import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { chooseJapanese } from '../tests/fixtures/japanese-interface';

// A note as people write it in a knowledge base: footnotes, a Mermaid diagram, wiki
// links and a callout. Each shows as a page would until the cursor enters it, and
// the file keeps every character. No provider or model process is started.
const base = await mkdtemp(path.join(tmpdir(), 'irori markdown UI '));
const root = path.join(base, 'Knowledge');
await mkdir(root, { recursive: true });
const files = new FileService(path.join(base, 'device'));
await files.init();
await files.register(root, '表示のKB', 'personal');
const note = [
  '# MTD-RLの問題設定と解くべき問い',
  '',
  '人がRLの判断を言葉で理解し、必要な指示で振る舞いを変えられるようにする。[^proposed-rq]',
  '',
  '## 1. なぜこの研究が必要なのか',
  '',
  '```mermaid',
  'flowchart TD',
  '    need["① 人は言葉で指示・理解したい"] --> gap["② 既存RLは非言語のI/O"]',
  '    gap --> bridge["③ 指示と説明を接続する"]',
  '```',
  '',
  '関連は [[背景|研究の背景]] と ![[図表]] にまとめる。',
  '',
  '> [!note] 前提',
  '> 先方との合意事項として扱わない。',
  '',
  '```python',
  'print("short")',
  '```',
  '',
  '[^proposed-rq]: 2026年10月19日の整理案。',
  '',
].join('\n');
await writeFile(path.join(root, 'problem.md'), note);
await chooseJapanese(files.dataDir);
const env = { ...process.env, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), '.'],
  env,
});
const errors: string[] = [];
await mkdir('test-results', { recursive: true });
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.getByRole('checkbox', { name: /表示のKB/ }).check();
  await page.getByRole('button', { name: '選択したスペースを開く', exact: true }).click();
  await page.getByRole('button', { name: 'problem', exact: true }).click();
  const editor = page.locator('.ProseMirror');
  await expect(editor).toContainText('MTD-RLの問題設定');

  // A paragraph with a footnote reads as text with a small mark, not as source.
  const reference = editor.locator('.literal-view', { hasText: '人がRLの判断' });
  await expect(reference.locator('.literal-preview')).toBeVisible();
  await expect(reference.locator('.footnote-mark')).toHaveText('proposed-rq');
  await expect(reference.locator('.literal-block')).toBeHidden();
  // The definition shows its name before its text.
  const definition = editor.locator('.footnote-definition');
  await expect(definition).toContainText('2026年10月19日の整理案。');
  await expect(definition.locator('.footnote-mark')).toHaveText('proposed-rq');

  // Wiki links show their labels; a callout its title.
  await expect(editor.locator('.wiki-link').first()).toHaveText('研究の背景');
  await expect(editor.locator('.wiki-embed')).toHaveText('図表');
  await expect(editor.locator('.callout-title')).toHaveText('前提');
  await expect(editor.locator('.callout')).toContainText('先方との合意事項として扱わない。');

  // The Mermaid block draws its diagram; its source is one click away.
  const diagram = editor.locator('.milkdown-code-block .preview svg');
  await expect(diagram).toBeVisible({ timeout: 30_000 });
  await expect(diagram).toContainText('人は言葉で指示・理解したい');
  // A short code block is as tall as its code.
  const python = editor.locator('.milkdown-code-block', { hasText: 'print("short")' });
  expect((await python.locator('.cm-editor').boundingBox())!.height).toBeLessThan(120);
  await page.screenshot({ path: 'test-results/markdown-ui-smoke.png' });
  await editor.locator('.callout').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/markdown-ui-smoke-callout.png' });

  // The reader's text size and line spacing reach the note; headings follow the size.
  const typography = () =>
    editor.evaluate((root) =>
      ['p', 'h1'].map((tag) => {
        const style = getComputedStyle(root.querySelector(tag)!);
        return [style.fontSize, style.lineHeight];
      }),
    );
  const choose = async (group: string, name: string) => {
    await page.getByRole('button', { name: /^設定（/ }).click();
    await page
      .getByRole('group', { name: group })
      .getByRole('radio', { name, exact: true })
      .check();
    await page.keyboard.press('Escape');
  };
  expect(await typography()).toEqual([
    ['16px', '24px'],
    ['32px', '43.2px'],
  ]);
  const labels = () =>
    diagram.evaluate((svg) =>
      [...svg.querySelectorAll('foreignObject')].map((box) => {
        const label = box.firstElementChild as HTMLElement;
        return [label.scrollHeight, getComputedStyle(label).fontSize];
      }),
    );
  const drawn = await labels();
  await choose('文字の大きさ', '大');
  await choose('行間', '広い');
  await expect.poll(typography).toEqual([
    ['18px', '34.2px'],
    ['36px', '48.6px'],
  ]);
  // A diagram's labels keep the size Mermaid measured them at, so none is cut off.
  expect(await labels()).toEqual(drawn);
  const chosen = await page.evaluate(() => window.irori.deviceSettings());
  expect([chosen.textSize, chosen.lineSpacing]).toEqual(['large', 'relaxed']);
  await page.screenshot({ path: 'test-results/markdown-ui-smoke-large.png' });
  await choose('文字の大きさ', '標準');
  await choose('行間', '標準');
  await expect.poll(typography).toEqual([
    ['16px', '24px'],
    ['32px', '43.2px'],
  ]);

  // Clicking the paragraph shows its source for editing; leaving it shows the page again.
  await reference.locator('.literal-preview').click();
  await expect(reference.locator('.literal-block')).toBeVisible();
  await expect(reference.locator('.literal-block')).toContainText('[^proposed-rq]');
  await page.keyboard.press('End');
  await page.keyboard.type('追記');
  await editor.getByText('MTD-RLの問題設定と解くべき問い').click();
  await expect(reference.locator('.literal-preview')).toContainText('追記');
  await expect(reference.locator('.literal-block')).toBeHidden();
  // What is saved is the text as written, with the edit. (The editor's trailing
  // paragraph after a last block that is not one adds a final line break.)
  await page.keyboard.press('ControlOrMeta+s');
  await expect
    .poll(async () => (await readFile(path.join(root, 'problem.md'), 'utf8')).trimEnd())
    .toBe(note.replace('[^proposed-rq]\n', '[^proposed-rq]追記\n').trimEnd());

  expect(errors).toEqual([]);
  await writeFile(
    'test-results/markdown-ui-smoke.json',
    JSON.stringify(
      {
        checks: [
          'a footnote reference shows as a mark, its source hidden',
          'a footnote definition shows its name before its text',
          'wiki links show their labels, a callout its title',
          'a Mermaid block draws its diagram',
          'a short code block is as tall as its code',
          "the reader's text size and line spacing reach paragraphs and headings, not a diagram's labels, and go back",
          'a click shows the source for editing; leaving shows the page; the file keeps the text',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log('Markdown UI checks passed: footnotes, wiki links, callouts and Mermaid.');
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
