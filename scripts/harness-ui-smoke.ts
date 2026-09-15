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
await writeFile(path.join(root, 'second.md'), '# Other note\n');
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
  const settings = () => page.getByLabel('会話と接続の設定', { exact: true });
  await expect(page.locator('.agent-settings-sheet')).not.toBeVisible();
  await page.getByRole('button', { name: '新しい会話', exact: true }).click();
  await expect(page.getByLabel('エージェントへの指示')).toBeFocused();
  await expect(page.getByText('次の送信から新しい会話を始めます。')).toBeVisible();
  await page.getByRole('button', { name: '取り消す', exact: true }).click();
  await expect(page.getByRole('button', { name: '新しい会話', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  for (const agent of ['pi', 'opencode']) {
    await page.getByLabel('エージェント', { exact: true }).selectOption(agent);
    await settings().click();
    await expect(page.getByText(/fixture/, { exact: false }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settings()).toBeFocused();
    await expect(page.locator('.agent-settings-sheet')).not.toBeVisible();
    await page.getByLabel('エージェントへの指示').fill('dialog');
    await page.getByRole('button', { name: '送信', exact: true }).click();
    if (agent === 'pi') {
      await page.getByRole('button', { name: 'note', exact: true }).click();
      await page.locator('.ProseMirror').click();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.press('Enter');
      await page.keyboard.insertText('会話中も編集を続けます');
      await page.getByLabel('エージェントへの指示').fill('next queued message');
      await page.getByRole('button', { name: '送信待ちに追加', exact: true }).click();
      await expect(page.getByLabel('送信待ち', { exact: true })).toContainText(
        'next queued message',
      );
      expect(await readFile(path.join(root, 'note.md'), 'utf8')).toContain(
        '会話中も編集を続けます',
      );
      const observations = await page.evaluate(
        (id) => window.irori.knowledgeHistory(id),
        space.scopeId,
      );
      // The first turn started before a note was selected; the queued turn captures its own note.
      expect(observations.runs.length).toBeGreaterThanOrEqual(1);
      await page.getByRole('button', { name: 'second', exact: true }).click();
      await expect(page.locator('.ProseMirror')).toContainText('Other note');
    }
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
    if (agent === 'pi') {
      await expect(page.locator('.message.done')).toHaveCount(2);
      const observations = await page.evaluate(
        (id) => window.irori.knowledgeHistory(id),
        space.scopeId,
      );
      expect(
        observations.runs.some((run) => run.sources.some((source) => source.path === 'note.md')),
      ).toBe(true);
      await expect(page.getByLabel('送信待ち', { exact: true })).toHaveCount(0);
      const requests = async () =>
        (await readFile(path.join(root, 'fixture-requests.jsonl'), 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
          .filter((entry) => entry.type === 'prompt');
      await page.getByLabel('エージェントへの指示').fill('hold');
      await page.getByRole('button', { name: '送信', exact: true }).click();
      await expect(page.getByRole('button', { name: '停止', exact: true })).toBeVisible();
      // The UI becomes stoppable during startup. Wait until this fixture actually receives
      // the prompt before testing cancellation/restart of a dispatched turn.
      await expect.poll(async () => (await requests()).length).toBe(3);
      await page.getByLabel('エージェントへの指示').fill('after cancellation');
      await page.getByRole('button', { name: '送信待ちに追加', exact: true }).click();
      await page.getByLabel('エージェントへの指示').fill('discard queued message');
      await page.getByRole('button', { name: '送信待ちに追加', exact: true }).click();
      await page.getByRole('button', { name: '停止', exact: true }).click();
      await expect(page.getByRole('button', { name: '送信を再開', exact: true })).toBeEnabled();
      await expect(page.getByLabel('送信待ち', { exact: true })).toContainText(
        'after cancellation',
      );
      expect((await requests()).length).toBe(3);
      for (const cycle of [1, 2]) {
        await app.close();
        app = await launch();
        page = await app.firstWindow();
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.locator('.workspace-card').filter({ hasText: 'マイワークスペース' }).click();
        await page.getByRole('button', { name: 'AIに相談', exact: true }).click();
        await page.getByLabel('エージェント', { exact: true }).selectOption('pi');
        await expect(page.getByLabel('送信待ち', { exact: true })).toContainText(
          'after cancellation',
        );
        await expect(page.locator('.message.done')).toHaveCount(3);
        await expect(page.locator('.message.user').first()).toHaveText('dialog');
        await expect(page.locator('.conversation')).toContainText('日本語');
        await expect(page.locator('.request')).toHaveCount(0);
        await expect(page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0);
        expect((await requests()).length).toBe(3);
        const pending = await page.evaluate(
          (id) => window.irori.agentConversation(id, 'pi'),
          space.scopeId,
        );
        expect(pending.queued[0].notePath).toBe('second.md');
        if (cycle === 1) {
          await page
            .getByLabel('送信待ち', { exact: true })
            .locator('div')
            .filter({ hasText: 'discard queued message' })
            .getByRole('button')
            .click();
          await expect(page.getByLabel('送信待ち', { exact: true })).not.toContainText(
            'discard queued message',
          );
        } else expect(pending.queued).toHaveLength(1);
      }
      await page.getByRole('button', { name: '送信を再開', exact: true }).click();
      await expect(page.locator('.message.done')).toHaveCount(4);
      expect((await requests()).length).toBe(4);
      await page.getByLabel('エージェントへの指示').fill('dialog reload');
      await page.getByRole('button', { name: '送信', exact: true }).click();
      await expect(page.locator('.request')).toBeVisible();
      await page.reload();
      await page.locator('.workspace-card').filter({ hasText: 'マイワークスペース' }).click();
      await page.getByRole('button', { name: 'AIに相談', exact: true }).click();
      await page.getByLabel('エージェント', { exact: true }).selectOption('pi');
      await expect(page.locator('.message.done')).toHaveCount(5);
      await expect(page.locator('.request')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0);
    }
    await settings().click();
    await expect(
      page.getByText('次の実行で前回の会話を引き継ぎます。履歴はこの端末に保存されます。', {
        exact: true,
      }),
    ).toBeVisible();
    await settings().click();
  }
  expect(await readFile(path.join(root, 'note.md'), 'utf8')).toContain('Fixture OpenCode edit');
  await page.screenshot({ path: 'test-results/irori-harnesses.png' });
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.locator('.workspace-card').filter({ hasText: 'マイワークスペース' }).click();
  await page.getByRole('button', { name: 'AIに相談', exact: true }).click();
  // An assistant reply is Markdown: it reaches the conversation as structure, not
  // as the characters the model wrote.
  await page.getByLabel('エージェント', { exact: true }).selectOption('pi');
  await page.getByLabel('エージェントへの指示').fill('markdown fixture');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect(page.locator('.message-markdown li').first()).toContainText('note.md を開く');
  await expect(page.locator('.message-markdown li').nth(1)).toContainText('見出しを追加');
  await expect(page.locator('.message-markdown h3').first()).toHaveText('手順');
  await expect(page.locator('.message-markdown pre code').first()).toContainText(
    'const ok = true;',
  );
  await expect(page.locator('.message-markdown').first()).not.toContainText('###');
  for (const agent of ['pi', 'opencode']) {
    await page.getByLabel('エージェント', { exact: true }).selectOption(agent);
    await settings().click();
    await expect(
      page.getByRole('button', { name: '会話の継続をリセット', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '会話の継続をリセット', exact: true }).click();
    await expect(page.getByText('次の実行で新しい会話を始めます。', { exact: true })).toBeVisible();
    await settings().click();
  }
  expect(errors).toEqual([]);
  await writeFile(
    'test-results/harness-ui-smoke.json',
    JSON.stringify(
      {
        evidence: 'Explicit protocol fixtures; no native model inference',
        checks: [
          'Pi/OpenCode panel selection',
          'compact assistant with optional session diagnostics and keyboard dismissal',
          'new conversation intent and cancellation preserve the composer',
          'native-shaped denial and question responses',
          'stream completion',
          'fixture mutation',
          'session status after restart',
          'per-provider reset',
          'history and queue retained across two host restarts',
          'no automatic replay, exact queued note selection and durable removal',
          'renderer reload stops native work and never restores live approval controls',
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
