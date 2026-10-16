import { _electron as electron, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';
import { YourAiService } from '../src/host/you';
import { SettingsService } from '../src/host/settings';
import { chooseJapanese } from '../tests/fixtures/japanese-interface';

// Routines from their own rail entry (ADR 016): navigation, a routine made
// from the page's form and edited there as a form and as text, the request to the irori agent,
// JavaScript in the settings, the review before the first run and after a
// change, JavaScript added from the row, Python offered without downloading it, a run's steps, output and changed
// files, the nothing-to-do gate, 停止, an agent step's request answered in its
// step, and its conversation. A secret is entered from its row, hidden in the
// output, written back and deleted; the display has no keychain, so the app
// runs with its reversible test store. `pi` is a protocol fixture; no model runs.
if (process.platform === 'win32') {
  console.log('Routines UI executable fixtures are POSIX only.');
  process.exit(0);
}
const base = await mkdtemp(path.join(tmpdir(), 'irori routines UI '));
const home = path.join(base, 'home');
await mkdir(home);
const files = new FileService(path.join(base, 'device'));
await files.init();
// This suite exercises the vault agent, which is off until turned on (ADR 021).
await new SettingsService(files.dataDir).save({ vaultAgent: true });
const root = path.join(base, 'Product');
await mkdir(path.join(root, 'Knowledge_Base'), { recursive: true });
await writeFile(path.join(root, 'Knowledge_Base', 'Product note.md'), '# Product\n');
const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], {
    cwd: root,
    stdio: 'pipe',
  });
git('init', '-q', '-b', 'main');
git('add', '.');
git('commit', '-q', '-m', 'Start');
const product = await files.register(root, 'Product', 'team');
await new WorkspaceService(files).save('Lab', [product.scopeId]);
await new WorkspaceService(files).save('Empty', []);
const you = new YourAiService(files.dataDir, home);
await you.create();
const youRoot = (await you.load()).root;
const routine = async (dir: string, contents: Record<string, string>) => {
  for (const [rel, text] of Object.entries(contents)) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), text);
  }
};
const routines = path.join(root, '.irori', 'routines');
const fetchJs = `const fs = require('node:fs');
fs.writeFileSync(require('node:path').join(process.env.IRORI_WORK, 'items.txt'), 'first\\nsecond\\n');
console.log('fetched 2');
`;
await routine(path.join(routines, 'collect'), {
  'routine.yaml': 'name: Collect\nsteps:\n  - run: fetch.js\n  - run: place.js\n',
  'fetch.js': fetchJs,
  'place.js': `const fs = require('node:fs');\nfs.mkdirSync('inbox', { recursive: true });\nfs.writeFileSync('inbox/items.md', fs.readFileSync(require('node:path').join(process.env.IRORI_WORK, 'items.txt')));\nconsole.log('placed');\n`,
});
await routine(path.join(routines, 'quiet'), {
  'routine.yaml': 'name: Quiet\nsteps:\n  - run: check.js\n  - run: [git, status]\n',
  'check.js': `console.log(JSON.stringify({ continue: false }));\n`,
});
await routine(path.join(routines, 'long'), {
  'routine.yaml': 'name: Long\nsteps:\n  - run: wait.js\n',
  'wait.js': `console.log('waiting');\nsetTimeout(() => {}, 60000);\n`,
});
await routine(path.join(routines, 'summary'), {
  'routine.yaml': 'name: Summary\nsteps:\n  - run: summarize.py\n',
  'summarize.py': 'print("summary")\n',
});
await routine(path.join(routines, 'ask'), {
  'routine.yaml':
    'name: Ask\nsteps:\n  - agent: vault\n    cli: pi\n    access: default\n    prompt: dialog\n',
});
await routine(path.join(routines, 'broken'), {
  'routine.yaml': 'name: Broken\nsteps:\n  - agent: vault\n    prompt: go\n',
});
await routine(path.join(routines, 'token'), {
  'routine.yaml': 'name: Token\nsteps:\n  - run: use.sh\n    secrets: [SLACK_TOKEN]\n',
  'use.sh':
    '#!/bin/sh\necho "got $SLACK_TOKEN"\nprintf "SLACK_TOKEN=xoxe-rotated-ui-2\\n" >> "$IRORI_SECRETS_OUT"\n',
});
await chmod(path.join(routines, 'token', 'use.sh'), 0o700);
await routine(path.join(youRoot, 'routines', 'version'), {
  'routine.yaml': 'name: Git version\nsteps:\n  - run: [git, --version]\n',
});
const bin = path.join(base, 'bin');
await mkdir(bin);
await writeFile(
  path.join(bin, 'pi'),
  `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/harnesses.mjs')).href)}).then(m=>m.run('pi'));\n`,
  { mode: 0o700 },
);
await chooseJapanese(files.dataDir);
const env = {
  ...process.env,
  HOME: home,
  PATH: bin + path.delimiter + process.env.PATH,
  IRORI_DATA_DIR: files.dataDir,
  IRORI_TEST_KEYSTORE: 'reversible',
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
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.setDefaultTimeout(20000);
  await page.locator('.workspace-card').filter({ hasText: 'Lab' }).click();
  const rail = page.getByRole('navigation', { name: 'vault' });
  const modeButton = rail.getByRole('button', { name: 'irori mode', exact: true });
  const routinesButton = rail.getByRole('button', { name: 'ルーティン', exact: true });
  const productButton = rail.getByRole('button', { name: /^Product・AI/ });
  // Home, irori mode, routines, then the vaults; the new icon loads at its bundled size.
  expect(
    await rail
      .locator('.rail-home, .rail-overview, .rail-routines, .rail-brain')
      .evaluateAll((buttons) => buttons.map((button) => button.className)),
  ).toEqual(['rail-home', 'rail-button rail-overview', 'rail-button rail-routines', 'rail-brain']);
  await expect
    .poll(() => routinesButton.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(256);
  // The routines page opens directly from a vault, with its own heading and selection.
  await routinesButton.click();
  await expect(page.getByRole('heading', { name: 'ルーティン', exact: true })).toBeVisible();
  await expect(routinesButton).toHaveAttribute('aria-current', 'page');
  await expect(modeButton).not.toHaveAttribute('aria-current');
  await expect(productButton).not.toHaveAttribute('aria-current');
  await expect(page.getByRole('group', { name: 'irori mode の表示' })).toHaveCount(0);
  const view = page.getByRole('region', { name: 'ルーティン', exact: true });
  const card = (name: string) => view.getByRole('article', { name, exact: true });
  /** The state of a routine's latest run, as its row shows it. */
  const last = (name: string, state: string) =>
    expect(card(name).locator(`.routine-head .routine-state.${state}`)).toBeVisible();
  await expect(view.getByRole('region', { name: 'irori agent' })).toContainText('Git version');
  await expect(view.getByRole('region', { name: 'Product' })).toContainText('Collect');
  // The agent panel stays beside the routines.
  await expect(page.getByRole('complementary', { name: 'irori agent' })).toBeVisible();
  // The irori mode layout survives a visit to routines; routines is no longer a layout tab.
  await modeButton.click();
  await expect(view).toHaveCount(0);
  const layouts = page.getByRole('group', { name: 'irori mode の表示' });
  await expect(layouts.getByRole('button', { name: 'ルーティン', exact: true })).toHaveCount(0);
  await layouts.getByRole('button', { name: '並列', exact: true }).click();
  await routinesButton.click();
  await expect(view).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'irori agent' })).toBeVisible();
  await modeButton.click();
  await expect(layouts.getByRole('button', { name: '並列', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await routinesButton.click();
  // Routines keeps the shared agent's resizable pane across the columns layout.
  const agentPanel = page.getByRole('complementary', { name: 'irori agent' });
  const narrow = (await agentPanel.boundingBox())!.width;
  const handle = (await page.getByRole('separator', { name: 'エージェントの幅' }).boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x - 160, handle.y + handle.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await agentPanel.boundingBox())!.width)
    .toBeGreaterThan(narrow + 120);
  await modeButton.click();
  await routinesButton.click();
  await expect
    .poll(async () => (await agentPanel.boundingBox())!.width)
    .toBeGreaterThan(narrow + 120);
  // Rail search from routines covers the workspace, as irori mode's does.
  await rail.getByRole('button', { name: /^検索/ }).click();
  await expect(page.getByRole('radio', { name: 'すべての vault', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.screenshot({ path: 'test-results/routines-navigation.png' });

  // An invalid routine says why and cannot run.
  await expect(card('Broken')).toContainText('無効');
  await expect(card('Broken')).toContainText('ステップ 1 の access がありません。');
  await expect(card('Broken').getByRole('button', { name: '実行' })).toBeDisabled();

  // A new routine is made from a form of its steps, which says what still stops it.
  await page.getByRole('button', { name: '新しいルーティン', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新しいルーティン' });
  await expect(create.getByRole('combobox', { name: '置き場所' })).toHaveValue(
    (await you.load()).id,
  );
  await create.getByRole('textbox', { name: '名前' }).fill('Daily mail');
  const first = create.getByRole('listitem', { name: 'ステップ 1' });
  await expect(first).toContainText('irori agent');
  await expect(create).toContainText('ステップ 1 の prompt がありません。');
  await expect(create.getByRole('button', { name: '作成', exact: true })).toBeEnabled();
  await create
    .getByRole('group', { name: 'ステップを追加' })
    .getByRole('button', { name: 'プログラム', exact: true })
    .click();
  const second = create.getByRole('listitem', { name: 'ステップ 2' });
  await second.getByRole('textbox', { name: 'コマンド' }).fill('git --version');
  await second.getByRole('button', { name: 'ステップ 2を上へ' }).click();
  await expect(first.getByRole('textbox', { name: 'コマンド' })).toHaveValue('git --version');
  await second.getByRole('textbox', { name: 'プロンプト' }).fill('Sort the mail.');
  await expect(create).not.toContainText('がありません');
  await page.screenshot({ path: 'test-results/routines-new.png' });
  // The same routine as text, and back to the form.
  const views = create.getByRole('group', { name: '編集の表示' });
  await views.getByRole('button', { name: 'YAML', exact: true }).click();
  await expect(create.getByRole('textbox', { name: 'routine.yaml' })).toHaveValue(
    'name: Daily mail\nsteps:\n  - run: [git, --version]\n  - agent: irori\n    access: default\n    prompt: Sort the mail.\n',
  );
  await views.getByRole('button', { name: 'フォーム', exact: true }).click();
  await create.getByRole('button', { name: '作成', exact: true }).click();
  await expect(create).toHaveCount(0);
  const daily = card('Daily mail');
  await expect(daily).toContainText('未確認');
  await expect(daily).not.toContainText('無効');
  const dailyYaml = path.join(youRoot, 'routines', 'Daily mail', 'routine.yaml');
  expect(await readFile(dailyYaml, 'utf8')).toContain('  - run: [git, --version]\n');
  // Edited as text in place: a save that still cannot run says why and stays open.
  await daily.getByRole('button', { name: 'Daily mail を編集' }).click();
  const editor = page.getByRole('dialog', { name: 'Daily mail' });
  await editor
    .getByRole('group', { name: '編集の表示' })
    .getByRole('button', { name: 'YAML', exact: true })
    .click();
  const source = editor.getByRole('textbox', { name: 'routine.yaml' });
  await source.fill(
    'name: Daily mail\nsteps:\n  - agent: irori # sorts\n    prompt: Sort the mail.\n',
  );
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor.getByRole('alert')).toHaveText('ステップ 1 の access がありません。');
  await expect(editor.getByRole('button', { name: '閉じる', exact: true })).toBeVisible();
  // The form shows the missing access as standard and keeps the comment.
  await editor
    .getByRole('group', { name: '編集の表示' })
    .getByRole('button', { name: 'フォーム', exact: true })
    .click();
  await expect(editor.getByRole('combobox', { name: 'アクセス' })).toHaveValue('default');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(daily).not.toContainText('無効');
  expect(await readFile(dailyYaml, 'utf8')).toBe(
    'name: Daily mail\nsteps:\n  - agent: irori # sorts\n    prompt: Sort the mail.\n    access: default\n',
  );
  // Text the form cannot hold opens as text, with the reason.
  await writeFile(dailyYaml, 'name: Daily mail\nwhen: daily\nsteps:\n  - run: [git, --version]\n');
  await daily.getByRole('button', { name: 'Daily mail を編集' }).click();
  await expect(editor.getByRole('alert')).toContainText('不明なキーがあります: when');
  await expect(editor.getByRole('textbox', { name: 'routine.yaml' })).toBeVisible();
  await editor
    .getByRole('textbox', { name: 'routine.yaml' })
    .fill(
      'name: Daily mail\nsteps:\n  - agent: irori\n    access: default\n    prompt: Sort the mail.\n',
    );
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toHaveCount(0);
  // Or the irori agent is asked, with the words placed for the person to finish.
  await page.getByRole('button', { name: 'irori agent に頼む', exact: true }).click();
  const instruction = page.getByRole('textbox', { name: 'irori agent への指示' });
  await expect(instruction).toHaveValue('ルーティンを作って：');
  await expect(instruction).toBeFocused();
  await instruction.fill('');

  // JavaScript is added from the row that needs it; nothing is downloaded.
  const collect = card('Collect');
  await expect(collect).toContainText('未確認');
  await expect(collect).toContainText('JavaScript が必要です。');
  await expect(collect.getByRole('button', { name: '実行' })).toBeDisabled();
  await collect.getByRole('button', { name: 'JavaScript を追加' }).click();
  await expect(collect).not.toContainText('JavaScript が必要です。');
  expect((await page.evaluate(() => window.irori.deviceSettings())).routineRuntimes).toEqual([
    'javascript',
  ]);
  // The settings' switch follows the row's addition and persists either choice.
  const settings = rail.getByRole('button', { name: /^設定/ });
  await settings.click();
  const javascript = page
    .getByRole('group', { name: 'ルーティン' })
    .getByRole('checkbox', { name: 'JavaScript' });
  await expect(javascript).toBeChecked();
  await javascript.uncheck();
  await expect
    .poll(async () => (await page.evaluate(() => window.irori.deviceSettings())).routineRuntimes)
    .toEqual([]);
  await page.keyboard.press('Escape');
  // Nothing signals the switch to the page, which reads routines again every 5 s.
  const poll = { timeout: 12000 };
  await expect(collect).toContainText('JavaScript が必要です。', poll);
  await settings.click();
  await javascript.check();
  await expect
    .poll(async () => (await page.evaluate(() => window.irori.deviceSettings())).routineRuntimes)
    .toEqual(['javascript']);
  await page.keyboard.press('Escape');
  await expect(collect).not.toContainText('JavaScript が必要です。', poll);
  // Python is offered from its row and the settings; adding it downloads uv, which
  // tests/python-runtime.test.ts covers, so the smoke does not press it.
  const summary = card('Summary');
  await expect(summary).toContainText('Python が必要です。');
  await expect(summary.getByRole('button', { name: 'Python を追加' })).toBeEnabled();
  await settings.click();
  await expect(
    page.getByRole('group', { name: 'ルーティン' }).getByRole('checkbox', { name: 'Python' }),
  ).not.toBeChecked();
  await page.keyboard.press('Escape');

  // The first 実行 shows every file and runs only after the confirmation.
  await collect.getByRole('button', { name: '実行' }).click();
  const review = page.getByRole('dialog', { name: 'ルーティンの確認' });
  await expect(review.getByRole('region', { name: 'routine.yaml' })).toContainText('run: fetch.js');
  await expect(review.getByRole('region', { name: 'fetch.js' })).toContainText(
    "console.log('fetched 2')",
  );
  await page.screenshot({ path: 'test-results/routines-review.png' });
  await review.getByRole('button', { name: '確認して実行' }).click();
  await expect(review).toHaveCount(0);
  await last('Collect', 'succeeded');
  await expect(collect).not.toContainText('未確認');
  const steps = collect.locator('.routine-step');
  await expect(steps.nth(0)).toContainText('fetch.js');
  await expect(steps.nth(0)).toContainText('成功');
  await steps.nth(0).getByText('出力', { exact: true }).click();
  await expect(steps.nth(0).locator('pre')).toHaveText('fetched 2\n');
  await collect.getByText('変更 1 件', { exact: true }).click();
  await expect(collect.locator('.routine-changes')).toContainText('inbox/items.md');
  expect(await readFile(path.join(root, 'inbox', 'items.md'), 'utf8')).toBe('first\nsecond\n');
  await page.screenshot({ path: 'test-results/routines-run.png' });

  // A change brings the review back, showing the difference.
  await writeFile(
    path.join(routines, 'collect', 'fetch.js'),
    fetchJs.replace('fetched 2', 'fetched two'),
  );
  // The view reads the routines again every 5 s; the edit shows on the next read.
  await expect(collect).toContainText('変更あり', poll);
  await collect.getByRole('button', { name: '実行' }).click();
  const diff = review.getByRole('region', { name: 'fetch.js' });
  await expect(diff).toContainText('変更');
  await expect(diff.locator('.add')).toContainText("console.log('fetched two')");
  await expect(diff.locator('.del')).toContainText("console.log('fetched 2')");
  await expect(review).toContainText('変更なし: routine.yaml, place.js');
  await review.getByRole('button', { name: '確認して実行' }).click();
  await expect(collect.locator('.routine-history button')).toHaveCount(2);
  await last('Collect', 'succeeded');
  await expect(steps.nth(0).locator('pre')).toHaveText('fetched two\n');

  // The gate ends a run quietly before its later steps.
  const quiet = card('Quiet');
  await quiet.getByRole('button', { name: '実行' }).click();
  await review.getByRole('button', { name: '確認して実行' }).click();
  await last('Quiet', 'nothing');
  await expect(quiet.locator('.routine-head')).toContainText('対象なし');
  await expect(quiet.locator('.routine-step').nth(1)).toContainText('未実行');

  // 停止 ends the step in progress.
  const long = card('Long');
  await long.getByRole('button', { name: '実行' }).click();
  await review.getByRole('button', { name: '確認して実行' }).click();
  await expect(long.locator('.routine-step').first()).toContainText('実行中');
  await long.getByRole('button', { name: '停止' }).click();
  await last('Long', 'stopped');
  await expect(long.getByRole('button', { name: '実行' })).toBeEnabled();

  // The irori agent's routine runs in its folder.
  const version = card('Git version');
  await version.getByRole('button', { name: '実行' }).click();
  await review.getByRole('button', { name: '確認して実行' }).click();
  await last('Git version', 'succeeded');
  await version.locator('.routine-step').getByText('出力', { exact: true }).click();
  await expect(version.locator('.routine-output pre')).toContainText('git version');

  // A secret is entered from the row that needs it, never shown again, and hidden in output.
  const token = card('Token');
  await expect(token).toContainText('シークレット SLACK_TOKEN がありません。');
  await expect(token.getByRole('button', { name: '実行' })).toBeDisabled();
  await token.getByRole('button', { name: 'SLACK_TOKEN を入力' }).click();
  const entry = page.getByRole('dialog', { name: 'シークレット SLACK_TOKEN' });
  await expect(entry.getByRole('button', { name: '保存' })).toBeDisabled();
  await entry.getByLabel('値').fill('xoxb-entered-in-ui-1');
  await page.screenshot({ path: 'test-results/routines-keystore.png' });
  await entry.getByRole('button', { name: '保存' }).click();
  await expect(entry).toHaveCount(0);
  await expect(token).not.toContainText('がありません');
  await token.getByRole('button', { name: '実行' }).click();
  await expect(review).toContainText('受け取るシークレット: SLACK_TOKEN');
  await review.getByRole('button', { name: '確認して実行' }).click();
  await last('Token', 'succeeded');
  await token.locator('.routine-step').getByText('出力', { exact: true }).click();
  await expect(token.locator('.routine-output pre')).toHaveText('got ***\n');
  expect(await page.content()).not.toContain('xoxb-entered-in-ui-1');
  // The step wrote a new value back; the test store's sealing is reversible.
  const sealed = JSON.parse(await readFile(path.join(files.dataDir, 'secrets.json'), 'utf8'));
  expect(Buffer.from(sealed.values.SLACK_TOKEN, 'base64').toString()).toBe(
    'test:xoxe-rotated-ui-2',
  );
  // The header's シークレット lists them with the routines using them; 削除 asks once more.
  await page.getByRole('button', { name: 'シークレット', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'シークレット' });
  const slack = sheet.getByRole('listitem', { name: 'SLACK_TOKEN' });
  await expect(slack).toContainText('Token');
  await slack.getByRole('button', { name: '削除' }).click();
  await slack.getByRole('button', { name: '削除する' }).click();
  // Still needed by Token, it stays listed to enter again.
  await expect(slack.getByRole('button', { name: '入力' })).toBeVisible();
  // A secret no routine names yet is added by its name.
  await sheet.getByRole('button', { name: '追加' }).click();
  const added = page.getByRole('dialog', { name: 'シークレットを追加' });
  await added.getByRole('textbox', { name: '名前' }).fill('notion-key');
  await expect(added.getByRole('textbox', { name: '名前' })).toHaveValue('NOTION_KEY');
  await added.getByLabel('値').fill('secret-notion-value');
  await added.getByRole('button', { name: '保存' }).click();
  await expect(sheet.getByRole('listitem', { name: 'NOTION_KEY' })).toBeVisible();
  await page.screenshot({ path: 'test-results/routines-keys.png' });
  await sheet.getByRole('button', { name: '閉じる' }).click();
  await expect(token).toContainText('シークレット SLACK_TOKEN がありません。');
  // A step's secrets are chosen and entered in the editor.
  await token.getByRole('button', { name: 'Token を編集' }).click();
  const tokenEditor = page.getByRole('dialog', { name: 'Token' });
  const named = tokenEditor.getByRole('group', { name: 'シークレット' });
  await named.getByRole('button', { name: '値を入力' }).click();
  await entry.getByLabel('値').fill('xoxb-entered-in-editor');
  await entry.getByRole('button', { name: '保存' }).click();
  await expect(entry).toHaveCount(0);
  await expect(named.getByRole('img', { name: '保存済み' })).toBeVisible();
  await named.getByRole('combobox', { name: 'シークレットの名前' }).fill('NOTION_KEY');
  await named.getByRole('button', { name: '追加' }).click();
  await expect(named).toContainText('NOTION_KEY');
  await expect(named.getByRole('img', { name: '保存済み' })).toHaveCount(2);
  await named.getByRole('button', { name: 'NOTION_KEY を外す' }).click();
  await tokenEditor.getByRole('button', { name: 'キャンセル' }).click();
  await expect(token).not.toContainText('がありません');
  expect(await page.content()).not.toContain('xoxb-entered-in-editor');

  // An agent step's request is answered in the step, and its conversation opens.
  const ask = card('Ask');
  await ask.getByRole('button', { name: '実行' }).click();
  await review.getByRole('button', { name: '確認して実行' }).click();
  const request = ask.getByRole('group', { name: '許可の要求' });
  await expect(request).toContainText('Fixture confirmation');
  await page.screenshot({ path: 'test-results/routines-request.png' });
  await request.getByRole('button', { name: '今回のみ許可' }).click();
  const question = ask.getByRole('group', { name: 'エージェントからの質問' });
  await expect(question).toContainText('Fixture answer');
  await question.getByLabel('Fixture answer').fill('Choice');
  await question.getByRole('button', { name: '回答する' }).click();
  await last('Ask', 'succeeded');
  await expect(ask.locator('.routine-step')).toContainText('vault agent');
  await ask.getByText('報告', { exact: true }).click();
  await expect(ask.locator('.routine-output pre')).toHaveText('日本語 の応答');
  const run = (
    await page.evaluate(
      ([owner]) => window.irori.routineRuns({ owner, folder: 'ask' }),
      [product.scopeId],
    )
  )[0];
  // The step is a conversation of its own (ADR 017), named in the run's record.
  const conversation = await page.evaluate(
    ({ scopeId, id }) => window.irori.agentConversation(scopeId, 'pi', id),
    { scopeId: product.scopeId, id: run.steps[0].conversation?.conversationId },
  );
  expect(conversation.summary?.title).toBe('ルーティン: Ask（ステップ 1）');
  const shown = conversation.events.filter(
    (event) => event.runId === run.steps[0].conversation?.runId,
  );
  expect(shown.some((event) => event.role === 'user' && event.text === 'dialog')).toBe(true);
  expect(shown.some((event) => event.text === 'ルーティン: Ask（ステップ 1）')).toBe(true);

  await ask.getByRole('button', { name: '会話' }).click();
  await expect(page.locator('.brain-names strong')).toHaveText('Product');
  await expect(page.getByRole('log').first()).toContainText('ルーティン: Ask（ステップ 1）');
  await expect(productButton).toHaveAttribute('aria-current', 'true');
  await expect(routinesButton).not.toHaveAttribute('aria-current');

  // An empty workspace still offers the irori agent's routines.
  await rail.getByRole('button', { name: 'ワークスペースを選択' }).click();
  await page.locator('.workspace-card').filter({ hasText: 'Empty' }).click();
  await expect(modeButton).toBeDisabled();
  await expect(routinesButton).toBeEnabled();
  await routinesButton.click();
  await expect(view.getByRole('region', { name: 'irori agent' })).toContainText('Git version');
  await expect(view.getByRole('region', { name: 'Product', exact: true })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'irori agent' })).toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    'Routines UI passed: invalid routine with its reason, a routine made from the form and edited as a form and as text, the irori agent asked, JavaScript added from the row and switched in the settings, the review before the first run and the difference after a change, steps with output and changed files, history, the nothing-to-do gate, 停止, a secret entered from its row and from the editor, hidden, written back, listed with its routines, added by name and deleted, an agent step whose request was answered in the step and whose conversation opened in its vault, and an irori agent routine. Protocol fixture only.',
  );
} finally {
  // A routine or run left by a failure would hold the window open behind a confirmation.
  const [first] = app.windows();
  await first
    ?.evaluate(
      async ([owner]) => {
        for (const folder of ['collect', 'quiet', 'long', 'token', 'ask'])
          await window.irori.stopRoutine({ owner, folder });
        await window.irori.cancel();
      },
      [product.scopeId],
    )
    .catch(() => {});
  await app.close();
  await rm(base, { recursive: true, force: true });
}
