import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';

// A hibachi holding another repository as a submodule (ADR 022): it is added from
// Source control, edited, committed and pushed in its own repository, recorded
// in the hibachi, and fetched again from the picker after its files are gone.
const base = await mkdtemp(path.join(tmpdir(), 'irori submodules ui '));
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
      '-c',
      'protocol.file.allow=always',
      ...args,
    ],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trimEnd();
}
const library = path.join(base, 'library.git'),
  seed = path.join(base, 'seed');
git(base, 'init', '--bare', '--initial-branch=main', library);
await mkdir(seed);
git(seed, 'init', '-b', 'main');
await writeFile(path.join(seed, 'doc.md'), '# Library\n');
git(seed, 'add', '.');
git(seed, 'commit', '-m', 'Library note');
git(seed, 'push', library, 'HEAD:main');
const files = new FileService(path.join(base, 'device'));
await files.init();
const root = path.join(base, 'サブモジュールのKB');
await mkdir(root);
git(root, 'init', '-b', 'main');
await files.register(root, 'サブモジュールのKB', 'personal');
await writeFile(path.join(root, 'README.md'), '# Main\n');
git(root, 'add', '.');
git(root, 'commit', '-m', 'Main hibachi');
// The GitHub URL reaches the disposable bare repository only through this test's config.
const globalConfig = path.join(base, 'gitconfig');
for (const [key, value] of [
  [`url.${library}.insteadOf`, 'https://github.com/irori-fixture/library.git'],
  ['protocol.file.allow', 'always'],
  ['user.name', 'UI fixture'],
  ['user.email', 'fixture@example.invalid'],
  ['commit.gpgsign', 'false'],
])
  git(base, 'config', '--file', globalConfig, key, value);
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
  await page.getByRole('checkbox', { name: /サブモジュールのKB/ }).check();
  await page.getByRole('button', { name: '選択したスペースを開く', exact: true }).click();
  await page
    .getByRole('group', { name: 'hibachi の表示' })
    .getByRole('button', { name: /^変更/ })
    .click();
  const panel = page.getByRole('region', { name: 'ソース管理' });
  const picker = panel.getByRole('combobox', { name: 'リポジトリ' });
  await expect(panel.locator('.git-repository-bar')).toBeVisible();
  await expect(picker).toHaveCount(0);

  // Add: the folder follows the repository's name, and Git stages the submodule.
  await panel.getByLabel('その他の Git 操作').click();
  await page.getByRole('menuitem', { name: 'submodule を追加…' }).click();
  const dialog = page.getByRole('dialog', { name: 'submodule を追加' });
  await dialog
    .getByRole('textbox', { name: 'GitHub のリポジトリ URL' })
    .fill('https://github.com/irori-fixture/library.git');
  await expect(dialog.getByRole('textbox', { name: 'フォルダ' })).toHaveValue('library');
  await dialog.getByRole('textbox', { name: 'フォルダ' }).fill('projects/library');
  await dialog.getByRole('button', { name: '追加', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(picker).toBeVisible();
  await expect(panel.locator('.git-file')).toHaveCount(2);
  await panel.getByRole('textbox', { name: 'commit メッセージ' }).fill('Add the library');
  await panel.getByRole('button', { name: 'コミット', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('コミットしました');
  expect(git(root, 'ls-tree', 'HEAD', 'projects/library')).toMatch(/^160000 commit /);

  // Edit inside the submodule: the hibachi lists nothing, the submodule lists the file.
  await writeFile(path.join(root, 'projects/library/doc.md'), '# Library\n\nEdited in irori\n');
  await panel.getByRole('button', { name: '更新', exact: true }).click();
  await expect(panel.locator('.git-file')).toHaveCount(0);
  await expect(picker.locator('option', { hasText: 'projects/library' })).toContainText('●');
  await picker.selectOption('projects/library');
  await expect(panel.locator('.git-branch')).toContainText('main');
  await expect(panel.locator('.git-file').filter({ hasText: 'doc.md' })).toBeVisible();
  await expect(panel.getByRole('menuitem', { name: 'submodule を追加…' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'すべて追加', exact: true }).click();
  await panel.getByRole('textbox', { name: 'commit メッセージ' }).fill('Edit the library');
  await panel.getByRole('button', { name: 'コミット', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('コミットしました');
  await panel.getByRole('button', { name: 'Push', exact: true }).click();
  const confirmation = panel.getByRole('region', { name: 'Git 操作の確認' });
  await expect(confirmation).toContainText('サブモジュールのKB / projects/library');
  await confirmation.getByRole('button', { name: 'Push', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('送信しました');
  expect(git(base, `--git-dir=${library}`, 'log', '-1', '--format=%s', 'main')).toBe(
    'Edit the library',
  );
  await page.screenshot({ path: 'test-results/irori-submodule.png' });

  // Back in the hibachi, the submodule's new commit is a change to record.
  await picker.selectOption('');
  const moved = panel.locator('.git-file').filter({ hasText: 'library' });
  await expect(moved).toBeVisible();
  await moved.click();
  await expect(page.getByLabel('差分', { exact: true })).toContainText('Edit the library');
  await page.getByRole('button', { name: 'ノートに戻る' }).click();
  await panel.getByRole('button', { name: 'すべて追加', exact: true }).click();
  await panel.getByRole('textbox', { name: 'commit メッセージ' }).fill('Record the library');
  await panel.getByRole('button', { name: 'コミット', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('コミットしました');
  expect(git(root, 'rev-parse', 'HEAD:projects/library')).toBe(
    git(path.join(root, 'projects/library'), 'rev-parse', 'HEAD'),
  );

  // A submodule whose files are gone is fetched again from the picker, on its branch.
  git(root, 'submodule', 'deinit', '--force', '--', 'projects/library');
  await panel.getByRole('button', { name: '更新', exact: true }).click();
  await expect(picker.locator('option', { hasText: 'projects/library' })).toContainText('未取得');
  await picker.selectOption('projects/library');
  await panel.getByRole('button', { name: '取得', exact: true }).click();
  await expect(panel.locator('.git-branch')).toContainText('main');
  expect(await readFile(path.join(root, 'projects/library/doc.md'), 'utf8')).toContain(
    'Edited in irori',
  );
  expect(errors).toEqual([]);
  await writeFile(
    'test-results/submodules-ui-smoke.json',
    JSON.stringify(
      {
        checks: [
          'Source control adds a GitHub repository as a submodule in a chosen folder, staged with .gitmodules',
          "an edit inside the submodule is listed in the submodule's repository, not the hibachi's",
          'the submodule commits on its branch and pushes to its own remote',
          "the hibachi lists the submodule's new commit, shows its log as the diff and records it",
          'a submodule whose files are gone is fetched again from the picker and put on its branch',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log('Submodule UI checks passed with disposable Git repositories; no live GitHub.');
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
