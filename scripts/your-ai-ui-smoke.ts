import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';

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
  const rail = page.getByRole('navigation', { name: 'Brain' });
  await rail.getByRole('button', { name: '全体', exact: true }).click();

  // Your AI is set up from the Overview; its starter never overwrites anything.
  const island = page.getByRole('complementary', { name: 'あなたの AI' });
  await expect(island).toContainText(you);
  await island.getByRole('button', { name: 'あなたの AI を用意する' }).click();
  const composer = island.getByLabel('あなたの AI への指示');
  await expect(composer).toBeVisible();
  expect(await readFile(path.join(you, 'AGENTS.md'), 'utf8')).toContain('# Your AI');
  expect(
    (await stat(path.join(you, '.agents', 'skills', 'brain-agents', 'SKILL.md'))).isFile(),
  ).toBe(true);
  const map = page.getByRole('region', { name: 'Brain の地図' });
  await expect(map.getByRole('button', { name: 'あなたの AI の Schema を開く' })).toBeVisible();

  // A request goes to your AI with the workspace's brains; it hands a note to
  // Product's sub-agent, whose write asks the person here.
  await composer.fill('Write a decision note.');
  await island.getByRole('button', { name: '送信', exact: true }).click();
  const request = island.getByRole('group', { name: '許可の要求' });
  await expect(request).toContainText('Product の AI から');
  await expect(island.getByRole('list', { name: 'Brain への依頼' })).toContainText(
    'Write a note in Product',
  );
  await expect(island.getByRole('list', { name: 'Brain への依頼' })).toContainText('許可待ち');
  // The map draws the hand-off, and the brains are held while your AI works.
  await expect(map.locator('.map-pill.hand-off')).toContainText('Write a note in Product');
  await expect(map.getByRole('button', { name: 'Product を開く' })).toHaveClass(/handed/);
  await page.screenshot({ path: 'test-results/irori-your-ai.png' });
  await rail.getByRole('button', { name: /^Research・AI/ }).click();
  await expect(page.locator('.brain-names strong')).toHaveText('Research');
  await page.getByRole('button', { name: 'AIに相談', exact: true }).click();
  await expect(page.locator('.agent-held')).toContainText(
    'あなたの AI がこの Brain にも仕事を渡しています',
  );
  await expect(page.getByRole('button', { name: '送信', exact: true })).toBeDisabled();
  await rail.getByRole('button', { name: '全体', exact: true }).click();

  // Allowed here, the sub-agent writes in its brain and reports.
  await request.getByRole('button', { name: '今回のみ許可' }).click();
  await expect(island.locator('.message.report')).toContainText(
    'Wrote Knowledge_Base/from-your-ai.md.',
  );
  await expect(island).toContainText("Handed the note to Product's AI.");
  await expect(island.getByRole('list', { name: 'Brain への依頼' })).toContainText('完了');
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

  // The Your AI screen: its folder read-only, and each brain's sub-agent. irori
  // asks your AI to write the definitions and shows them once written.
  await map.getByRole('button', { name: 'あなたの AI の Schema を開く' }).click();
  await expect(page.getByRole('region', { name: 'ファイルの内容' })).toContainText('# Your AI');
  const definitions = page.getByRole('region', { name: 'Brain の AI' });
  await expect(definitions.getByRole('button', { name: /^Product の AI/ })).toContainText('未定義');
  await page.screenshot({ path: 'test-results/irori-your-ai-screen.png' });
  await definitions.getByRole('button', { name: 'あなたの AI に定義を更新させる' }).click();
  await expect(island).toContainText('Wrote 2 definitions.');
  expect(await readFile(path.join(you, '.claude', 'agents', 'product.md'), 'utf8')).toContain(
    'name: product',
  );
  await map.getByRole('button', { name: 'あなたの AI の Schema を開く' }).click();
  await expect(definitions.getByRole('button', { name: /^Product の AI/ })).toContainText(
    '定義済み',
  );
  await expect(definitions.getByRole('button', { name: /^Research の AI/ })).toContainText(
    '定義済み',
  );
  await page.getByRole('button', { name: '全体に戻る' }).click();
  await expect(map).toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    'Your-AI UI passed: setup from the Overview, a hand-off to a brain sub-agent with its request answered and its report, the map’s hand-off line, brains held while your AI works, your AI kept out of the brains, hand-offs in the foreground, definitions written on request and shown on the Your AI screen. Protocol fixture only.',
  );
} finally {
  const [first] = app.windows();
  await first?.evaluate(() => window.irori.cancel()).catch(() => {});
  await app.close();
  await rm(base, { recursive: true, force: true });
}
