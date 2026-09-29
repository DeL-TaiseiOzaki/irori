import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';

// The Schema section as settings: every change is made through the forms and
// checked on disk, in a disposable KB. No model or cloud call is made.
const base = await mkdtemp(path.join(tmpdir(), 'irori schema settings '));
const files = new FileService(path.join(base, 'device'));
await files.init();
const root = path.join(base, 'KB');
await mkdir(path.join(root, 'Knowledge_Base', 'projects'), { recursive: true });
await mkdir(path.join(root, '.agents', 'skills', 'distill'), { recursive: true });
await mkdir(path.join(root, '.claude'), { recursive: true });
await writeFile(path.join(root, 'AGENTS.md'), '# Always\n\nWrite in plain words.\n');
await writeFile(path.join(root, 'Knowledge_Base', 'projects', 'plan.md'), '# Plan\n');
await writeFile(
  path.join(root, '.agents', 'skills', 'distill', 'SKILL.md'),
  '---\nname: distill\ndescription: Files yesterday.\nmetadata:\n  roles: editor\n---\n\nOnly ever append.\n',
);
await writeFile(
  path.join(root, '.claude', 'settings.json'),
  JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } }),
);
await files.register(root, 'Schema KB', 'personal');
const read = (relative: string) => readFile(path.join(root, relative), 'utf8');

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
  await page.getByRole('checkbox', { name: /Schema KB/ }).check();
  await page.getByRole('button', { name: '選択したスペースを開く' }).click();
  const schema = page.locator('.brain-panel').getByRole('region', { name: 'Schema', exact: true });
  const group = (name: string) =>
    schema.getByRole('group', { name: `Schema の${name}`, exact: true });
  const stage = page.getByRole('region', { name: 'Schema の設定' });
  await expect(group('指示')).toContainText('AGENTS.md');
  await expect(group('スキル')).toContainText('distill');
  await expect(group('ルール')).toContainText('まだありません');
  await expect(group('フック')).toContainText('まだありません');

  // The instructions the agent always reads.
  await group('指示').getByRole('button', { name: 'AGENTS.md', exact: true }).click();
  const instructions = stage.getByRole('textbox', { name: '指示', exact: true });
  await expect(instructions).toHaveValue('# Always\n\nWrite in plain words.\n');
  await instructions.fill('# Always\n\nWrite in plain words.\nCite the source.\n');
  await stage.getByRole('button', { name: '保存', exact: true }).click();
  await expect(stage.getByRole('status')).toContainText('保存しました');
  expect(await read('AGENTS.md')).toBe('# Always\n\nWrite in plain words.\nCite the source.\n');

  // A new skill: name, description and instructions, then an attached file.
  await schema.getByRole('button', { name: 'スキルを追加', exact: true }).click();
  await stage.getByRole('textbox', { name: '名前', exact: true }).fill('weekly-review');
  await stage
    .getByRole('textbox', { name: '説明', exact: true })
    .fill('Reviews the week: what moved, what did not.');
  await stage
    .getByRole('textbox', { name: '手順', exact: true })
    .fill('Run scripts/collect.py first.');
  await stage.getByRole('button', { name: '作成', exact: true }).click();
  await expect(group('スキル').getByRole('button', { name: 'weekly-review' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(await read('.agents/skills/weekly-review/SKILL.md')).toBe(
    '---\nname: weekly-review\ndescription: "Reviews the week: what moved, what did not."\n---\n\nRun scripts/collect.py first.\n',
  );
  await stage.getByRole('button', { name: 'ファイルを追加', exact: true }).click();
  await stage.getByRole('textbox', { name: 'ファイル名', exact: true }).fill('scripts/collect.py');
  await stage.getByRole('textbox', { name: '内容', exact: true }).fill('print("week")\n');
  await stage.getByRole('button', { name: '追加', exact: true }).click();
  await expect(stage.getByRole('button', { name: 'scripts/collect.py' })).toBeVisible();
  expect(await read('.agents/skills/weekly-review/scripts/collect.py')).toBe('print("week")\n');
  // A text file from disk is imported the same way.
  await stage.getByRole('button', { name: 'ファイルを追加', exact: true }).click();
  await stage.locator('input[type="file"]').setInputFiles({
    name: 'checklist.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('- [ ] Inbox\n'),
  });
  await expect(stage.getByRole('textbox', { name: 'ファイル名', exact: true })).toHaveValue(
    'checklist.md',
  );
  await stage.getByRole('button', { name: '追加', exact: true }).click();
  await expect(stage.getByRole('button', { name: 'checklist.md' })).toBeVisible();
  expect(await read('.agents/skills/weekly-review/checklist.md')).toBe('- [ ] Inbox\n');
  await page.screenshot({ path: 'test-results/irori-schema-settings.png' });

  // Editing a skill keeps the metadata the form does not show; renaming moves its folder.
  await group('スキル').getByRole('button', { name: 'distill', exact: true }).click();
  await expect(stage.getByRole('textbox', { name: '説明', exact: true })).toHaveValue(
    'Files yesterday.',
  );
  await stage.getByRole('textbox', { name: '名前', exact: true }).fill('file-away');
  await stage
    .getByRole('textbox', { name: '説明', exact: true })
    .fill('Files yesterday into the library.');
  await stage.getByRole('button', { name: '保存', exact: true }).click();
  await expect(group('スキル').getByRole('button', { name: 'file-away' })).toBeVisible();
  expect((await readdir(path.join(root, '.agents', 'skills'))).sort()).toEqual([
    'file-away',
    'weekly-review',
  ]);
  expect(await read('.agents/skills/file-away/SKILL.md')).toBe(
    '---\nname: file-away\ndescription: Files yesterday into the library.\nmetadata:\n  roles: editor\n---\n\nOnly ever append.\n',
  );

  // A rule, created and then deleted after confirmation.
  await schema.getByRole('button', { name: 'ルールを追加', exact: true }).click();
  await stage.getByRole('textbox', { name: 'ファイル名', exact: true }).fill('tone');
  await stage.getByRole('textbox', { name: 'ルール', exact: true }).fill('Be brief.\n');
  await stage.getByRole('button', { name: '作成', exact: true }).click();
  await expect(group('ルール').getByRole('button', { name: 'tone.md' })).toBeVisible();
  expect(await read('.claude/rules/tone.md')).toBe('Be brief.\n');
  await stage.getByRole('button', { name: '削除', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'ルールを削除' });
  await confirm.getByRole('button', { name: '削除する', exact: true }).click();
  await expect(group('ルール')).toContainText('まだありません');
  expect(await readdir(path.join(root, '.claude', 'rules'))).toEqual([]);

  // A hook goes into .claude/settings.json beside the keys already there.
  await schema.getByRole('button', { name: 'フックを追加', exact: true }).click();
  await stage
    .getByRole('combobox', { name: 'タイミング', exact: true })
    .selectOption('PostToolUse');
  await stage.getByRole('textbox', { name: '対象（matcher）', exact: true }).fill('Edit|Write');
  await stage.getByRole('textbox', { name: 'コマンド', exact: true }).fill('npm run format');
  await stage.getByRole('button', { name: '作成', exact: true }).click();
  await expect(group('フック')).toContainText('PostToolUse · Edit|Write');
  expect(await read('.claude/settings.json')).toBe(
    JSON.stringify(
      {
        permissions: { allow: ['Bash(npm test)'] },
        hooks: {
          PostToolUse: [
            { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'npm run format' }] },
          ],
        },
      },
      null,
      2,
    ) + '\n',
  );

  // A folder's own instructions.
  await schema.getByRole('button', { name: '指示を追加', exact: true }).click();
  await stage
    .getByRole('combobox', { name: '場所', exact: true })
    .selectOption('Knowledge_Base/projects');
  await stage
    .getByRole('textbox', { name: '指示', exact: true })
    .fill('Keep one plan per project.\n');
  await stage.getByRole('button', { name: '作成', exact: true }).click();
  await expect(group('指示')).toContainText('Knowledge_Base/projects');
  expect(await read('Knowledge_Base/projects/AGENTS.md')).toBe('Keep one plan per project.\n');

  // Nothing is unreachable: the files are one toggle away.
  await schema.getByRole('button', { name: 'ファイルとして表示', exact: true }).click();
  await expect(schema.getByRole('button', { name: '.agents', exact: true })).toBeVisible();
  await expect(schema.getByRole('button', { name: '.claude', exact: true })).toBeVisible();
  await schema.getByRole('button', { name: 'ファイルとして表示', exact: true }).click();
  await expect(group('スキル')).toContainText('weekly-review');
  expect(errors).toEqual([]);
  await writeFile(
    'test-results/schema-settings-ui-smoke.json',
    JSON.stringify(
      {
        checks: [
          'Schema section lists instructions, skills, rules and hooks',
          'AGENTS.md edited through the form',
          'skill created with name, description, instructions and two attached files',
          'skill renamed with its folder; other front matter kept',
          'rule created and deleted after confirmation',
          'hook written into .claude/settings.json beside existing keys',
          'folder AGENTS.md created in a chosen knowledge folder',
          'raw files remain reachable through the toggle',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log('Schema settings UI checks passed; no native model or cloud calls.');
} catch (error) {
  await (
    await app.firstWindow()
  )
    .screenshot({ path: 'test-results/irori-schema-settings-failure.png' })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
