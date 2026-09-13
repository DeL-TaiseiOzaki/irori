import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileService } from '../src/host/files';
if (process.platform === 'win32') {
  console.log(
    'Harness UI executable fixtures are POSIX only; native Windows acceptance remains open.',
  );
  process.exit(0);
}
const base = await mkdtemp(path.join(tmpdir(), 'irori harness UI '));
const files = new FileService(path.join(base, 'device'));
await files.init();
const root = path.join(base, 'KB');
await mkdir(root);
const space = await files.register(root, 'ハーネス検証', 'personal');
await writeFile(path.join(root, 'note.md'), '# Harness fixture\n');
const bin = path.join(base, 'bin');
await mkdir(bin);
for (const id of ['pi', 'opencode'])
  await writeFile(
    path.join(bin, id),
    `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/harnesses.mjs')).href)}).then(m=>m.run(${JSON.stringify(id)}));\n`,
    { mode: 0o700 },
  );
const env = {
  ...process.env,
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
let app = await launch();
const errors: string[] = [];
await mkdir('test-results', { recursive: true });
try {
  let page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.getByRole('checkbox', { name: /ハーネス検証/ }).check();
  await page.getByRole('button', { name: '選択したスペースを開く' }).click();
  await page.getByRole('button', { name: 'AIに相談', exact: true }).click();
  for (const agent of ['pi', 'opencode']) {
    await page.getByLabel('エージェント', { exact: true }).selectOption(agent);
    await expect(page.getByText(/fixture/, { exact: false }).first()).toBeVisible();
    await page.getByLabel('エージェントへの指示').fill('dialog');
    await page.getByRole('button', { name: '保存して実行 ↗', exact: true }).click();
    await page.locator('.request').getByRole('button', { name: '拒否', exact: true }).click();
    if (agent === 'opencode') {
      await page.getByRole('button', { name: 'Choice', exact: true }).click();
      await page.getByRole('button', { name: 'Second', exact: true }).click();
      await expect(page.getByLabel('Fixture answer', { exact: true })).toHaveValue(
        'Choice\nSecond',
      );
    } else await page.getByLabel('Fixture answer', { exact: true }).fill('Choice');
    await page.getByRole('button', { name: '回答する', exact: true }).click();
    await expect(page.locator('.message.done').last()).toContainText('完了');
    await expect(
      page.getByText('次の実行で前回の会話を引き継ぎます。会話本文の再表示には未対応です。', {
        exact: true,
      }),
    ).toBeVisible();
  }
  expect(await readFile(path.join(root, 'note.md'), 'utf8')).toContain('Fixture OpenCode edit');
  await page.screenshot({ path: 'test-results/irori-harnesses.png' });
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.locator('.workspace-card').filter({ hasText: 'マイワークスペース' }).click();
  await page.getByRole('button', { name: 'AIに相談', exact: true }).click();
  for (const agent of ['pi', 'opencode']) {
    await page.getByLabel('エージェント', { exact: true }).selectOption(agent);
    await expect(
      page.getByRole('button', { name: '会話の継続をリセット', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '会話の継続をリセット', exact: true }).click();
    await expect(page.getByText('次の実行で新しい会話を始めます。', { exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
  await writeFile(
    'test-results/harness-ui-smoke.json',
    JSON.stringify(
      {
        evidence: 'Explicit protocol fixtures; no native model inference',
        checks: [
          'Pi/OpenCode panel selection',
          'native-shaped denial and question responses',
          'stream completion',
          'fixture mutation',
          'session status after restart',
          'per-provider reset',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log('Harness UI protocol fixtures pass; native model inference remains unverified.');
} catch (error) {
  await (
    await app.firstWindow()
  )
    .screenshot({ path: 'test-results/irori-harness-failure.png' })
    .catch(() => {});
  throw error;
} finally {
  await (await app.firstWindow()).evaluate(() => window.irori.cancel()).catch(() => {});
  await app.close();
  await rm(base, { recursive: true, force: true });
}
