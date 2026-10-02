import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';
import { SettingsService } from '../src/host/settings';

// Your AI in the Overview: set up its folder, hand work to a brain's sub-agent,
// answer the sub-agent's request, read its report, keep your AI out of the
// brains, hold the brains while it works, and have it write the definitions.
// `claude` is a protocol fixture; no model runs.
if (process.platform === 'win32') {
  console.log('Your-AI UI executable fixtures are POSIX only.');
  process.exit(0);
}
const base = await mkdtemp(path.join(tmpdir(), 'irori your AI UI '));
const home = path.join(base, 'home');
await mkdir(home);
const files = new FileService(path.join(base, 'device'));
await files.init();
// This suite exercises the hibachi agent, which is off until turned on (ADR 021).
await new SettingsService(files.dataDir).save({ hibachiAgent: true });
const roots: string[] = [];
for (const name of ['Product', 'Research']) {
  const root = path.join(base, name);
  await mkdir(path.join(root, 'Knowledge_Base'), { recursive: true });
  await writeFile(path.join(root, 'Knowledge_Base', `${name} note.md`), `# ${name}\n`);
  await writeFile(path.join(root, 'AGENTS.md'), `# ${name} agents\n`);
  roots.push(root);
}
const product = await files.register(roots[0], 'Product', 'team');
const research = await files.register(roots[1], 'Research', 'personal');
await new WorkspaceService(files).save('Lab', [product.scopeId, research.scopeId]);
const bin = path.join(base, 'bin');
await mkdir(bin);
await writeFile(
  path.join(bin, 'claude'),
  `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/claude-your-ai.mjs')).href)}).then(m=>m.run());\n`,
  { mode: 0o700 },
);
// Your AI on another CLI: Pi's protocol fixture.
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
const app = await electron.launch({
  args: [
    ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '.',
  ],
  env,
});
const you = path.join(home, 'irori', 'you');
const errors: string[] = [];
await mkdir('test-results', { recursive: true });
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.setDefaultTimeout(20000);
  const fixtureLog = async () =>
    (await readFile(path.join(you, 'your-ai-fixture.jsonl'), 'utf8').catch(() => ''))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  await page.locator('.workspace-card').filter({ hasText: 'Lab' }).click();
  const rail = page.getByRole('navigation', { name: 'hibachi' });
  await rail.getByRole('button', { name: 'irori mode', exact: true }).click();

  // Your AI is set up from the Overview; its starter never overwrites anything.
  const island = page.getByRole('complementary', { name: 'irori agent' });
  await expect(island).toContainText(you);
  await island.getByRole('button', { name: 'irori agent を用意する' }).click();
  const composer = island.getByLabel('irori agent への指示');
  await expect(composer).toBeVisible();
  expect(await readFile(path.join(you, 'AGENTS.md'), 'utf8')).toContain('# irori agent');
  await expect(stat(path.join(you, '.agents'))).rejects.toThrow();
  const map = page.getByRole('region', { name: 'hibachi の地図' });
  await expect(map.getByRole('button', { name: 'irori agent の Schema を開く' })).toBeVisible();

  // Before any hand-off the Your AI screen says irori writes the definitions;
  // one the person already wrote is kept as it is.
  await writeFile(
    path.join(you, '.claude', 'agents', 'hibachi-research.md'),
    '---\nname: hibachi-research\ndescription: Edited by the person.\n---\nMine.\n',
  );
  await map.getByRole('button', { name: 'irori agent の Schema を開く' }).click();
  const definitions = page.getByRole('region', { name: 'hibachi agent' });
  await expect(
    definitions.getByRole('button', { name: /^Product の hibachi agent/ }),
  ).toContainText('未作成');
  await expect(
    definitions.getByRole('button', { name: /^Research の hibachi agent/ }),
  ).toContainText('定義済み');
  await expect(definitions.getByRole('button', { name: /定義を更新させる/ })).toHaveCount(0);
  // Its Schema is edited as settings, the same as a hibachi's: the instructions
  // open first, and a rule and a skill are added in its own folder.
  const youPanel = page.getByRole('region', { name: 'irori agent のフォルダ' });
  const youGroup = (name: string) =>
    youPanel.getByRole('group', { name: `Schema の${name}`, exact: true });
  const settings = page.getByRole('region', { name: 'Schema の設定' });
  await expect(settings.getByRole('textbox', { name: '指示', exact: true })).toHaveValue(
    /^# irori agent\n/,
  );
  await youGroup('ルール').getByRole('button', { name: 'ルールを追加', exact: true }).click();
  await settings.getByRole('textbox', { name: 'ファイル名', exact: true }).fill('tone');
  await settings
    .getByRole('textbox', { name: 'ルール', exact: true })
    .fill('Report in Japanese.\n');
  await settings.getByRole('button', { name: '作成', exact: true }).click();
  await expect(youGroup('ルール').getByRole('button', { name: 'tone.md' })).toBeVisible();
  expect(await readFile(path.join(you, '.claude', 'rules', 'tone.md'), 'utf8')).toBe(
    'Report in Japanese.\n',
  );
  await youGroup('スキル').getByRole('button', { name: 'スキルを追加', exact: true }).click();
  await settings.getByRole('textbox', { name: '名前', exact: true }).fill('weekly');
  await settings.getByRole('textbox', { name: '説明', exact: true }).fill('Plans the week.');
  await settings.getByRole('textbox', { name: '手順', exact: true }).fill('Ask each hibachi.');
  await settings.getByRole('button', { name: '作成', exact: true }).click();
  await expect(youGroup('スキル').getByRole('button', { name: 'weekly' })).toBeVisible();
  expect(await readFile(path.join(you, '.agents', 'skills', 'weekly', 'SKILL.md'), 'utf8')).toBe(
    '---\nname: weekly\ndescription: Plans the week.\n---\n\nAsk each hibachi.\n',
  );
  // The folder as files, read-only, still shows the definitions.
  await youPanel.getByRole('button', { name: 'ファイルとして表示', exact: true }).click();
  await youPanel.getByRole('button', { name: 'hibachi-research.md' }).click();
  await expect(page.getByRole('region', { name: 'ファイルの内容' })).toContainText(
    'Edited by the person.',
  );
  await youPanel.getByRole('button', { name: 'ファイルとして表示', exact: true }).click();
  await page.getByRole('button', { name: 'irori mode に戻る' }).click();

  // The irori agent starts in full access like a hibachi agent. This part is
  // about requests, so it runs in the standard mode, chosen in the composer.
  const access = island.getByLabel('irori agent のアクセス', { exact: true });
  await expect(access).toHaveValue('full-access');
  await access.selectOption('default');
  // A request goes to your AI with the workspace's brains; it hands a note to
  // Product's sub-agent, whose write asks the person here.
  await composer.fill('Write a decision note.');
  await island.getByRole('button', { name: '送信', exact: true }).click();
  const request = island.getByRole('group', { name: '許可の要求' });
  await expect(request).toContainText('Product の hibachi agent から');
  await expect(island.getByRole('list', { name: 'hibachi への依頼' })).toContainText(
    'Write a note in Product',
  );
  await expect(island.getByRole('list', { name: 'hibachi への依頼' })).toContainText('許可待ち');
  // The map draws the hand-off, and the brains are held while your AI works.
  await expect(map.locator('.map-pill.hand-off')).toContainText('Write a note in Product');
  await expect(map.getByRole('button', { name: 'Product を開く' })).toHaveClass(/handed/);
  // Its Schema waits while it runs, as a hibachi's does during its run.
  await map.getByRole('button', { name: 'irori agent の Schema を開く' }).click();
  await expect(page.getByRole('region', { name: 'Schema の設定' })).toContainText(
    'irori agent の実行中は変更できません。',
  );
  await expect(youPanel.getByRole('button', { name: 'ルールを追加', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'irori mode に戻る' }).click();
  await page.screenshot({ path: 'test-results/irori-your-ai.png' });
  await rail.getByRole('button', { name: /^Research・AI/ }).click();
  await expect(page.locator('.brain-names strong')).toHaveText('Research');
  await page
    .getByTestId('stage')
    .getByRole('button', { name: 'hibachi agent', exact: true })
    .click();
  // The person's own conversation in a handed hibachi is not held (ADR 020).
  await expect(page.getByRole('textbox', { name: 'エージェントへの指示' })).toBeEnabled();
  await rail.getByRole('button', { name: 'irori mode', exact: true }).click();

  // Allowed here, the sub-agent writes in its brain and reports.
  await request.getByRole('button', { name: '今回のみ許可' }).click();
  await expect(island.locator('.message.report')).toContainText(
    'Wrote Knowledge_Base/from-your-ai.md.',
  );
  await expect(island).toContainText("Handed the note to Product's hibachi agent.");
  await expect(island.getByRole('list', { name: 'hibachi への依頼' })).toContainText('完了');
  expect(await readFile(path.join(roots[0], 'Knowledge_Base', 'from-your-ai.md'), 'utf8')).toBe(
    '# From your AI\n',
  );
  await expect(map.locator('.map-pill.hand-off')).toHaveCount(0);

  // Your AI's own write in a brain is refused, and a background hand-off runs
  // in the foreground so its request can reach the person.
  await composer.fill('Try a direct write, then hand it over in the background.');
  await island.getByRole('button', { name: '送信', exact: true }).click();
  await island
    .getByRole('group', { name: '許可の要求' })
    .getByRole('button', { name: '今回のみ許可' })
    .click();
  await expect
    .poll(async () => (await fixtureLog()).filter((entry) => 'written' in entry).length)
    .toBe(2);
  const log = await fixtureLog();
  expect(log.some((entry) => entry.direct === 'denied')).toBe(true);
  expect(log.filter((entry) => 'background' in entry).map((entry) => entry.background)).toEqual([
    false,
    false,
  ]);
  await expect(readFile(path.join(roots[0], 'direct.md'))).rejects.toThrow();

  // The Your AI screen: its folder read-only, and each hibachi's sub-agent.
  // irori wrote the missing definition when it handed Product over, and left
  // the person's own one alone.
  expect(log[0].loaded.sort()).toEqual(['hibachi-product', 'hibachi-research']);
  expect(
    await readFile(path.join(you, '.claude', 'agents', 'hibachi-product.md'), 'utf8'),
  ).toContain('name: hibachi-product');
  expect(
    await readFile(path.join(you, '.claude', 'agents', 'hibachi-research.md'), 'utf8'),
  ).toContain('Edited by the person.');
  await map.getByRole('button', { name: 'irori agent の Schema を開く' }).click();
  await expect(
    page
      .getByRole('region', { name: 'Schema の設定' })
      .getByRole('textbox', { name: '指示', exact: true }),
  ).toHaveValue(/^# irori agent\n/);
  await expect(
    definitions.getByRole('button', { name: /^Product の hibachi agent/ }),
  ).toContainText('定義済み');
  await definitions.getByRole('button', { name: /^Product の hibachi agent/ }).click();
  await expect(definitions.locator('.you-definition')).toContainText('name: hibachi-product');
  await page.screenshot({ path: 'test-results/irori-your-ai-screen.png' });
  await page.getByRole('button', { name: 'irori mode に戻る' }).click();
  await expect(map).toBeVisible();

  // Your AI on another CLI, with a model from that CLI's list: Pi loads no
  // sub-agents, so it hands a brain to its hibachi agent with the `hibachi`
  // command irori puts on its PATH (irori's own runtime run as Node). The
  // hibachi agent runs in that brain, and its report comes back. The choice is kept.
  const cli = island.getByLabel('irori agent の CLI', { exact: true });
  await expect(cli).toHaveValue('claude');
  await cli.selectOption('pi');
  await expect(island.getByRole('button', { name: 'Pi · あなたの Schema' })).toBeVisible();
  await island.getByLabel('モデル', { exact: true }).selectOption('anthropic/claude-fixture');
  await composer.fill('Tidy both brains.\nrun: hibachi Product "Tidy the Product notes."');
  await island.getByRole('button', { name: '送信', exact: true }).click();
  const piLog = async () =>
    (await readFile(path.join(you, 'fixture-requests.jsonl'), 'utf8').catch(() => ''))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  await expect
    .poll(async () => (await piLog()).filter((entry) => entry.type === 'prompt').length)
    .toBe(1);
  await expect(island).toContainText('の応答');
  await expect(island.getByRole('list', { name: 'hibachi への依頼' })).toContainText(
    'Tidy the Product notes.',
  );
  await expect(island.getByRole('list', { name: 'hibachi への依頼' })).toContainText('完了');
  const sent = (await piLog()).find((entry) => entry.type === 'prompt').message as string;
  expect(sent).toContain(`folder ${JSON.stringify(roots[0])}, hibachi agent "hibachi-product"`);
  expect(sent).toContain('You run on Pi');
  expect(sent).toContain('with the `hibachi` command in your shell');
  expect(sent).not.toContain('AGENTS.md');
  expect(sent.endsWith('run: hibachi Product "Tidy the Product notes."')).toBe(true);
  const command = (await piLog()).find((entry) => entry.type === 'command');
  expect(command).toMatchObject({ code: 0, stdout: '日本語\u2028の応答\n' });
  // The hand-off is Product's own run, kept in a Product conversation of its own
  // for this irori agent conversation, titled with the task (ADR 017).
  const productRun = await page.evaluate(async (scopeId) => {
    const rows = await window.irori.agentConversations(scopeId);
    const handed = rows.find((row) => 'origin' in row && row.origin === 'hand-off');
    return handed && 'title' in handed
      ? { title: handed.title, ...(await window.irori.agentConversation(scopeId, 'pi', handed.id)) }
      : undefined;
  }, product.scopeId);
  expect(productRun?.title).toBe('Tidy the Product notes.');
  if (!productRun) throw Error('The hand-off has no conversation');
  expect(
    productRun.events.some(
      (event) => event.role === 'user' && event.text.endsWith('Tidy the Product notes.'),
    ),
  ).toBe(true);
  expect(productRun.events.at(-1)).toMatchObject({ type: 'done', outcome: 'completed' });
  expect((await piLog()).find((entry) => entry.type === 'launch').args.slice(2, 6)).toEqual([
    '--provider',
    'anthropic',
    '--model',
    'claude-fixture',
  ]);
  expect((await page.evaluate(() => window.irori.deviceSettings())).yourAi).toEqual({
    agent: 'pi',
    models: { pi: 'anthropic/claude-fixture' },
  });
  await map.getByRole('button', { name: 'irori agent の Schema を開く' }).click();
  await expect(page.locator('.you-chip')).toHaveText('Pi');
  await page.getByRole('button', { name: 'irori mode に戻る' }).click();
  expect(errors).toEqual([]);
  console.log(
    'Your-AI UI passed: setup from the Overview, a hand-off to a brain sub-agent with its request answered and its report, the map’s hand-off line, brains held while your AI works, your AI kept out of the brains, hand-offs in the foreground, definitions irori writes when absent, kept when edited, and shown on the Your AI screen, the irori agent’s Schema settings (instructions, a rule, a skill, locked while it runs) and its files, and your AI on Pi with a listed model handing a brain to its hibachi agent with the hibachi command. Protocol fixtures only.',
  );
} finally {
  const [first] = app.windows();
  await first?.evaluate(() => window.irori.cancel()).catch(() => {});
  await app.close();
  await rm(base, { recursive: true, force: true });
}
