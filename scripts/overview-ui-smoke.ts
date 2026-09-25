import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';

// Two brains' AIs run at once: switching brains while one runs, a queue per
// brain that goes on in the background, and the Overview answering, stopping,
// resuming and sending. The CLIs are protocol fixtures; no model runs.
if (process.platform === 'win32') {
  console.log('Overview UI executable fixtures are POSIX only.');
  process.exit(0);
}
const base = await mkdtemp(path.join(tmpdir(), 'irori overview UI '));
const files = new FileService(path.join(base, 'device'));
await files.init();
const roots: string[] = [];
for (const name of ['Product', 'Research']) {
  const root = path.join(base, name);
  await mkdir(path.join(root, 'Knowledge_Base'), { recursive: true });
  await writeFile(path.join(root, 'Knowledge_Base', `${name} note.md`), `# ${name}\n\nlantern\n`);
  await writeFile(path.join(root, 'AGENTS.md'), `# ${name} agents\n`);
  roots.push(root);
}
const product = await files.register(roots[0], 'Product', 'team');
const research = await files.register(roots[1], 'Research', 'personal');
await new WorkspaceService(files).save('Lab', [product.scopeId, research.scopeId]);
const bin = path.join(base, 'bin');
await mkdir(bin);
await writeFile(
  path.join(bin, 'pi'),
  `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/harnesses.mjs')).href)}).then(m=>m.run('pi'));\n`,
  { mode: 0o700 },
);
const env = {
  ...process.env,
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
  const conversation = (scopeId: string) =>
    page.evaluate((id) => window.irori.agentConversation(id, 'pi'), scopeId);
  const turns = async (scopeId: string) =>
    (await conversation(scopeId)).events
      .filter((event) => event.role === 'user')
      .map((e) => e.text);
  await page.locator('.workspace-card').filter({ hasText: 'Lab' }).click();
  const rail = page.getByRole('navigation', { name: 'Brain' });

  // Product's AI asks for permission and has a second instruction queued behind it.
  await page.getByRole('button', { name: 'AIに相談', exact: true }).click();
  await page.getByLabel('エージェント', { exact: true }).selectOption('pi');
  await page.getByLabel('エージェントへの指示').fill('dialog');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect(page.locator('.request')).toContainText('Fixture confirmation');
  await page.getByLabel('エージェントへの指示').fill('second turn');
  await page.getByRole('button', { name: '送信待ちに追加', exact: true }).click();
  await expect(page.getByLabel('送信待ち', { exact: true })).toContainText('second turn');

  // Another brain can be chosen while Product's AI waits, and run its own AI.
  await rail.getByRole('button', { name: /^Research・AI/ }).click();
  await expect(page.locator('.brain-names strong')).toHaveText('Research');
  await page.getByLabel('エージェント', { exact: true }).selectOption('pi');
  await page.getByLabel('エージェントへの指示').fill('hold');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect(rail.getByRole('button', { name: 'Research・AI 実行中' })).toBeVisible();
  await expect(rail.getByRole('button', { name: 'Product・AI 許可待ち' })).toBeVisible();
  await expect(page.locator('.status-bar')).toContainText('実行中 2');
  await expect(page.locator('.status-bar')).toContainText('許可待ち 1');
  // The workspace cannot be left while an AI runs in any brain.
  await expect(page.getByRole('button', { name: 'ワークスペースを選択' })).toBeDisabled();

  // Back in Product, the request is still answerable after the switch.
  await rail.getByRole('button', { name: /^Product・AI/ }).click();
  await expect(page.locator('.request').getByRole('button', { name: '拒否' })).toBeVisible();
  await expect(page.getByLabel('エージェント', { exact: true })).toHaveValue('pi');
  // Research stays the brain on show, so Product's queue has to go on in the background.
  await rail.getByRole('button', { name: /^Research・AI/ }).click();
  await expect(page.locator('.brain-names strong')).toHaveText('Research');

  // The Overview: a map of both brains and their AIs.
  await rail.getByRole('button', { name: '全体', exact: true }).click();
  const map = page.getByRole('region', { name: 'Brain の地図' });
  await expect(map.getByRole('button', { name: 'Product を開く' })).toContainText('許可待ち');
  await expect(map.getByRole('button', { name: 'Research を開く' })).toContainText('実行中');
  await expect(map.locator('.map-group')).toHaveCount(2);
  // Beside the map, your AI comes first; each brain's own AI is the other tab.
  await expect(page.getByRole('complementary', { name: 'あなたの AI' })).toBeVisible();
  await page.getByRole('button', { name: 'Brain の AI', exact: true }).click();
  const ais = page.getByRole('complementary', { name: 'Brain の AI' });
  const productAi = ais.getByRole('group', { name: 'Product の AI' });
  await page.screenshot({ path: 'test-results/irori-overview-map.png' });
  // Search from the Overview covers every brain.
  await page.getByRole('button', { name: /^すべての Brain を検索/ }).click();
  await expect(page.getByRole('radio', { name: 'すべての Brain', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Answering Product's requests here; its queue then goes on by itself.
  await productAi.getByRole('button', { name: '拒否', exact: true }).click();
  await productAi.getByLabel('Fixture answer', { exact: true }).fill('Choice');
  await productAi.getByRole('button', { name: '回答する', exact: true }).click();
  await expect
    .poll(async () => {
      const value = await conversation(product.scopeId);
      return [value.queued.length, !!value.activeRunId, value.events.at(-1)?.outcome];
    })
    .toEqual([0, false, 'completed']);
  expect(await turns(product.scopeId)).toEqual(['dialog', 'second turn']);
  await expect(productAi).toContainText('待機');

  // Sending from the Overview queues behind Research's run.
  await ais.getByRole('radio', { name: 'Research', exact: true }).check();
  await ais.getByLabel('Research の AI への指示').fill('queued from overview');
  await ais.getByRole('button', { name: '送信待ちに追加', exact: true }).click();
  await expect.poll(async () => (await conversation(research.scopeId)).queued.length).toBe(1);

  // Side by side: stop Research's run, then resume its queue.
  await page.getByRole('button', { name: '並列', exact: true }).click();
  const columns = page.getByRole('region', { name: 'Brain の並列表示' });
  const researchColumn = columns.getByRole('region', { name: 'Research', exact: true });
  await expect(researchColumn).toContainText('実行中');
  await expect(researchColumn).toContainText('Research note');
  await expect(researchColumn).toContainText('AGENTS.md');
  await page.screenshot({ path: 'test-results/irori-overview-columns.png' });
  await researchColumn.getByRole('button', { name: '停止', exact: true }).click();
  await expect(researchColumn.getByRole('button', { name: '送信を再開' })).toBeVisible();
  // A stopped run leaves its queue for the person, not sent on its own.
  expect((await conversation(research.scopeId)).queued.length).toBe(1);
  await researchColumn.getByRole('button', { name: '送信を再開', exact: true }).click();
  await expect
    .poll(async () => {
      const value = await conversation(research.scopeId);
      return [value.queued.length, !!value.activeRunId, value.events.at(-1)?.outcome];
    })
    .toEqual([0, false, 'completed']);
  expect(await turns(research.scopeId)).toEqual(['hold', 'queued from overview']);

  // A brain with nothing running takes an instruction from the Overview at once.
  await page.getByRole('button', { name: '地図', exact: true }).click();
  await ais.getByRole('radio', { name: 'Product', exact: true }).check();
  await ais.getByLabel('Product の AI への指示').fill('from overview');
  await ais.getByRole('button', { name: '送信', exact: true }).click();
  await expect
    .poll(() => turns(product.scopeId))
    .toEqual(['dialog', 'second turn', 'from overview']);
  await expect.poll(async () => !!(await conversation(product.scopeId)).activeRunId).toBe(false);

  // Opening a note from a column shows that brain with the note.
  await page.getByRole('button', { name: '並列', exact: true }).click();
  await researchColumn.getByRole('button', { name: 'Research note', exact: true }).click();
  await expect(page.locator('.brain-names strong')).toHaveText('Research');
  await expect(page.locator('.ProseMirror')).toContainText('Research');
  await expect(rail.getByRole('button', { name: /^Research・AI/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  // The panel shows Research's finished conversation, not a stale queue.
  await expect(page.getByLabel('送信待ち', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ワークスペースを選択' })).toBeEnabled();

  // And back to the map, then into a brain from it.
  // The Overview comes back as it was left: side by side.
  await rail.getByRole('button', { name: '全体', exact: true }).click();
  await expect(columns).toBeVisible();
  await page.getByRole('button', { name: '地図', exact: true }).click();
  await map.getByRole('button', { name: 'Product を開く' }).click();
  await expect(page.locator('.brain-names strong')).toHaveText('Product');
  await expect(map).toHaveCount(0);

  // A result found from the Overview opens in its own brain.
  await rail.getByRole('button', { name: '全体', exact: true }).click();
  await page.getByRole('button', { name: /^すべての Brain を検索/ }).click();
  const palette = page.getByRole('dialog', { name: 'KB内を検索' });
  await palette.getByLabel('本文を検索', { exact: true }).fill('lantern');
  await palette.getByRole('button', { name: '検索', exact: true }).click();
  const found = palette.getByRole('group', { name: 'Research', exact: true });
  await expect(found).toContainText('Research note');
  await expect(palette.getByRole('group', { name: 'Product', exact: true })).toContainText(
    'Product note',
  );
  await found.getByRole('button').first().click();
  await expect(palette).toHaveCount(0);
  await expect(map).toHaveCount(0);
  await expect(page.locator('.brain-names strong')).toHaveText('Research');
  expect(errors).toEqual([]);
  console.log(
    'Overview UI passed: two brains running at once, switching during a run, a request answered after a switch and from the Overview, a background queue, stop/resume, sending and queueing from the Overview, map and columns, all-brains search opening in its brain. Protocol fixture only.',
  );
} finally {
  // A run left by a failure would hold the window open behind a confirmation.
  const [first] = app.windows();
  await first
    ?.evaluate(
      (ids) => Promise.all(ids.map((id) => window.irori.cancel(id))),
      [product.scopeId, research.scopeId],
    )
    .catch(() => {});
  await app.close();
  await rm(base, { recursive: true, force: true });
}
