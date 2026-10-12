import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { CloudService } from '../src/cloud/service';

// The explorer as a file manager: folders and files of any kind in knowledge and in a
// connected folder, renamed, moved by dragging and deleted, with links following.
if (process.platform === 'win32') {
  console.log('Explorer UI fixture uses POSIX links; Windows remains unverified here.');
  process.exit(0);
}
const base = await mkdtemp(path.join(tmpdir(), 'irori explorer UI 日本語 '));
const files = new FileService(path.join(base, 'device'));
await files.init();
const root = path.join(base, 'KB');
await mkdir(path.join(root, 'Knowledge_Base/notes'), { recursive: true });
const space = await files.register(root, '整理KB', 'personal');
await writeFile(path.join(root, 'Knowledge_Base/notes/topic.md'), '# Topic\n');
await writeFile(path.join(root, 'Knowledge_Base/home.md'), '# Home\n\n[topic](notes/topic.md)\n');
const shared = path.join(base, 'Box', '資料');
await mkdir(shared, { recursive: true });
await writeFile(path.join(shared, 'old.md'), '# Old\n');
await new CloudService(files).addLocal({
  scopeId: space.scopeId,
  path: shared,
  contentsRoot: 'contents',
  name: '共有',
  access: 'read-write',
});

const env = { ...process.env, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
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
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: '選択したスペースを開く' }).click();
  const panel = page.locator('.brain-panel');
  const knowledge = panel.getByRole('region', { name: 'Knowledge', exact: true });
  const contents = panel.getByRole('region', { name: 'Contents', exact: true });
  const row = (region: typeof knowledge, name: string) =>
    region.getByRole('button', { name, exact: true });
  const menuItem = (name: string) => page.getByRole('menuitem', { name, exact: true });
  const disk = (relative: string) =>
    readdir(path.join(root, relative)).then((names) => names.sort());

  // A right click on a folder makes a folder in it, then a file of any kind in that one.
  await expect(row(knowledge, 'notes')).toBeVisible();
  await row(knowledge, 'notes').click({ button: 'right' });
  await menuItem('新しいフォルダ').click();
  await page.getByRole('textbox', { name: 'フォルダ名' }).fill('図表');
  await page.getByRole('button', { name: '作成', exact: true }).click();
  await expect(row(knowledge, '図表')).toBeVisible();
  expect(await disk('Knowledge_Base/notes')).toEqual(['topic.md', '図表']);
  await row(knowledge, '図表').click({ button: 'right' });
  await menuItem('新しいファイル').click();
  await page.getByRole('textbox', { name: 'ファイル名' }).fill('data.csv');
  await page.getByRole('button', { name: '作成', exact: true }).click();
  await expect(row(knowledge, 'data.csv')).toBeVisible();
  expect(await disk('Knowledge_Base/notes/図表')).toEqual(['data.csv']);

  // Renaming a folder from its row menu rewrites the links into it.
  await knowledge.getByRole('button', { name: 'notes の操作', exact: true }).click();
  await menuItem('名前を変更').click();
  await page.getByRole('textbox', { name: '新しい名前' }).fill('topics');
  await page.getByRole('button', { name: '名前を変更', exact: true }).click();
  await expect(row(knowledge, 'topics')).toBeVisible();
  await expect
    .poll(() => readFile(path.join(root, 'Knowledge_Base/home.md'), 'utf8'))
    .toBe('# Home\n\n[topic](topics/topic.md)\n');
  await expect(page.getByRole('contentinfo')).toContainText('1 件のリンクを更新しました');
  // A new empty CSV is not an error.
  await expect(page.getByRole('alert')).toHaveCount(0);

  // Dragging a file onto a folder moves it there. The renamed folder opens again.
  await row(knowledge, 'topics').click();
  await row(knowledge, '図表').click();
  await expect(row(knowledge, 'data.csv')).toBeVisible();
  await row(knowledge, 'data.csv').dragTo(row(knowledge, 'Knowledge_Base'));
  await expect.poll(() => disk('Knowledge_Base')).toEqual(['data.csv', 'home.md', 'topics']);

  // A file dropped from the file manager onto a folder is copied into it.
  await row(knowledge, 'topics').evaluate((target) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['dropped'], 'memo.txt', { type: 'text/plain' }));
    for (const type of ['dragover', 'drop'])
      target.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
  });
  await expect.poll(() => disk('Knowledge_Base/topics')).toEqual(['memo.txt', 'topic.md', '図表']);

  // A note deleted from the keyboard goes to irori's deleted notes.
  await row(knowledge, 'home').focus();
  await page.keyboard.press('Delete');
  const deletion = page.getByRole('dialog', { name: '削除' });
  await expect(deletion).toContainText('削除済みノートから復元できます。');
  await deletion.getByRole('button', { name: '削除済みに移す', exact: true }).click();
  await expect(row(knowledge, 'home')).toHaveCount(0);
  expect(await disk('Knowledge_Base')).toEqual(['data.csv', 'topics']);

  // The knowledge folder itself keeps its name: the settings change it.
  await row(knowledge, 'Knowledge_Base').click({ button: 'right' });
  await expect(menuItem('新しいフォルダ')).toBeVisible();
  await expect(menuItem('名前を変更')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // A connected folder takes folders too, and files brought in from elsewhere.
  await expect(row(contents, '共有')).toBeVisible();
  await row(contents, '共有').click({ button: 'right' });
  await menuItem('新しいフォルダ').click();
  await page.getByRole('textbox', { name: 'フォルダ名' }).fill('2026');
  await page.getByRole('button', { name: '作成', exact: true }).click();
  await expect.poll(async () => (await readdir(shared)).sort()).toEqual(['2026', 'old.md']);
  // Held under a drag from the file manager, a closed folder opens; files dropped
  // there are copied in, keeping both where a name is taken.
  await writeFile(path.join(shared, '2026', 'a.txt'), 'before');
  const drag = (type: string, names: string[]) =>
    row(contents, '2026').evaluate(
      (target, { type, names }) => {
        const transfer = new DataTransfer();
        for (const name of names) transfer.items.add(new File([name], name));
        target.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
      },
      { type, names },
    );
  await expect(row(contents, '2026')).toHaveAttribute('aria-expanded', 'false');
  await drag('dragover', ['a.txt']);
  await expect(row(contents, '2026')).toHaveAttribute('aria-expanded', 'true');
  await drag('drop', ['a.txt', 'b.csv']);
  await expect
    .poll(async () => (await readdir(path.join(shared, '2026'))).sort())
    .toEqual(['a 2.txt', 'a.txt', 'b.csv']);
  expect(await readFile(path.join(shared, '2026', 'a.txt'), 'utf8')).toBe('before');
  await expect(page.getByRole('contentinfo')).toContainText('2 件のファイルを追加');
  await row(contents, '共有').click({ button: 'right' });
  const chooser = page.waitForEvent('filechooser');
  await menuItem('ファイルを追加…').click();
  // Playwright hands Electron's file input bytes, not a path.
  await (
    await chooser
  ).setFiles({
    name: 'scan.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n%fixture\n'),
  });
  await expect
    .poll(async () => (await readdir(shared)).sort())
    .toEqual(['2026', 'old.md', 'scan.pdf']);
  expect(await readFile(path.join(shared, 'scan.pdf'), 'utf8')).toBe('%PDF-1.4\n%fixture\n');

  expect(errors).toEqual([]);
  await writeFile(
    'test-results/explorer-ui-smoke.json',
    JSON.stringify(
      {
        checks: [
          'a right click on a knowledge folder makes a folder and a file of any kind in it',
          'renaming a knowledge folder from its row menu rewrites the links into it',
          'dragging a file onto a folder moves it there',
          'a file dropped from the file manager is copied into the folder',
          "a note deleted with the Delete key goes to irori's deleted notes",
          'the knowledge folder itself offers no rename',
          'a connected folder takes a new folder and files brought in from elsewhere',
          'a closed folder opens under a drag; dropped files keep both on a taken name',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log('Explorer UI checks passed.');
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
