import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
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
// A disposable home stands in for the user's, so the reach view reads nothing real.
const home = path.join(base, 'home');
await mkdir(root);
await mkdir(plain);
await mkdir(home);
const space = await files.register(root, 'スキル検証', 'personal');
await files.register(plain, '素のKB', 'personal');
await writeFile(path.join(root, 'note.md'), '# Skill fixture\n');
await writeFile(path.join(plain, 'note.md'), '# No skills here\n');

const skill = async (name: string, text: string, at = path.join(root, '.agents', 'skills')) => {
  await mkdir(path.join(at, name), { recursive: true });
  await writeFile(path.join(at, name, 'SKILL.md'), text);
};
await skill(
  'distill',
  '---\nname: distill\ndescription: Files yesterday into the library.\n---\n\nOnly ever append.\n',
);
await skill(
  'promote',
  '---\nname: promote\ndescription: Opens a promotion pull request.\nmetadata:\n  roles: maintainer\n---\n\nCopy, never move.\n',
);
await skill(
  'review',
  '---\nname: review\ndescription: Reads a draft closely.\nmetadata:\n  roles: editor\n---\n\nRead twice.\n',
);
// A package that cannot be read must be reported, not silently dropped.
await skill('unreadable', '---\nname: mismatched\ndescription: d\n---\n\nBody\n');
// A retired skill keeps its name and the reason, and nothing a CLI would load.
await mkdir(path.join(root, '.agents', 'skills', 'old'));
await writeFile(
  path.join(root, '.agents', 'skills', 'old', 'RETIRED.md'),
  '---\nretired: 2026-09-21\nreason: Folded into distill.\nreplacement: distill\n---\n',
);
// Personal copies: one shadows a declared skill in Claude Code, one keeps a retired name alive.
await skill(
  'distill',
  '---\nname: distill\ndescription: Personal copy.\n---\n\nMine.\n',
  path.join(home, '.claude', 'skills'),
);
await skill(
  'old',
  '---\nname: old\ndescription: Stale copy.\n---\n\nStale.\n',
  path.join(home, '.agents', 'skills'),
);

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
  HOME: home,
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
    'distill — Files yesterday into the library.',
    'promote — Opens a promotion pull request.',
    'review — Reads a draft closely.',
  ]);
  await expect(page.getByText('読み込めないスキル')).toContainText('.agents/skills/unreadable');
  await expect(page.getByText('old スキルは 2026-09-21 に退役しました')).toContainText(
    'Folded into distill.（代わりに distill）',
  );

  // The reader's role narrows the picker on this device; unscoped skills stay.
  const role = page.getByLabel('役割', { exact: true });
  await expect(role).toHaveValue('');
  await expect(page.getByLabel('プロジェクト', { exact: true })).toHaveCount(0);
  await role.selectOption('editor');
  expect(await picker.locator('option').allTextContents()).toEqual([
    'スキルなし',
    'distill — Files yesterday into the library.',
    'review — Reads a draft closely.',
  ]);
  await expect
    .poll(() => readFile(path.join(files.dataDir, 'device-settings.json'), 'utf8').catch(() => ''))
    .toContain('"role": "editor"');
  // The choice stays on the device: the KB's skill directory gains nothing.
  expect((await readdir(path.join(root, '.agents', 'skills'))).sort()).toEqual([
    'distill',
    'old',
    'promote',
    'review',
    'unreadable',
  ]);
  await role.selectOption('');
  await expect(picker.locator('option')).toHaveCount(4);

  // The reach view names home-relative directories only, never the machine path.
  await page.getByRole('button', { name: '到達確認' }).click();
  const reach = page.getByRole('dialog', { name: 'スキルの到達' });
  await expect(reach).toContainText('Claude Code');
  await expect(reach).toContainText('読まない。同名が ~/.claude/skills にあり、そちらだけを読む');
  await expect(reach).toContainText('退役した名前が ~/.agents/skills に残っている');
  await expect(reach).toContainText('信頼済みなら読む');
  expect(await reach.textContent()).not.toContain(home);
  await reach.getByRole('button', { name: '閉じる' }).click();
  await expect(reach).toHaveCount(0);

  await picker.selectOption('distill');
  // A run may add a package. It must appear when the run settles without clearing the choice.
  await skill(
    'journal',
    '---\nname: journal\ndescription: Appends to a dated record.\n---\n\nAppend only.\n',
  );
  await page.getByLabel('エージェントへの指示').fill('sort out yesterday');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect(page.locator('.message.done').last()).toContainText('完了');
  await expect(page.locator('.agent-panel')).toContainText('distill スキルの手順で実行します。');
  await expect(picker.locator('option')).toContainText([
    'スキルなし',
    'distill — Files yesterday into the library.',
    'journal — Appends to a dated record.',
    'promote — Opens a promotion pull request.',
    'review — Reads a draft closely.',
  ]);
  await expect(picker).toHaveValue('distill');

  const sent = (await readFile(path.join(root, 'fixture-requests.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .find((entry) => entry.type === 'prompt').message as string;
  expect(sent).toContain('Only ever append.');
  expect(sent).not.toContain('Copy, never move.');
  expect(sent.indexOf('Only ever append.')).toBeLessThan(sent.indexOf('sort out yesterday'));

  // Skills belong to the space that declares them; switching must not carry them over.
  const rail = page.getByRole('navigation', { name: 'Brain' });
  await rail.getByRole('button', { name: /^素のKB・AI/ }).click();
  await expect(page.getByLabel('スキル', { exact: true })).toHaveCount(0);
  await expect(page.getByText('読み込めないスキル')).toHaveCount(0);
  await expect(page.getByText('退役しました')).toHaveCount(0);
  await rail.getByRole('button', { name: /^スキル検証・AI/ }).click();
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
