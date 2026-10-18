import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';
import { chooseJapanese } from '../tests/fixtures/japanese-interface';

// Several windows over one irori (ADR 051): each has its own tabs, what one has
// open the others leave alone, and closing one leaves the rest running.
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
  expect(errors).toEqual([]);
  console.log(
    'Windows UI passed: new window from the menu, separate tabs, protection of what another window has open, terminal kept when another window closes. No model inference.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
