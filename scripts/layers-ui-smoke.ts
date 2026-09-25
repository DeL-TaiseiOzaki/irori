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
  const schema = page.locator('.layer-pane.schema');
  const personal = page.locator('.layer-pane.my-kb');
  const team = page.locator('.layer-pane.team-kb');
  await expect(page.locator('.layer-pane')).toHaveCount(5);
  await expect(schema.getByRole('button', { name: 'AGENTS', exact: true })).toHaveCount(4);
  await expect(personal.locator('.scope-tree')).toHaveCount(1);
  await expect(team.locator('.scope-tree')).toHaveCount(3);
  await expect(team.getByText('組織', { exact: true })).toBeVisible();
  await expect(personal.getByRole('button', { name: /AGENTS/ })).toHaveCount(0);
  await expect(schema.getByRole('button', { name: 'README', exact: true })).toHaveCount(0);
  await expect(
    page.locator('.layer-pane.my-contents').getByRole('button', { name: /調査 資料/ }),
  ).toHaveCount(1);
  await expect(
    page.locator('.layer-pane.team-contents').getByRole('button', { name: /調査 資料/ }),
  ).toHaveCount(3);
  // Every pane can be resized by the reader, and the sizes are kept on the device.
  // The window reaches its requested height some time after launch; the checks
  // need the explorer's full height, not the squeezed one.
  await expect.poll(() => page.evaluate(() => innerHeight)).toBeGreaterThan(900);
  const height = async (pane: string) =>
    (await page.locator(`.layer-pane.${pane}`).boundingBox())!.height;
  const width = async (pane: string) =>
    (await page.locator(`.layer-pane.${pane}`).boundingBox())!.width;
  const drag = async (label: string, dx: number, dy: number) => {
    const box = (await page.getByRole('separator', { name: label }).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
    await page.mouse.up();
  };
  // Moves stay small so that no row reaches its minimum and folds.
  const [schemaBefore, knowledgeBefore] = [await height('schema'), await height('my-kb')];
  await drag('Schema とナレッジの境界', 0, 30);
  await expect.poll(() => height('schema')).toBeGreaterThan(schemaBefore + 20);
  expect(await height('my-kb')).toBeLessThan(knowledgeBefore - 20);
  const [knowledgeMiddle, contentsBefore] = [await height('my-kb'), await height('my-contents')];
  await drag('ナレッジと資料の境界', 0, 15);
  await expect.poll(() => height('my-kb')).toBeGreaterThan(knowledgeMiddle + 8);
  expect(await height('my-contents')).toBeLessThan(contentsBefore - 8);
  const personalWidth = await width('my-kb');
  await drag('個人とチームのナレッジの境界', 50, 0);
  await expect.poll(() => width('my-kb')).toBeGreaterThan(personalWidth + 30);
  // The materials row keeps its own split.
  expect(Math.abs((await width('my-contents')) - personalWidth)).toBeLessThan(2);
  // Folding both halves of a row gives its space to the other rows.
  const others = async () => (await height('schema')) + (await height('my-contents'));
  const [knowledgeOpen, othersOpen] = [await height('my-kb'), await others()];
  await page.getByRole('button', { name: '個人のナレッジ', exact: false }).click();
  await page.getByRole('button', { name: 'チームのナレッジ', exact: false }).click();
  await expect.poll(() => height('my-kb')).toBeLessThan(40);
  expect(await others()).toBeGreaterThan(othersOpen + knowledgeOpen - 45);
  await page.getByRole('button', { name: '個人のナレッジ', exact: false }).click();
  await expect.poll(() => height('my-kb')).toBeGreaterThan(knowledgeOpen - 2);
  await expect(page.locator('.layer-pane.team-kb .layer-body')).toHaveCount(0);
  await page.getByRole('button', { name: 'チームのナレッジ', exact: false }).click();
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
    .toMatch(
      /irori-explorer-rows.*irori-explorer-knowledge|irori-explorer-knowledge.*irori-explorer-rows/,
    );
  await page.screenshot({ path: 'test-results/irori-resized-explorer.png' });
  const personalSchema = schema.locator(`[data-scope-id="${spaces[0].scopeId}"]`);
  await personalSchema.getByRole('button', { name: 'schema', exact: true }).click();
  await expect(personalSchema.getByRole('button', { name: 'policy', exact: true })).toBeVisible();
  await expect(personalSchema.getByRole('button', { name: /raw|調査 資料/ })).toHaveCount(0);
  await personalSchema.getByRole('button', { name: 'AGENTS', exact: true }).click();
  await expect(page.locator('.document-editor')).toContainText('個人KB rules');
  const engineering = team.locator(`[data-scope-id="${spaces[1].scopeId}"]`);
  const research = team.locator(`[data-scope-id="${spaces[2].scopeId}"]`);
  await engineering.getByRole('button', { name: 'README', exact: true }).click();
  await expect(page.locator('.document-editor')).toContainText('Engineering notes');
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\nEngineering edit\n');
  await research.getByRole('button', { name: 'README', exact: true }).click();
  await expect(research.locator('[aria-current="page"]')).toContainText('README');
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  expect(await readFile(path.join(spaces[1].root, 'README.md'), 'utf8')).toContain(
    'Engineering edit',
  );
  expect(await readFile(path.join(spaces[2].root, 'README.md'), 'utf8')).toBe('# Research notes\n');
  await research.getByRole('button', { name: 'README', exact: true }).click();
  await expect(page.locator('.document-editor')).toContainText('Research notes');
  await page.getByRole('button', { name: 'AIに相談', exact: true }).click();
  await expect(page.getByLabel('相談の対象')).toContainText('Research');
  await page.getByRole('button', { name: 'このノートの要点をまとめて', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'エージェントへの指示' })).toHaveValue(
    'このノートの要点をまとめて',
  );
  await expect(page.getByRole('textbox', { name: 'エージェントへの指示' })).toBeFocused();
  await expect(page.locator('.message.user')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/irori-layered-explorer.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 800));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(1024);
  const panelBounds = await page.locator('.agent-panel').boundingBox();
  expect(panelBounds!.x).toBeGreaterThanOrEqual(0);
  expect(panelBounds!.x + panelBounds!.width).toBeLessThanOrEqual(
    await page.evaluate(() => innerWidth),
  );
  await page
    .locator('.agent-heading')
    .getByRole('button', { name: 'AIパネルを閉じる', exact: true })
    .click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
  await page.getByRole('button', { name: '個人KB のクラウド接続', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'クラウド接続' })).toContainText(
    '個人KB のクラウド接続',
  );
  await expect(page.locator('.connection-card')).toContainText('schema/raw/調査 資料/');
  await page.getByRole('dialog').getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: '個人の資料', exact: false }).click();
  await expect(page.locator('.layer-pane.my-contents .layer-body')).toHaveCount(0);
  await page.getByRole('button', { name: '個人の資料', exact: false }).click();
  await expect(page.locator('.layer-pane.my-contents .layer-body')).toBeVisible();
  expect(errors).toEqual([]);
  await writeFile(
    'test-results/layers-ui-smoke.json',
    JSON.stringify(
      {
        checks: [
          'five panes and personal/team/organization grouping',
          'rows and personal/team splits resize and are kept on the device',
          'folding a whole row gives its height to the others',
          'per-repository schema isolation',
          'nested contents excluded from schema',
          'unconfigured aliases visible without a mount',
          'same-name note ownership and dirty-switch protection',
          'agent context follows selected repository',
          'prompt suggestions fill and focus the composer without starting a run',
          'cloud action targets its owning scope',
          'pane collapse and expansion',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log('Layered explorer UI checks passed; no native model or cloud calls.');
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
