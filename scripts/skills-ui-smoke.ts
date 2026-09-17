import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileService } from '../src/host/files';
if (process.platform === 'win32') {
  console.log(
    'Skill UI executable fixtures are POSIX only; native Windows acceptance remains open.',
  );
  process.exit(0);
}
const base = await mkdtemp(path.join(tmpdir(), 'irori skills UI '));
const files = new FileService(path.join(base, 'device'));
await files.init();
const root = path.join(base, 'KB skills');
const plain = path.join(base, 'KB plain');
await mkdir(root);
await mkdir(plain);
const space = await files.register(root, 'スキル検証', 'personal');
await files.register(plain, '素のKB', 'personal');
await writeFile(path.join(root, 'note.md'), '# Skill fixture\n');
await writeFile(path.join(plain, 'note.md'), '# No skills here\n');

const skill = async (name: string, text: string) => {
  await mkdir(path.join(root, '.agents', 'skills', name), { recursive: true });
  await writeFile(path.join(root, '.agents', 'skills', name, 'SKILL.md'), text);
};
await skill(
  'distill',
  '---\nname: distill\ndescription: Files yesterday into the library.\n---\n\nOnly ever append.\n',
);
await skill(
  'promote',
  '---\nname: promote\ndescription: Opens a promotion pull request.\n---\n\nCopy, never move.\n',
);
// A package that cannot be read must be reported, not silently dropped.
await skill('unreadable', '---\nname: mismatched\ndescription: d\n---\n\nBody\n');

const bin = path.join(base, 'bin');
await mkdir(bin);
await writeFile(
  path.join(bin, 'pi'),
  `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/harnesses.mjs')).href)}).then(m=>m.run("pi"));\n`,
  { mode: 0o700 },
);
const env = {
  ...process.env,
  PATH: bin + path.delimiter + process.env.PATH,
  IRORI_DATA_DIR: files.dataDir,
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
  for (const name of ['スキル検証', '素のKB'])
    await page.getByRole('checkbox', { name: new RegExp(name) }).check();
  await page.getByRole('button', { name: '選択したスペースを開く' }).click();
  await page.getByRole('button', { name: 'AIに相談', exact: true }).click();
  await page.getByLabel('エージェント', { exact: true }).selectOption('pi');

  const picker = page.getByLabel('スキル', { exact: true });
  await expect(picker).toBeVisible();
  await expect(picker).toHaveValue('');
  expect(await picker.locator('option').allTextContents()).toEqual([
    'スキルなし',
    'distill',
    'promote',
  ]);
  await expect(page.getByText('読み込めないスキル')).toContainText('.agents/skills/unreadable');

  await picker.selectOption('distill');
  await page.getByLabel('エージェントへの指示').fill('sort out yesterday');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect(page.locator('.message.done').last()).toContainText('完了');
  await expect(page.locator('.agent-panel')).toContainText('distill スキルの手順で実行します。');

  const sent = (await readFile(path.join(root, 'fixture-requests.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .find((entry) => entry.type === 'prompt').message as string;
  expect(sent).toContain('Only ever append.');
  expect(sent).not.toContain('Copy, never move.');
  expect(sent.indexOf('Only ever append.')).toBeLessThan(sent.indexOf('sort out yesterday'));

  // Skills belong to the space that declares them; switching must not carry them over.
  const knowledge = page.getByRole('region', { name: '個人のナレッジ' });
  await knowledge.getByRole('button', { name: '素のKB', exact: true }).click();
  await expect(page.getByLabel('スキル', { exact: true })).toHaveCount(0);
  await expect(page.getByText('読み込めないスキル')).toHaveCount(0);
  await knowledge.getByRole('button', { name: 'スキル検証', exact: true }).click();
  await expect(page.getByLabel('スキル', { exact: true })).toHaveValue('');
} catch (error) {
  await (
    await app.firstWindow()
  )
    .screenshot({ path: 'test-results/irori-skills-failure.png' })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
if (errors.length) throw Error(`Renderer errors: ${errors.join('\n')}`);
console.log('Skill picker smoke passed.');
