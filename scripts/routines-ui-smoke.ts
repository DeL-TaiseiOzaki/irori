import { seedDataConsent } from '../tests/data-consent-fixture';
import { _electron as electron, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';
import { YourAiService } from '../src/host/you';

// Routines in irori mode (ADR 016): the review before the first run and after a
// change, JavaScript added from the row, a run's steps, output and changed
// files, the nothing-to-do gate, 停止, an agent step's request answered in its
// step, and its conversation. `pi` is a protocol fixture; no model runs.
if (process.platform === 'win32') {
  console.log('Routines UI executable fixtures are POSIX only.');
  process.exit(0);
}
const base = await mkdtemp(path.join(tmpdir(), 'irori routines UI '));
const home = path.join(base, 'home');
await mkdir(home);
const files = new FileService(path.join(base, 'device'));
await files.init();
await seedDataConsent(files.dataDir);
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
await routine(path.join(routines, 'ask'), {
  'routine.yaml':
    'name: Ask\nsteps:\n  - agent: hibachi\n    cli: pi\n    access: default\n    prompt: dialog\n',
});
await routine(path.join(routines, 'broken'), {
  'routine.yaml': 'name: Broken\nsteps:\n  - agent: hibachi\n    prompt: go\n',
});
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
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.setDefaultTimeout(20000);
  await page.locator('.workspace-card').filter({ hasText: 'Lab' }).click();
  const rail = page.getByRole('navigation', { name: 'hibachi' });
  await rail.getByRole('button', { name: 'irori mode', exact: true }).click();
  await page.getByRole('button', { name: 'ルーティン', exact: true }).click();
  const view = page.getByRole('region', { name: 'ルーティン', exact: true });
  const card = (name: string) => view.getByRole('article', { name, exact: true });
  /** The state of a routine's latest run, as its row shows it. */
  const last = (name: string, state: string) =>
    expect(card(name).locator(`.routine-head .routine-state.${state}`)).toBeVisible();
  await expect(view.getByRole('region', { name: 'irori agent' })).toContainText('Git version');
  await expect(view.getByRole('region', { name: 'Product' })).toContainText('Collect');
  // The agent panel stays beside the routines.
  await expect(page.getByRole('complementary', { name: 'irori agent' })).toBeVisible();

  // An invalid routine says why and cannot run.
  await expect(card('Broken')).toContainText('無効');
  await expect(card('Broken')).toContainText('ステップ 1 の access がありません。');
  await expect(card('Broken').getByRole('button', { name: '実行' })).toBeDisabled();

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
  await expect(collect).toContainText('変更あり');
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

  // An agent step's request is answered in the step, and its conversation opens.
  const ask = card('Ask');
  await ask.getByRole('button', { name: '実行' }).click();
  await review.getByRole('button', { name: '確認して実行' }).click();
  const request = ask.getByRole('group', { name: '許可の要求' });
  await expect(request).toContainText('Fixture confirmation');
  await page.screenshot({ path: 'test-results/routines-request.png' });
  await request.getByRole('button', { name: '今回のみ許可' }).click();
  await expect(request).toContainText('Fixture answer');
  await request.getByLabel('Fixture answer').fill('Choice');
  await request.getByRole('button', { name: '回答する' }).click();
  await last('Ask', 'succeeded');
  await expect(ask.locator('.routine-step')).toContainText('hibachi agent');
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
  expect(errors).toEqual([]);
  console.log(
    'Routines UI passed: invalid routine with its reason, JavaScript added from the row, the review before the first run and the difference after a change, steps with output and changed files, history, the nothing-to-do gate, 停止, an agent step whose request was answered in the step and whose conversation opened in its hibachi, and an irori agent routine. Protocol fixture only.',
  );
} finally {
  // A routine or run left by a failure would hold the window open behind a confirmation.
  const [first] = app.windows();
  await first
    ?.evaluate(
      async ([owner]) => {
        for (const folder of ['collect', 'quiet', 'long', 'ask'])
          await window.irori.stopRoutine({ owner, folder });
        await window.irori.cancel();
      },
      [product.scopeId],
    )
    .catch(() => {});
  await app.close();
  await rm(base, { recursive: true, force: true });
}
