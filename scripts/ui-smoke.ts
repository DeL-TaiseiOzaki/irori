import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { processTree } from './process-metrics';
import { FileService } from '../src/host/files';
import { sessionKey } from '../src/agents/sessions';
import { SettingsService } from '../src/host/settings';
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
// This suite exercises the hibachi agent, which is off until turned on (ADR 021).
await mkdir(path.join(base, 'device'), { recursive: true });
await new SettingsService(path.join(base, 'device')).save({ hibachiAgent: true });
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
// Measured before the restart and checked after it.
let chosenWidth = 0;
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
// Display choices live in the rail's settings, which stay open for several choices.
const openSettings = () => page.getByRole('button', { name: /^設定（/ }).click();
async function choose(theme: string) {
  await openSettings();
  await page.getByRole('radio', { name: theme, exact: true }).check();
  await page.keyboard.press('Escape');
}
try {
  await expect(page.getByRole('heading', { name: 'ワークスペースを選択' })).toBeVisible();
  await expect
    .poll(() =>
      page.locator('.brand-icon').evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    // The renderer carries a 256px mark; the full-resolution file stays for the
    // window, the dock and the installers.
    .toBe(256);
  const startupMs = Date.now() - launchStart;
  const createWorkspace = page.getByRole('button', { name: 'ワークスペースを作成', exact: true });
  await createWorkspace.hover();
  await expect(createWorkspace.locator('.obsidian-arrow-fill-btn__circle')).toHaveCSS(
    'clip-path',
    'inset(0px round 999px)',
  );
  await page.screenshot({ path: 'test-results/obsidian-startup.png', fullPage: true });
  await page.getByRole('button', { name: 'KBフォルダを開く' }).click();
  const registration = page.getByRole('dialog', { name: 'スペース登録' });
  await expect(registration).toBeVisible();
  await expect.poll(() => registration.evaluate((element) => element.matches(':modal'))).toBe(true);
  await expect(registration.getByLabel('KBフォルダ', { exact: true })).toBeFocused();
  // Obsidian's moving indicators keep Base UI's keyboard and pressed-value contract.
  const folderMode = registration.getByRole('button', { name: '既存のフォルダ', exact: true });
  const cloneMode = registration.getByRole('button', { name: 'GitHub から取得', exact: true });
  await expect(registration.getByRole('button', { name: '登録して開く' })).toBeDisabled();
  await folderMode.focus();
  await expect(folderMode).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('ArrowRight');
  await expect(cloneMode).toBeFocused();
  await expect(folderMode).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  await expect(cloneMode).toHaveAttribute('aria-pressed', 'true');
  await expect(registration.getByLabel('GitHub リポジトリ URL')).toBeVisible();
  await cloneMode.focus();
  await page.keyboard.press('Enter');
  await expect(cloneMode).toHaveAttribute('aria-pressed', 'true');
  // The OS setting takes effect while the dialog is already mounted.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(registration.locator('.obsidian-arrow-fill-btn__circle')).toHaveCSS(
    'transition-duration',
    '0s',
  );
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Space');
  await expect(folderMode).toHaveAttribute('aria-pressed', 'true');
  await expect(registration.getByLabel('KBフォルダ', { exact: true })).toBeVisible();
  const transforms = await folderMode
    .locator('.obsidian-magnet-marker')
    .evaluate(async (marker) => {
      const samples: string[] = [];
      for (let frame = 0; frame < 8; frame++) {
        await new Promise(requestAnimationFrame);
        samples.push(getComputedStyle(marker).transform);
      }
      return samples;
    });
  expect(transforms.every((transform) => transform === 'none')).toBe(true);
  await page.screenshot({ path: 'test-results/obsidian-registration.png', fullPage: true });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    await expect
      .poll(() => registration.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(registration).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'KBフォルダを開く' })).toBeFocused();
  await page.getByRole('button', { name: 'KBフォルダを開く' }).click();
  await page.getByLabel('KBフォルダ', { exact: true }).fill(kb);
  await page.getByLabel('スペース名', { exact: true }).fill('プロダクト');
  await page.getByText('分類', { exact: true }).click();
  await page.getByLabel('スペースの種類').selectOption('team');
  await page.getByRole('button', { name: '登録して開く' }).click();
  await page.getByRole('button', { name: '選択したスペースを開く' }).click();
  // The workspace opens on the first brain's home.
  await expect(page.getByRole('button', { name: 'ノートを作成', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/obsidian-workspace-hearth.png', fullPage: true });
  await choose('ダーク');
  await page.screenshot({
    path: 'test-results/obsidian-workspace-dark.png',
    fullPage: true,
    animations: 'disabled',
  });
  await choose('ライト');
  await page.screenshot({ path: 'test-results/obsidian-workspace-light.png', fullPage: true });
  await page.getByRole('button', { name: '日本語 note', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toContainText('顧客インタビュー');
  await expect(page.locator('.ProseMirror table.children')).toBeVisible();
  // The reader's own light/dark choice, applied at once and kept for next launch.
  const dark = () => page.evaluate(() => document.documentElement.dataset.theme === 'dark');
  await expect.poll(dark).toBe(false);
  await choose('ダーク');
  await expect.poll(dark).toBe(true);
  // The rendered note typeface changes without replacing the editor and is
  // kept in the same device record as the theme and pane sizes.
  await openSettings();
  for (const name of ['システム', '丸ゴシック', '教科書体'])
    await expect(page.getByRole('radio', { name, exact: true })).toBeAttached();
  await page.screenshot({ path: 'test-results/irori-settings.png', fullPage: true });
  await page.getByRole('radio', { name: '教科書体', exact: true }).check();
  await page.keyboard.press('Escape');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.markdownFont))
    .toBe('textbook');
  await expect
    .poll(() =>
      page.locator('.ProseMirror').evaluate((element) => getComputedStyle(element).fontFamily),
    )
    .toContain('UD Digi Kyokasho N-R');
  await choose('システムに合わせる');
  await expect.poll(dark).toBe(false);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe('hearth');
  await choose('ダーク');
  await expect.poll(dark).toBe(true);
  // Pane sizes are the reader's too, and the device record keeps both.
  const paneWidth = () =>
    page.locator('.brain-pane').evaluate((element) => element.getBoundingClientRect().width);
  const startWidth = await paneWidth();
  const handle = page.getByRole('separator', { name: 'hibachi パネルの幅', exact: true });
  const grip = (await handle.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 90, grip.y + grip.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(paneWidth).toBeGreaterThan(startWidth + 40);
  chosenWidth = await paneWidth();
  // Opening a rich document is not itself an edit.
  await expect(page.getByText('保存済み', { exact: true })).toBeVisible();
  if ((await readFile(path.join(kb, '日本語 note.md'), 'utf8')) !== input)
    throw Error('No-op changed Markdown bytes');
  await page.locator('.ProseMirror').evaluate((element) => {
    element.dataset.lifecycle = 'original';
  });
  await page.locator('.ProseMirror p').first().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('リッチ編集を保存します。');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('保存済み', { exact: true })).toBeVisible();
  if (
    !(await readFile(path.join(kb, '日本語 note.md'), 'utf8')).includes('リッチ編集を保存します。')
  )
    throw Error('Rich edit was not saved');
  await expect(page.locator('.ProseMirror')).toHaveAttribute('data-lifecycle', 'original');
  await expect(page.getByRole('button', { name: 'ソース', exact: true })).toHaveCount(0);
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\nUIで編集しました。\n');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('保存済み', { exact: true })).toBeVisible();
  // ProseMirror groups adjacent edits within its default 500 ms newGroupDelay.
  // Separate setup typing from the edit under test; saving does not close history.
  // Keep the following edit/save/undo immediate to catch the 200 ms listener race.
  await page.waitForTimeout(600);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('保存後も入力を続けます。');
  const selection = () =>
    editor.evaluate((element) => {
      const selected = window.getSelection();
      return {
        focused: element === document.activeElement,
        text: selected?.anchorNode?.textContent,
        offset: selected?.anchorOffset,
      };
    });
  const beforeSave = await selection();
  expect(beforeSave.focused).toBe(true);
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByText('保存済み', { exact: true })).toBeVisible();
  expect(await selection()).toEqual(beforeSave);
  await expect(editor).toHaveAttribute('data-lifecycle', 'original');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor).not.toContainText('保存後も入力を続けます。');
  await expect(editor).toContainText('UIで編集しました。');
  await expect
    .poll(async () =>
      (await readFile(path.join(kb, '日本語 note.md'), 'utf8')).includes(
        '保存後も入力を続けます。',
      ),
    )
    .toBe(false);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(editor).toContainText('保存後も入力を続けます。');
  await expect
    .poll(async () =>
      (await readFile(path.join(kb, '日本語 note.md'), 'utf8')).includes(
        '保存後も入力を続けます。',
      ),
    )
    .toBe(true);
  await page.keyboard.insertText('自動保存後も編集できます。');
  await expect
    .poll(async () =>
      (await readFile(path.join(kb, '日本語 note.md'), 'utf8')).includes(
        '自動保存後も編集できます。',
      ),
    )
    .toBe(true);
  await expect(editor).toHaveAttribute('data-lifecycle', 'original');
  await writeFile(path.join(kb, '日本語 note.md'), input + '\n外部の変更を反映しました。\n');
  await expect(page.locator('.document-editor')).toContainText('外部の変更を反映しました。');
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\n保持する下書き\n');
  await writeFile(path.join(kb, '日本語 note.md'), input + '\nエージェントの別の変更。\n');
  await expect(page.getByText('外部でノートが変更されました。')).toBeVisible();
  await expect(page.locator('.versions')).toContainText('保持する下書き');
  await expect(page.locator('.versions')).toContainText('エージェントの別の変更。');
  await page.getByRole('button', { name: 'ディスク版を表示' }).click();
  await page.getByRole('button', { name: '互換', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('互換編集');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('保存済み', { exact: true })).toBeVisible();
  const compatible = await readFile(path.join(kb, '互換.md'), 'utf8');
  if (
    !compatible.startsWith('\ufeff---\r\n# Keep this comment\r\nunknown: yes\r\n---') ||
    !compatible.includes('![[埋め込み]]') ||
    !compatible.includes('互換編集') ||
    /(?<!\r)\n/.test(compatible)
  )
    throw Error('Document edit lost BOM, CRLF or opaque Markdown');
  await page.getByRole('button', { name: '日本語 note', exact: true }).click();
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  const clipboardPng = await app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
    const png = nativeImage
      .createFromBitmap(Buffer.from([0x22, 0x66, 0xcc, 0xff]), {
        width: 1,
        height: 1,
      })
      .toPNG();
    await clipboard.write([
      new ClipboardItem({
        'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }),
      }),
    ]);
    const item = (await clipboard.read())[0];
    const image = (await item.getType('image/png')) as Blob;
    return Buffer.from(await image.arrayBuffer()).toString('base64');
  });
  await page.locator('.ProseMirror').evaluate((element) => {
    element.addEventListener(
      'paste',
      (event) => {
        element.setAttribute('data-native-paste', String(event.isTrusted));
      },
      { once: true },
    );
  });
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('.ProseMirror')).toHaveAttribute('data-native-paste', 'true');
  await expect
    .poll(() =>
      page
        .locator('.ProseMirror img')
        .evaluateAll((images) =>
          images.some((img) => (img as HTMLImageElement).naturalWidth === 1),
        ),
    )
    .toBe(true);
  await expect
    .poll(async () =>
      (await readFile(path.join(kb, '日本語 note.md'), 'utf8')).includes('_assets/image-'),
    )
    .toBe(true);
  const imageMarkdown = await readFile(path.join(kb, '日本語 note.md'), 'utf8');
  expect(imageMarkdown).not.toMatch(/blob:|data:image/);
  const imageRelative = imageMarkdown.match(/_assets\/image-[a-f0-9]+\.png/)![0];
  expect(await readFile(path.join(kb, imageRelative))).toEqual(Buffer.from(clipboardPng, 'base64'));
  await page.getByRole('button', { name: '互換', exact: true }).click();
  await page.getByRole('button', { name: '日本語 note', exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator('.ProseMirror img')
        .evaluateAll((images) =>
          images.some((img) => (img as HTMLImageElement).naturalWidth === 1),
        ),
    )
    .toBe(true);
  await expect(page.locator('.literal-block').filter({ hasText: '<br' })).toHaveCount(0);
  await page.getByRole('button', { name: 'hibachi agent', exact: true }).click();
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
      await page.getByRole('button', { name: '送信' }).click();
      if (agent === 'claude') {
        await page.locator('.ProseMirror').click();
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
        if (await page.getByRole('button', { name: '送信' }).isVisible()) {
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
        await page.getByRole('button', { name: 'ディスク版を表示' }).click();
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
      'Obsidian controls: keyboard switching, selected-value retention, native initial focus, disabled submit, live reduced motion and light/dark themes',
      'rich Markdown table',
      'rich Japanese edit/save',
      'no-op bytes',
      'repeated document save retaining focus, selection, undo/redo and editing after autosave',
      'native clipboard image paste, automatic save, relative bytes and reopen',
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
  // Seeded records from before ADR 017 exercise the migration, the history list and
  // deletion across process restarts. They do not represent a native provider resume.
  const files = new FileService(env.IRORI_DATA_DIR);
  await files.init();
  const space = files.list()[0];
  await rm(path.join(files.dataDir, 'conversations-migrated.json'), { force: true });
  for (const agent of ['codex', 'claude'] as const) {
    const binding = { scopeId: space.scopeId, root: space.root, agent };
    await mkdir(path.join(files.dataDir, 'agent-sessions'), { recursive: true });
    await writeFile(
      path.join(files.dataDir, 'agent-sessions', `${sessionKey(binding)}.json`),
      JSON.stringify({
        schemaVersion: 1,
        ...binding,
        handle: `fixture-${agent}-handle`,
        access: 'full-access',
        updatedAt: new Date().toISOString(),
      }),
    );
  }
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
      // The chosen theme and pane width survive the restart, before a workspace
      // is opened: the renderer's own storage does not persist on a file URL.
      await expect
        .poll(() => window.evaluate(() => document.documentElement.dataset.theme === 'dark'))
        .toBe(true);
      await expect
        .poll(() => window.evaluate(() => document.documentElement.dataset.markdownFont))
        .toBe('textbook');
      await window.locator('.workspace-card').filter({ hasText: 'マイワークスペース' }).click();
      await expect
        .poll(() =>
          window
            .locator('.brain-pane')
            .evaluate((element) => element.getBoundingClientRect().width),
        )
        .toBeGreaterThan(chosenWidth - 12);
      await window.getByRole('button', { name: 'hibachi agent', exact: true }).click();
      await window.getByRole('button', { name: '履歴', exact: true }).click();
      const history = window.getByRole('region', { name: '履歴' });
      const earlier = history.locator('.history-row').filter({ hasText: '以前の会話' });
      if (cycle === 1) {
        await expect(earlier).toHaveCount(2);
        await expect(earlier.filter({ hasText: 'Claude Code' })).toHaveCount(1);
        await history.getByRole('button', { name: '以前の会話 の操作' }).last().click();
        await window.getByRole('menuitem', { name: '削除' }).click();
        await history.getByRole('button', { name: '削除する', exact: true }).click();
      }
      // Deleted in the first run, it stays deleted; the migration does not run twice.
      await expect(earlier).toHaveCount(1);
      if (cycle === 2) await window.screenshot({ path: 'test-results/irori-session-recovery.png' });
      expect(errors).toEqual([]);
    } finally {
      await restarted.close();
    }
  }
  const report = {
    nativeProviderResume: 'not exercised',
    checks: [
      'saved handles migrated into conversations on restart',
      'conversation deleted through the history list',
      'deletion persists through a second restart without migrating again',
      'the other conversation retained',
    ],
    errors,
  };
  await writeFile('test-results/ui-sessions.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
