import { _electron as electron, expect, type Page } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';
import { chooseJapanese } from '../tests/fixtures/japanese-interface';

// A workspace tab's right click (ADR 066): a tab is duplicated, the same workspace then
// open in two tabs that each keep their own place; one, the others or those to the right
// close; a tab moves to a new window; and a tab dropped on a window that has its
// workspace open already becomes a tab of its own there.
const base = await mkdtemp(path.join(tmpdir(), 'irori tab menu UI '));
const files = new FileService(path.join(base, 'device'));
await files.init();
const vault = async (name: string) => {
  const folder = path.join(base, name);
  await mkdir(folder);
  return (await files.register(folder, name, 'personal')).scopeId;
};
const one = await vault('一つ目のKB');
const two = await vault('二つ目のKB');
const three = await vault('三つ目のKB');
const workspaces = new WorkspaceService(files);
await workspaces.save('調べもの', [one, two]);
await workspaces.save('書きもの', [three]);
await chooseJapanese(files.dataDir);
const home = path.join(base, 'home');
await mkdir(home);
const env = { ...process.env, HOME: home, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [...(process.getuid?.() === 0 ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '.'],
  env,
});
const errors: string[] = [];
const windowCount = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
const strip = (page: Page) => page.getByRole('navigation', { name: 'ワークスペース' });
const names = (page: Page) => strip(page).locator('.workspace-tab').allInnerTexts();
const tabs = (page: Page, name: string) => strip(page).getByRole('button', { name, exact: true });
const shownVault = (page: Page) => page.locator('.brain-panel').first();
/** Right-clicks the `nth` tab named `name` and picks `item` from its menu. */
async function choose(page: Page, name: string, nth: number, item: string) {
  await expect(tabs(page, name).nth(nth)).toBeEnabled();
  await tabs(page, name).nth(nth).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: `${name} のタブ` });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: item, exact: true }).click();
  await expect(menu).toHaveCount(0);
}
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.locator('.workspace-card').filter({ hasText: '調べもの' }).click();
  // The workspace's second vault on show is where its tab is left.
  await page
    .getByRole('navigation', { name: 'vault' })
    .getByRole('button', { name: /^二つ目のKB/ })
    .click();
  await expect(shownVault(page)).toHaveAttribute('aria-label', '二つ目のKB');
  await page.getByRole('button', { name: 'ワークスペースを開く' }).click();
  await page.locator('.workspace-card').filter({ hasText: '書きもの' }).click();
  await expect(tabs(page, '書きもの')).toHaveAttribute('aria-current', 'page');

  // The menu offers what a browser's does; a window's tabs can all be closed but one.
  await tabs(page, '調べもの').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '調べもの のタブ' });
  for (const item of [
    'タブを複製',
    '新しいウィンドウに移動',
    'タブを閉じる',
    '他のタブを閉じる',
    '右側のタブを閉じる',
  ])
    await expect(menu.getByRole('menuitem', { name: item, exact: true })).toBeEnabled();
  await mkdir('test-results', { recursive: true });
  await menu.evaluate((popup) => Promise.all(popup.getAnimations().map((done) => done.finished)));
  await page.screenshot({ path: 'test-results/irori-tab-menu.png' });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // Duplicated, it opens after itself and on show, where the tab was left.
  await choose(page, '調べもの', 0, 'タブを複製');
  expect(await names(page)).toEqual(['調べもの', '調べもの', '書きもの']);
  await expect(tabs(page, '調べもの').nth(1)).toHaveAttribute('aria-current', 'page');
  await expect(shownVault(page)).toHaveAttribute('aria-label', '二つ目のKB');
  // Each tab keeps its own place.
  await page
    .getByRole('navigation', { name: 'vault' })
    .getByRole('button', { name: /^一つ目のKB/ })
    .click();
  await expect(shownVault(page)).toHaveAttribute('aria-label', '一つ目のKB');
  await tabs(page, '調べもの').nth(0).click();
  await expect(tabs(page, '調べもの').nth(0)).toHaveAttribute('aria-current', 'page');
  await expect(shownVault(page)).toHaveAttribute('aria-label', '二つ目のKB');
  await tabs(page, '調べもの').nth(1).click();
  await expect(shownVault(page)).toHaveAttribute('aria-label', '一つ目のKB');

  // Those to the right of the first close; the copy was on show, so the first comes on show.
  await choose(page, '調べもの', 0, '右側のタブを閉じる');
  expect(await names(page)).toEqual(['調べもの']);
  await expect(tabs(page, '調べもの')).toHaveAttribute('aria-current', 'page');
  await expect(shownVault(page)).toHaveAttribute('aria-label', '二つ目のKB');
  // A window's one tab can be closed but not moved, and has no others to close.
  await tabs(page, '調べもの').click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: '新しいウィンドウに移動' })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: '他のタブを閉じる' })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: '右側のタブを閉じる' })).toBeDisabled();
  await page.keyboard.press('Escape');

  // The others close, the one right-clicked stays and comes on show.
  await page.getByRole('button', { name: 'ワークスペースを開く' }).click();
  await page.locator('.workspace-card').filter({ hasText: '書きもの' }).click();
  await expect(tabs(page, '書きもの')).toHaveAttribute('aria-current', 'page');
  await choose(page, '調べもの', 0, '他のタブを閉じる');
  expect(await names(page)).toEqual(['調べもの']);
  await expect(tabs(page, '調べもの')).toHaveAttribute('aria-current', 'page');
  // One of a workspace's two tabs closes from its menu; the other stays as it was.
  await choose(page, '調べもの', 0, 'タブを複製');
  await choose(page, '調べもの', 1, 'タブを閉じる');
  expect(await names(page)).toEqual(['調べもの']);
  await expect(shownVault(page)).toHaveAttribute('aria-label', '二つ目のKB');

  // Moved to a new window from its menu, the copy opens there; this window keeps the first.
  await choose(page, '調べもの', 0, 'タブを複製');
  const [moved] = await Promise.all([
    app.waitForEvent('window'),
    choose(page, '調べもの', 1, '新しいウィンドウに移動'),
  ]);
  moved.on('pageerror', (error) => errors.push(String(error)));
  await expect(tabs(moved, '調べもの')).toHaveAttribute('aria-current', 'page');
  await expect(shownVault(moved)).toHaveAttribute('aria-label', '二つ目のKB');
  await expect.poll(() => names(page)).toEqual(['調べもの']);
  expect(await windowCount()).toBe(2);

  // Dropped on this window's tabs, where the workspace is open already, it is a tab of
  // its own after the one there, and its emptied window closes (ADR 064, 066).
  await app.evaluate(({ BrowserWindow }) => {
    const [first, other] = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id);
    first.setBounds({ x: 0, y: 0, width: 980, height: 680 });
    other.setBounds({ x: 300, y: 344, width: 980, height: 680 });
    other.focus();
  });
  const there = (await tabs(page, '調べもの').boundingBox())!;
  const held = (await tabs(moved, '調べもの').boundingBox())!;
  await moved.mouse.move(held.x + held.width / 2, held.y + held.height / 2);
  await moved.mouse.down();
  await moved.mouse.move(there.x + there.width + 40 - 300, there.y + 10 - 344, { steps: 10 });
  await expect(strip(page).locator('.workspace-tab[data-incoming]')).toHaveText('調べもの');
  await moved.mouse.up();
  await expect.poll(windowCount).toBe(1);
  expect(await names(page)).toEqual(['調べもの', '調べもの']);
  await expect(tabs(page, '調べもの').nth(1)).toHaveAttribute('aria-current', 'page');
  await expect(shownVault(page)).toHaveAttribute('aria-label', '二つ目のKB');

  expect(errors).toEqual([]);
  console.log(
    'Tab menu UI passed: a tab duplicated with its place, two tabs of one workspace each keeping theirs, one, the others and those to the right closed, a tab moved to a new window from its menu, and dropped back beside a tab of its workspace as one of its own.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
