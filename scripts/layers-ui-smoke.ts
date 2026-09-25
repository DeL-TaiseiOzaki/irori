import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileService } from '../src/host/files';
import type { Category } from '../src/domain/types';

const base = await mkdtemp(path.join(tmpdir(), 'irori layers '));
const files = new FileService(path.join(base, 'device'));
await files.init();
const spaces = [];
for (const [name, category] of [
  ['個人KB', 'personal'],
  ['Engineering', 'team'],
  ['Research', 'team'],
  ['組織KB', 'organization'],
] as [string, Category][]) {
  const root = path.join(base, name);
  await mkdir(root);
  const space = await files.register(root, name, category);
  spaces.push(space);
  for (const directory of ['schema', '.codex', 'Knowledge_Base/notes'])
    await mkdir(path.join(root, directory), { recursive: true });
  await writeFile(path.join(root, 'AGENTS.md'), `# ${name} rules\n\nOnly this repository.\n`);
  await writeFile(path.join(root, 'schema/policy.md'), `# ${name} policy\n`);
  await writeFile(path.join(root, '.codex/config.toml'), '# Native configuration fixture\n');
  await writeFile(path.join(root, 'README.md'), `# ${name} notes\n`);
  await writeFile(path.join(root, 'Knowledge_Base/notes/topic.md'), `# ${name} topic\n`);
  const contentsRoot = category === 'personal' ? 'schema/raw' : 'contents';
  const { root: _root, ...declaration } = space;
  await writeFile(
    path.join(root, '.irori/scope.json'),
    JSON.stringify({ ...declaration, contents: [contentsRoot] }),
  );
  await writeFile(
    path.join(root, '.irori/cloud-mounts.json'),
    JSON.stringify([
      {
        schemaVersion: 1,
        scopeId: space.scopeId,
        mountId: randomUUID(),
        provider: 'google-drive',
        folderId: 'fixture-folder',
        parentId: 'root',
        folderName: 'Drive name',
        contentsRoot,
        name: '調査 資料',
        access: 'read-only',
      },
    ]),
  );
}
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
  await expect(page.getByRole('checkbox')).toHaveCount(4);
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check();
  await page.getByRole('button', { name: '選択したスペースを開く' }).click();
  // The rail holds the workspace's brains in order; the panel shows one brain.
  const rail = page.getByRole('navigation', { name: 'Brain' });
  const brain = (name: string) => rail.getByRole('button', { name: new RegExp(`^${name}・AI`) });
  for (const name of ['個人KB', 'Engineering', 'Research', '組織KB'])
    await expect(brain(name)).toBeVisible();
  await expect(brain('個人KB')).toHaveAttribute('aria-current', 'true');
  const panel = page.locator('.brain-panel');
  const section = (name: string) => panel.getByRole('region', { name, exact: true });
  const schema = section('Schema');
  const knowledge = section('Knowledge');
  const contents = section('Contents');
  await expect(panel.locator('.brain-names')).toContainText('個人KB');
  await expect(panel.locator('.brain-names')).toContainText('個人');
  await expect(schema.getByRole('button', { name: 'AGENTS', exact: true })).toHaveCount(1);
  await expect(schema.getByRole('button', { name: 'README', exact: true })).toHaveCount(0);
  await expect(knowledge.getByRole('button', { name: 'README', exact: true })).toHaveCount(1);
  await expect(knowledge.getByRole('button', { name: /AGENTS/ })).toHaveCount(0);
  // An unconfigured Drive alias is visible without a mount, in the brain's Contents only.
  await expect(contents.getByRole('button', { name: /調査 資料/ })).toHaveCount(1);
  await expect(contents.getByText('未接続')).toBeVisible();
  // A nested contents root under schema/ stays out of the Schema section.
  await schema.getByRole('button', { name: 'schema', exact: true }).click();
  await expect(schema.getByRole('button', { name: 'policy', exact: true })).toBeVisible();
  await expect(schema.getByRole('button', { name: /raw|調査 資料/ })).toHaveCount(0);
  // The organization's category shows beside its name.
  await brain('組織KB').click();
  await expect(panel.locator('.brain-names')).toContainText('組織');
  await expect(brain('組織KB')).toHaveAttribute('aria-current', 'true');
  // Each section can be resized, folded to its heading, and the sizes are kept on the device.
  await expect.poll(() => page.evaluate(() => innerHeight)).toBeGreaterThan(900);
  const height = async (name: string) => (await section(name).boundingBox())!.height;
  const drag = async (label: string, dx: number, dy: number) => {
    const box = (await page.getByRole('separator', { name: label }).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
    await page.mouse.up();
  };
  const [schemaBefore, knowledgeBefore] = [await height('Schema'), await height('Knowledge')];
  await drag('Schema と Knowledge の境界', 0, 30);
  await expect.poll(() => height('Schema')).toBeGreaterThan(schemaBefore + 20);
  expect(await height('Knowledge')).toBeLessThan(knowledgeBefore - 20);
  const [knowledgeMiddle, contentsBefore] = [await height('Knowledge'), await height('Contents')];
  await drag('Knowledge と Contents の境界', 0, 15);
  await expect.poll(() => height('Knowledge')).toBeGreaterThan(knowledgeMiddle + 8);
  expect(await height('Contents')).toBeLessThan(contentsBefore - 8);
  const others = async () => (await height('Schema')) + (await height('Contents'));
  const [knowledgeOpen, othersOpen] = [await height('Knowledge'), await others()];
  await knowledge.getByRole('button', { name: 'Knowledge', exact: true }).click();
  await expect.poll(() => height('Knowledge')).toBeLessThan(40);
  await expect(knowledge.getByRole('button', { name: 'Knowledge', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  expect(await others()).toBeGreaterThan(othersOpen + knowledgeOpen - 45);
  await knowledge.getByRole('button', { name: 'Knowledge', exact: true }).click();
  await expect.poll(() => height('Knowledge')).toBeGreaterThan(80);
  await expect
    .poll(async () =>
      Object.keys(
        JSON.parse(
          await readFile(path.join(files.dataDir, 'device-settings.json'), 'utf8').catch(
            () => '{}',
          ),
        ).layouts ?? {},
      ).join(' '),
    )
    .toMatch(/irori-brain-sections/);
  await page.screenshot({ path: 'test-results/irori-resized-sections.png' });
  // Same-named notes belong to their own brains; switching saves the one being edited.
  await brain('個人KB').click();
  await schema.getByRole('button', { name: 'AGENTS', exact: true }).click();
  await expect(page.locator('.document-editor')).toContainText('個人KB rules');
  await brain('Engineering').click();
  await knowledge.getByRole('button', { name: 'README', exact: true }).click();
  await expect(page.locator('.document-editor')).toContainText('Engineering notes');
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\nEngineering edit\n');
  await brain('Research').click();
  await expect(brain('Research')).toHaveAttribute('aria-current', 'true');
  await knowledge.getByRole('button', { name: 'README', exact: true }).click();
  await expect(knowledge.locator('[aria-current="page"]')).toContainText('README');
  await expect(page.locator('.crumbs')).toContainText('Research');
  await expect(page.getByText('保存済み', { exact: true })).toBeVisible();
  expect(await readFile(path.join(spaces[1].root, 'README.md'), 'utf8')).toContain(
    'Engineering edit',
  );
  expect(await readFile(path.join(spaces[2].root, 'README.md'), 'utf8')).toBe('# Research notes\n');
  await expect(page.locator('.document-editor')).toContainText('Research notes');
  // The AI panel belongs to the brain on show and names its Schema.
  await page.getByRole('button', { name: 'AIに相談', exact: true }).click();
  await expect(page.getByLabel('相談の対象')).toContainText('Research');
  await expect(page.locator('.schema-line')).toContainText('Research の Schema');
  await expect(page.locator('.schema-line')).toContainText('AGENTS.md');
  await page.getByRole('button', { name: 'このノートの要点をまとめて', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'エージェントへの指示' })).toHaveValue(
    'このノートの要点をまとめて',
  );
  await expect(page.getByRole('textbox', { name: 'エージェントへの指示' })).toBeFocused();
  await expect(page.locator('.message.user')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/irori-brain-panel.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 800));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(1024);
  const panelBounds = await page.locator('.agent-panel').boundingBox();
  expect(panelBounds!.x).toBeGreaterThanOrEqual(0);
  expect(panelBounds!.x + panelBounds!.width).toBeLessThanOrEqual(
    await page.evaluate(() => innerWidth),
  );
  await page.screenshot({ path: 'test-results/irori-brain-panel-narrow.png' });
  await page
    .locator('.agent-header')
    .getByRole('button', { name: 'AIパネルを閉じる', exact: true })
    .click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
  // The Contents action opens the connections of the brain it belongs to.
  await brain('個人KB').click();
  await contents.getByRole('button', { name: '個人KB のクラウド接続', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'クラウド接続' })).toContainText(
    '個人KB の Contents に Google Drive を接続',
  );
  await expect(page.locator('.connection-card')).toContainText('schema/raw/調査 資料/');
  await page.getByRole('dialog').getByRole('button', { name: '閉じる', exact: true }).click();
  expect(errors).toEqual([]);
  await writeFile(
    'test-results/layers-ui-smoke.json',
    JSON.stringify(
      {
        checks: [
          'rail lists the workspace brains in order and marks the one on show',
          'one brain panel with Schema, Knowledge and Contents; category beside the name',
          'sections resize, fold to their headings and are kept on the device',
          'per-brain schema isolation',
          'nested contents excluded from schema',
          'unconfigured aliases visible without a mount',
          'same-name note ownership and saving before switching brains',
          'agent context and Schema line follow the brain on show',
          'prompt suggestions fill and focus the composer without starting a run',
          'cloud action targets its owning brain',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log('Brain panel UI checks passed; no native model or cloud calls.');
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
