import { _electron as electron, expect, type Locator, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';
import { SettingsService } from '../src/host/settings';
import { YourAiService } from '../src/host/you';
import { chooseJapanese } from '../tests/fixtures/japanese-interface';

// irori mode's threads (ADR 034): the irori agent's conversations run side by side
// in columns, a closed column's run goes on in a tab, each workspace keeps its own
// threads and columns, a conversation of another workspace is never shown, a
// stopped conversation takes a new instruction after its queued one, and a queued
// instruction sent now joins the running turn (ADR 056), in irori mode and in a
// vault's column. `codex` is a protocol fixture; no model runs.
if (process.platform === 'win32') {
  console.log('irori mode thread UI executable fixtures are POSIX only.');
  process.exit(0);
}
// A Codex app server that answers each turn with the instruction's last line. A turn
// whose instruction says `hold:NAME` waits until a file `release-NAME` is in its folder,
// or until words are steered into it, which it answers and then ends.
const codexFixture = `#!/usr/bin/env node
if (process.argv.includes('--version')) { console.log('codex-cli 0.154.0 fixture'); process.exit(0); }
const fs = require('node:fs');
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
let held;
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (!m.method || m.id === undefined) return;
  if (m.method === 'turn/steer') {
    const steered = m.params.input.map((part) => part.text ?? '').join('\\n');
    fs.appendFileSync('codex-turns.jsonl', JSON.stringify({ steered }) + '\\n');
    send({ id: m.id, result: { turnId: m.params.expectedTurnId } });
    clearInterval(held);
    setTimeout(() => {
      send({ method: 'item/agentMessage/delta', params: { delta: 'steered: ' + steered } });
      send({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
    }, 50);
    return;
  }
  if (m.method === 'turn/start') {
    const text = m.params.input.map((part) => part.text ?? '').join('\\n');
    const said = text.trim().split('\\n').at(-1);
    fs.appendFileSync('codex-turns.jsonl', JSON.stringify({ said }) + '\\n');
    send({ id: m.id, result: { turn: { id: 'fixture-turn' } } });
    const hold = /hold:(\\w+)/.exec(said)?.[1];
    const finish = () => {
      send({ method: 'item/agentMessage/delta', params: { delta: 'reply to ' + said } });
      send({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
    };
    if (!hold) return finish();
    const timer = (held = setInterval(() => {
      if (!fs.existsSync('release-' + hold)) return;
      clearInterval(timer);
      finish();
    }, 100));
    return;
  }
  if (m.method.startsWith('thread/'))
    fs.appendFileSync('codex-turns.jsonl', JSON.stringify({ thread: m.method + ':' + m.params.approvalPolicy }) + '\\n');
  const result = m.method.startsWith('thread/')
    ? { thread: { id: m.params.threadId || 'fixture-thread-' + Date.now() + Math.random() } }
    : {};
  send({ id: m.id, result });
});
`;
const base = await mkdtemp(path.join(tmpdir(), 'irori threads UI '));
const home = path.join(base, 'home');
await mkdir(home);
const files = new FileService(path.join(base, 'device'));
await files.init();
// The vault agent is on for the vault column's part (ADR 021); the irori agent runs on Codex.
await new SettingsService(files.dataDir).save({
  vaultAgent: true,
  yourAi: { agent: 'codex', models: {} },
});
const you = new YourAiService(files.dataDir, home);
await you.create();
const youRoot = (await you.load()).root;
const roots: Record<string, string> = {};
const ids: Record<string, string> = {};
for (const name of ['Alpha', 'Beta']) {
  const root = path.join(base, name);
  await mkdir(path.join(root, 'Knowledge_Base'), { recursive: true });
  await writeFile(path.join(root, 'Knowledge_Base', `${name}.md`), `# ${name}\n`);
  roots[name] = root;
  ids[name] = (await files.register(root, name, 'team')).scopeId;
}
const workspaces = new WorkspaceService(files);
const first = await workspaces.save('First', [ids.Alpha]);
const second = await workspaces.save('Second', [ids.Beta]);
const bin = path.join(base, 'bin');
await mkdir(bin);
await writeFile(path.join(bin, 'codex'), codexFixture, { mode: 0o700 });
await chooseJapanese(files.dataDir);
const env = {
  ...process.env,
  HOME: home,
  PATH: bin + path.delimiter + process.env.PATH,
  IRORI_DATA_DIR: files.dataDir,
} as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [
    ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '.',
  ],
  env,
});
const errors: string[] = [];
await mkdir('test-results', { recursive: true });
/** What the fixture was told, in order, in a folder: turns' last lines, or words steered in. */
const told = async (folder: string, key: 'said' | 'steered' | 'thread') =>
  (await readFile(path.join(folder, 'codex-turns.jsonl'), 'utf8').catch(() => ''))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line)[key] as string | undefined)
    .filter((value) => value !== undefined);
const said = (folder: string) => told(folder, 'said');
const release = (folder: string, name: string) =>
  writeFile(path.join(folder, `release-${name}`), '');
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.setDefaultTimeout(20000);
  const rail = page.getByRole('navigation', { name: 'vault' });
  const open = async (name: string) => {
    await page.locator('.workspace-card').filter({ hasText: name }).click();
    await rail.getByRole('button', { name: 'irori mode', exact: true }).click();
  };
  const goHome = async () => {
    await rail.getByRole('button', { name: 'ワークスペースを選択' }).click();
    await expect(page.locator('.workspace-card').first()).toBeVisible();
  };
  const column = (n: number) =>
    page.getByRole('complementary', {
      name: n === 1 ? 'irori agent' : `irori agent ${n}`,
      exact: true,
    });
  const send = async (panel: Locator, label: string, text: string, button = '送信') => {
    await panel.getByLabel(label).fill(text);
    await panel.getByRole('button', { name: button, exact: true }).click();
  };
  const conversations = (workspaceId: string) =>
    page.evaluate(
      async ([workspace]) => {
        const id = (await window.irori.yourAi()).id;
        return window.irori.agentConversations(id, workspace);
      },
      [workspaceId],
    );
  /** Waits until no conversation of the irori agent in the workspace is running. */
  const settled = (workspaceId: string) =>
    expect
      .poll(async () =>
        (await conversations(workspaceId)).some((row) => 'running' in row && row.running),
      )
      .toBe(false);
  const titled = async (workspaceId: string, title: string) =>
    (await conversations(workspaceId)).find(
      (row) => 'title' in row && row.title.startsWith(title),
    ) as { id: string; running: boolean } | undefined;

  /**
   * Each conversation keeps its own access (ADR 009): full access chosen in one stays
   * through its later sends, a new conversation starts standard, and back on the
   * first it shows and sends with full access, its native session going on.
   */
  const ownAccess = async (panel: Locator, label: string, folder: string, name: string) => {
    const access = panel.getByLabel('エージェントのアクセス', { exact: true });
    const idle = () =>
      expect(panel.getByRole('button', { name: '停止', exact: true })).toHaveCount(0);
    const before = (await told(folder, 'thread')).length;
    await panel.getByRole('button', { name: '新しい会話', exact: true }).click();
    await expect(access).toHaveValue('default');
    await access.selectOption('full-access');
    for (const word of ['full one', 'full two', 'standard one', 'full three']) {
      if (word === 'standard one') {
        await panel.getByRole('button', { name: '新しい会話', exact: true }).click();
        await expect(access).toHaveValue('default');
      }
      if (word === 'full three') {
        await panel
          .getByRole('tablist', { name: '開いている会話' })
          .getByRole('tab', { name: new RegExp(`${name} full one`) })
          .click();
        await expect(access).toHaveValue('full-access');
      }
      await send(panel, label, `${name} ${word}`);
      await expect(panel.getByRole('log')).toContainText(`reply to ${name} ${word}`);
      await idle();
      await expect(access).toHaveValue(word === 'standard one' ? 'default' : 'full-access');
    }
    expect((await told(folder, 'thread')).slice(before)).toEqual([
      'thread/start:never',
      'thread/resume:never',
      'thread/start:on-request',
      'thread/resume:never',
    ]);
  };

  // Two threads of the irori agent run at once, each in its own column.
  await open('First');
  await expect(column(1)).toBeVisible();
  await expect(column(1).getByRole('button', { name: 'この列を閉じる' })).toHaveCount(0);
  await send(column(1), 'irori agent への指示', 'first thread hold:one');
  await expect(column(1).getByRole('button', { name: '停止', exact: true })).toBeVisible();
  const island = page.locator('.overview-ai-pane');
  const narrow = (await island.boundingBox())!.width;
  await column(1).getByRole('button', { name: '列を追加' }).click();
  await expect(column(2)).toBeVisible();
  // The island widens for the new column.
  await expect.poll(async () => (await island.boundingBox())!.width).toBeGreaterThan(narrow + 200);
  await send(column(2), 'irori agent への指示', 'second thread hold:two');
  await expect(column(2).getByRole('button', { name: '停止', exact: true })).toBeVisible();
  await expect(column(1).getByRole('button', { name: '停止', exact: true })).toBeVisible();
  await expect
    .poll(
      async () =>
        (await conversations(first.id)).filter((row) => 'running' in row && row.running).length,
    )
    .toBe(2);
  await page.screenshot({ path: 'test-results/irori-threads.png' });

  // Up to four columns.
  await column(2).getByRole('button', { name: '列を追加' }).click();
  await column(3).getByRole('button', { name: '列を追加' }).click();
  await expect(column(4)).toBeVisible();
  for (const n of [1, 2, 3, 4])
    await expect(column(n).getByRole('button', { name: '列を追加' })).toBeDisabled();
  for (const n of [4, 3]) await column(n).getByRole('button', { name: 'この列を閉じる' }).click();
  await expect(column(3)).toHaveCount(0);

  // Closing a column never stops its run: the conversation comes back as a tab of the
  // first column, still running, and ends when its turn does.
  await column(2).getByRole('button', { name: 'この列を閉じる' }).click();
  await expect(column(2)).toHaveCount(0);
  const tabs = column(1).getByRole('tablist', { name: '開いている会話' });
  await expect(tabs.getByRole('tab', { name: /second thread/ })).toBeVisible();
  expect((await titled(first.id, 'second thread'))?.running).toBe(true);
  await release(youRoot, 'two');
  await expect.poll(async () => (await titled(first.id, 'second thread'))?.running).toBe(false);
  await tabs.getByRole('tab', { name: /second thread/ }).click();
  await expect(column(1).getByRole('log')).toContainText('reply to second thread hold:two');
  await tabs.getByRole('tab', { name: /first thread/ }).click();

  // A stopped thread takes a new instruction: the one queued behind it goes first,
  // then the new one, without resuming by hand.
  await send(column(1), 'irori agent への指示', 'queued follow-up', '送信待ちに追加');
  const queue = column(1).getByLabel('送信待ち', { exact: true });
  await expect(queue).toContainText('queued follow-up');
  await column(1).getByRole('button', { name: '停止', exact: true }).click();
  await expect(queue).toContainText('一時停止中');
  await send(column(1), 'irori agent への指示', 'after the stop', '送信待ちに追加');
  await expect(queue).toHaveCount(0);
  await expect(column(1).getByRole('log')).toContainText('reply to after the stop');
  expect((await said(youRoot)).slice(-2)).toEqual(['queued follow-up', 'after the stop']);

  // A queued instruction sent now joins the turn under way, which goes on with it;
  // the one queued before it still waits, and goes when the turn ends (ADR 056).
  await send(column(1), 'irori agent への指示', 'steered thread hold:steer');
  await expect(column(1).getByRole('button', { name: '停止', exact: true })).toBeVisible();
  await send(column(1), 'irori agent への指示', 'waits behind', '送信待ちに追加');
  await send(column(1), 'irori agent への指示', 'join now', '送信待ちに追加');
  await expect(queue).toContainText('join now');
  await column(1).screenshot({ path: 'test-results/irori-send-now.png' });
  await queue
    .locator('div')
    .filter({ hasText: 'join now' })
    .getByRole('button', { name: /今すぐ送る/ })
    .click();
  await expect(column(1).getByRole('log')).toContainText('steered: join now');
  await expect(column(1).getByRole('log')).toContainText('reply to waits behind');
  await expect(queue).toHaveCount(0);
  expect(await told(youRoot, 'steered')).toEqual(['join now']);
  expect((await said(youRoot)).slice(-2)).toEqual(['steered thread hold:steer', 'waits behind']);

  await ownAccess(column(1), 'irori agent への指示', youRoot, 'irori');
  await tabs.getByRole('tab', { name: /first thread/ }).click();
  await expect(column(1).getByRole('log')).toContainText('after the stop');

  // Each workspace keeps its own threads and columns.
  await column(1).getByRole('button', { name: '列を追加' }).click();
  await expect(column(2)).toBeVisible();
  await settled(first.id);
  await goHome();
  await open('Second');
  await expect(column(1)).toBeVisible();
  await expect(column(2)).toHaveCount(0);
  await expect(column(1).getByRole('log')).not.toContainText('first thread');
  await expect(column(1).getByRole('tablist', { name: '開いている会話' })).toHaveCount(0);
  await send(column(1), 'irori agent への指示', 'second workspace');
  await expect(column(1).getByRole('log')).toContainText('reply to second workspace');
  await settled(second.id);
  await goHome();
  await open('First');
  await expect(column(2)).toBeVisible();
  await expect(column(1).getByRole('log')).toContainText('after the stop');
  await expect(column(1).getByRole('log')).not.toContainText('second workspace');
  await column(1).getByRole('button', { name: '履歴', exact: true }).click();
  const history = column(1).getByRole('region', { name: '履歴' });
  await expect(history).toContainText('first thread');
  await expect(history).not.toContainText('second workspace');
  await column(1).getByRole('button', { name: '履歴', exact: true }).click();
  // The host never shows one workspace's conversation in another, even named.
  const firstThread = (await titled(first.id, 'first thread'))!;
  const refused = await page.evaluate(
    async ([id, workspace]) => {
      const you = (await window.irori.yourAi()).id;
      return window.irori.agentConversation(you, 'codex', id, workspace).then(
        () => '',
        (error: Error) => error.message,
      );
    },
    [firstThread.id, second.id],
  );
  expect(refused).toContain('別のワークスペース');

  // The same in a vault's own column: stopped with an instruction queued, the next
  // send lets both go, in order.
  await rail.getByRole('button', { name: /^Alpha/ }).click();
  const vault = page.getByRole('complementary', { name: 'Alpha agent', exact: true });
  await page.locator('.ai-toggle').click();
  await expect(vault).toBeVisible();
  await vault.getByLabel('エージェント', { exact: true }).selectOption('codex');
  await send(vault, 'エージェントへの指示', 'vault thread hold:vault');
  await expect(vault.getByRole('button', { name: '停止', exact: true })).toBeVisible();
  await send(vault, 'エージェントへの指示', 'vault follow-up', '送信待ちに追加');
  const vaultQueue = vault.getByLabel('送信待ち', { exact: true });
  await expect(vaultQueue).toContainText('vault follow-up');
  await vault.getByRole('button', { name: '停止', exact: true }).click();
  await expect(vaultQueue).toContainText('一時停止中');
  await send(vault, 'エージェントへの指示', 'vault again', '送信待ちに追加');
  await expect(vaultQueue).toHaveCount(0);
  await expect(vault.getByRole('log')).toContainText('reply to vault again');
  expect((await said(roots.Alpha)).slice(-2)).toEqual(['vault follow-up', 'vault again']);
  // The vault agent's running turn takes an instruction sent now as well.
  await send(vault, 'エージェントへの指示', 'vault steered hold:vaultsteer');
  await expect(vault.getByRole('button', { name: '停止', exact: true })).toBeVisible();
  await send(vault, 'エージェントへの指示', 'vault join now', '送信待ちに追加');
  await expect(vaultQueue).toContainText('vault join now');
  await vaultQueue.getByRole('button', { name: /今すぐ送る/ }).click();
  await expect(vaultQueue).toHaveCount(0);
  await expect(vault.getByRole('log')).toContainText('steered: vault join now');
  expect(await told(roots.Alpha, 'steered')).toEqual(['vault join now']);
  await expect(vault.getByRole('button', { name: '停止', exact: true })).toHaveCount(0);
  await ownAccess(vault, 'エージェントへの指示', roots.Alpha, 'vault');
  // The settings choose the access every agent's new conversation starts in; one a
  // conversation already has stays (ADR 009).
  const chooseAccess = async (name: RegExp) => {
    await page.getByRole('button', { name: /^設定（/ }).click();
    const sheet = page.getByRole('dialog');
    await sheet
      .getByRole('group', { name: '新しい会話のアクセス' })
      .getByRole('radio', { name })
      .check();
    await expect(sheet).toContainText(
      name.test('フルアクセス') ? 'すべてフルアクセスで始まります' : '新しい会話は標準で始まり',
    );
    if (name.test('フルアクセス'))
      await page.screenshot({ path: 'test-results/settings-access.png' });
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  };
  const vaultAccess = vault.getByLabel('エージェントのアクセス', { exact: true });
  await expect(vaultAccess).toHaveValue('full-access');
  await chooseAccess(/^フルアクセス$/);
  await vault.getByRole('button', { name: '新しい会話', exact: true }).click();
  await expect(vaultAccess).toHaveValue('full-access');
  await send(vault, 'エージェントへの指示', 'vault from settings');
  await expect(vault.getByRole('log')).toContainText('reply to vault from settings');
  await expect(vault.getByRole('button', { name: '停止', exact: true })).toHaveCount(0);
  expect((await told(roots.Alpha, 'thread')).at(-1)).toBe('thread/start:never');
  // A conversation that ran in standard keeps it.
  await vault
    .getByRole('tablist', { name: '開いている会話' })
    .getByRole('tab', { name: /vault standard one/ })
    .click();
  await expect(vaultAccess).toHaveValue('default');
  await chooseAccess(/^標準/);
  await vault.getByRole('button', { name: '新しい会話', exact: true }).click();
  await expect(vaultAccess).toHaveValue('default');
  await expect
    .poll(async () =>
      (await page.evaluate(([id]) => window.irori.agentConversations(id), [ids.Alpha])).some(
        (row) => 'running' in row && row.running,
      ),
    )
    .toBe(false);

  expect(errors).toEqual([]);
  console.log(
    'irori mode threads UI passed: two irori agent threads running at once in columns, at most four columns, a closed column’s run kept as a tab, a stopped thread taking a new send after its queued one and a queued instruction sent now joining the running turn, and each conversation keeping its own access with the settings choosing where new ones start, in irori mode and in a vault column, and threads, columns and history kept per workspace with another workspace’s conversation refused. Protocol fixtures only.',
  );
} finally {
  // A turn still held would keep its run, and the app, open.
  for (const [folder, name] of [
    [youRoot, 'one'],
    [youRoot, 'two'],
    [youRoot, 'steer'],
    [roots.Alpha, 'vault'],
    [roots.Alpha, 'vaultsteer'],
  ])
    await release(folder, name);
  await app.close();
}
