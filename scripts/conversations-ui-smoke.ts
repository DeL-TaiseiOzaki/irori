import { _electron as electron, expect, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileService } from '../src/host/files';
import { sessionKey } from '../src/agents/sessions';

// A hibachi's conversations (ADR 017 stage 1): a record from before is migrated,
// new conversations are listed, renamed, pinned, archived and deleted, a send in
// one conversation waits behind another's run, and the irori agent's history is
// its own. `pi` is a protocol fixture; no model runs.
if (process.platform === 'win32') {
  console.log('Conversation UI executable fixtures are POSIX only.');
  process.exit(0);
}
const base = await mkdtemp(path.join(tmpdir(), 'irori conversations UI '));
const home = path.join(base, 'home');
await mkdir(home);
const files = new FileService(path.join(base, 'device'));
await files.init();
const root = path.join(base, 'KB');
await mkdir(root);
await writeFile(path.join(root, 'note.md'), '# Conversation fixture\n');
const space = await files.register(root, '会話検証', 'personal');
// What 0.1.56 kept for this hibachi's Pi conversation.
const binding = { scopeId: space.scopeId, agent: 'pi' as const, root: space.root };
const runId = randomUUID();
await mkdir(path.join(files.dataDir, 'agent-conversations'), { recursive: true });
await writeFile(
  path.join(files.dataDir, 'agent-conversations', `${sessionKey(binding)}.json`),
  JSON.stringify({
    schemaVersion: 1,
    ...binding,
    events: [
      { runId, role: 'user', type: 'status', text: '以前に聞いたこと' },
      { runId, type: 'text', text: '以前の返事' },
      { runId, type: 'done', text: '完了', outcome: 'completed' },
    ],
    queued: [],
    truncated: false,
  }),
);
const bin = path.join(base, 'bin');
await mkdir(bin);
await writeFile(
  path.join(bin, 'pi'),
  `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/harnesses.mjs')).href)}).then(m=>m.run('pi'));\n`,
  { mode: 0o700 },
);
const env = {
  ...process.env,
  HOME: home,
  PATH: bin + path.delimiter + process.env.PATH,
  IRORI_DATA_DIR: files.dataDir,
} as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const launch = () =>
  electron.launch({
    args: [
      ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      '.',
    ],
    env,
  });
const errors: string[] = [];
await mkdir('test-results', { recursive: true });
const panel = (page: Page) =>
  page.getByRole('complementary', { name: '会話検証 の hibachi agent' });
const history = (page: Page) => panel(page).getByRole('region', { name: '履歴' });
const row = (page: Page, title: string) =>
  history(page).locator('.history-row').filter({ hasText: title });
async function act(page: Page, title: string, action: string) {
  await row(page, title)
    .getByRole('button', { name: `${title} の操作` })
    .click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}
async function send(page: Page, text: string, label = '送信') {
  await panel(page).getByLabel('エージェントへの指示').fill(text);
  await panel(page).getByRole('button', { name: label, exact: true }).click();
}
let app = await launch();
try {
  let page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.setDefaultTimeout(20000);
  await page.getByRole('checkbox', { name: /会話検証/ }).check();
  await page.getByRole('button', { name: '選択したスペースを開く' }).click();
  await page.getByRole('button', { name: 'hibachi agent', exact: true }).click();

  // The record from before is one conversation, titled 以前の会話, with its events.
  await panel(page).getByRole('button', { name: '履歴', exact: true }).click();
  await expect(row(page, '以前の会話')).toHaveCount(1);
  await expect(row(page, '以前の会話')).toContainText('Pi');
  await row(page, '以前の会話').locator('.history-open').click();
  await expect(history(page)).toHaveCount(0);
  await expect(panel(page).getByLabel('エージェント', { exact: true })).toHaveValue('pi');
  await expect(panel(page).locator('.message.user')).toHaveText(['以前に聞いたこと']);

  // A new conversation starts empty on the same CLI; its first line is its title.
  await panel(page).getByRole('button', { name: '新しい会話', exact: true }).click();
  await expect(panel(page).locator('.message')).toHaveCount(0);
  await expect(panel(page).getByLabel('エージェント', { exact: true })).toHaveValue('pi');
  await send(page, '最初の話題\nrun: sleep 4');
  await expect(panel(page).locator('.message.user')).toHaveText(['最初の話題\nrun: sleep 4']);
  await expect(panel(page).getByRole('button', { name: '停止', exact: true })).toBeVisible();
  // Another conversation of the same hibachi waits behind that run (ADR 017 D4).
  await panel(page).getByRole('button', { name: '新しい会話', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: '停止', exact: true })).toHaveCount(0);
  await send(page, '二つ目の話題', '送信待ちに追加');
  await expect(panel(page).getByLabel('送信待ち', { exact: true })).toContainText('二つ目の話題');
  await expect(panel(page).locator('.message.user')).toHaveText(['二つ目の話題'], {
    timeout: 30000,
  });
  await expect(panel(page).locator('.message.done')).toHaveCount(1);
  await expect(panel(page).getByLabel('送信待ち', { exact: true })).toHaveCount(0);

  await panel(page).getByRole('button', { name: '履歴', exact: true }).click();
  await expect(history(page).locator('.history-row')).toHaveCount(3);
  await expect(history(page).locator('.history-title')).toHaveText([
    '二つ目の話題',
    '最初の話題',
    '以前の会話',
  ]);
  await expect(row(page, '二つ目の話題')).toHaveAttribute('aria-current', 'true');
  // Rename, pin and archive.
  await act(page, '最初の話題', '名前を変更');
  await history(page).getByLabel('会話の名前', { exact: true }).fill('名前を変えた話題');
  await history(page).getByLabel('会話の名前', { exact: true }).press('Enter');
  await expect(row(page, '名前を変えた話題')).toHaveCount(1);
  await act(page, '以前の会話', 'ピン留め');
  await expect(history(page).locator('h3').first()).toHaveText('ピン留め');
  await expect(history(page).locator('.history-title').first()).toHaveText('以前の会話');
  await act(page, '以前の会話', 'アーカイブ');
  await expect(history(page).locator('details summary')).toHaveText('アーカイブ 1');
  await page.screenshot({ path: 'test-results/irori-conversation-history.png' });
  // Deleting the conversation on show: the hibachi shows its latest other one.
  await act(page, '二つ目の話題', '削除');
  await expect(history(page).getByRole('group', { name: '削除の確認' })).toContainText(
    'CLI 側の履歴は残ります',
  );
  await history(page).getByRole('button', { name: '削除する', exact: true }).click();
  await expect(row(page, '二つ目の話題')).toHaveCount(0);
  await panel(page).getByRole('button', { name: '履歴', exact: true }).click();
  await expect(panel(page).locator('.message.user')).toHaveText(['最初の話題\nrun: sleep 4']);
  await page.screenshot({ path: 'test-results/irori-conversations.png' });
  expect((await readdir(path.join(files.dataDir, 'conversations'))).length).toBe(2);

  // Restarted, the conversations and their names are kept.
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.setDefaultTimeout(20000);
  await page.locator('.workspace-card').filter({ hasText: 'マイワークスペース' }).click();
  await page.getByRole('button', { name: 'hibachi agent', exact: true }).click();
  await panel(page).getByRole('button', { name: '履歴', exact: true }).click();
  await expect(history(page).locator('.history-title')).toHaveText([
    '名前を変えた話題',
    '以前の会話',
  ]);
  await expect(history(page).locator('details summary')).toHaveText('アーカイブ 1');

  // The irori agent's history is its own: none of the hibachi's conversations.
  const rail = page.getByRole('navigation', { name: 'hibachi' });
  await rail.getByRole('button', { name: 'irori mode', exact: true }).click();
  const island = page.getByRole('complementary', { name: 'irori agent' });
  await island.getByRole('button', { name: 'irori agent を用意する' }).click();
  await expect(island.getByRole('button', { name: '新しい会話', exact: true })).toBeVisible();
  await island.getByRole('button', { name: '履歴', exact: true }).click();
  await expect(island.getByRole('region', { name: '履歴' })).toContainText(
    '会話はまだありません。',
  );
  await expect(island.locator('.history-row')).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      migrated: 'one conversation from agent-conversations',
      listed: [
        'new conversation',
        'queued behind another run',
        'rename',
        'pin',
        'archive',
        'delete',
      ],
      restart: 'kept',
      iroriAgent: 'separate history',
    }),
  );
} finally {
  await app.close();
}
