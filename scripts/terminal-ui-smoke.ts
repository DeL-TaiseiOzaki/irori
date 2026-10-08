import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';

const base = await mkdtemp(path.join(tmpdir(), 'irori terminal UI 日本語 '));
const files = new FileService(path.join(base, 'device'));
await files.init();
const kb = path.join(base, 'KB with spaces');
await mkdir(kb);
await files.register(kb, '端末のKB', 'personal');
// The irori agent's folder is set up, so irori mode has a terminal of its own.
const home = path.join(base, 'home');
const you = path.join(home, 'irori', 'you');
await mkdir(you, { recursive: true });
await writeFile(path.join(you, 'AGENTS.md'), '# irori agent\n');
const env = { ...process.env, HOME: home, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [...(process.getuid?.() === 0 ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '.'],
  env,
});
try {
  const page = await app.firstWindow();
  await page.getByRole('checkbox', { name: /端末のKB/ }).check();
  await page.getByRole('button', { name: '選択したスペースを開く' }).click();
  await page
    .locator('.status-bar')
    .getByRole('button', { name: 'ターミナル', exact: true })
    .click();
  const panel = page.getByRole('region', { name: '端末のKB のターミナル' });
  await expect(panel.locator('.terminal-state')).toHaveText('実行中');
  await panel.locator('.xterm-helper-textarea').focus();
  await page.keyboard.insertText(
    process.platform === 'win32'
      ? "Set-Content -LiteralPath 'terminal 日本語.txt' -Value '画面から保存' -Encoding utf8"
      : "printf '画面から保存\\n' > 'terminal 日本語.txt'",
  );
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => readFile(path.join(kb, 'terminal 日本語.txt'), 'utf8').catch(() => ''), {
      timeout: 10000,
    })
    .toContain('画面から保存');
  await page.setViewportSize({ width: 1000, height: 720 });
  await expect(panel).toBeVisible();
  const footer = await page.locator('.status-bar').boundingBox();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(720);
  const home = page.getByRole('button', { name: 'ワークスペースを選択', exact: true });
  // Home asks before it closes the terminal; cancelling keeps the shell.
  await home.click();
  const goHome = page.getByRole('dialog', { name: 'ホームに戻る' });
  await expect(goHome).toContainText('ターミナルを閉じます。');
  await goHome.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(goHome).toHaveCount(0);
  await expect(panel.locator('.terminal-state')).toHaveText('実行中');
  await expect(
    page.locator('.status-bar').getByRole('button', { name: 'ターミナル', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/irori-terminal.png' });
  await panel.getByRole('button', { name: 'プロセスを終了', exact: true }).click();
  await expect(panel.locator('.terminal-state')).toHaveText('終了');
  await expect(panel.getByLabel('ターミナルのシェル')).toBeEnabled();
  await panel.getByRole('button', { name: '開く', exact: true }).click();
  await expect(panel.locator('.terminal-state')).toHaveText('実行中');
  await panel.getByRole('button', { name: '終了して閉じる' }).click();
  await expect(panel).toHaveCount(0);
  await expect(home).toBeEnabled();
  // Ctrl+` opens the drawer and closes it again, from inside the terminal too.
  await page.keyboard.press('Control+Backquote');
  await expect(panel.locator('.terminal-state')).toHaveText('実行中');
  await panel.locator('.xterm-helper-textarea').focus();
  await page.keyboard.press('Control+Backquote');
  await expect(panel).toHaveCount(0);

  // irori mode hides the hibachi's stage, so its terminal is a drawer of its own,
  // in the irori agent's folder, that outlives a visit to a hibachi.
  const rail = page.getByRole('navigation', { name: 'hibachi' });
  await rail.getByRole('button', { name: 'irori mode', exact: true }).click();
  const toggle = page
    .locator('.status-bar')
    .getByRole('button', { name: 'ターミナル', exact: true });
  await expect(toggle).toBeEnabled();
  await toggle.click();
  const irori = page.getByRole('region', { name: 'irori agent のターミナル' });
  await expect(irori).toBeVisible();
  await expect(irori.locator('.terminal-state')).toHaveText('実行中');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(panel).toHaveCount(0);
  await irori.locator('.xterm-helper-textarea').focus();
  await page.keyboard.insertText(
    process.platform === 'win32'
      ? "Set-Content -LiteralPath 'irori 日本語.txt' -Value 'irori mode から保存' -Encoding utf8"
      : "printf 'irori mode から保存\\n' > 'irori 日本語.txt'",
  );
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => readFile(path.join(you, 'irori 日本語.txt'), 'utf8').catch(() => ''), {
      timeout: 10000,
    })
    .toContain('irori mode から保存');
  await page.screenshot({ path: 'test-results/irori-mode-terminal.png' });
  await rail.getByRole('button', { name: /^端末のKB/ }).click();
  await expect(irori).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await rail.getByRole('button', { name: 'irori mode', exact: true }).click();
  await expect(irori).toBeVisible();
  await expect(irori.locator('.terminal-state')).toHaveText('実行中');
  await page.keyboard.press('Control+Backquote');
  await expect(irori).toHaveCount(0);
  // From irori mode with its terminal open, home closes it once agreed.
  await toggle.click();
  await expect(irori.locator('.terminal-state')).toHaveText('実行中');
  await home.click();
  await goHome.getByRole('button', { name: '停止して戻る', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ワークスペースを選択' })).toBeVisible();
  console.log(
    'Terminal UI passed: detected native shell, actual keyboard input/Japanese file, resize, stop/reopen, irori mode drawer and cleanup. No model inference.',
  );
} catch (error) {
  const page = await app.firstWindow();
  console.error(
    await page
      .locator('.terminal-panel')
      .innerText()
      .catch(() => 'Terminal panel unavailable'),
  );
  throw error;
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
