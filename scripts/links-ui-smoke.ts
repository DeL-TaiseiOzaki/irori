import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';

// Real disposable notes linking to each other by relative path, as the recommended
// knowledge base writes them. No provider or model process is started.
const base = await mkdtemp(path.join(tmpdir(), 'irori links UI '));
const root = path.join(base, 'Knowledge');
await mkdir(path.join(root, 'wiki'), { recursive: true });
const files = new FileService(path.join(base, 'device'));
await files.init();
await files.register(root, 'リンクのKB', 'personal');
await writeFile(
  path.join(root, 'topic.md'),
  '# 出発点\n\n[下の階層へ](wiki/deep.md)\n\n[まだ無いページ](planned.md)\n',
);
await writeFile(
  path.join(root, 'wiki', 'deep.md'),
  '# 深いページ\n\n[上の階層へ](../arrival.md)\n',
);
await writeFile(path.join(root, 'arrival.md'), '# 到着点\n');
const env = { ...process.env, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), '.'],
  env,
});
const errors: string[] = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.getByRole('checkbox', { name: /リンクのKB/ }).check();
  await page.getByLabel('ワークスペース名').fill('Link workspace');
  await page.getByRole('button', { name: '選択したスペースを開く', exact: true }).click();
  await page.getByRole('button', { name: 'topic', exact: true }).click();
  const editor = page.locator('.ProseMirror');
  await expect(editor).toContainText('出発点');

  // A plain click belongs to the editor: it places the cursor and opens nothing.
  await editor.getByRole('link', { name: '下の階層へ' }).click();
  await expect(editor).toContainText('出発点');

  // The modifier follows the link, down into a folder and back out of it.
  await editor.getByRole('link', { name: '下の階層へ' }).click({ modifiers: ['ControlOrMeta'] });
  await expect(editor).toContainText('深いページ');
  await editor.getByRole('link', { name: '上の階層へ' }).click({ modifiers: ['ControlOrMeta'] });
  await expect(editor).toContainText('到着点');

  // A page that has not been written yet is named, and the note stays open.
  await page.getByRole('button', { name: 'topic', exact: true }).click();
  await expect(editor).toContainText('出発点');
  await editor
    .getByRole('link', { name: 'まだ無いページ' })
    .click({ modifiers: ['ControlOrMeta'] });
  const notice = page.locator('p.hint[role="status"]');
  await expect(notice).toContainText('リンク先のファイルがまだありません');
  await expect(notice).toContainText('planned.md');
  await expect(editor).toContainText('出発点');

  // Unsaved work is carried through the link, not lost to it.
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' 追記');
  await editor.getByRole('link', { name: '下の階層へ' }).click({ modifiers: ['ControlOrMeta'] });
  await expect(editor).toContainText('深いページ');
  await page.getByRole('button', { name: 'topic', exact: true }).click();
  await expect(editor).toContainText('追記');

  if (errors.length) throw Error(`Renderer errors: ${errors.join('\n')}`);
  console.log('Link UI smoke passed: relative links followed down, up and to a missing page.');
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
