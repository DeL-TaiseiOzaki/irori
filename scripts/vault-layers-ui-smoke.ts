import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { SettingsService } from '../src/host/settings';
import { WorkspaceService } from '../src/host/workspaces';
import { chooseJapanese } from '../tests/fixtures/japanese-interface';

// A vault chooses the layers it has (ADR 070): the settings leave Knowledge out
// of a workspace for code, the panel and the home follow, nothing on disk moves,
// and choosing the layer again brings it back. No model or cloud call is made.
const base = await mkdtemp(path.join(tmpdir(), 'irori vault layers UI '));
const files = new FileService(path.join(base, 'device'));
await files.init();
// The Schema section shows only with the vault agent on (ADR 021).
await new SettingsService(files.dataDir).save({ vaultAgent: true });
const root = path.join(base, 'Dev');
await mkdir(path.join(root, 'Knowledge_Base'), { recursive: true });
await mkdir(path.join(root, 'scripts'), { recursive: true });
await writeFile(path.join(root, 'AGENTS.md'), '# Dev\n\nBuild with the scripts.\n');
await writeFile(path.join(root, 'Knowledge_Base', 'note.md'), '# Note\n');
await writeFile(path.join(root, 'scripts', 'build.sh'), 'echo build\n');
const dev = await files.register(root, 'Dev', 'personal');
await new WorkspaceService(files).save('Lab', [dev.scopeId]);
const scope = async () =>
  JSON.parse(await readFile(path.join(root, '.irori', 'scope.json'), 'utf8'));
await chooseJapanese(files.dataDir);
const env = { ...process.env, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const errors: string[] = [];
const app = await electron.launch({
  args: [
    ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '.',
  ],
  env,
});
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.locator('.workspace-card').filter({ hasText: 'Lab' }).click();
  const panel = page.locator('.brain-panel');
  const section = (name: string) => panel.getByRole('region', { name, exact: true });
  const sheet = page.getByRole('dialog', { name: 'vault の設定' });
  const open = async () => {
    await page.getByRole('button', { name: 'vault のメニュー', exact: true }).click();
    await page.getByRole('menuitem', { name: 'vault の設定', exact: true }).click();
    await expect(sheet).toBeVisible();
  };
  const save = async () => {
    await sheet.getByRole('button', { name: '保存', exact: true }).click();
    await expect(sheet).toHaveCount(0);
  };
  const choice = sheet.getByRole('group', { name: 'この vault が持つ層' });

  // A vault starts with all three layers; Schema's choice is always on.
  for (const name of ['Schema', 'Knowledge', 'Contents']) await expect(section(name)).toBeVisible();
  await expect(page.getByRole('button', { name: 'ノートを作成', exact: true })).toBeVisible();
  await open();
  await expect(choice.getByRole('checkbox', { name: 'Schema' })).toBeChecked();
  await expect(choice.getByRole('checkbox', { name: 'Schema' })).toBeDisabled();
  await expect(choice.getByRole('checkbox', { name: 'Knowledge' })).toBeChecked();
  await expect(choice.getByRole('checkbox', { name: 'Contents' })).toBeChecked();

  // Schema and Contents: a workspace for code, with no notes.
  await choice.getByRole('checkbox', { name: 'Knowledge' }).uncheck();
  await expect(sheet.getByRole('textbox', { name: 'Knowledge の表示名' })).toBeDisabled();
  await expect(sheet.getByRole('textbox', { name: 'Knowledge のフォルダ' })).toBeDisabled();
  await expect(sheet.getByRole('textbox', { name: 'Contents のフォルダ' })).toBeEnabled();
  await page.screenshot({ path: 'test-results/irori-vault-layers-settings.png' });
  await save();
  expect((await scope()).layers).toEqual(['contents']);
  // The declaration's folders are as they were, and no file moved.
  expect((await scope()).contents).toEqual(['contents']);
  expect(await readFile(path.join(root, 'Knowledge_Base', 'note.md'), 'utf8')).toBe('# Note\n');
  await expect(section('Knowledge')).toHaveCount(0);
  await expect(section('Contents')).toBeVisible();
  // Schema opens on the vault's own files, the former notes among them.
  const schema = section('Schema');
  await expect(schema.getByRole('button', { name: 'scripts', exact: true })).toBeVisible();
  await expect(schema.getByRole('button', { name: 'Knowledge_Base', exact: true })).toBeVisible();
  await expect(schema.getByRole('button', { name: 'AGENTS.md', exact: true })).toBeVisible();
  // The home offers no note and shows no Knowledge card.
  await expect(page.getByRole('button', { name: 'ノートを作成', exact: true })).toHaveCount(0);
  await expect(page.locator('.home-card.Knowledge_Base')).toHaveCount(0);
  await expect(page.locator('.home-card.contents')).toBeVisible();
  // A file of the vault still opens from the Schema file view.
  await schema.getByRole('button', { name: 'scripts', exact: true }).click();
  await schema.getByRole('button', { name: 'build.sh', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('echo build');
  await page.screenshot({ path: 'test-results/irori-vault-layers-workspace.png' });

  // Schema and Knowledge: notes alone.
  await open();
  await choice.getByRole('checkbox', { name: 'Knowledge' }).check();
  await choice.getByRole('checkbox', { name: 'Contents' }).uncheck();
  await expect(sheet.getByRole('textbox', { name: 'Contents のフォルダ' })).toBeDisabled();
  await save();
  expect((await scope()).layers).toEqual(['Knowledge_Base']);
  await expect(section('Knowledge')).toBeVisible();
  await expect(section('Contents')).toHaveCount(0);
  // A note shows by its title again, as in every knowledge tree.
  await expect(section('Knowledge').getByText('note', { exact: true })).toBeVisible();

  // All three again: the declaration keeps no field for it.
  await open();
  await choice.getByRole('checkbox', { name: 'Contents' }).check();
  await save();
  expect('layers' in (await scope())).toBe(false);
  for (const name of ['Schema', 'Knowledge', 'Contents']) await expect(section(name)).toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    'Vault layers UI passed: all three by default, Schema and Contents with the vault’s files under Schema and no note offered, Schema and Knowledge, and all three again with nothing moved.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
