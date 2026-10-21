import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';
import { chooseJapanese } from '../tests/fixtures/japanese-interface';

// The stage in columns with tabs (ADR 052): files open as tabs of the focused
// column, a column opens beside with the same file, the editor moves to the
// column clicked, the other columns show their files as saved, and each vault
// keeps its own columns.
const base = await mkdtemp(path.join(tmpdir(), 'irori stage columns UI '));
const files = new FileService(path.join(base, 'device'));
await files.init();
const roots: Record<string, string> = {};
const ids: string[] = [];
for (const name of ['Home', 'Paper']) {
  roots[name] = path.join(base, name);
  await mkdir(path.join(roots[name], 'Knowledge_Base'), { recursive: true });
  ids.push((await files.register(roots[name], name, 'personal')).scopeId);
}
const knowledge = (vault: string, rel: string) => path.join(roots[vault], 'Knowledge_Base', rel);
await writeFile(knowledge('Home', 'alpha.md'), '# Alpha\n\nFirst page.\n');
await writeFile(knowledge('Home', 'beta.md'), '# Beta\n');
await writeFile(knowledge('Home', 'gamma.md'), '# Gamma\n');
await writeFile(knowledge('Paper', 'paper.md'), '# Paper\n');
await new WorkspaceService(files).save('Lab', ids);
await chooseJapanese(files.dataDir);
const env = { ...process.env, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const errors: string[] = [];

const app = await electron.launch({
  args: [
    ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '.',
  ],
  env,
});
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.setDefaultTimeout(20000);
  await page.locator('.workspace-card').filter({ hasText: 'Lab' }).click();
  const tree = page.getByRole('region', { name: 'Knowledge', exact: true });
  const openNote = (name: string) => tree.getByRole('button', { name, exact: true }).click();
  const columns = page.locator('.stage-column');
  const column = (n: number) => columns.nth(n - 1);
  const tabs = (scope: ReturnType<typeof column> | typeof page) =>
    scope.getByRole('tablist', { name: '開いているファイル' }).getByRole('tab');
  const editor = page.locator(
    '.stage-column.focused .ProseMirror, .note-surface > .document-scroll .ProseMirror',
  );
  const split = page.getByRole('button', { name: '横に並べて開く' });

  // One file shows as before; a second makes the open files tabs.
  await openNote('alpha');
  await expect(page.locator('.ProseMirror h1')).toHaveText('Alpha');
  await expect(page.locator('.stage-tabs')).toHaveCount(0);
  await openNote('beta');
  await expect(tabs(page)).toHaveText(['alpha.md', 'beta.md']);
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await tabs(page).first().click();
  await expect(page.locator('.ProseMirror h1')).toHaveText('Alpha');

  // A column opens beside with the same file and takes the focus.
  await split.click();
  await expect(columns).toHaveCount(2);
  await expect(column(2)).toHaveClass(/focused/);
  await expect(tabs(column(2))).toHaveText(['alpha.md']);
  await expect(column(1).locator('.ProseMirror h1')).toHaveText('Alpha');
  await expect(column(1).locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');

  // A file opened now goes to the focused column.
  await openNote('gamma');
  await expect(tabs(column(2))).toHaveText(['alpha.md', 'gamma.md']);
  await expect(tabs(column(1))).toHaveText(['alpha.md', 'beta.md']);
  await expect(column(2).locator('.ProseMirror h1')).toHaveText('Gamma');
  await page.screenshot({ path: 'test-results/irori-stage-columns.png' });

  // An edit is saved when the editor moves to the column clicked, which shows it as read.
  await column(2).locator('.ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\nWritten in the second column\n');
  await column(1).locator('.ProseMirror h1').click();
  await expect(column(1)).toHaveClass(/focused/);
  await expect(column(1).locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');
  await expect(column(2).locator('.ProseMirror')).toContainText('Written in the second column');
  expect(await readFile(knowledge('Home', 'gamma.md'), 'utf8')).toContain(
    'Written in the second column',
  );
  // A save in the focused column shows in another column showing the same file.
  await tabs(column(2)).first().click();
  await expect(column(2)).toHaveClass(/focused/);
  await expect(column(1).locator('.ProseMirror h1')).toHaveText('Alpha');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\nShared between columns\n');
  await expect(column(1).locator('.ProseMirror')).toContainText('Shared between columns');

  // Closing a tab of the column without the focus leaves the editor where it is.
  await column(1).getByRole('button', { name: 'alpha.md のタブを閉じる' }).click();
  await expect(tabs(column(1))).toHaveText(['beta.md']);
  await expect(column(1).locator('.ProseMirror h1')).toHaveText('Beta');
  await expect(column(2)).toHaveClass(/focused/);

  // Another vault has its own stage; coming back finds the columns as they were.
  const rail = page.getByRole('navigation', { name: 'vault' });
  await rail.getByRole('button', { name: /^Paper/ }).click();
  await expect(columns).toHaveCount(0);
  await tree.getByRole('button', { name: 'paper', exact: true }).click();
  await expect(page.locator('.ProseMirror h1')).toHaveText('Paper');
  await rail.getByRole('button', { name: /^Home/ }).click();
  await expect(columns).toHaveCount(2);
  await expect(column(2).locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');
  await expect(column(2).locator('.ProseMirror h1')).toHaveText('Alpha');
  await expect(column(1).locator('.ProseMirror h1')).toHaveText('Beta');

  // Up to four columns.
  await split.click();
  await split.click();
  await expect(columns).toHaveCount(4);
  await expect(split).toBeDisabled();
  for (const n of [4, 3]) await column(n).getByRole('button', { name: 'この列を閉じる' }).click();
  await expect(columns).toHaveCount(2);

  // Closing the focused column moves the editor to the one beside it.
  await column(2).getByRole('button', { name: 'この列を閉じる' }).click();
  await expect(columns).toHaveCount(0);
  await expect(page.locator('.stage-tabs')).toHaveCount(0);
  await expect(page.locator('.ProseMirror h1')).toHaveText('Beta');
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');
  await page.waitForTimeout(500);
  await expect(page.getByRole('alert')).toHaveCount(0);
} finally {
  await app.close();
}
expect(errors).toEqual([]);
console.log(
  'Stage columns UI passed: files opened as tabs, a column opened beside with the same file, new files went to the focused column, the editor moved to the column clicked after saving, another column showed the saved text, each vault kept its own columns, four was the limit, and closing the focused column moved the editor beside it.',
);
