import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { processTree } from './process-metrics';
import { FileService } from '../src/host/files';
import { SessionStore } from '../src/agents/sessions';
const base = await mkdtemp(path.join(tmpdir(), 'irori UI 日本語 '));
const kb = path.join(base, 'KB folder');
await mkdir(kb);
const input =
  '# 顧客インタビュー\n\n最初の成功体験を、もっと早く。\n\n- 最初の設定は少なく。\n- 具体例を見せる。\n\n| 観点 | 学び |\n| --- | --- |\n| 体験 | 小さく始める |\n';
await writeFile(path.join(kb, '日本語 note.md'), input);
const opaque =
  '\ufeff---\r\n# Keep this comment\r\nunknown: yes\r\n---\r\n# 互換ノート\r\n\r\n![[埋め込み]]\r\n';
await writeFile(path.join(kb, '互換.md'), opaque);
await writeFile(
  path.join(kb, 'CLAUDE.md'),
  'Only edit the note selected by the user in this disposable fixture KB. Do not access files outside it.\n',
);
await writeFile(
  path.join(kb, 'AGENTS.md'),
  'Only edit the note selected by the user in this disposable fixture KB. Do not access files outside it.\n',
);
const launchStart = Date.now();
const env: Record<string, string> = Object.fromEntries(
  Object.entries({ ...process.env, IRORI_DATA_DIR: path.join(base, 'device') }).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [
    ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '.',
  ],
  env,
  timeout: 30000,
});
const errors: string[] = [];
let peak: Awaited<ReturnType<typeof processTree>>;
let samples = 0;
let sampling = false;
const sampler = setInterval(() => {
  if (sampling) return;
  sampling = true;
  void processTree(app.process().pid!)
    .then((sample) => {
      samples++;
      if (sample && (!peak || sample.totalRssKiB > peak.totalRssKiB)) peak = sample;
    })
    .finally(() => {
      sampling = false;
    });
}, 500);
const page = await app.firstWindow();
page.on('pageerror', (error) => errors.push(String(error)));
try {
  await expect(page.getByRole('heading', { name: 'ワークスペースを選択' })).toBeVisible();
  await expect
    .poll(() =>
      page.locator('.brand-icon').evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBe(1254);
  const startupMs = Date.now() - launchStart;
  await page.getByRole('button', { name: 'KBフォルダを開く' }).click();
  await page.getByLabel('KBフォルダ', { exact: true }).fill(kb);
  await page.getByLabel('スペース名', { exact: true }).fill('プロダクト');
  await page.getByLabel('スペースの種類').selectOption('team');
  await page.getByRole('button', { name: '登録して開く' }).click();
  await page.getByRole('button', { name: '選択したスペースを開く' }).click();
  await page.getByRole('button', { name: '日本語 note', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toContainText('顧客インタビュー');
  await expect(page.locator('.ProseMirror table.children')).toBeVisible();
  // Opening a rich document is not itself an edit.
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  if ((await readFile(path.join(kb, '日本語 note.md'), 'utf8')) !== input)
    throw Error('No-op changed Markdown bytes');
  await page.locator('.ProseMirror p').first().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('リッチ編集を保存します。');
  await page.getByRole('button', { name: '保存 •', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  if (
    !(await readFile(path.join(kb, '日本語 note.md'), 'utf8')).includes('リッチ編集を保存します。')
  )
    throw Error('Rich edit was not saved');
  await page.getByRole('button', { name: 'ソース', exact: true }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\nUIで編集しました。\n');
  await page.getByRole('button', { name: '保存 •', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await writeFile(path.join(kb, '日本語 note.md'), input + '\n外部の変更を反映しました。\n');
  await expect(page.locator('.document-editor')).toContainText('外部の変更を反映しました。');
  await page.getByRole('button', { name: 'ソース', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\n保持する下書き\n');
  await writeFile(path.join(kb, '日本語 note.md'), input + '\nエージェントの別の変更。\n');
  await expect(
    page.getByText('外部でノートが変更されました。未保存の編集を保持しています。'),
  ).toBeVisible();
  await expect(page.locator('.versions')).toContainText('保持する下書き');
  await expect(page.locator('.versions')).toContainText('エージェントの別の変更。');
  await page.getByRole('button', { name: 'ディスク版を表示（下書きは保持）' }).click();
  await page.getByRole('button', { name: '互換', exact: true }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('互換編集');
  await page.getByRole('button', { name: '保存 •', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  if ((await readFile(path.join(kb, '互換.md'), 'utf8')) !== opaque + '互換編集')
    throw Error('Source edit lost BOM, CRLF or opaque Markdown');
  await page.getByRole('button', { name: '日本語 note', exact: true }).click();
  await page.getByRole('button', { name: 'AIに相談', exact: true }).click();
  const realResults: unknown[] = [];
  if (process.env.IRORI_UI_REAL_AGENTS === '1') {
    for (const agent of ['codex', 'claude']) {
      await page.getByLabel('エージェント', { exact: true }).selectOption(agent);
      const marker = `UI_${agent.toUpperCase()}_VERIFIED`;
      await page
        .getByLabel('エージェントへの指示')
        .fill(
          `Read the selected note and append exactly one paragraph: ${marker}. Use your native tools; shell reads and apply_patch are allowed. Only change this note. Preserve all existing Japanese text. Then report completion.`,
        );
      await page.getByRole('button', { name: '保存して実行 ↗' }).click();
      if (agent === 'claude') {
        await page.getByRole('button', { name: 'ソース', exact: true }).click();
        await page.locator('.cm-content').click();
        await page.keyboard.press('ControlOrMeta+End');
        await page.keyboard.insertText('\n実行中の下書き\n');
      }
      const deadline = Date.now() + 150000;
      let completed = false;
      while (Date.now() < deadline) {
        const permits = page.getByRole('button', { name: '今回のみ許可', exact: true });
        if (await permits.count()) {
          const request = page.locator('.request').filter({ has: permits.first() });
          const details = (await request.locator('pre').textContent()) ?? '';
          const safe =
            details.includes('日本語 note.md') && !/curl|wget|https?:|rm -|sudo/.test(details);
          await request
            .getByRole('button', { name: safe ? '今回のみ許可' : '拒否', exact: true })
            .click();
        }
        if (await page.getByRole('button', { name: '保存して実行 ↗' }).isVisible()) {
          completed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!completed) {
        await page.getByRole('button', { name: '停止', exact: true }).click();
        throw Error(`${agent} UI run timed out`);
      }
      if (agent === 'claude') {
        await expect(page.locator('.versions')).toContainText(marker, { timeout: 10000 });
        await expect(page.locator('.versions')).toContainText('実行中の下書き');
        await page.getByRole('button', { name: 'ディスク版を表示（下書きは保持）' }).click();
      }
      await expect(page.locator('.document-editor')).toContainText(marker, { timeout: 10000 });
      const bytes = await readFile(path.join(kb, '日本語 note.md'), 'utf8');
      if (!bytes.includes(marker)) throw Error(`${agent} did not mutate the note`);
      realResults.push({
        agent,
        modified: true,
        editorReflected: true,
        dirtyAgentConflict: agent === 'claude',
      });
    }
  }
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/irori-desktop.png', fullPage: true });
  const metrics = await app.evaluate(({ app }) =>
    app.getAppMetrics().map((m) => ({ type: m.type, pid: m.pid, memory: m.memory, cpu: m.cpu })),
  );
  const report = {
    fixture: base,
    startupMs,
    realResults,
    errors,
    metrics,
    processTreePeak: peak,
    processTreeSamples: samples,
    checks: [
      'folder registration',
      'rich Markdown table',
      'rich Japanese edit/save',
      'no-op bytes',
      'source save',
      'edited BOM/CRLF/frontmatter preservation',
      'clean external refresh',
      'dirty conflict',
    ],
    rootTestSandboxDisabled: process.platform === 'linux' && process.getuid?.() === 0,
  };
  await writeFile(
    process.env.IRORI_UI_REAL_AGENTS === '1'
      ? 'test-results/ui-smoke-real.json'
      : 'test-results/ui-smoke.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  expect(errors).toEqual([]);
} finally {
  clearInterval(sampler);
  await app.close();
}

if (process.env.IRORI_UI_REAL_AGENTS !== '1') {
  // Seeded handles exercise actual host persistence/IPC/UI across process restarts.
  // They do not represent a successful native provider resume.
  const files = new FileService(env.IRORI_DATA_DIR);
  await files.init();
  const space = files.list()[0];
  const store = new SessionStore(files.dataDir);
  for (const agent of ['codex', 'claude'] as const)
    await store.save(
      { scopeId: space.scopeId, root: space.root, agent },
      `fixture-${agent}-handle`,
    );
  const savedText = '次の実行で前回の会話を引き継ぎます。会話本文の再表示には未対応です。';
  for (const cycle of [1, 2]) {
    const restarted = await electron.launch({
      args: [
        ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
        '.',
      ],
      env,
      timeout: 30000,
    });
    try {
      const window = await restarted.firstWindow();
      window.on('pageerror', (error) => errors.push(String(error)));
      await window.locator('.workspace-card').filter({ hasText: 'マイワークスペース' }).click();
      await window.getByRole('button', { name: 'AIに相談', exact: true }).click();
      await expect(window.getByText(savedText, { exact: true })).toBeVisible();
      await window.getByLabel('エージェント', { exact: true }).selectOption('claude');
      if (cycle === 1) {
        await expect(window.getByText(savedText, { exact: true })).toBeVisible();
        await window.getByRole('button', { name: '会話の継続をリセット', exact: true }).click();
      }
      await expect(
        window.getByText('次の実行で新しい会話を始めます。', { exact: true }),
      ).toBeVisible();
      await expect(
        window.getByRole('button', { name: '会話の継続をリセット', exact: true }),
      ).toHaveCount(0);
      await window.getByLabel('エージェント', { exact: true }).selectOption('codex');
      await expect(window.getByText(savedText, { exact: true })).toBeVisible();
      if (cycle === 2) await window.screenshot({ path: 'test-results/irori-session-recovery.png' });
      expect(errors).toEqual([]);
    } finally {
      await restarted.close();
    }
  }
  const report = {
    nativeProviderResume: 'not exercised',
    checks: [
      'saved handle status after host process restart',
      'provider-specific reset through ordinary panel',
      'reset persists through second restart',
      'other provider session retained',
    ],
    errors,
  };
  await writeFile('test-results/ui-sessions.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
