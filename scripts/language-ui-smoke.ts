import { _electron as electron, expect, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';

// Every name the fixture supplies is English, so any Japanese left on screen after
// switching to English is interface text that was not translated.
const base = await mkdtemp(path.join(tmpdir(), 'irori language UI '));
const root = path.join(base, 'Research');
await mkdir(path.join(root, 'Knowledge_Base'), { recursive: true });
await writeFile(path.join(root, 'Knowledge_Base', 'welcome.md'), '# Welcome\n\nPlain notes.\n');
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

/** Japanese interface text on screen: visible text and accessible names. */
async function japaneseLeft(page: Page, where: string) {
  const found = await page.evaluate(() => {
    const japanese = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
    const hits: string[] = [];
    for (const line of document.body.innerText.split('\n'))
      if (japanese.test(line)) hits.push(line.trim());
    for (const element of document.querySelectorAll('[aria-label], [placeholder], [title]'))
      for (const name of ['aria-label', 'placeholder', 'title']) {
        const value = element.getAttribute(name);
        if (value && japanese.test(value)) hits.push(`${name}=${value}`);
      }
    return [...new Set(hits)];
  });
  expect(found, `Japanese interface text left on ${where}`).toEqual([]);
}

async function chooseLanguage(page: Page, name: string, trigger: RegExp) {
  await page.getByRole('button', { name: trigger }).click();
  await page.getByRole('radio', { name, exact: true }).check();
  await page.keyboard.press('Escape');
}

const visited: string[] = [];
let app = await launch();
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await expect(page.getByRole('heading', { name: 'ワークスペースを選択' })).toBeVisible();
  await page.locator('.workspace-card').filter({ hasText: 'Lab' }).click();
  await expect(page.getByRole('button', { name: 'AIに相談', exact: true })).toBeVisible();

  // The switch is immediate: no restart, and the open workspace stays open.
  await chooseLanguage(page, 'English', /^設定（/);
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('en');
  await expect(page.getByRole('button', { name: 'Ask AI', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'welcome', exact: true }).click();
  await expect(page.locator('.document-editor')).toContainText('Plain notes.');
  await japaneseLeft(page, 'the workspace with a note open');
  visited.push('workspace and open note');

  await page.getByRole('button', { name: 'Cloud connection for Research', exact: true }).click();
  const cloud = page.getByRole('dialog', { name: 'Cloud connection' });
  await expect(cloud).toBeVisible();
  await expect(cloud.locator('.connections')).toHaveAttribute('aria-busy', 'false', {
    timeout: 15000,
  });
  await japaneseLeft(page, 'the cloud connection dialog');
  await cloud.getByRole('button', { name: 'Close', exact: true }).click();
  visited.push('cloud connection dialog');

  await page.getByRole('button', { name: /^Search \(/ }).click();
  const search = page.getByRole('dialog', { name: 'Search in KB' });
  await expect(search).toBeVisible();
  await japaneseLeft(page, 'the search dialog');
  await page.keyboard.press('Escape');
  await expect(search).toHaveCount(0);
  visited.push('search dialog');

  await page.getByRole('button', { name: 'Create a note in Research', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await japaneseLeft(page, 'the note creation dialog');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  visited.push('note creation dialog');

  await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
  await expect(page.locator('.agent-panel')).toBeVisible();
  await japaneseLeft(page, 'the AI panel');
  await page.getByRole('button', { name: 'Close AI panel' }).first().click();
  visited.push('AI panel');

  const modes = page.getByRole('group', { name: 'Brain view' });
  await modes.getByRole('button', { name: /^Changes/ }).click();
  await expect(page.locator('.git-sidebar')).toBeVisible();
  await japaneseLeft(page, 'source control');
  await modes.getByRole('button', { name: 'Files', exact: true }).click();
  visited.push('source control');

  await page.getByRole('button', { name: 'Brain menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Brain settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Brain settings' })).toBeVisible();
  await japaneseLeft(page, 'the brain settings sheet');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  visited.push('brain settings sheet');

  // The host speaks the same language: a message it writes arrives in English.
  const hostMessage = await page.evaluate(() =>
    window.irori.openUrl('file:///etc/passwd').then(
      () => '',
      (error) => String(error),
    ),
  );
  expect(hostMessage).toContain('Only http or https links');
  visited.push('host message');
  await page.screenshot({ path: 'test-results/irori-english.png' });
  expect(
    JSON.parse(await readFile(path.join(files.dataDir, 'device-settings.json'), 'utf8')).language,
  ).toBe('en');
} finally {
  await app.close();
}

// The choice is the device's: the next launch starts in English.
app = await launch();
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await expect(page.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('en');
  await japaneseLeft(page, 'the startup screen');
  visited.push('startup screen after restart');
  await page.locator('.workspace-card').filter({ hasText: 'Lab' }).click();
  await chooseLanguage(page, '日本語', /^Settings \(/);
  await expect(page.getByRole('button', { name: 'AIに相談', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('ja');
} finally {
  await app.close();
}
expect(errors).toEqual([]);
await writeFile(
  'test-results/language-ui-smoke.json',
  JSON.stringify({ visitedInEnglish: visited, errors }, null, 2),
);
console.log(
  `Language UI passed: English on ${visited.join(', ')}; restart kept it; back to Japanese.`,
);
