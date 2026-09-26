import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import type { Space } from '../src/domain/types';

async function checkConcurrentReconcile(
  app: ElectronApplication,
  page: Page,
  root: string,
  scopeId: string,
) {
  await expect(page.getByText('保存済み', { exact: true })).toBeVisible();
  // Hold actual read responses in the main-process fixture, never replacing the renderer's HostAPI.
  await app.evaluate(({ ipcMain }, scopeId) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;
    const original = (
      ipcMain as unknown as { _invokeHandlers: Map<string, Handler> }
    )._invokeHandlers.get('irori')!;
    const fixture = {
      original,
      holding: true,
      pending: [] as { value: unknown; resolve: (value: unknown) => void }[],
    };
    (globalThis as unknown as { gitReadFixture: typeof fixture }).gitReadFixture = fixture;
    ipcMain.removeHandler('irori');
    ipcMain.handle('irori', async (event, method, ...args) => {
      const result = await original(event, method, ...args);
      if (method !== 'read' || args[0] !== scopeId || args[1] !== 'README.md' || !fixture.holding)
        return result;
      return new Promise((resolve) => fixture.pending.push({ value: result, resolve }));
    });
  }, scopeId);
  try {
    const text = await readFile(path.join(root, 'README.md'), 'utf8');
    await writeFile(path.join(root, 'README.md'), `${text}\nConcurrent reconcile fixture\n`);
    await app.evaluate(({ BrowserWindow }, scopeId) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.webContents.send('irori:event', { type: 'files', scopeId });
      window.webContents.send('irori:event', { type: 'files', scopeId });
    }, scopeId);
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (globalThis as unknown as { gitReadFixture: { pending: unknown[] } }).gitReadFixture
              .pending.length,
        ),
      )
      .toBeGreaterThanOrEqual(2);
    await app.evaluate(() => {
      const fixture = (
        globalThis as unknown as {
          gitReadFixture: {
            holding: boolean;
            pending: { value: unknown; resolve: (value: unknown) => void }[];
          };
        }
      ).gitReadFixture;
      fixture.holding = false;
      const newest = fixture.pending.pop()!;
      newest.resolve(newest.value);
    });
    await expect(page.locator('.document-editor')).toContainText('Concurrent reconcile fixture');
    await app.evaluate(() => {
      const fixture = (
        globalThis as unknown as {
          gitReadFixture: {
            pending: { value: unknown; resolve: (value: unknown) => void }[];
          };
        }
      ).gitReadFixture;
      for (const pending of fixture.pending.splice(0)) pending.resolve(pending.value);
    });
    await page.evaluate(async (scopeId) => {
      await window.irori.gitStatus(scopeId);
      await new Promise(requestAnimationFrame);
    }, scopeId);
    await expect(page.locator('.conflict')).toHaveCount(0);
    await expect(page.locator('.document-editor')).toContainText('Concurrent reconcile fixture');
    await page.locator('.ProseMirror').click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.insertText('Saved after concurrent refresh\n');
    await page.keyboard.press('ControlOrMeta+s');
    await expect
      .poll(() => readFile(path.join(root, 'README.md'), 'utf8'))
      .toContain('Saved after concurrent refresh');
  } finally {
    await app.evaluate(({ ipcMain }) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;
      const fixture = (
        globalThis as unknown as {
          gitReadFixture: {
            original: Handler;
            pending: { value: unknown; resolve: (value: unknown) => void }[];
          };
        }
      ).gitReadFixture;
      for (const pending of fixture.pending) pending.resolve(pending.value);
      ipcMain.removeHandler('irori');
      ipcMain.handle('irori', fixture.original);
    });
  }
}

const base = await mkdtemp(path.join(tmpdir(), 'irori git UI '));
function git(root: string, ...args: string[]) {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=UI fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trimEnd();
}
const files = new FileService(path.join(base, 'device'));
await files.init();
const spaces: Space[] = [];
for (const [name, category] of [
  ['個人KB', 'personal'],
  ['チームKB', 'team'],
] as const) {
  const root = path.join(base, name);
  await mkdir(root);
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'UI fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  spaces.push(await files.register(root, name, category));
  await writeFile(path.join(root, 'README.md'), `# ${name}\n\nOriginal 日本語\n`);
  git(root, 'add', '.');
  git(root, 'commit', '-m', `${name} initial`);
}
const root = spaces[0].root,
  remote = path.join(base, 'remote.git'),
  peer = path.join(base, 'peer');
git(base, 'init', '--bare', '--initial-branch=main', remote);
git(root, 'remote', 'add', 'origin', remote);
git(root, 'push', '-u', 'origin', 'main');
git(base, 'clone', remote, peer);
// The repository carries a Git AI Standard note naming README's third line as a collaborator's.
const initial = git(root, 'rev-parse', 'HEAD');
execFileSync('git', ['notes', '--ref=ai', 'add', '-F', '-', initial], {
  cwd: root,
  input:
    'README.md\n  h_0123456789abcd 3\n---\n' +
    JSON.stringify({
      schema_version: 'authorship/3.0.0',
      base_commit_sha: initial,
      prompts: {},
      humans: { h_0123456789abcd: { author: 'Collaborator <c@example.invalid>' } },
    }),
  stdio: ['pipe', 'pipe', 'pipe'],
});
// URL rewriting is confined to this disposable test config. The product runs real Git clone.
const seed = path.join(base, 'seed'),
  cloneRemote = path.join(base, 'catalog.git');
await mkdir(seed);
git(seed, 'init', '-b', 'main');
git(seed, 'config', 'user.name', 'UI fixture');
git(seed, 'config', 'user.email', 'fixture@example.invalid');
git(seed, 'config', 'commit.gpgsign', 'false');
await writeFile(path.join(seed, 'README.md'), '# Catalog\n');
git(seed, 'add', '.');
git(seed, 'commit', '-m', 'Catalog initial');
const catalogCommit = git(seed, 'rev-parse', 'HEAD');
execFileSync('git', ['notes', '--ref=ai', 'add', '-F', '-', catalogCommit], {
  cwd: seed,
  input:
    'README.md\n  h_0123456789abcd 1\n---\n' +
    JSON.stringify({
      schema_version: 'authorship/3.0.0',
      base_commit_sha: catalogCommit,
      prompts: {},
      humans: { h_0123456789abcd: { author: 'Collaborator <c@example.invalid>' } },
    }),
  stdio: ['pipe', 'pipe', 'pipe'],
});
git(base, 'clone', '--bare', seed, cloneRemote);
git(seed, 'push', cloneRemote, 'refs/notes/ai:refs/notes/ai');
const globalConfig = path.join(base, 'gitconfig');
git(
  base,
  'config',
  '--file',
  globalConfig,
  `url.${cloneRemote}.insteadOf`,
  'https://github.com/irori-fixture/catalog.git',
);
git(
  base,
  'config',
  '--file',
  globalConfig,
  `url.${path.join(base, 'missing.git')}.insteadOf`,
  'https://github.com/irori-fixture/missing.git',
);
const env = {
  ...process.env,
  IRORI_DATA_DIR: files.dataDir,
  GIT_CONFIG_GLOBAL: globalConfig,
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
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  for (const box of await page.getByRole('checkbox').all()) await box.check();
  await page.getByRole('button', { name: '選択したスペースを開く' }).click();
  await page
    .getByRole('region', { name: 'Knowledge', exact: true })
    .getByRole('button', { name: 'README', exact: true })
    .click();
  await page.getByRole('button', { name: /^ノートの情報/ }).click();
  await expect(page.locator('.note-info')).toContainText('人が書いた・直した行: 1 行');
  await page.keyboard.press('Escape');
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\nUI saved 日本語\n');
  const modes = page.getByRole('group', { name: 'Brain の表示' });
  const notesView = modes.getByRole('button', { name: 'ファイル', exact: true });
  const gitView = modes.getByRole('button', { name: /^変更/ });
  await notesView.focus();
  await expect(notesView).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('ArrowRight');
  await expect(gitView).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(gitView).toHaveAttribute('aria-pressed', 'true');
  let sidebar = page.getByRole('region', { name: 'ソース管理' });
  let panel = page.locator('.git-sidebar, .git-workspace-detail');
  await expect(sidebar).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('Editing with source control open\n');
  await expect
    .poll(() => readFile(path.join(root, 'README.md'), 'utf8'))
    .toContain('Editing with source control open');
  await checkConcurrentReconcile(app, page, root, spaces[0].scopeId);
  await panel.getByRole('button', { name: '更新', exact: true }).click();
  await panel.locator('.git-file').filter({ hasText: 'README.md' }).click();
  await expect(panel.getByLabel('差分', { exact: true })).toContainText('+UI saved 日本語');
  await expect(panel.getByLabel('差分', { exact: true })).toContainText(
    'Editing with source control open',
  );
  await panel.getByRole('button', { name: 'ノートに戻る' }).click();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect(sidebar).toBeVisible();
  await panel.getByRole('button', { name: 'README.md をステージする', exact: true }).click();
  await expect(
    panel.getByRole('button', { name: 'README.md をステージから外す', exact: true }),
  ).toBeEnabled();
  expect(git(root, 'diff', '--cached', '--', 'README.md')).toContain('UI saved 日本語');
  await panel.getByRole('button', { name: 'README.md をステージから外す', exact: true }).click();
  await expect(
    panel.getByRole('button', { name: 'README.md をステージする', exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: 'test-results/irori-source-control.png' });
  await writeFile(path.join(root, 'extra.md'), '# Extra staged note');
  await panel.getByRole('button', { name: '更新', exact: true }).click();
  await panel.getByRole('button', { name: 'すべて追加', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('まとめて追加');
  await panel.getByRole('button', { name: 'すべて解除', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('すべて外しました');
  await panel.getByRole('button', { name: 'すべて追加', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('まとめて追加');
  await writeFile(path.join(root, 'extra.md'), '# Extra after staging');
  await panel.getByRole('button', { name: '更新', exact: true }).click();
  await expect(panel.locator('.git-file').filter({ hasText: 'extra.md' })).toHaveCount(2);
  // A burst of file events must refresh the open diff rather than restart it:
  // the view keeps its content and still ends on the newest bytes.
  await panel.locator('.git-file').filter({ hasText: 'extra.md' }).last().click();
  await expect(panel.getByLabel('差分', { exact: true })).toContainText('Extra after staging');
  for (const line of ['burst one', 'burst two', 'burst three'])
    await writeFile(path.join(root, 'extra.md'), `# Extra after staging\n\n${line}\n`);
  await expect(panel.getByLabel('差分', { exact: true })).toContainText('burst three');
  await expect(panel.getByLabel('差分', { exact: true })).not.toContainText('差分を読み込み中');
  await writeFile(path.join(root, 'extra.md'), '# Extra after staging');
  await expect(panel.getByLabel('差分', { exact: true })).not.toContainText('burst three');
  await panel.getByRole('button', { name: 'ノートに戻る' }).click();
  await panel.getByRole('textbox', { name: 'commit メッセージ' }).fill('UI note update');
  await panel.getByRole('button', { name: 'コミット', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('この端末の履歴に commit');
  expect(git(root, 'show', 'HEAD:README.md')).toContain('UI saved 日本語');
  expect(git(root, 'show', 'HEAD:extra.md')).toBe('# Extra staged note');
  // The line typed here is named as the committer's in the commit's own note.
  expect(git(root, 'notes', '--ref=ai', 'list').split('\n').filter(Boolean)).toHaveLength(2);
  expect(git(root, 'notes', '--ref=ai', 'show', 'HEAD')).toMatch(/^README\.md\n  h_[0-9a-f]{14} /);
  expect(await readFile(path.join(root, 'extra.md'), 'utf8')).toBe('# Extra after staging');
  await writeFile(path.join(root, 'extra.md'), '# Extra staged note');
  expect(git(remote, 'show', 'main:README.md')).not.toContain('UI saved 日本語');
  const changesView = panel.getByRole('button', { name: /^変更 \d+$/ });
  const historyView = panel.getByRole('button', { name: '履歴', exact: true });
  await changesView.focus();
  await expect(changesView).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('ArrowRight');
  await expect(historyView).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(historyView).toHaveAttribute('aria-pressed', 'true');
  await panel.locator('.git-history-item').filter({ hasText: 'UI note update' }).click();
  // Refreshing (or any file event) while the commit diff is in flight must not
  // discard the patch and leave the loading text on screen.
  await panel.getByRole('button', { name: '更新', exact: true }).click();
  await expect(panel.getByLabel('差分', { exact: true })).toContainText('UI saved 日本語');
  await page.screenshot({ path: 'test-results/irori-git-history.png' });
  // Changes belong to the brain on show; choosing another brain shows its repository.
  const rail = page.getByRole('navigation', { name: 'Brain' });
  await rail.getByRole('button', { name: /^チームKB・AI/ }).click();
  await expect(panel.locator('.git-repository-bar')).toContainText('リモート未設定');
  await panel.getByRole('button', { name: '履歴', exact: true }).click();
  await expect(panel.locator('.git-history-item')).toHaveCount(1);
  await expect(panel.locator('.git-history-item')).toContainText('チームKB initial');
  await rail.getByRole('button', { name: /^個人KB・AI/ }).click();
  await panel.getByRole('button', { name: 'Push', exact: true }).click();
  await expect(panel.getByRole('region', { name: 'Git 操作の確認' })).toContainText(
    'origin / main',
  );
  await panel.getByRole('button', { name: 'Push を実行', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('リモートへの送信が完了');
  expect(git(remote, 'show', 'main:README.md')).toContain('UI saved 日本語');
  expect(git(remote, 'rev-parse', 'refs/notes/ai')).toBe(git(root, 'rev-parse', 'refs/notes/ai'));

  git(peer, 'pull', '--ff-only');
  await writeFile(path.join(peer, 'README.md'), '# Peer 日本語\n');
  git(peer, 'add', '.');
  git(peer, 'commit', '-m', 'Peer competing change');
  git(peer, 'push');
  await writeFile(path.join(root, 'README.md'), '# Local 日本語\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'Local competing change');
  await panel.getByRole('button', { name: '更新', exact: true }).click();
  await panel.getByLabel('その他の Git 操作').click();
  await expect(panel.getByRole('menuitem', { name: 'Fetch', exact: true })).toBeEnabled();
  await panel.getByRole('menuitem', { name: 'Fetch', exact: true }).click();
  await expect(panel.locator('.git-repository-bar')).toContainText(
    '送信待ち 1 commit ・ 受信待ち 1 commit',
  );
  await panel.getByRole('button', { name: 'Pull', exact: true }).click();
  await panel.getByRole('button', { name: 'Pull を実行', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('分岐');
  await panel.getByLabel('その他の Git 操作').click();
  await panel.getByRole('menuitem', { name: '履歴を統合', exact: true }).click();
  await panel.getByRole('button', { name: '履歴の統合を開始' }).click();
  await expect(panel.locator('.git-warning')).toContainText('未解決 1 件');
  await panel.locator('.git-file').filter({ hasText: 'README.md' }).click();
  await expect(panel.getByRole('textbox', { name: '統合する内容' })).toContainText('<<<<<<<');
  await expect(panel.locator('.git-conflict-versions')).toContainText('Local 日本語');
  await expect(panel.locator('.git-conflict-versions')).toContainText('Peer 日本語');
  await panel
    .getByRole('textbox', { name: '統合する内容' })
    .fill('# Combined\n\nLocal 日本語\nPeer 日本語\n');
  await panel.getByRole('textbox', { name: 'commit メッセージ' }).fill('Unfinished merge message');
  await expect
    .poll(() =>
      page.evaluate(
        async (scopeId) =>
          (await window.irori.draftRead({ kind: 'git-resolution', scopeId, path: 'README.md' }))
            ?.text,
        spaces[0].scopeId,
      ),
    )
    .toBe('# Combined\n\nLocal 日本語\nPeer 日本語\n');
  await expect
    .poll(() =>
      page.evaluate(
        async (scopeId) => (await window.irori.draftRead({ kind: 'git-commit', scopeId }))?.text,
        spaces[0].scopeId,
      ),
    )
    .toBe('Unfinished merge message');
  await app.close();
  await writeFile(path.join(root, 'README.md'), 'Native content changed while irori was closed\n');
  app = await launch();
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
  await page.locator('.workspace-card').filter({ hasText: 'マイワークスペース' }).click();
  await page
    .getByRole('region', { name: 'Knowledge', exact: true })
    .getByRole('button', { name: 'README', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Brain の表示' })
    .getByRole('button', { name: /^変更/ })
    .click();
  sidebar = page.getByRole('region', { name: 'ソース管理' });
  panel = page.locator('.git-sidebar, .git-workspace-detail');
  await expect(panel.getByRole('textbox', { name: 'commit メッセージ' })).toHaveValue(
    'Unfinished merge message',
  );
  await panel.locator('.git-file').filter({ hasText: 'README.md' }).click();
  await expect(panel.getByRole('region', { name: '統合の下書きの復元' })).toContainText(
    'Git の状態が変わっています',
  );
  await expect(panel.getByRole('textbox', { name: '統合する内容' })).toHaveValue(
    'Native content changed while irori was closed\n',
  );
  await panel.getByRole('button', { name: '下書きを編集に戻す', exact: true }).click();
  await expect(panel.getByRole('textbox', { name: '統合する内容' })).toHaveValue(
    '# Combined\n\nLocal 日本語\nPeer 日本語\n',
  );
  expect(await readFile(path.join(root, 'README.md'), 'utf8')).toBe(
    'Native content changed while irori was closed\n',
  );
  await page.screenshot({ path: 'test-results/irori-git-conflict.png' });
  // An unresolved merge keeps the Changes view and the brain in place.
  await expect(page.getByRole('button', { name: 'ファイル', exact: true })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'ノートに戻る' })).toBeDisabled();
  await expect(
    page.getByRole('navigation', { name: 'Brain' }).getByRole('button', { name: /^チームKB・AI/ }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(sidebar).toBeVisible();
  await writeFile(path.join(root, 'README.md'), 'External conflict working copy\n');
  // A refused resolution reads the conflict again at once, and again after the status
  // refresh that follows; that second read briefly disables the resolve button. Count
  // the host's completed conflict reads, so the next click cannot land while it is
  // disabled (which on a loaded runner silently lost the click).
  await app.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;
    const original = (
      ipcMain as unknown as { _invokeHandlers: Map<string, Handler> }
    )._invokeHandlers.get('irori')!;
    const reads = { original, conflicts: 0 };
    (globalThis as unknown as { conflictReads: typeof reads }).conflictReads = reads;
    ipcMain.removeHandler('irori');
    ipcMain.handle('irori', async (event, method, ...args) => {
      const result = await original(event, method, ...args);
      if (method === 'gitConflict') reads.conflicts++;
      return result;
    });
  });
  await panel.getByRole('button', { name: '統合内容を保存して解決' }).click();
  await expect(panel.getByRole('alert')).toContainText('確認後');
  await expect
    .poll(() =>
      app.evaluate(
        () =>
          (globalThis as unknown as { conflictReads: { conflicts: number } }).conflictReads
            .conflicts,
      ),
    )
    .toBeGreaterThanOrEqual(2);
  await app.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;
    const { original } = (globalThis as unknown as { conflictReads: { original: Handler } })
      .conflictReads;
    ipcMain.removeHandler('irori');
    ipcMain.handle('irori', original);
  });
  await expect(page.getByRole('region', { name: 'Git の差分' })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await expect(panel.getByRole('textbox', { name: '統合する内容' })).toHaveValue(
    '# Combined\n\nLocal 日本語\nPeer 日本語\n',
  );
  expect(await readFile(path.join(root, 'README.md'), 'utf8')).toBe(
    'External conflict working copy\n',
  );
  await panel.getByRole('button', { name: '統合内容を保存して解決' }).click();
  await expect(panel.locator('.git-warning')).toContainText('未解決 0 件');
  await expect
    .poll(() =>
      page.evaluate(
        async (scopeId) =>
          (await window.irori.draftRead({ kind: 'git-resolution', scopeId, path: 'README.md' }))
            ?.text,
        spaces[0].scopeId,
      ),
    )
    .toBe(null);
  await panel.getByRole('textbox', { name: 'commit メッセージ' }).fill('Merge reviewed versions');
  await panel.getByRole('button', { name: 'コミット', exact: true }).click();
  try {
    await expect(
      panel.getByRole('status').filter({ hasText: 'この端末の履歴に commit しました。' }),
    ).toBeVisible();
  } catch (error) {
    console.error(
      JSON.stringify({
        mergeCommitDiagnostics: {
          alerts: await page.getByRole('alert').allTextContents(),
          status: await page.getByRole('status').allTextContents(),
          head: git(root, 'log', '-1', '--format=%s'),
          changes: git(root, 'status', '--porcelain'),
          document: await readFile(path.join(root, 'README.md'), 'utf8'),
          editor: await page.locator('.document-editor').allTextContents(),
        },
      }),
    );
    throw error;
  }
  await expect(panel.locator('.git-warning')).toHaveCount(0);
  expect(git(root, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(3);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 800));
  const bounds = await sidebar.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1024);
  await page.getByRole('button', { name: 'ファイル', exact: true }).click();
  await expect(sidebar).toHaveCount(0);
  await expect(page.locator('.document-editor')).toContainText('Combined');

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
  await page.getByRole('button', { name: 'Brain を追加', exact: true }).click();
  await page.getByRole('button', { name: 'GitHub から取得', exact: true }).click();
  const registration = page.getByRole('form', { name: 'スペース登録' });
  // Nothing to preview yet, so no empty panel sits under the form.
  await expect(registration.locator('.repository-preview')).toBeHidden();
  await page
    .getByRole('textbox', { name: 'GitHub リポジトリ URL' })
    .fill('https://github.com/irori-fixture/missing.git');
  await page.getByRole('textbox', { name: '保存先の親フォルダ' }).fill(base);
  await page.getByRole('textbox', { name: '新しいフォルダ名' }).fill('取得した KB');
  await page.getByRole('button', { name: 'リポジトリを取得', exact: true }).click();
  // A failed clone gives advice once, folds Git's own output, and leaves no folder behind.
  const failure = registration.getByRole('alert');
  await expect(failure.locator('p')).toHaveText(
    '接続先・ネットワーク・アクセス権を確認してから再試行してください。',
  );
  await expect(failure).not.toContainText('Error:');
  await expect(failure).not.toContainText('保持');
  await expect(failure.locator('pre')).toBeHidden();
  await failure.getByText('詳細', { exact: true }).click();
  await expect(failure.locator('pre')).toContainText('missing.git');
  await expect(failure.locator('pre')).not.toContainText('Cloning into');
  await expect(readFile(path.join(base, '取得した KB'))).rejects.toMatchObject({ code: 'ENOENT' });
  // The same folder name works on the next attempt.
  await page
    .getByRole('textbox', { name: 'GitHub リポジトリ URL' })
    .fill('https://github.com/irori-fixture/catalog.git');
  await page.getByRole('button', { name: 'リポジトリを取得', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'KBフォルダ', exact: true })).toHaveValue(
    path.join(base, '取得した KB'),
  );
  expect(await readFile(path.join(base, '取得した KB/README.md'), 'utf8')).toBe('# Catalog\n');
  expect(git(path.join(base, '取得した KB'), 'notes', '--ref=ai', 'show', 'HEAD')).toContain(
    'h_0123456789abcd 1',
  );
  await page.getByRole('button', { name: '登録して開く', exact: true }).click();
  await expect(page.getByRole('form', { name: 'スペース登録' })).toHaveCount(0);
  expect(JSON.parse(await readFile(path.join(files.dataDir, 'spaces.json'), 'utf8'))).toHaveLength(
    3,
  );
  expect(errors).toEqual([]);
  await writeFile(
    'test-results/git-ui-smoke.json',
    JSON.stringify(
      {
        checks: [
          'Git review flushes the current editor',
          'late duplicate file-read responses cannot invent an external conflict or block a later save',
          'nonmodal source control keeps the note editable and autosaving',
          'diff returns to the mounted note without closing source control',
          'row and bulk stage/unstage and direct local commit through reviewed file list',
          'partial staging commits the index and preserves later worktree edits',
          'per-space history isolation',
          'explicit single-branch push to disposable bare remote',
          'fetch and divergent receive refusal',
          'native merge, both conflict versions, manual resolution and merge commit',
          'dirty conflict blocks closing, repository switching and returning to the note',
          'unsent commit message and conflict resolution draft survive a full Electron restart',
          'stale conflict draft restores only explicitly and never overwrites the native file until resolution',
          'successful conflict resolution acknowledges and durably clears its draft',
          'editor refresh after source control closes',
          '1024px sidebar bounds',
          'a failed clone folds redacted Git output under one advice line and removes its empty folder',
          'real Git clone with fixture-only URL rewrite and normal scope registration',
          "a collaborator's h_ line in refs/notes/ai counts for the open note, a commit names the lines typed here as the committer's, and Push carries the ref",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'Git UI checks passed with real disposable Git repositories; no live GitHub or model calls.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
