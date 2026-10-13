import { _electron as electron, expect } from '@playwright/test';
import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { chooseJapanese } from '../tests/fixtures/japanese-interface';

// PDF, Word, PowerPoint, spreadsheets and images open on the stage in a viewer,
// from a disposable KB holding the fixtures in tests/fixtures/viewers.
const base = await mkdtemp(path.join(tmpdir(), 'irori viewers UI '));
const root = path.join(base, 'Materials KB');
await mkdir(path.join(root, 'materials'), { recursive: true });
const fixtures = path.resolve('tests/fixtures/viewers');
for (const name of [
  'sample.pdf',
  'sample.docx',
  'sample.pptx',
  'inherited.pptx',
  'sample.xlsx',
  'picture.png',
])
  await copyFile(path.join(fixtures, name), path.join(root, 'materials', name));
// Code opens in the editor as in VS Code; bytes that are not text go to their application.
await writeFile(
  path.join(root, 'materials', 'hello.py'),
  'def hello():\n    return "こんにちは"\n',
);
await writeFile(path.join(root, 'materials', 'blob.dat'), Buffer.from([0xff, 0xfe, 0x00, 0x81]));
const files = new FileService(path.join(base, 'device'));
await files.init();
await files.register(root, '資料のKB', 'personal');
await chooseJapanese(files.dataDir);
const env = { ...process.env, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), '.'],
  env,
});
const errors: string[] = [];
const alerts: string[] = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('dialog', (dialog) => {
    alerts.push(dialog.message());
    void dialog.dismiss();
  });
  // Opening in the external application is answered here rather than by the OS.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as never;
  });
  await page.getByRole('checkbox', { name: /資料のKB/ }).check();
  await page.getByLabel('ワークスペース名').fill('Viewers');
  await page.getByRole('button', { name: '選択したスペースを開く', exact: true }).click();
  await page.getByRole('button', { name: 'materials', exact: true }).click();
  const viewer = page.locator('.file-viewer');
  const bar = viewer.locator('.viewer-bar');

  // PDF: a Japanese page drawn with a bundled CMap, and a standard-font page.
  await page.getByRole('button', { name: 'sample.pdf', exact: true }).click();
  await expect(bar).toContainText('PDF');
  await expect(bar).toContainText('2 ページ');
  await expect(page.getByText('表示のみ', { exact: true })).toBeVisible();
  const pdfPages = viewer.locator('.pdf-page');
  await expect(pdfPages).toHaveCount(2);
  await expect(pdfPages.first().locator('canvas')).toBeVisible();
  await expect(pdfPages.first().locator('.textLayer')).toContainText('資料ビューアーの試験');
  await pdfPages.nth(1).scrollIntoViewIfNeeded();
  await expect(pdfPages.nth(1).locator('.textLayer')).toContainText('Second page in Helvetica');
  const fitted = (await pdfPages.first().boundingBox())!.width;
  await viewer.getByRole('button', { name: '拡大', exact: true }).click();
  await expect(viewer.locator('.zoom-level')).toHaveText('110%');
  await expect
    .poll(async () => (await pdfPages.first().boundingBox())!.width)
    .toBeGreaterThan(fitted * 1.05);
  await viewer.locator('.zoom-level').click();
  await expect(viewer.locator('.zoom-level')).toHaveText('100%');
  await pdfPages.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/irori-viewer-pdf.png' });

  // Word: pages from the document, with a link that goes to the browser and one that goes nowhere.
  await page.getByRole('button', { name: 'sample.docx', exact: true }).click();
  await expect(bar).toContainText('Word');
  const word = viewer.locator('.word-document');
  await expect(word.locator('section.docx').first()).toContainText('議事録 2026-09-26');
  await expect(word.locator('section.docx')).toHaveCount(2);
  await expect(word).toContainText('<img src=x onerror=alert(1)>');
  await expect(word.locator('img[onerror]')).toHaveCount(0);
  await expect(word.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(word.locator('a[href="https://example.com/irori"]')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/irori-viewer-word.png' });

  // PowerPoint: every slide, escaped text, a picture, a table and a chart.
  await page.getByRole('button', { name: 'sample.pptx', exact: true }).click();
  await expect(bar).toContainText('3 枚のスライド');
  const deck = viewer.locator('.slide-deck');
  await expect(deck.locator('section.frame')).toHaveCount(3);
  await expect(deck.locator('section.frame').first()).toContainText(
    '四半期レビュー <script>alert(1)</script>',
  );
  await expect(deck.locator('script')).toHaveCount(0);
  await expect(deck.locator('section.frame').nth(1)).toContainText('赤い太字の注記');
  await expect(deck.locator('section.frame').nth(2).locator('table')).toContainText('大阪');
  await expect(deck.locator('section.frame').nth(2).locator('svg')).toHaveCount(1);
  const slideBox = (await deck.locator('section.frame').first().boundingBox())!;
  // A 4:3 deck keeps its shape with no letterbox.
  expect(Math.abs(slideBox.width / slideBox.height - 4 / 3)).toBeLessThan(0.02);
  await page.screenshot({ path: 'test-results/irori-viewer-slides.png' });

  // A template's title takes the master's size and is not cut at its box; a box
  // with an outline and no fill stays empty, one with its style's fill is filled.
  await page.getByRole('button', { name: 'inherited.pptx', exact: true }).click();
  await expect(bar).toContainText('1 枚のスライド');
  const inherited = deck.locator('section.frame').first();
  const title = inherited.locator('div', { hasText: /^社会実装$/ }).last();
  const titleStyle = await title.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      size: Math.round(parseFloat(style.fontSize) * 100) / 100,
      weight: style.fontWeight,
      overflow: style.overflow,
    };
  });
  expect(titleStyle).toEqual({ size: 37.33, weight: '400', overflow: 'visible' });
  const fills = await inherited.evaluate((frame) =>
    [...frame.querySelectorAll<HTMLElement>('.slide > div')]
      .filter((node) => /border:\s*\d+px solid/.test(node.getAttribute('style') ?? ''))
      .map((node) => [node.style.left, getComputedStyle(node).backgroundColor]),
  );
  expect(fills).toContainEqual(['960px', 'rgba(0, 0, 0, 0)']);
  expect(fills.find(([left]) => left === '96px')?.[1]).not.toMatch(/^rgba?\(0, 0, 0(, 1)?\)$/);
  await page.screenshot({ path: 'test-results/irori-viewer-slides-inherited.png' });

  // Spreadsheet: displayed values, a merge, paging and the second sheet.
  await page.getByRole('button', { name: 'sample.xlsx', exact: true }).click();
  await expect(bar).toContainText('2 シート');
  const sheet = viewer.locator('.sheet-view');
  await expect(sheet.getByRole('tab', { name: '売上' })).toHaveAttribute('aria-selected', 'true');
  await expect(sheet).toContainText('251 行 · 7 列');
  await expect(sheet.locator('tbody tr').nth(1)).toContainText('2026-09-02');
  await expect(sheet.locator('tbody tr').nth(1)).toContainText('1,235');
  await expect(sheet.locator('tbody tr').nth(1)).toContainText('0.1%');
  await expect(sheet.locator('td[rowspan="2"][colspan="2"]')).toHaveText('結合セル');
  await sheet.getByRole('button', { name: '次の 200 行' }).click();
  await expect(sheet.locator('tbody tr')).toHaveCount(51);
  await page.screenshot({ path: 'test-results/irori-viewer-sheet.png' });
  await sheet.getByRole('tab', { name: 'メモ' }).click();
  await expect(sheet.locator('tbody')).toContainText('二枚目のシート');

  // A code file opens in the editor, highlighted by its language.
  await page.getByRole('button', { name: 'hello.py', exact: true }).click();
  const code = page.locator('.cm-content').first();
  await expect(code).toContainText('def hello():');
  await expect(code.locator('span', { hasText: /^def$/ })).toHaveCount(1);
  await page.screenshot({ path: 'test-results/irori-code-file.png' });
  // Bytes that are not text go to their application, without an error.
  await page.getByRole('button', { name: 'blob.dat', exact: true }).click();
  await expect(code).toContainText('def hello():');
  await expect(page.getByRole('alert')).toHaveCount(0);

  // An image, and the way out to the external application.
  await page.getByRole('button', { name: 'picture.png', exact: true }).click();
  await expect(bar).toContainText('120 × 80');
  await expect(viewer.locator('.image-view img')).toBeVisible();
  await bar.getByRole('button', { name: '外部アプリで開く' }).click();

  // A file changed on disk is read again.
  await writeFile(
    path.join(root, 'materials', 'picture.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  await expect(bar).toContainText('1 × 1');

  expect(alerts).toEqual([]);
  expect(errors).toEqual([]);
  console.log(
    'Viewers UI passed: Japanese PDF with a bundled CMap and its text layer, zoom, Word pages and links, slides (a template title at its master size, an outlined box left unfilled), a Python file in the editor, sheet values, merges, paging and sheets, an image reloaded after a change, and no script or unsafe link carried into the page. No provider calls.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
