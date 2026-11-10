import { _electron as electron, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { agentIds } from '../src/domain/types';
import { chooseJapanese } from '../tests/fixtures/japanese-interface';

// A new device's window shows the work alone (ADR 059): the access, the model, the
// columns, the branch, the terminal and the version join it from the settings, each on
// its own, and leave it again. No instruction is sent, so no CLI runs.
const base = await mkdtemp(path.join(tmpdir(), 'irori window items 日本語 '));
const files = new FileService(path.join(base, 'device'));
await files.init();
const kb = path.join(base, 'KB with spaces');
await mkdir(path.join(kb, 'Knowledge_Base'), { recursive: true });
await writeFile(path.join(kb, 'Knowledge_Base', 'note.md'), '# Note\n');
const git = (...args: string[]) =>
  execFileSync('git', args, {
    cwd: kb,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'irori',
      GIT_AUTHOR_EMAIL: 'irori@example.invalid',
      GIT_COMMITTER_NAME: 'irori',
      GIT_COMMITTER_EMAIL: 'irori@example.invalid',
    },
  });
git('init', '-q', '-b', 'trunk');
git('add', '-A');
git('commit', '-q', '-m', 'Start');
await files.register(kb, '画面のKB', 'personal');
// The irori agent's folder is set up, so its column is ready to take an instruction.
const home = path.join(base, 'home');
const you = path.join(home, 'irori', 'you');
await mkdir(you, { recursive: true });
await writeFile(path.join(you, 'AGENTS.md'), '# irori agent\n');
await chooseJapanese(files.dataDir);
const record = () =>
  readFile(path.join(files.dataDir, 'device-settings.json'), 'utf8')
    .then((text) => JSON.parse(text).windowItems)
    .catch(() => undefined);
const env = { ...process.env, HOME: home, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [...(process.getuid?.() === 0 ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '.'],
  env,
});
const errors: string[] = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.getByRole('checkbox', { name: /画面のKB/ }).check();
  await page.getByRole('button', { name: '選択したスペースを開く' }).click();

  // The window as a new device shows it: the vault and the AI along its foot, nothing else.
  const bar = page.locator('.status-bar');
  const terminalButton = bar.locator('button', { hasText: 'ターミナル' });
  await expect(bar).toContainText('画面のKB');
  await expect(bar).toContainText('AI');
  await expect(bar).not.toContainText('trunk');
  await expect(bar.locator('.status-version')).toHaveCount(0);
  await expect(terminalButton).toHaveCount(0);
  // The vault's home has no terminal button either.
  await expect(page.getByRole('button', { name: 'ターミナル', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'irori agent', exact: true }).click();
  const column = page.locator('.agent-panel');
  const access = column.getByLabel('エージェントのアクセス', { exact: true });
  const model = column.getByLabel('モデル', { exact: true });
  const addColumn = column.getByRole('button', { name: '列を追加', exact: true });
  await expect(column.getByLabel('irori agent への指示')).toBeVisible();
  await expect(column.getByRole('button', { name: '新しい会話', exact: true })).toBeVisible();
  await expect(column.getByRole('button', { name: '履歴', exact: true })).toBeVisible();
  await expect(column.getByRole('button', { name: '送信', exact: true })).toBeVisible();
  for (const hidden of [access, model, addColumn]) await expect(hidden).toHaveCount(0);
  // The CLI's version left the conversation for the settings.
  await expect(column.getByRole('button', { name: '会話と接続', exact: true })).toHaveCount(0);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/irori-window-default.png' });

  // The settings list every item with where it appears; one turned on joins the window at once.
  const settings = page.getByRole('button', { name: /^設定（/ });
  const sheet = page.getByRole('dialog', { name: '設定', exact: true });
  const nav = sheet.getByRole('navigation', { name: '設定の項目' });
  const entry = nav.getByRole('button', { name: '画面に出すもの' });
  const openItems = async () => {
    await settings.click();
    await entry.click();
  };
  const close = async () => {
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  };
  await openItems();
  await expect(entry).toContainText('表示中 1 / 8');
  for (const group of [
    'エージェントへの指示の入力欄',
    '会話の上部',
    'ステータスバー（ウィンドウの下端）',
  ])
    await expect(sheet.getByRole('heading', { name: group, exact: true })).toBeVisible();
  const item = (name: string) => sheet.getByRole('switch', { name, exact: true });
  for (const name of ['アクセス', 'モデルと思考量', '人の行を伝える', '列の操作'])
    await expect(item(name)).not.toBeChecked();
  for (const name of ['ブランチ', 'ターミナル', 'バージョン'])
    await expect(item(name)).not.toBeChecked();
  await expect(item('スキル')).toBeChecked();
  await expect(sheet.getByRole('button', { name: '既定に戻す', exact: true })).toBeDisabled();
  await item('ターミナル').check();
  await expect(entry).toContainText('表示中 2 / 8');
  // The window is behind the sheet, so its button is counted rather than seen.
  await expect(terminalButton).toHaveCount(1);
  await expect.poll(record).toEqual({ terminal: true });
  await item('ターミナル').uncheck();
  await expect(terminalButton).toHaveCount(0);
  await expect.poll(record).toEqual({ terminal: false });
  await page.screenshot({ path: 'test-results/irori-window-items.png' });

  // Everything at once, for a person who wants the whole window back.
  await sheet.getByRole('button', { name: 'すべて出す', exact: true }).click();
  await expect(entry).toContainText('表示中 8 / 8');
  await expect(sheet.getByRole('button', { name: 'すべて出す', exact: true })).toBeDisabled();
  await close();
  await expect(access).toHaveValue('default');
  await expect(model).toBeVisible();
  await expect(addColumn).toBeVisible();
  await expect(bar).toContainText('trunk');
  await expect(bar.locator('.status-version')).toHaveText(/^\d+\.\d+\.\d+/);
  await expect(terminalButton).toBeVisible();
  await page.screenshot({ path: 'test-results/irori-window-all.png' });

  // And back to what a new device shows.
  await openItems();
  await sheet.getByRole('button', { name: '既定に戻す', exact: true }).click();
  await expect(entry).toContainText('表示中 1 / 8');
  await expect(item('スキル')).toBeChecked();
  await close();
  for (const hidden of [access, model, addColumn, terminalButton])
    await expect(hidden).toHaveCount(0);
  await expect(bar).not.toContainText('trunk');
  await expect(bar.locator('.status-version')).toHaveCount(0);

  // What is in use stays in view while its item is off. Full access is chosen in the
  // settings, and the conversation that starts in it says so (ADR 053).
  await settings.click();
  await nav.getByRole('button', { name: '共通' }).click();
  await sheet.getByRole('radio', { name: 'フルアクセス', exact: true }).check();
  // Each CLI is listed here with its version, or as not found on this device.
  await expect(sheet.getByRole('heading', { name: 'この端末の CLI', exact: true })).toBeVisible();
  for (const name of ['Codex', 'Claude Code', 'OpenCode', 'Pi'])
    await expect(sheet.getByText(name, { exact: true })).toBeVisible();
  await expect(sheet.getByText(/^(使えます|未検出)$/)).toHaveCount(agentIds.length);
  await close();
  await expect(access).toHaveValue('full-access');
  await settings.click();
  await sheet.getByRole('radio', { name: '標準（CLI の承認に従う）', exact: true }).check();
  await close();
  await expect(access).toHaveCount(0);

  // The terminal still opens with its shortcut; while open, its button is there to close it.
  await page.keyboard.press('Control+Backquote');
  const panel = page.getByRole('region', { name: '画面のKB のターミナル' });
  await expect(panel.locator('.terminal-state')).toHaveText('実行中');
  await expect(terminalButton).toHaveAttribute('aria-pressed', 'true');
  await terminalButton.click();
  await expect(panel).toHaveCount(0);
  await expect(terminalButton).toHaveCount(0);

  expect(errors).toEqual([]);
  console.log(
    'Window items UI passed: default window, each item from the settings, all at once and back, full access and an open terminal kept in view. No model inference.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
