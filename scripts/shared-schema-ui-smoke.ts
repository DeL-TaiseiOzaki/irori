import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { SettingsService } from '../src/host/settings';
import { YourAiService } from '../src/host/you';

// Every Schema from the settings (ADR 027): the shared Schema every agent
// follows, written as files in the irori agent's folder, and a hibachi's own,
// all through the forms and checked on disk. No model or cloud call is made.
const base = await mkdtemp(path.join(tmpdir(), 'irori shared schema UI '));
const home = path.join(base, 'home');
await mkdir(home);
const files = new FileService(path.join(base, 'device'));
await files.init();
// Hibachi Schemas are offered while hibachi agents are on (ADR 021).
await new SettingsService(files.dataDir).save({ hibachiAgent: true });
const { root: you } = await new YourAiService(files.dataDir, home).create();
const root = path.join(base, 'KB');
await mkdir(path.join(root, '.agents', 'skills', 'distill'), { recursive: true });
await writeFile(path.join(root, 'AGENTS.md'), '# Always\n\nWrite in plain words.\n');
await writeFile(path.join(root, 'note.md'), '# Note\n');
await writeFile(
  path.join(root, '.agents', 'skills', 'distill', 'SKILL.md'),
  '---\nname: distill\ndescription: Files yesterday.\n---\n\nOnly ever append.\n',
);
await files.register(root, 'Shared KB', 'personal');
const shared = (relative: string) => readFile(path.join(you, '.irori', 'shared', relative), 'utf8');

const env = { ...process.env, HOME: home, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
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
  await page.getByRole('checkbox', { name: /Shared KB/ }).check();
  await page.getByRole('button', { name: '選択したスペースを開く' }).click();

  // The settings open every Schema; the shared one comes first.
  await page.getByRole('button', { name: /^設定（/ }).click();
  await page.getByRole('button', { name: '共通・hibachi', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Schema の設定' });
  const owners = dialog.getByRole('navigation', { name: 'Schema の設定' });
  await expect(owners.getByRole('button', { name: '共通', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(owners.getByRole('button', { name: 'irori agent', exact: true })).toBeVisible();
  await expect(owners.getByRole('button', { name: 'Shared KB', exact: true })).toBeVisible();
  const group = (name: string) =>
    dialog.getByRole('group', { name: `Schema の${name}`, exact: true });
  const stage = dialog.getByRole('region', { name: 'Schema の設定' });
  // Instructions and skills only: rules and hooks belong to Claude Code, not to every agent.
  await expect(group('指示')).toContainText('まだありません');
  await expect(group('スキル')).toContainText('まだありません');
  await expect(group('ルール')).toHaveCount(0);
  await expect(group('フック')).toHaveCount(0);

  // Written through the form; irori keeps it as a file in the irori agent's folder.
  await dialog.getByRole('button', { name: '指示を追加', exact: true }).click();
  await expect(stage.getByRole('combobox', { name: '場所', exact: true })).toHaveValue('');
  await expect(
    stage.getByRole('combobox', { name: '場所', exact: true }).locator('option'),
  ).toHaveText(['すべてのエージェント（AGENTS.md）']);
  await stage
    .getByRole('textbox', { name: '指示', exact: true })
    .fill('Write dates as YYYY-MM-DD.\n');
  await stage.getByRole('button', { name: '作成', exact: true }).click();
  await expect(group('指示').getByRole('button', { name: 'AGENTS.md' })).toBeVisible();
  await expect.poll(() => shared('AGENTS.md')).toBe('Write dates as YYYY-MM-DD.\n');

  await dialog.getByRole('button', { name: 'スキルを追加', exact: true }).click();
  await stage.getByRole('textbox', { name: '名前', exact: true }).fill('weekly');
  await stage.getByRole('textbox', { name: '説明', exact: true }).fill('Writes the weekly review.');
  await stage.getByRole('textbox', { name: '手順', exact: true }).fill('Collect the week.');
  await stage.getByRole('button', { name: '作成', exact: true }).click();
  await expect(group('スキル').getByRole('button', { name: 'weekly' })).toBeVisible();
  expect(await shared('.agents/skills/weekly/SKILL.md')).toBe(
    '---\nname: weekly\ndescription: Writes the weekly review.\n---\n\nCollect the week.\n',
  );
  // The irori agent's own instructions are another Schema, untouched.
  expect(await readFile(path.join(you, 'AGENTS.md'), 'utf8')).not.toContain('YYYY-MM-DD');

  // A hibachi's own Schema from the same place, with all its kinds.
  await owners.getByRole('button', { name: 'Shared KB', exact: true }).click();
  await expect(group('ルール')).toBeVisible();
  await group('指示').getByRole('button', { name: 'AGENTS.md', exact: true }).click();
  const instructions = stage.getByRole('textbox', { name: '指示', exact: true });
  await expect(instructions).toHaveValue('# Always\n\nWrite in plain words.\n');
  await instructions.fill('# Always\n\nWrite in plain words.\nCite the source.\n');
  await stage.getByRole('button', { name: '保存', exact: true }).click();
  await expect(stage.getByRole('status')).toContainText('保存しました');
  expect(await readFile(path.join(root, 'AGENTS.md'), 'utf8')).toBe(
    '# Always\n\nWrite in plain words.\nCite the source.\n',
  );
  await owners.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // The shared skill joins the hibachi's own in its composer.
  await page.getByRole('button', { name: 'hibachi agent', exact: true }).click();
  const picker = page.getByLabel('スキル', { exact: true });
  await expect(picker.locator('option')).toHaveText([
    'スキルなし',
    'distill — Files yesterday.',
    'weekly (共通) — Writes the weekly review.',
  ]);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify(
      {
        checks: [
          'settings open every Schema, the shared one first',
          'the shared Schema offers instructions and skills only',
          'shared instructions and a shared skill written as files in the irori agent folder',
          'a hibachi Schema edited from the same dialog',
          'the shared skill offered in a hibachi composer beside its own',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log('Shared Schema UI checks passed; no native model or cloud calls.');
} catch (error) {
  await (
    await app.firstWindow()
  )
    .screenshot({ path: 'test-results/irori-shared-schema-failure.png' })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
