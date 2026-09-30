import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import type { Space } from '../src/domain/types';

async function checkUnrelatedFileEvent(
  app: ElectronApplication,
  page: Page,
  scopeId: string,
  otherScopeId: string,
) {
  await expect(page.getByText('保存済み', { exact: true })).toBeVisible();
  await app.evaluate(({ ipcMain }, scopeId) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;
    const original = (
      ipcMain as unknown as { _invokeHandlers: Map<string, Handler> }
    )._invokeHandlers.get('irori')!;
    const fixture = { original, reads: 0, declarations: 0 };
    (globalThis as unknown as { unrelatedReadFixture: typeof fixture }).unrelatedReadFixture =
      fixture;
    ipcMain.removeHandler('irori');
    ipcMain.handle('irori', (event, method, ...args) => {
      if (method === 'read' && args[0] === scopeId && args[1] === 'README.md') fixture.reads++;
      if (method === 'notesDeclaration' && args[0] === scopeId) fixture.declarations++;
      return original(event, method, ...args);
    });
  }, scopeId);
  const counts = () =>
    app.evaluate(() => {
      const { reads, declarations } = (
        globalThis as unknown as { unrelatedReadFixture: { reads: number; declarations: number } }
      ).unrelatedReadFixture;
      return { reads, declarations };
    });
  try {
    await app.evaluate(({ BrowserWindow }, scopeId) => {
      BrowserWindow.getAllWindows()[0].webContents.send('irori:event', { type: 'files', scopeId });
    }, otherScopeId);
    // Declaration refresh proves the renderer received the file event. A file
    // in another hibachi must not reread the whole document open in this one.
    await expect.poll(async () => (await counts()).declarations).toBeGreaterThan(0);
    expect((await counts()).reads).toBe(0);
    await app.evaluate(({ BrowserWindow }, scopeId) => {
      BrowserWindow.getAllWindows()[0].webContents.send('irori:event', { type: 'files', scopeId });
    }, scopeId);
    await expect.poll(async () => (await counts()).reads).toBe(1);
  } finally {
    await app.evaluate(({ ipcMain }) => {
      const fixture = (
        globalThis as unknown as {
          unrelatedReadFixture: { original: (...args: unknown[]) => unknown };
        }
      ).unrelatedReadFixture;
      ipcMain.removeHandler('irori');
      ipcMain.handle('irori', fixture.original);
    });
  }
}

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
// Hibachis made in the app commit with the person's own identity.
git(base, 'config', '--file', globalConfig, 'user.name', 'UI fixture');
git(base, 'config', '--file', globalConfig, 'user.email', 'fixture@example.invalid');
git(base, 'config', '--file', globalConfig, 'commit.gpgsign', 'false');
// A stand-in for the GitHub CLI, signed in as `octo` with the organization `team-a`.
// `repo create` makes a bare repository and points the new github.com URL at it,
// except for `octo/taken`, which GitHub refuses as an existing name.
const ghBin = path.join(base, 'bin'),
  ghLog = path.join(base, 'gh.log'),
  github = path.join(base, 'github');
await mkdir(ghBin);
await writeFile(
  path.join(ghBin, 'gh'),
  `#!/bin/sh
printf '%s|%s\\n' "$GH_HOST" "$*" >> '${ghLog}'
case "$*" in
  "api user --jq .login") echo octo ;;
  "api user/orgs --paginate --jq .[].login") echo team-a ;;
  "config get git_protocol --host github.com") echo https ;;
  "repo create octo/taken "*)
    echo 'GraphQL: Name already exists on this account (createRepository)' >&2; exit 1 ;;
  "repo create "*)
    bare='${github}'/"$3.git"
    git init --quiet --bare "$bare" &&
      git config --file "$GIT_CONFIG_GLOBAL" "url.$bare.insteadOf" "https://github.com/$3.git" || exit 1
    echo "https://github.com/$3" ;;
  *) echo "unknown command $*" >&2; exit 1 ;;
esac
`,
);
await chmod(path.join(ghBin, 'gh'), 0o755);
const ghCalls = async () =>
  (await readFile(ghLog, 'utf8').catch(() => '')).split('\n').filter(Boolean);
const env = {
  ...process.env,
  IRORI_DATA_DIR: files.dataDir,
  GIT_CONFIG_GLOBAL: globalConfig,
  PATH: [ghBin, process.env.PATH].filter(Boolean).join(path.delimiter),
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
  await expect(page.locator('.note-info')).toContainText('人が書いた行 1');
  await page.keyboard.press('Escape');
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\nUI saved 日本語\n');
  const modes = page.getByRole('group', { name: 'hibachi の表示' });
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
  await checkUnrelatedFileEvent(app, page, spaces[0].scopeId, spaces[1].scopeId);
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
  await expect(panel.getByRole('status')).toContainText('すべて追加しました');
  await panel.getByRole('button', { name: 'すべて解除', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('すべて外しました');
  await panel.getByRole('button', { name: 'すべて追加', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('すべて追加しました');
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
  await expect(panel.getByRole('status')).toContainText('コミットしました');
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
  const rail = page.getByRole('navigation', { name: 'hibachi' });
  await rail.getByRole('button', { name: /^チームKB・AI/ }).click();
  await expect(panel.locator('.git-repository-bar')).toContainText('リモート未設定');
  await panel.getByRole('button', { name: '履歴', exact: true }).click();
  await expect(panel.locator('.git-history-item')).toHaveCount(1);
  await expect(panel.locator('.git-history-item')).toContainText('チームKB initial');
  await rail.getByRole('button', { name: /^個人KB・AI/ }).click();
  await panel.getByRole('button', { name: 'Push', exact: true }).click();
  const confirmation = panel.getByRole('region', { name: 'Git 操作の確認' });
  await expect(confirmation).toContainText('origin / main');
  await confirmation.getByRole('button', { name: 'Push', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('送信しました');
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
  await confirmation.getByRole('button', { name: 'Pull', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('分岐');
  await panel.getByLabel('その他の Git 操作').click();
  await panel.getByRole('menuitem', { name: '履歴を統合', exact: true }).click();
  await confirmation.getByRole('button', { name: '統合', exact: true }).click();
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
    .getByRole('group', { name: 'hibachi の表示' })
    .getByRole('button', { name: /^変更/ })
    .click();
  sidebar = page.getByRole('region', { name: 'ソース管理' });
  panel = page.locator('.git-sidebar, .git-workspace-detail');
  await expect(panel.getByRole('textbox', { name: 'commit メッセージ' })).toHaveValue(
    'Unfinished merge message',
  );
  await panel.locator('.git-file').filter({ hasText: 'README.md' }).click();
  await expect(panel.getByRole('region', { name: '統合の下書きの復元' })).toContainText(
    'Git の状態が変わりました',
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
    page
      .getByRole('navigation', { name: 'hibachi' })
      .getByRole('button', { name: /^チームKB・AI/ }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(sidebar).toBeVisible();
  await writeFile(path.join(root, 'README.md'), 'External conflict working copy\n');
  // A refused resolution reads the conflict again at once, and again after the status
  // refresh that follows. Hold that second read so it is still in flight when the
  // person resolves: the button stays usable (a click was once lost to it being
  // disabled), and the held read, answered late, does not report the resolved file.
  await app.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;
    const original = (
      ipcMain as unknown as { _invokeHandlers: Map<string, Handler> }
    )._invokeHandlers.get('irori')!;
    const fixture = { original, reads: 0, held: [] as (() => void)[] };
    (globalThis as unknown as { conflictReads: typeof fixture }).conflictReads = fixture;
    ipcMain.removeHandler('irori');
    ipcMain.handle('irori', async (event, method, ...args) => {
      if (method !== 'gitConflict' || ++fixture.reads < 2) return original(event, method, ...args);
      await new Promise<void>((resolve) => fixture.held.push(resolve));
      return original(event, method, ...args);
    });
  });
  await panel.getByRole('button', { name: '統合内容を保存して解決' }).click();
  await expect(panel.getByRole('alert')).toContainText('確認後');
  await expect
    .poll(() =>
      app.evaluate(
        () =>
          (globalThis as unknown as { conflictReads: { held: unknown[] } }).conflictReads.held
            .length,
      ),
    )
    .toBe(1);
  const review = page.getByRole('region', { name: 'Git の差分' });
  await expect(review).toHaveAttribute('aria-busy', 'true');
  await expect(panel.getByRole('textbox', { name: '統合する内容' })).toHaveValue(
    '# Combined\n\nLocal 日本語\nPeer 日本語\n',
  );
  expect(await readFile(path.join(root, 'README.md'), 'utf8')).toBe(
    'External conflict working copy\n',
  );
  const resolve = panel.getByRole('button', { name: '統合内容を保存して解決' });
  await expect(resolve).toBeEnabled();
  await resolve.click();
  await expect(panel.locator('.git-warning')).toContainText('未解決 0 件');
  await app.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;
    const fixture = (
      globalThis as unknown as { conflictReads: { original: Handler; held: (() => void)[] } }
    ).conflictReads;
    ipcMain.removeHandler('irori');
    ipcMain.handle('irori', fixture.original);
    for (const release of fixture.held.splice(0)) release();
  });
  // Host replies arrive in order, so this round trip follows the released read's answer.
  await page.evaluate(async (scopeId) => {
    await window.irori.gitStatus(scopeId);
    await new Promise(requestAnimationFrame);
  }, spaces[0].scopeId);
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(review).toHaveAttribute('aria-busy', 'false');
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
    await expect(panel.getByRole('status').filter({ hasText: 'コミットしました。' })).toBeVisible();
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
  await page.getByRole('button', { name: 'hibachi を追加', exact: true }).click();
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

  // A hibachi made in the app, published in the same step. GitHub refuses the
  // first name; the hibachi stays created and is published from Source control.
  await page.getByRole('button', { name: 'hibachi を追加', exact: true }).click();
  const creation = page.getByRole('form', { name: 'スペース登録' });
  await creation.getByRole('button', { name: '新しく作成', exact: true }).click();
  await creation.getByRole('textbox', { name: '保存先の親フォルダ' }).fill(base);
  await creation.getByRole('textbox', { name: '新しいフォルダ名' }).fill('new-hibachi');
  await creation.getByRole('textbox', { name: 'スペース名' }).fill('新しい hibachi');
  await expect(creation.getByRole('button', { name: '作成して開く', exact: true })).toBeEnabled();
  await creation.getByRole('checkbox', { name: 'GitHub にも作成' }).check();
  await expect(creation.getByRole('combobox', { name: 'GitHub アカウント' })).toHaveValue('octo');
  await expect(creation.getByRole('combobox', { name: '公開範囲' })).toHaveValue('private');
  const repositoryName = creation.getByRole('textbox', { name: 'リポジトリ名' });
  await expect(repositoryName).toHaveValue('new-hibachi');
  await repositoryName.fill('bad name');
  await expect(creation.getByRole('button', { name: '作成して公開', exact: true })).toBeDisabled();
  await repositoryName.fill('taken');
  await creation.getByRole('button', { name: '作成して公開', exact: true }).click();
  const partial = creation.getByRole('alert');
  await expect(partial).toContainText('hibachi は作成しましたが');
  await expect(partial).toContainText('同じ名前のリポジトリが GitHub にすでにあります');
  const created = path.join(base, 'new-hibachi');
  expect(git(created, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n').sort()).toEqual([
    '.gitignore',
    '.irori/scope.json',
  ]);
  expect(git(created, 'log', '-1', '--format=%s')).toBe('hibachi「新しい hibachi」を作成');
  expect(git(created, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
  expect(git(created, 'remote')).toBe('');
  await creation.getByRole('button', { name: '開く', exact: true }).click();
  await expect(page.getByRole('form', { name: 'スペース登録' })).toHaveCount(0);
  await page
    .getByRole('group', { name: 'hibachi の表示' })
    .getByRole('button', { name: /^変更/ })
    .click();
  panel = page.locator('.git-sidebar, .git-workspace-detail');
  await expect(panel.locator('.git-remote')).toContainText('リモート未設定');
  await panel.getByRole('button', { name: 'GitHub に公開…', exact: true }).click();
  let publication = page.getByRole('form', { name: 'GitHub に公開' });
  await expect(publication.getByRole('combobox', { name: 'GitHub アカウント' })).toHaveValue(
    'octo',
  );
  await expect(publication.getByRole('textbox', { name: 'リポジトリ名' })).toHaveValue(
    'new-hibachi',
  );
  await publication.getByRole('button', { name: '作成して送信', exact: true }).click();
  await expect(page.getByRole('form', { name: 'GitHub に公開' })).toHaveCount(0);
  // The publish dialog's own progress line is a status too; read the panel's notice.
  await expect(panel.locator('.git-notice[role="status"]')).toContainText(
    'octo/new-hibachi を公開しました。',
  );
  expect(git(created, 'config', '--get', 'remote.origin.url')).toBe(
    'https://github.com/octo/new-hibachi.git',
  );
  expect(git(created, 'config', '--get', 'branch.main.merge')).toBe('refs/heads/main');
  expect(git(path.join(github, 'octo/new-hibachi.git'), 'rev-parse', 'main')).toBe(
    git(created, 'rev-parse', 'HEAD'),
  );
  await expect(panel.locator('.git-ahead')).toHaveText('↑0 ↓0');
  await expect(panel.getByRole('button', { name: 'GitHub に公開…' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Push', exact: true })).toBeEnabled();

  // A hibachi registered as an ordinary folder starts Git, commits, and goes to an organization.
  const plain = path.join(base, 'plain KB');
  await mkdir(plain);
  await writeFile(path.join(plain, 'note.md'), '# Plain\n\nWritten before Git\n');
  await page.getByRole('button', { name: 'hibachi を追加', exact: true }).click();
  await page.getByRole('textbox', { name: 'KBフォルダ', exact: true }).fill(plain);
  await expect(page.getByRole('form', { name: 'スペース登録' })).toContainText(
    'ローカルのKBフォルダ',
  );
  await page.getByRole('textbox', { name: 'スペース名' }).fill('Plain');
  await page.getByRole('button', { name: '登録して開く', exact: true }).click();
  await expect(page.getByRole('form', { name: 'スペース登録' })).toHaveCount(0);
  await page
    .getByRole('group', { name: 'hibachi の表示' })
    .getByRole('button', { name: /^変更/ })
    .click();
  await expect(panel.getByRole('heading', { name: 'Git 未設定' })).toBeVisible();
  await panel.getByRole('button', { name: 'Git を始める', exact: true }).click();
  await expect(panel.getByText('Git を始めました。')).toBeVisible();
  expect(git(plain, 'symbolic-ref', 'HEAD')).toBe('refs/heads/main');
  await expect(panel.locator('.git-file').filter({ hasText: 'note.md' })).toHaveCount(1);
  await panel.getByRole('button', { name: 'すべて追加', exact: true }).click();
  await panel.getByRole('textbox', { name: 'commit メッセージ' }).fill('Start the plain hibachi');
  await panel.getByRole('button', { name: 'コミット', exact: true }).click();
  await expect(panel.locator('.git-notice[role="status"]')).toContainText('コミットしました');
  await panel.getByRole('button', { name: 'GitHub に公開…', exact: true }).click();
  publication = page.getByRole('form', { name: 'GitHub に公開' });
  const account = publication.getByRole('combobox', { name: 'GitHub アカウント' });
  await expect(account).toHaveValue('octo');
  await account.selectOption('team-a');
  await expect(publication.getByRole('textbox', { name: 'リポジトリ名' })).toHaveValue('plain-KB');
  await publication.getByRole('combobox', { name: '公開範囲' }).selectOption('public');
  await expect(publication).toContainText('公開リポジトリは誰でも閲覧できます');
  await publication.getByRole('button', { name: '作成して送信', exact: true }).click();
  // The publish dialog's own progress line is a status too; read the panel's notice.
  await expect(panel.locator('.git-notice[role="status"]')).toContainText(
    'team-a/plain-KB を公開しました。',
  );
  expect(git(path.join(github, 'team-a/plain-KB.git'), 'show', 'main:note.md')).toContain(
    'Written before Git',
  );
  expect(await ghCalls()).toEqual(
    expect.arrayContaining([
      'github.com|repo create octo/taken --private',
      'github.com|repo create octo/new-hibachi --private',
      'github.com|repo create team-a/plain-KB --public',
    ]),
  );
  expect((await ghCalls()).filter((call) => call.includes('repo create'))).toHaveLength(3);
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
          'a conflict stays resolvable while it is re-read, and the late re-read reports nothing',
          'unsent commit message and conflict resolution draft survive a full Electron restart',
          'stale conflict draft restores only explicitly and never overwrites the native file until resolution',
          'successful conflict resolution acknowledges and durably clears its draft',
          'editor refresh after source control closes',
          '1024px sidebar bounds',
          'a failed clone folds redacted Git output under one advice line and removes its empty folder',
          'real Git clone with fixture-only URL rewrite and normal scope registration',
          'a hibachi created in the app is a repository on main whose first commit holds only .irori/scope.json and .gitignore',
          'a GitHub refusal while creating keeps the hibachi and its form open, and Source control publishes it afterwards through a fake gh',
          'an ordinary-folder hibachi starts Git, commits, and publishes to an organization as a public repository',
          "a collaborator's h_ line in refs/notes/ai counts for the open note, a commit names the lines typed here as the committer's, and Push carries the ref",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'Git UI checks passed with real disposable Git repositories and a fake gh; no live GitHub or model calls.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
