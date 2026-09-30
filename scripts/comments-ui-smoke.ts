import { _electron as electron, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';

// A disposable knowledge base with one page whose frontmatter sits above the
// body, so a line found in the rendered view has to count the lines the
// properties hold. No provider or model process is started.
const base = await mkdtemp(path.join(tmpdir(), 'irori comments UI '));
const root = path.join(base, 'Knowledge');
await mkdir(root, { recursive: true });
execFileSync('git', ['init', '--quiet', root]);
execFileSync('git', ['-C', root, 'config', 'user.email', 'comment.person@example.com']);
const text =
  '---\ntitle: Topic\n---\n# Topic\n\nA claim that needs a source.\n\nSame words.\n\nSame words.\n';
await writeFile(path.join(root, 'topic.md'), text);

const files = new FileService(path.join(base, 'device'));
await files.init();
await files.register(root, 'コメントのKB', 'personal');
const env = { ...process.env, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), '.'],
  env,
});
const errors: string[] = [];
const commentsFile = path.join(root, '.irori', 'comments', 'topic.md.json');
const saved = async () => JSON.parse(await readFile(commentsFile, 'utf8'));

/** Selects `words` in the `index`-th paragraph of the rendered note that has them. */
async function select(page: Page, words: string, index = 0) {
  await page.locator('.ProseMirror').evaluate(
    (element, [words, index]) => {
      const paragraphs = [...element.querySelectorAll('p')].filter((p) =>
        p.textContent?.includes(words as string),
      );
      const node = paragraphs[index as number].firstChild!;
      const at = node.textContent!.indexOf(words as string);
      (element as HTMLElement).focus();
      getSelection()!.setBaseAndExtent(node, at, node, at + (words as string).length);
    },
    [words, index] as const,
  );
  await expect.poll(() => page.evaluate(() => getSelection()!.toString())).toBe(words);
}
/** Which paragraph having `words` holds the selection, or -1. */
const selectedParagraph = (page: Page, words: string) =>
  page.locator('.ProseMirror').evaluate((element, words) => {
    const paragraphs = [...element.querySelectorAll('p')].filter((p) =>
      p.textContent?.includes(words),
    );
    const anchor = getSelection()!.anchorNode;
    return paragraphs.findIndex((p) => anchor && p.contains(anchor));
  }, words);

try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.getByRole('checkbox', { name: /コメントのKB/ }).check();
  await page.getByLabel('ワークスペース名').fill('Comments workspace');
  await page.getByRole('button', { name: '選択したスペースを開く', exact: true }).click();
  await page.getByRole('button', { name: 'topic', exact: true }).click();
  const editor = page.locator('.ProseMirror');
  await expect(editor).toContainText('A claim that needs a source.');

  // A selection becomes the comment's quote, with the line of the file it is on.
  await select(page, 'needs a source');
  await page.getByRole('button', { name: 'コメント', exact: true }).click();
  const popover = page.locator('.comments-popover');
  await expect(popover.locator('.comment-quote.selected')).toHaveText('needs a source');
  await popover.getByLabel('新しいコメント').fill('どの資料？');
  await popover.getByRole('button', { name: '追加', exact: true }).click();
  await expect(popover.locator('.comment-list li')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'コメント 1 件', exact: true })).toBeVisible();
  const first = (await saved()).comments[0];
  if (
    first.quote !== 'needs a source' ||
    first.line !== 6 ||
    first.body !== 'どの資料？' ||
    first.by !== 'human:comment.person'
  )
    throw Error(`Unexpected comment: ${JSON.stringify(first)}`);
  // The note's bytes are untouched.
  if ((await readFile(path.join(root, 'topic.md'), 'utf8')) !== text)
    throw Error('Commenting changed the note');

  // The second of two identical paragraphs keeps its own line and is found again.
  await page.keyboard.press('Escape');
  await select(page, 'Same words.', 1);
  await page.getByRole('button', { name: 'コメント 1 件', exact: true }).click();
  await popover.getByLabel('新しいコメント').fill('重複');
  await popover.getByLabel('新しいコメント').press('ControlOrMeta+Enter');
  await expect(popover.locator('.comment-list li')).toHaveCount(2);
  if ((await saved()).comments[1].line !== 10)
    throw Error(`Wrong line for the second paragraph: ${JSON.stringify(await saved())}`);

  // Without a selection the comment is about the whole note.
  await page.keyboard.press('Escape');
  await editor.locator('h1').click();
  await page.getByRole('button', { name: 'コメント 2 件', exact: true }).click();
  await expect(popover.locator('.comment-quote.selected')).toHaveCount(0);
  await popover.getByLabel('新しいコメント').fill('全体に出典が足りない');
  await popover.getByRole('button', { name: '追加', exact: true }).click();
  await expect(popover.locator('.comment-list li')).toHaveCount(3);
  // The comment button sits beside the backlinks button without repeating it.
  await expect(page.locator('.stage-actions .backlinks-trigger')).toHaveCount(1);
  if ('quote' in (await saved()).comments[2]) throw Error('A note comment carried a quote');

  // A quote in the list selects its passage in the note.
  await popover.locator('button.comment-quote', { hasText: 'Same words.' }).click();
  await expect(popover).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => getSelection()!.toString())).toBe('Same words.');
  await expect.poll(() => selectedParagraph(page, 'Same words.')).toBe(1);
  await page.getByRole('button', { name: 'コメント 3 件', exact: true }).click();
  await popover.locator('button.comment-quote', { hasText: 'needs a source' }).click();
  await expect.poll(() => page.evaluate(() => getSelection()!.toString())).toBe('needs a source');

  // A comment changed on disk — by an agent or a pull — shows in the list.
  const onDisk = await saved();
  onDisk.comments[2].body = 'エージェントが書き換えた';
  await writeFile(commentsFile, JSON.stringify(onDisk));
  await page.getByRole('button', { name: 'コメント 3 件', exact: true }).click();
  await expect(popover.getByText('エージェントが書き換えた')).toBeVisible({ timeout: 10000 });

  // Resolving removes a comment; the last one takes its file with it.
  for (let left = 3; left > 0; left--) {
    await popover.getByRole('button', { name: '解決', exact: true }).first().click();
    await expect(popover.locator('.comment-list li')).toHaveCount(left - 1);
  }
  await expect(page.getByRole('button', { name: 'コメント', exact: true })).toBeVisible();
  const gone = await stat(commentsFile).then(
    () => false,
    () => true,
  );
  if (!gone) throw Error('The comments file stayed after the last comment was resolved');

  if (errors.length) throw Error(`Renderer errors: ${errors.join('\n')}`);
  console.log(
    'Comments UI smoke passed: a selection quoted with its file line under frontmatter, the second of two identical paragraphs told apart, a whole-note comment, quotes selecting their passage, an on-disk change shown, and resolving down to no file.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
