import { _electron as electron, expect, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';

// ADR 021: the hibachi agent and the Schema layer are optional, and the agent dock
// shows conversations side by side beside the page, or without it.
const base = await mkdtemp(path.join(tmpdir(), 'irori dock UI '));
const root = path.join(base, 'Research');
await mkdir(path.join(root, 'Knowledge_Base'), { recursive: true });
await writeFile(path.join(root, 'Knowledge_Base', 'welcome.md'), '# Welcome\n\nPlain notes.\n');
await writeFile(path.join(root, 'AGENTS.md'), '# Research\n');
const files = new FileService(path.join(base, 'device'));
await files.init();
const space = await files.register(root, 'Research', 'personal');
await new WorkspaceService(files).save('Lab', [space.scopeId]);
const env = { ...process.env, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const errors: string[] = [];
const launch = () =>
  electron.launch({
    args: [
      ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      '.',
    ],
    env,
  });
const width = (page: Page, selector: string) =>
  page.locator(selector).evaluate((element) => element.getBoundingClientRect().width);

async function setHibachiAgent(page: Page, on: boolean) {
  await page.getByRole('button', { name: /^設定（/ }).click();
  const box = page.getByRole('checkbox', { name: 'hibachi agent', exact: true });
  if (on) await box.check();
  else await box.uncheck();
  await page.keyboard.press('Escape');
}

let app = await launch();
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.locator('.workspace-card').filter({ hasText: 'Lab' }).click();

  // Off by default: an editor of Knowledge and Contents, with the irori agent.
  const brain = page.locator('.brain-panel');
  await expect(brain.getByRole('region', { name: 'Knowledge', exact: true })).toBeVisible();
  await expect(brain.getByRole('region', { name: 'Schema', exact: true })).toHaveCount(0);
  await expect(page.locator('.home-card.schema')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'hibachi agent', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'irori agent', exact: true }).click();
  const columns = page.locator('.agent-panel');
  await expect(columns).toHaveCount(1);
  await expect(columns.first()).toHaveAttribute('aria-label', 'irori agent');
  await expect(page.getByRole('button', { name: 'irori agent を用意する' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^表示するエージェント/ })).toHaveCount(0);
  await expect(page.locator('.schema-line')).toHaveCount(0);

  // On: the Schema layer returns and the first column shows the hibachi's agent.
  await setHibachiAgent(page, true);
  await expect(brain.getByRole('region', { name: 'Schema', exact: true })).toBeVisible();
  await expect(columns.first()).toHaveAttribute('aria-label', 'Research の hibachi agent');
  await expect(columns.first().locator('.schema-line')).toContainText('AGENTS.md');

  // A second column widens the dock past the old limit and keeps its own draft.
  const before = await width(page, '.assistant-pane');
  await columns.first().getByRole('button', { name: '列を追加' }).click();
  await expect(columns).toHaveCount(2);
  await expect.poll(() => width(page, '.assistant-pane')).toBeGreaterThan(before + 200);
  await expect(columns.nth(1)).toHaveAttribute('aria-label', 'Research の hibachi agent');
  const first = columns.first().getByRole('textbox', { name: 'エージェントへの指示' });
  const second = columns.nth(1).getByRole('textbox', { name: 'エージェントへの指示' });
  await expect(second).toBeEnabled();
  await second.fill('二列目の下書き');
  await expect(first).toHaveValue('');

  // The column can show the irori agent instead.
  await columns
    .nth(1)
    .getByRole('button', { name: /^表示するエージェント/ })
    .click();
  await page.getByRole('menuitemradio', { name: 'irori agent' }).click();
  await expect(columns.nth(1)).toHaveAttribute('aria-label', 'irori agent');
  await expect(columns.first()).toHaveAttribute('aria-label', 'Research の hibachi agent');

  // The page folds away so only the agents show, and a file brings it back.
  await columns.first().getByRole('button', { name: '本文を隠す' }).click();
  await expect.poll(() => width(page, '.stage-pane')).toBeLessThan(2);
  await expect(columns).toHaveCount(2);
  await columns.first().getByRole('button', { name: '本文を表示' }).click();
  await expect.poll(() => width(page, '.stage-pane')).toBeGreaterThan(300);
  await columns.first().getByRole('button', { name: '本文を隠す' }).click();
  await expect.poll(() => width(page, '.stage-pane')).toBeLessThan(2);
  await brain.getByRole('button', { name: 'welcome', exact: true }).click();
  await expect(page.locator('.document-editor')).toContainText('Plain notes.');
  await expect.poll(() => width(page, '.stage-pane')).toBeGreaterThan(300);

  // Closing a later column keeps the first; the second column's draft stays on the device.
  await columns.nth(1).getByRole('button', { name: 'この列を閉じる' }).click();
  await expect(columns).toHaveCount(1);
  await columns.first().getByRole('button', { name: '列を追加' }).click();
  await expect(columns.nth(1).getByRole('textbox', { name: 'エージェントへの指示' })).toHaveValue(
    '二列目の下書き',
  );

  // Off again: the Schema layer leaves and the dock shows the irori agent alone.
  await setHibachiAgent(page, false);
  await expect(brain.getByRole('region', { name: 'Schema', exact: true })).toHaveCount(0);
  await expect(columns.first()).toHaveAttribute('aria-label', 'irori agent');
  await columns.first().getByRole('button', { name: 'irori agent を閉じる' }).click();
  await expect(columns).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'irori agent', exact: true })).toBeVisible();
  const stored = JSON.parse(
    await readFile(path.join(files.dataDir, 'device-settings.json'), 'utf8'),
  );
  if (stored.hibachiAgent !== false) throw Error('The choice was not kept on the device.');
} finally {
  await app.close();
}

// The choice survives a restart.
await writeFile(
  path.join(files.dataDir, 'device-settings.json'),
  JSON.stringify({
    ...JSON.parse(await readFile(path.join(files.dataDir, 'device-settings.json'), 'utf8')),
    hibachiAgent: true,
  }),
);
app = await launch();
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.locator('.workspace-card').filter({ hasText: 'Lab' }).click();
  await expect(
    page.locator('.brain-panel').getByRole('region', { name: 'Schema', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'hibachi agent', exact: true })).toBeVisible();
} finally {
  await app.close();
}
if (errors.length) throw Error(errors.join('\n'));
console.log('Dock UI smoke passed: optional hibachi agent, columns side by side, page hidden');
