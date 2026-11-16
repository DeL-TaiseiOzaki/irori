import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';
import { chooseJapanese } from '../tests/fixtures/japanese-interface';
import { showEveryWindowItem } from '../tests/fixtures/window-items';

// Several windows over one irori (ADR 051): each has its own tabs, what one has
// open the others leave alone, and closing one leaves the rest running. A tab
// dragged out of its window opens in a window of its own (ADR 063), or joins the
// tabs of another window it is let go on (ADR 064); along its strip it is reordered
// (ADR 065).
const base = await mkdtemp(path.join(tmpdir(), 'irori windows UI 日本語 '));
const files = new FileService(path.join(base, 'device'));
await files.init();
const kb = path.join(base, 'KB one');
const other = path.join(base, 'KB two');
await mkdir(kb);
await mkdir(other);
const first = await files.register(kb, '一つ目のKB', 'personal');
const second = await files.register(other, '二つ目のKB', 'personal');
const workspaces = new WorkspaceService(files);
await workspaces.save('最初の作業', [first.scopeId]);
await workspaces.save('次の作業', [second.scopeId]);
await chooseJapanese(files.dataDir);
await showEveryWindowItem(files.dataDir);
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
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.locator('.workspace-card').filter({ hasText: '最初の作業' }).click();
  const terminalButton = page
    .locator('.status-bar')
    .getByRole('button', { name: 'ターミナル', exact: true });
  await terminalButton.click();
  const panel = page.getByRole('region', { name: '一つ目のKB のターミナル' });
  await expect(panel.locator('.terminal-state')).toHaveText('実行中');

  // File > New Window opens a second window at the start screen.
  const [next] = await Promise.all([
    app.waitForEvent('window'),
    app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('new-window')!.click()),
  ]);
  next.on('pageerror', (error) => errors.push(String(error)));
  await expect(next.getByRole('heading', { name: 'ワークスペースを選択' })).toBeVisible();
  expect(await windowCount()).toBe(2);
  // The workspace open in the first window cannot be removed from the second.
  await expect(next.getByRole('button', { name: '最初の作業 の登録を削除' })).toBeDisabled();
  await expect(next.getByRole('button', { name: '次の作業 の登録を削除' })).toBeEnabled();
  await next.locator('.workspace-card').filter({ hasText: '次の作業' }).click();
  await expect(next.getByRole('navigation', { name: 'ワークスペース' })).toContainText('次の作業');
  // Each window keeps its own tabs.
  await expect(page.getByRole('navigation', { name: 'ワークスペース' })).not.toContainText(
    '次の作業',
  );

  // The terminal's output goes to its own window only; typing there still works.
  await panel.locator('.xterm-helper-textarea').focus();
  await page.keyboard.insertText(
    process.platform === 'win32'
      ? "Set-Content -LiteralPath 'window.txt' -Value 'first window' -Encoding utf8"
      : "printf 'first window\\n' > 'window.txt'",
  );
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => readFile(path.join(kb, 'window.txt'), 'utf8').catch(() => ''), {
      timeout: 10000,
    })
    .toContain('first window');

  // Closing the second window, which runs nothing of its own, asks nothing and
  // leaves the first window and its terminal as they were.
  await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id);
    windows.at(-1)!.close();
  });
  await expect.poll(windowCount).toBe(1);
  await expect(panel.locator('.terminal-state')).toHaveText('実行中');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/irori-windows.png' });
  // With the second window gone, its workspace may be removed from the first.
  await panel.getByRole('button', { name: '終了して閉じる' }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: 'ワークスペースを選択', exact: true }).click();
  await expect(page.getByRole('button', { name: '次の作業 の登録を削除' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '最初の作業 の登録を削除' })).toBeDisabled();

  // A tab dragged below the strip opens in a window of its own (ADR 063), on the vault it
  // showed, and leaves this window once that one shows it. Nothing of it stops.
  await page.locator('.workspace-card').filter({ hasText: '次の作業' }).click();
  const strip = page.getByRole('navigation', { name: 'ワークスペース' });
  const tabOf = (where: typeof strip, name: string) =>
    where.getByRole('button', { name, exact: true });
  await expect(tabOf(strip, '次の作業')).toHaveAttribute('aria-current', 'page');
  const held = (await tabOf(strip, '次の作業').boundingBox())!;
  await page.mouse.move(held.x + held.width / 2, held.y + held.height / 2);
  await page.mouse.down();
  // Along the strip it is not out yet; below it, it says where it goes.
  await page.mouse.move(held.x + held.width / 2 + 30, held.y + held.height / 2 + 4, { steps: 4 });
  await expect(page.locator('.workspace-tab-drag')).toBeVisible();
  await expect(page.locator('.workspace-tab-drag')).not.toContainText('新しいウィンドウで開く');
  await page.mouse.move(held.x + held.width / 2 + 60, held.y + 240, { steps: 8 });
  await expect(page.locator('.workspace-tab-drag')).toContainText('新しいウィンドウで開く');
  const [moved] = await Promise.all([app.waitForEvent('window'), page.mouse.up()]);
  moved.on('pageerror', (error) => errors.push(String(error)));
  const movedStrip = moved.getByRole('navigation', { name: 'ワークスペース' });
  await expect(tabOf(movedStrip, '次の作業')).toHaveAttribute('aria-current', 'page');
  await expect(moved.getByRole('heading', { name: '二つ目のKB' }).first()).toBeVisible();
  await expect(strip).not.toContainText('次の作業');
  await expect(tabOf(strip, '最初の作業')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.workspace-tab-drag')).toHaveCount(0);
  expect(await windowCount()).toBe(2);
  await moved.screenshot({ path: 'test-results/irori-windows-moved.png' });
  // A window's only tab moves only onto another window's tabs (ADR 064): let go
  // anywhere else, it stays and nothing opens.
  const only = (await tabOf(movedStrip, '次の作業').boundingBox())!;
  await moved.mouse.move(only.x + only.width / 2, only.y + only.height / 2);
  await moved.mouse.down();
  await moved.mouse.move(only.x + only.width / 2, only.y + 240, { steps: 8 });
  await expect(moved.locator('.workspace-tab-drag')).toContainText(
    'ほかのウィンドウのタブの上で離す',
  );
  await moved.mouse.up();
  await expect(moved.locator('.workspace-tab-drag')).toHaveCount(0);
  await expect(tabOf(movedStrip, '次の作業')).toBeVisible();
  expect(await windowCount()).toBe(2);

  // Let go on the first window's tabs, it joins them where it was let go, comes on show
  // there, and its emptied window closes. The first window shows where while it is over.
  // The windows are placed so the second overlaps the first below its title bar.
  const place = (second: { x: number; y: number }) =>
    app.evaluate(({ BrowserWindow }, second) => {
      const [first, other] = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id);
      first.setBounds({ x: 0, y: 0, width: 980, height: 680 });
      other.setBounds({ ...second, width: 980, height: 680 });
      other.focus();
    }, second);
  await place({ x: 300, y: 344 });
  const firstTab = (await tabOf(strip, '最初の作業').boundingBox())!;
  const held2 = (await tabOf(movedStrip, '次の作業').boundingBox())!;
  await moved.mouse.move(held2.x + held2.width / 2, held2.y + held2.height / 2);
  await moved.mouse.down();
  // The first window's title bar, after its tab, seen from the second window's page.
  const ontoFirst = { x: firstTab.x + firstTab.width + 40 - 300, y: firstTab.y + 10 - 344 };
  await moved.mouse.move(ontoFirst.x, ontoFirst.y, { steps: 10 });
  await expect(strip.locator('.workspace-tab[data-incoming]')).toHaveText('次の作業');
  await page.screenshot({
    path: 'test-results/irori-windows-joining.png',
    clip: { x: 0, y: 0, width: 600, height: 60 },
  });
  await moved.mouse.up();
  await expect.poll(windowCount).toBe(1);
  await expect(strip.locator('.workspace-tab[data-incoming]')).toHaveCount(0);
  await expect(tabOf(strip, '次の作業')).toHaveAttribute('aria-current', 'page');
  expect(await strip.locator('.workspace-tab').allInnerTexts()).toEqual(['最初の作業', '次の作業']);

  // A tab dragged along the strip takes the place it is let go at (ADR 065): a mark shows
  // the gap while it moves, and the tab on show and the windows stay as they were.
  const first = (await tabOf(strip, '最初の作業').boundingBox())!;
  const along = (await tabOf(strip, '次の作業').boundingBox())!;
  await page.mouse.move(along.x + along.width / 2, along.y + along.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + 4, along.y + along.height / 2 + 6, { steps: 8 });
  await expect(strip.locator('.workspace-tab-slot')).toBeVisible();
  await expect(page.locator('.workspace-tab-drag')).not.toContainText('新しいウィンドウで開く');
  await page.mouse.up();
  await expect(strip.locator('.workspace-tab-slot')).toHaveCount(0);
  expect(await strip.locator('.workspace-tab').allInnerTexts()).toEqual(['次の作業', '最初の作業']);
  await expect(tabOf(strip, '次の作業')).toHaveAttribute('aria-current', 'page');
  expect(await windowCount()).toBe(1);
  // Let go where it already stands, nothing moves.
  const stays = (await tabOf(strip, '次の作業').boundingBox())!;
  await page.mouse.move(stays.x + stays.width / 2, stays.y + stays.height / 2);
  await page.mouse.down();
  await page.mouse.move(stays.x + stays.width / 2 + 12, stays.y + stays.height / 2, { steps: 4 });
  await expect(strip.locator('.workspace-tab-slot')).toHaveCount(0);
  await page.mouse.up();
  expect(await strip.locator('.workspace-tab').allInnerTexts()).toEqual(['次の作業', '最初の作業']);

  // A window at its start screen takes a tab let go on its title bar, and the window it
  // came from keeps its other tab.
  const [empty] = await Promise.all([
    app.waitForEvent('window'),
    app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('new-window')!.click()),
  ]);
  empty.on('pageerror', (error) => errors.push(String(error)));
  await expect(empty.getByRole('heading', { name: 'ワークスペースを選択' })).toBeVisible();
  await place({ x: 300, y: 344 });
  const second = (await tabOf(strip, '次の作業').boundingBox())!;
  await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2);
  await page.mouse.down();
  // Its title bar where it covers the first window: the window in front is the one joined.
  await page.mouse.move(800, 344 + 18, { steps: 10 });
  await expect(empty.locator('.workspace-tab[data-incoming]')).toHaveText('次の作業');
  await page.mouse.up();
  const emptyStrip = empty.getByRole('navigation', { name: 'ワークスペース' });
  await expect(tabOf(emptyStrip, '次の作業')).toHaveAttribute('aria-current', 'page');
  await expect(strip).not.toContainText('次の作業');
  await expect(tabOf(strip, '最初の作業')).toHaveAttribute('aria-current', 'page');
  expect(await windowCount()).toBe(2);
  expect(errors).toEqual([]);
  console.log(
    'Windows UI passed: new window from the menu, separate tabs, protection of what another window has open, terminal kept when another window closes, a tab dragged out to a window of its own, dropped on the tabs of another window to join them, and reordered along its strip. No model inference.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
