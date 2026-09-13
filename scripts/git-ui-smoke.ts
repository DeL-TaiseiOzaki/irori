import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';

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
const spaces = [];
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
// URL rewriting is confined to this disposable test config. The product runs real Git clone.
const seed = path.join(base, 'seed'),
  cloneRemote = path.join(base, 'catalog.git');
await mkdir(seed);
git(seed, 'init', '-b', 'main');
await writeFile(path.join(seed, 'README.md'), '# Catalog\n');
git(seed, 'add', '.');
git(seed, 'commit', '-m', 'Catalog initial');
git(base, 'clone', '--bare', seed, cloneRemote);
const globalConfig = path.join(base, 'gitconfig');
git(
  base,
  'config',
  '--file',
  globalConfig,
  `url.${cloneRemote}.insteadOf`,
  'https://github.com/irori-fixture/catalog.git',
);
const env = {
  ...process.env,
  IRORI_DATA_DIR: files.dataDir,
  GIT_CONFIG_GLOBAL: globalConfig,
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
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  for (const box of await page.getByRole('checkbox').all()) await box.check();
  await page.getByRole('button', { name: '選択したスペースを開く' }).click();
  await page
    .locator('.layer-pane.my-kb')
    .getByRole('button', { name: 'README', exact: true })
    .click();
  await page.getByRole('button', { name: 'ソース', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\nUI saved 日本語\n');
  await expect(page.getByRole('button', { name: '変更と履歴', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '保存 •', exact: true }).click();
  await page.getByRole('button', { name: '変更と履歴', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Git の変更と履歴' });
  await expect(panel).toBeVisible();
  await panel.locator('.git-file').filter({ hasText: 'README.md' }).click();
  await expect(panel.getByLabel('差分', { exact: true })).toContainText('+UI saved 日本語');
  await panel.getByRole('button', { name: 'commit 対象に追加', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('commit 対象に追加しました');
  await panel.getByRole('textbox', { name: 'commit メッセージ' }).fill('UI note update');
  await panel.getByRole('button', { name: 'commit 内容を確認' }).click();
  await expect(panel.getByRole('region', { name: 'Git 操作の確認' })).toContainText('README.md');
  await panel.getByRole('button', { name: 'この内容を commit', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('この端末の履歴に commit');
  expect(git(root, 'show', 'HEAD:README.md')).toContain('UI saved 日本語');
  expect(git(remote, 'show', 'main:README.md')).not.toContain('UI saved 日本語');
  await panel.getByRole('button', { name: '履歴', exact: true }).click();
  await panel.locator('.git-history-item').filter({ hasText: 'UI note update' }).click();
  await expect(panel.getByLabel('差分', { exact: true })).toContainText('UI saved 日本語');
  await page.screenshot({ path: 'test-results/irori-git-history.png' });
  await panel.getByLabel('Git のスペース').selectOption(spaces[1].scopeId);
  await expect(panel.locator('.git-repository-bar')).toContainText('リモート未設定');
  await panel.getByRole('button', { name: '履歴', exact: true }).click();
  await expect(panel.locator('.git-history-item')).toHaveCount(1);
  await expect(panel.locator('.git-history-item')).toContainText('チームKB initial');
  await panel.getByLabel('Git のスペース').selectOption(spaces[0].scopeId);
  await panel.getByRole('button', { name: '共有内容を確認' }).click();
  await expect(panel.getByRole('region', { name: 'Git 操作の確認' })).toContainText(
    'origin / main',
  );
  await panel.getByRole('button', { name: 'このブランチを共有' }).click();
  await expect(panel.getByRole('status')).toContainText('リモートへの送信が完了');
  expect(git(remote, 'show', 'main:README.md')).toContain('UI saved 日本語');

  git(peer, 'pull', '--ff-only');
  await writeFile(path.join(peer, 'README.md'), '# Peer 日本語\n');
  git(peer, 'add', '.');
  git(peer, 'commit', '-m', 'Peer competing change');
  git(peer, 'push');
  await writeFile(path.join(root, 'README.md'), '# Local 日本語\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'Local competing change');
  await panel.getByRole('button', { name: '更新', exact: true }).click();
  await expect(panel.getByRole('button', { name: '取得', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: '取得', exact: true }).click();
  await expect(panel.locator('.git-repository-bar')).toContainText(
    '送信待ち 1 commit ・ 受信待ち 1 commit',
  );
  await panel.getByRole('button', { name: '受信', exact: true }).click();
  await panel.getByRole('button', { name: '変更を受信', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('分岐');
  await panel.getByRole('button', { name: '履歴を統合', exact: true }).click();
  await panel.getByRole('button', { name: '履歴の統合を開始' }).click();
  await expect(panel.locator('.git-warning')).toContainText('未解決 1 件');
  await panel.locator('.git-file').filter({ hasText: 'README.md' }).click();
  await expect(panel.getByRole('textbox', { name: '統合する内容' })).toContainText('<<<<<<<');
  await expect(panel.locator('.git-conflict-versions')).toContainText('Local 日本語');
  await expect(panel.locator('.git-conflict-versions')).toContainText('Peer 日本語');
  await panel
    .getByRole('textbox', { name: '統合する内容' })
    .fill('# Combined\n\nLocal 日本語\nPeer 日本語\n');
  await page.screenshot({ path: 'test-results/irori-git-conflict.png' });
  await expect(panel.getByRole('button', { name: 'Git 画面を閉じる' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(panel).toBeVisible();
  await writeFile(path.join(root, 'README.md'), 'External conflict working copy\n');
  await panel.getByRole('button', { name: '統合内容を保存して解決' }).click();
  await expect(panel.getByRole('alert')).toContainText('確認後');
  await expect(panel.locator('.git-detail')).toHaveAttribute('aria-busy', 'false');
  await expect(panel.getByRole('textbox', { name: '統合する内容' })).toHaveValue(
    '# Combined\n\nLocal 日本語\nPeer 日本語\n',
  );
  expect(await readFile(path.join(root, 'README.md'), 'utf8')).toBe(
    'External conflict working copy\n',
  );
  await panel.getByRole('button', { name: '統合内容を保存して解決' }).click();
  await expect(panel.locator('.git-warning')).toContainText('未解決 0 件');
  await panel.getByRole('textbox', { name: 'commit メッセージ' }).fill('Merge reviewed versions');
  await panel.getByRole('button', { name: 'commit 内容を確認' }).click();
  await panel.getByRole('button', { name: 'この内容を commit', exact: true }).click();
  await expect(panel.locator('.git-warning')).toHaveCount(0);
  expect(git(root, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(3);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 800));
  const bounds = await panel.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1024);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.document-editor')).toContainText('Combined');
  await expect(page.getByRole('button', { name: '変更と履歴', exact: true })).toBeFocused();

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
  await page.getByRole('button', { name: 'スペースを追加', exact: true }).click();
  await page.getByRole('button', { name: 'GitHub から取得', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'GitHub リポジトリ URL' })
    .fill('https://github.com/irori-fixture/catalog.git');
  await page.getByRole('textbox', { name: '保存先の親フォルダ' }).fill(base);
  await page.getByRole('textbox', { name: '新しいフォルダ名' }).fill('取得した KB');
  await page.getByRole('button', { name: 'リポジトリを取得', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'KBフォルダ', exact: true })).toHaveValue(
    path.join(base, '取得した KB'),
  );
  expect(await readFile(path.join(base, '取得した KB/README.md'), 'utf8')).toBe('# Catalog\n');
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
          'dirty editor blocks Git review',
          'real staging and local commit through reviewed UI',
          'per-space history isolation',
          'explicit single-branch push to disposable bare remote',
          'fetch and divergent receive refusal',
          'native merge, both conflict versions, manual resolution and merge commit',
          'editor refresh and modal focus return',
          '1024px dialog bounds',
          'real Git clone with fixture-only URL rewrite and normal scope registration',
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
