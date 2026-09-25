import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import type { KnowledgeSearch } from '../src/domain/search';

// Disposable local KBs exercise the actual renderer/HostAPI/filesystem path.
// No provider/model or external cloud process is started.
const base = await mkdtemp(path.join(tmpdir(), 'irori search UI '));
const root = path.join(base, 'Notes');
const otherRoot = path.join(base, 'Reference');
await mkdir(root);
await mkdir(otherRoot);
const files = new FileService(path.join(base, 'device'));
await files.init();
const space = await files.register(root, '検索対象KB', 'personal');
const other = await files.register(otherRoot, '参照KB', 'team');
for (const directory of ['notes', 'schema', 'contents', 'nested'])
  await mkdir(path.join(root, directory));
await files.register(path.join(root, 'nested'), '独立した子KB', 'team');
await writeFile(
  path.join(root, 'notes/body.md'),
  '# A quiet note\n\nORBITAL insight lives in the body.\nLiteral a.*b example.\n',
);
await writeFile(path.join(root, 'editing.md'), '# Editing\n');
await writeFile(
  path.join(root, 'navigation.md'),
  '# Navigation\n\nWaypoint first\n\nWaypoint second\n\n**ambig**uous [other](ambiguous)\n',
);
await writeFile(path.join(root, 'line-endings.txt'), 'First\r\n\r\nCRLFMatch\r\n');
await writeFile(path.join(root, 'orbital-filename.md'), '# Filename only\n');
for (const name of [
  'AGENTS.md',
  'schema/policy.md',
  'contents/raw.md',
  '.hidden.md',
  'nested/child.md',
])
  await writeFile(path.join(root, name), 'ORBITAL excluded content\n');
await writeFile(path.join(otherRoot, 'reference.md'), '# Reference\n\nORBITAL in another KB.\n');

const env = { ...process.env, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [
    ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '.',
  ],
  env,
});
const errors: string[] = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.getByRole('checkbox', { name: /検索対象KB/ }).check();
  await page.getByRole('checkbox', { name: /参照KB/ }).check();
  await page.getByRole('button', { name: '選択したスペースを開く', exact: true }).click();
  await page.getByRole('button', { name: 'editing', exact: true }).click();
  const editor = page.locator('.ProseMirror');
  await expect(editor).toContainText('Editing');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\nAutosaveSearchToken\n');
  const launcher = page.getByRole('button', { name: /^検索（/ });
  await launcher.click();
  const panel = page.getByRole('dialog', { name: 'KB内を検索', exact: true });
  const query = panel.getByLabel('本文を検索', { exact: true });
  // The brain to search is one chip each; the brain on show is chosen first.
  const scope = (name: string) => panel.getByRole('radio', { name, exact: true });
  const submit = panel.getByRole('button', { name: '検索', exact: true });
  const results = panel.getByRole('region', { name: '本文の検索結果', exact: true });
  await expect(query).toBeFocused();
  await expect(panel.getByRole('radio')).toHaveCount(2);
  await expect(scope('検索対象KB')).toBeChecked();
  await query.fill('AutosaveSearchToken');
  await query.press('Enter');
  await expect(results.locator('li')).toHaveCount(1);
  await expect(results).toContainText('editing.md');
  expect(await readFile(path.join(root, 'editing.md'), 'utf8')).toContain('AutosaveSearchToken');

  await query.fill('orbital');
  await expect(results).toHaveCount(0);
  await submit.click();
  await expect(results.locator('li')).toHaveCount(1);
  await expect(results).toContainText('notes/body.md');
  await expect(results).toContainText('3 行目');
  await expect(results).toContainText('ORBITAL insight lives in the body.');
  await expect(results).not.toContainText('excluded');
  await expect(results).not.toContainText('orbital-filename');
  await expect(results).not.toContainText('reference.md');
  await results.getByRole('button').click();
  await expect(panel).toHaveCount(0);
  await expect(editor).toContainText('ORBITAL insight');
  await expect(page.getByText('3 行目の一致箇所を選択しました。', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('ORBITAL');
  await expect(editor).toBeFocused();

  await launcher.click();
  await query.fill('Waypoint');
  await submit.click();
  await expect(results.locator('li')).toHaveCount(2);
  await results.getByRole('button').last().click();
  await expect(page.getByText('5 行目の一致箇所を選択しました。', { exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.textContent))
    .toBe('Waypoint second');
  await launcher.click();
  await query.fill('ambiguous');
  await submit.click();
  await results.getByRole('button').click();
  await expect(page.getByText(/一致箇所を安全に特定できませんでした/)).toBeVisible();
  await launcher.click();
  await query.fill('CRLFMatch');
  await submit.click();
  await results.getByRole('button').click();
  await expect(page.getByText('3 行目の一致箇所を選択しました。', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('CRLFMatch');
  expect(await readFile(path.join(root, 'line-endings.txt'), 'utf8')).toBe(
    'First\r\n\r\nCRLFMatch\r\n',
  );

  await launcher.click();
  await query.fill('orbital');
  await scope('参照KB').check();
  await submit.click();
  await expect(results.locator('li')).toHaveCount(1);
  await expect(results).toContainText('reference.md');
  await expect(results).not.toContainText('notes/body.md');
  await results.getByRole('button').click();
  await expect(panel).toHaveCount(0);
  await expect(editor).toContainText('ORBITAL in another KB.');
  await launcher.click();
  await expect(scope('参照KB')).toBeChecked();
  await scope('検索対象KB').check();
  await query.fill('ＯＲＢＩＴＡＬ');
  await submit.click();
  await expect(results).toContainText('一致する本文はありません。');
  await query.fill('a.*b');
  await submit.click();
  await expect(results.locator('li')).toHaveCount(1);
  await expect(results).toContainText('Literal a.*b example.');

  // Real files exercise incomplete search and refresh notices; the index records the
  // oversized file as unreadable and the walk reports it on every request.
  await writeFile(path.join(root, 'oversized.txt'), 'x'.repeat(3 * 1024 * 1024));
  await expect(results).toContainText('KB のファイルが更新されました');
  await query.fill('not-present');
  await submit.click();
  await expect(results).toContainText('検索できた範囲に一致する本文はありません。');
  await expect(results).toContainText('1 ファイルをスキップしました。');
  await query.fill('orbital');
  await submit.click();
  await expect(results).toContainText('notes/body.md');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/irori-search.png' });

  // Hold only search responses in Electron's main-process fixture. The existing
  // application IPC handler continues to handle every non-search request.
  // Electron's private handler map is used only here, never exposed to renderer code.
  await app.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;
    const original = (
      ipcMain as unknown as { _invokeHandlers: Map<string, Handler> }
    )._invokeHandlers.get('irori')!;
    const fixture = {
      original,
      pending: [] as { scopeId: string; query: string; resolve: (value: unknown) => void }[],
    };
    (globalThis as unknown as { searchUiFixture: typeof fixture }).searchUiFixture = fixture;
    ipcMain.removeHandler('irori');
    ipcMain.handle('irori', (event, method, ...args) => {
      if (method !== 'search') return original(event, method, ...args);
      return new Promise((resolve) =>
        fixture.pending.push({ scopeId: args[0], query: args[1], resolve }),
      );
    });
  });
  const pendingCount = () =>
    app.evaluate(
      () =>
        (globalThis as unknown as { searchUiFixture: { pending: unknown[] } }).searchUiFixture
          .pending.length,
    );
  const release = async (index: number, preview: string, error = false) => {
    await app.evaluate(
      (_electron, { index, preview, error }) => {
        const fixture = (
          globalThis as unknown as {
            searchUiFixture: {
              pending: { scopeId: string; query: string; resolve: (value: unknown) => void }[];
            };
          }
        ).searchUiFixture;
        const [pending] = fixture.pending.splice(index, 1);
        const value: KnowledgeSearch = {
          scopeId: pending.scopeId,
          query: pending.query,
          hits: [{ path: 'notes/body.md', line: 3, preview }],
          scannedFiles: 1,
          skippedFiles: 0,
          incomplete: false,
        };
        pending.resolve(error ? { ok: false, error: preview } : { ok: true, value });
      },
      { index, preview, error },
    );
    // Flush a following round trip before inspecting the renderer's next frame.
    await page.evaluate(() => window.irori.spaces());
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
  };
  await query.fill('first');
  await submit.click();
  await expect.poll(pendingCount).toBe(1);
  await query.fill('second');
  await expect(results).toHaveCount(0);
  await submit.click();
  await expect.poll(pendingCount).toBe(2);
  await release(1, 'Current query result');
  await expect(results).toContainText('Current query result');
  await release(0, 'Late query result');
  await expect(results).toContainText('Current query result');
  await expect(results).not.toContainText('Late query result');

  await query.fill('pending scope');
  await submit.click();
  await expect.poll(pendingCount).toBe(1);
  await scope('参照KB').check();
  await submit.click();
  await expect.poll(pendingCount).toBe(2);
  await release(1, 'Current KB result');
  await release(0, 'Late previous KB result');
  await expect(results).toContainText('Current KB result');
  await expect(results).not.toContainText('Late previous KB result');

  await query.fill('pending close');
  await submit.click();
  await expect.poll(pendingCount).toBe(1);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(launcher).toBeFocused();
  await launcher.click();
  await release(0, 'Late closed panel result');
  await expect(query).toHaveValue('');
  await expect(results).toHaveCount(0);
  await query.fill('error');
  await submit.click();
  await expect.poll(pendingCount).toBe(1);
  await release(0, 'Search fixture unavailable', true);
  await expect(panel.getByRole('alert')).toContainText('Search fixture unavailable');
  await expect(submit).toBeEnabled();
  await query.fill('recovered');
  await submit.click();
  await expect.poll(pendingCount).toBe(1);
  await release(0, 'Recovered search result');
  await expect(results).toContainText('Recovered search result');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await panel.getByRole('button', { name: '閉じる', exact: true }).click();
  await app.evaluate(({ ipcMain }) => {
    const fixture = (
      globalThis as unknown as {
        searchUiFixture: {
          original: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;
        };
      }
    ).searchUiFixture;
    ipcMain.removeHandler('irori');
    ipcMain.handle('irori', fixture.original);
  });

  // An unresolved external edit still blocks search's preflight save. The panel
  // shows one brain at a time, so the search target's brain is chosen first.
  await page
    .getByRole('navigation', { name: 'Brain' })
    .getByRole('button', { name: /^検索対象KB・AI/ })
    .click();
  await page.getByRole('button', { name: 'editing', exact: true }).click();
  await expect(editor).toContainText('AutosaveSearchToken');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\nRetain this draft\n');
  await writeFile(path.join(root, 'editing.md'), '# External edit\n');
  await expect(page.locator('.versions')).toContainText('Retain this draft');
  await launcher.click();
  await query.fill('orbital');
  await submit.click();
  await expect(panel.getByRole('alert')).toContainText('編集中のノートを保存できませんでした');
  await expect(results).toHaveCount(0);
  expect(await readFile(path.join(root, 'editing.md'), 'utf8')).toBe('# External edit\n');
  await page.keyboard.press('Escape');
  await expect(page.locator('.versions')).toContainText('Retain this draft');
  expect(errors).toEqual([]);
  console.log(
    'Search UI passed: saved edits, literal body search, KB/layer isolation, result opening, incomplete/refresh notices, stale query/scope/close responses, retry and conflict guards. No model execution.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
