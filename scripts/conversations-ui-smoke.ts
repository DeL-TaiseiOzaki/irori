import { _electron as electron, expect, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileService } from '../src/host/files';
import { sessionKey } from '../src/agents/sessions';
import { jsonLine, storedLine } from '../src/agents/conversations';
import { SettingsService } from '../src/host/settings';

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
// This suite exercises the hibachi agent, which is off until turned on (ADR 021).
await new SettingsService(files.dataDir).save({ hibachiAgent: true });
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
// A conversation of 399 events, one short of the window a column keeps: the next
// run's events push the oldest out, and the log must keep its nodes meanwhile. Its
// first run took eight steps, so the window reaches into that group of steps.
const longId = randomUUID();
const longAt = '2025-01-01T00:00:00.000Z';
await mkdir(path.join(files.dataDir, 'conversations', longId), { recursive: true });
await writeFile(
  path.join(files.dataDir, 'conversations', longId, 'meta.json'),
  JSON.stringify({
    schemaVersion: 1,
    id: longId,
    owner: { kind: 'hibachi', id: space.scopeId, name: '会話検証' },
    agent: 'pi',
    model: null,
    title: '長い会話',
    titleSource: 'first-message',
    createdAt: longAt,
    updatedAt: longAt,
    linkedNote: null,
    hibachis: [],
    pinned: false,
    archived: false,
    forkedFrom: null,
    native: {},
  }),
);
await writeFile(
  path.join(files.dataDir, 'conversations', longId, 'events.jsonl'),
  Array.from({ length: 98 }, (_, n) => {
    const run = randomUUID();
    const lines = [
      { runId: run, role: 'user' as const, type: 'status' as const, text: `長い会話 ${n + 1}` },
      ...Array.from({ length: n === 0 ? 8 : 1 }, (_, step) => ({
        runId: run,
        type: 'tool' as const,
        text: '読む',
        details: JSON.stringify({ path: `note-${step}.md` }),
        call: `call-${n}-${step}`,
      })),
      { runId: run, type: 'text' as const, text: `返事 ${n + 1}` },
      { runId: run, type: 'done' as const, text: '完了', outcome: 'completed' as const },
    ];
    return lines.map((line) => jsonLine(storedLine(line, longAt))).join('');
  }).join(''),
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
  // The row's own menu: another row's may still be closing.
  await page
    .getByRole('menu', { name: `${title} の操作` })
    .getByRole('menuitem', { name: action, exact: true })
    .click();
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
  await send(page, '最初の話題\nrun: sleep 6');
  await expect(panel(page).locator('.message.user')).toHaveText(['最初の話題\nrun: sleep 6']);
  await expect(panel(page).getByRole('button', { name: '停止', exact: true })).toBeVisible();
  // Another conversation of the same hibachi runs beside that run, in a tab of its own (ADR 020).
  await panel(page).getByRole('button', { name: '新しい会話', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: '停止', exact: true })).toHaveCount(0);
  const tabs = panel(page).getByRole('tablist', { name: '開いている会話' });
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  const first = tabs.getByRole('tab', { name: /最初の話題/ });
  await expect(first.getByRole('img', { name: '実行中' })).toHaveCount(1);
  // A running conversation keeps its tab.
  await expect(tabs.getByRole('button', { name: '最初の話題 のタブを閉じる' })).toHaveCount(0);
  await send(page, '二つ目の話題');
  await expect(panel(page).locator('.message.user')).toHaveText(['二つ目の話題']);
  await expect(panel(page).locator('.message.done')).toHaveCount(1);
  await expect(panel(page).getByLabel('送信待ち', { exact: true })).toHaveCount(0);
  await expect(first.getByRole('img', { name: '実行中' })).toHaveCount(1);
  await page.screenshot({ path: 'test-results/irori-parallel-conversations.png' });
  await first.click();
  await expect(panel(page).locator('.message.user')).toHaveText(['最初の話題\nrun: sleep 6']);
  await expect(panel(page).getByRole('button', { name: '停止', exact: true })).toBeVisible();
  await expect(panel(page).locator('.message.done')).toHaveCount(1, { timeout: 30000 });
  await expect(first.getByRole('img')).toHaveCount(0);
  await tabs.getByRole('button', { name: '以前の会話 のタブを閉じる' }).click();
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await tabs.getByRole('tab', { name: '二つ目の話題' }).click();
  await expect(panel(page).locator('.message.user')).toHaveText(['二つ目の話題']);

  await panel(page).getByRole('button', { name: '履歴', exact: true }).click();
  await expect(history(page).locator('.history-row')).toHaveCount(4);
  await expect(history(page).locator('.history-title')).toHaveText([
    '最初の話題',
    '二つ目の話題',
    '以前の会話',
    '長い会話',
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
  await expect(panel(page).locator('.message.user')).toHaveText(['最初の話題\nrun: sleep 6']);
  await page.screenshot({ path: 'test-results/irori-conversations.png' });
  expect((await readdir(path.join(files.dataDir, 'conversations'))).length).toBe(3);

  // The long conversation: its log keeps its nodes, and the details the person
  // opened, while a new run's events push the oldest out of the window.
  await panel(page).getByRole('button', { name: '履歴', exact: true }).click();
  await row(page, '長い会話').locator('.history-open').click();
  await expect(history(page)).toHaveCount(0);
  await expect(panel(page).locator('.message.user')).toHaveCount(98);
  await expect(panel(page).locator('.message.user').first()).toHaveText('長い会話 1');
  const steps = panel(page).locator('details.step');
  await expect(steps).toHaveCount(105);
  // The last step of the first run's group: its first steps leave with the window.
  await steps.nth(7).locator('summary').click();
  await expect(steps.nth(7)).toHaveJSProperty('open', true);
  const keptMessage = (await panel(page).locator('.message.user').nth(1).elementHandle())!;
  const openedStep = (await steps.nth(7).elementHandle())!;
  await send(page, '窓を滑らせる');
  await expect(panel(page).locator('.message.user').last()).toHaveText('窓を滑らせる');
  await expect(panel(page).locator('.message.text').last()).toContainText('の応答');
  await expect(panel(page).getByText(/以前の \d+ 件を省略/)).toBeVisible();
  await expect(panel(page).locator('.message.user').first()).toHaveText('長い会話 2');
  // The window reached into the first group of steps, which kept its later steps.
  await expect(steps.first()).not.toContainText('note-0.md');
  await expect(steps.first()).toContainText('note-');
  expect(await keptMessage.evaluate((element) => element.isConnected)).toBe(true);
  expect(
    await openedStep.evaluate(
      (element) => element.isConnected && (element as HTMLDetailsElement).open,
    ),
  ).toBe(true);

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
    '長い会話',
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
        'parallel conversations in tabs',
        'rename',
        'pin',
        'archive',
        'delete',
      ],
      restart: 'kept',
      longLog: 'nodes kept while the window slides',
      iroriAgent: 'separate history',
    }),
  );
} finally {
  await app.close();
}
