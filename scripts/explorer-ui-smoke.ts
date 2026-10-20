import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { CloudService } from '../src/cloud/service';
import { SettingsService } from '../src/host/settings';
import { chooseJapanese } from '../tests/fixtures/japanese-interface';

// The explorer as a file manager: folders and files of any kind in knowledge and in a
// connected folder, renamed in place, moved by dragging and deleted, with links
// following; Schema's files and folders renamed in place too.
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
await mkdir(path.join(root, '.agents/skills/draft-skill'), { recursive: true });
await writeFile(path.join(root, '.agents/skills/draft-skill/SKILL.md'), '# Draft\n');
await writeFile(path.join(root, 'AGENTS.md'), '# Agents\n');
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

// The Schema layer shows with the vault agent on (ADR 021).
await new SettingsService(files.dataDir).save({ vaultAgent: true });
await chooseJapanese(files.dataDir);
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
  // The name field a row turns into while it is renamed.
  const nameField = (name: string) => panel.getByRole('textbox', { name: `${name} の新しい名前` });
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

  // Renaming a folder from its row menu edits its name in place and rewrites the links into it.
  await knowledge.getByRole('button', { name: 'notes の操作', exact: true }).click();
  await menuItem('名前を変更').click();
  await expect(nameField('notes')).toBeFocused();
  await expect(nameField('notes')).toHaveValue('notes');
  await page.keyboard.type('topics');
  await page.keyboard.press('Enter');
  await expect(row(knowledge, 'topics')).toBeVisible();
  await expect(nameField('notes')).toHaveCount(0);
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

  // F2 edits a name in place. A file's extension stays out of the selection, so
  // typing replaces its name alone; a note shows and keeps its title without `.md`.
  await row(knowledge, 'data.csv').focus();
  await page.keyboard.press('F2');
  await expect(nameField('data.csv')).toBeFocused();
  await page.keyboard.type('table');
  await page.keyboard.press('Enter');
  await expect(row(knowledge, 'table.csv')).toBeVisible();
  await expect(row(knowledge, 'topic')).toBeVisible();
  await row(knowledge, 'topic').focus();
  await page.keyboard.press('F2');
  await expect(nameField('topic.md')).toHaveValue('topic');
  await nameField('topic.md').fill('話題');
  await page.keyboard.press('Enter');
  await expect(row(knowledge, '話題')).toBeVisible();
  // Escape keeps the name; a name a file cannot have is refused beside the field.
  await row(knowledge, 'topics').focus();
  await page.keyboard.press('F2');
  await nameField('topics').fill('kept');
  await page.keyboard.press('Escape');
  await expect(row(knowledge, 'topics')).toBeVisible();
  await row(knowledge, 'topics').focus();
  await page.keyboard.press('F2');
  await nameField('topics').fill('a/b');
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(nameField('topics')).toBeVisible();
  // A name another entry has is refused by the host, and the field stays for another try.
  await nameField('topics').fill('table.csv');
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('alert')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(row(knowledge, 'topics')).toBeVisible();
  expect(await disk('Knowledge_Base')).toEqual(['table.csv', 'topics']);
  expect(await disk('Knowledge_Base/topics')).toEqual(['memo.txt', '図表', '話題.md']);

  // Schema's files and folders are renamed in place too; `.irori` keeps its name.
  const schema = panel.getByRole('region', { name: 'Schema', exact: true });
  await schema.getByRole('button', { name: 'ファイルとして表示', exact: true }).click();
  await expect(row(schema, 'AGENTS.md')).toBeVisible();
  await row(schema, 'AGENTS.md').click({ button: 'right' });
  await menuItem('名前を変更').click();
  await expect(nameField('AGENTS.md')).toBeFocused();
  await page.keyboard.type('CLAUDE');
  await page.keyboard.press('Enter');
  await expect(row(schema, 'CLAUDE.md')).toBeVisible();
  expect((await readdir(root)).includes('CLAUDE.md')).toBe(true);
  // Only renaming is offered there: nothing is made, moved or deleted.
  await row(schema, '.agents').click({ button: 'right' });
  await expect(menuItem('名前を変更')).toBeVisible();
  await expect(menuItem('移動')).toHaveCount(0);
  await expect(menuItem('削除')).toHaveCount(0);
  await expect(menuItem('新しいフォルダ')).toHaveCount(0);
  await expect(menuItem('コピー')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await row(schema, '.agents').click();
  await row(schema, 'skills').click();
  await row(schema, 'draft-skill').focus();
  await page.keyboard.press('F2');
  await nameField('draft-skill').fill('review-skill');
  await page.keyboard.press('Enter');
  await expect(row(schema, 'review-skill')).toBeVisible();
  expect(await readdir(path.join(root, '.agents/skills'))).toEqual(['review-skill']);
  await row(schema, '.irori').click({ button: 'right' });
  await expect(menuItem('パスをコピー')).toBeVisible();
  await expect(menuItem('名前を変更')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await schema.getByRole('button', { name: 'ファイルとして表示', exact: true }).click();

  // Every row copies its path, as a file manager's menu does: in full, or from the vault.
  const clipboardText = () => app.evaluate(({ clipboard }) => clipboard.readText());
  await row(knowledge, 'topics').click({ button: 'right' });
  await expect(menuItem('開く')).toHaveCount(0);
  await menuItem('相対パスをコピー').click();
  await expect.poll(clipboardText).toBe('Knowledge_Base/topics');
  await row(knowledge, 'table.csv').click({ button: 'right' });
  await expect(menuItem('開く')).toBeVisible();
  await menuItem('パスをコピー').click();
  await expect.poll(clipboardText).toBe(path.join(root, 'Knowledge_Base', 'table.csv'));

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
  // A file of any size comes in whole, past the 100 MiB once refused. The page
  // builds the same bytes as the check below.
  const large = 120 * 1024 * 1024 + 3;
  await row(contents, '2026').evaluate((target, size) => {
    const bytes = new Uint8Array(size);
    for (let index = 0; index < size; index++) bytes[index] = (index * 7) % 251;
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'deck.pptx'));
    target.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  }, large);
  await expect(page.getByRole('contentinfo')).toContainText('1 件のファイルを追加', {
    timeout: 60_000,
  });
  const copied = await readFile(path.join(shared, '2026', 'deck.pptx'));
  expect(copied.length).toBe(large);
  expect(copied.every((byte, index) => byte === (index * 7) % 251)).toBe(true);
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

  // Copy and paste, as in a file manager. The keyboard's copy puts the file's full
  // path on the system's clipboard too; a paste on a folder copies into it.
  const at = (region: typeof knowledge, entry: string) =>
    region.locator(`button[data-entry="${entry}"]`);
  await at(knowledge, 'Knowledge_Base/table.csv').focus();
  await page.keyboard.press('ControlOrMeta+C');
  await expect.poll(clipboardText).toBe(path.join(root, 'Knowledge_Base', 'table.csv'));
  await at(knowledge, 'Knowledge_Base/topics').focus();
  await page.keyboard.press('ControlOrMeta+V');
  await expect
    .poll(() => disk('Knowledge_Base/topics'))
    .toEqual(['memo.txt', 'table.csv', '図表', '話題.md']);
  await expect(page.getByRole('contentinfo')).toContainText('table.csv をコピーしました');
  // On a file, the paste goes beside it under a free name; the original stays.
  await at(knowledge, 'Knowledge_Base/table.csv').focus();
  await page.keyboard.press('ControlOrMeta+V');
  await expect.poll(() => disk('Knowledge_Base')).toEqual(['table 2.csv', 'table.csv', 'topics']);
  // A folder copied from its menu and pasted from the knowledge folder's.
  await at(knowledge, 'Knowledge_Base/topics/図表').click({ button: 'right' });
  await menuItem('コピー').click();
  await row(knowledge, 'Knowledge_Base').click({ button: 'right' });
  await menuItem('貼り付け').click();
  await expect
    .poll(() => disk('Knowledge_Base'))
    .toEqual(['table 2.csv', 'table.csv', 'topics', '図表']);
  // A cut row dims until its paste moves it.
  await at(knowledge, 'Knowledge_Base/table 2.csv').click({ button: 'right' });
  await menuItem('切り取り').click();
  await expect(at(knowledge, 'Knowledge_Base/table 2.csv')).toHaveClass(/\bcut\b/);
  await at(knowledge, 'Knowledge_Base/図表').focus();
  await page.keyboard.press('ControlOrMeta+V');
  await expect.poll(() => disk('Knowledge_Base')).toEqual(['table.csv', 'topics', '図表']);
  expect(await disk('Knowledge_Base/図表')).toEqual(['table 2.csv']);
  // A file of a connected folder copies into knowledge.
  await at(contents, 'contents/共有/old.md').click({ button: 'right' });
  await menuItem('コピー').click();
  await at(knowledge, 'Knowledge_Base/topics').click({ button: 'right' });
  await menuItem('貼り付け').click();
  await expect.poll(() => disk('Knowledge_Base/topics')).toContain('old.md');
  expect(await readFile(path.join(root, 'Knowledge_Base/topics/old.md'), 'utf8')).toBe('# Old\n');
  // Files copied in the file manager come in on a paste, as a drop's do. The page
  // stands in for the system's clipboard with the paste event it would send.
  await at(knowledge, 'Knowledge_Base/topics').evaluate((target) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['pasted'], 'clip.txt', { type: 'text/plain' }));
    target.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }),
    );
  });
  await expect.poll(() => disk('Knowledge_Base/topics')).toContain('clip.txt');
  expect(await readFile(path.join(root, 'Knowledge_Base/topics/clip.txt'), 'utf8')).toBe('pasted');

  expect(errors).toEqual([]);
  await writeFile(
    'test-results/explorer-ui-smoke.json',
    JSON.stringify(
      {
        checks: [
          'a right click on a knowledge folder makes a folder and a file of any kind in it',
          'renaming a knowledge folder from its row menu edits its name in place and rewrites the links into it',
          'F2 renames a file in place with its extension outside the selection, and a note by its title',
          'Escape keeps the name; an invalid or taken name is refused beside the field',
          "Schema's files and folders rename in place; .irori offers no rename, and nothing else is offered",
          'dragging a file onto a folder moves it there',
          'a file dropped from the file manager is copied into the folder',
          "a note deleted with the Delete key goes to irori's deleted notes",
          'the knowledge folder itself offers no rename',
          'a connected folder takes a new folder and files brought in from elsewhere',
          'a closed folder opens under a drag; dropped files keep both on a taken name',
          'a dropped file over 100 MiB comes in whole',
          'the keyboard copies a file and pastes it into a folder, or beside a file under a free name',
          "a folder copied from its menu pastes from another folder's menu",
          'a cut row dims and its paste moves it',
          'a file of a connected folder copies into knowledge',
          'files pasted from the system clipboard come in as a drop does',
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
