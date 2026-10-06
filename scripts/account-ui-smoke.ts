import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';
import { SettingsService } from '../src/host/settings';
import { fakeGh, git, remote } from '../tests/fixtures/github';

// The environment kept on the GitHub account (ADR 026): one device saves its
// hibachis, workspaces and preferences from the settings, and a new device
// restores them from the start screen. gh is a stand-in answering from a folder.
const base = await mkdtemp(path.join(tmpdir(), 'irori account UI '));
const scope = {
  schemaVersion: 1,
  scopeId: '2d4c6e8a-1b3d-4f5a-9c7e-0a1b2c3d4e5f',
  name: 'Research',
  category: 'personal',
  contents: ['contents'],
};
const kb = await remote(base, 'kb', {
  '.irori/scope.json': JSON.stringify(scope, null, 2) + '\n',
  '.gitignore': '/contents/\n',
  'knowledge/note.md': '# Note\n',
});
const globalConfig = path.join(base, 'gitconfig');
await writeFile(
  globalConfig,
  `[user]\n\tname = Git fixture\n\temail = fixture@example.invalid\n[commit]\n\tgpgsign = false\n` +
    `[url "${kb.bare}"]\n\tinsteadOf = ${kb.url}\n`,
);
const fake = await fakeGh(base);
const bin = path.dirname(fake.gh);

// Device A has the hibachi, a workspace and a dark theme.
const homeA = path.join(base, 'home-a'),
  homeB = path.join(base, 'home-b');
const checkout = path.join(homeA, 'irori', 'kb');
await mkdir(path.dirname(checkout), { recursive: true });
await mkdir(homeB, { recursive: true });
process.env.GIT_CONFIG_GLOBAL = globalConfig;
git(base, 'clone', '--quiet', kb.url, checkout);
const filesA = new FileService(path.join(base, 'device-a'));
await filesA.init();
const research = await filesA.register(checkout, 'Research', 'personal');
await new WorkspaceService(filesA).save('Lab', [research.scopeId]);
await new SettingsService(filesA.dataDir).save({ theme: 'dark' });

const launch = (data: string, home: string) => {
  const env = {
    ...process.env,
    IRORI_DATA_DIR: data,
    HOME: home,
    GIT_CONFIG_GLOBAL: globalConfig,
    PATH: [bin, process.env.PATH].filter(Boolean).join(path.delimiter),
  } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  return electron.launch({
    args: [
      ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      '.',
    ],
    env,
  });
};
const errors: string[] = [];
await mkdir('test-results', { recursive: true });
let app = await launch(filesA.dataDir, homeA);
try {
  let page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.locator('.workspace-card').filter({ hasText: 'Lab' }).click();
  await page.getByRole('button', { name: /^設定/ }).click();
  const account = page.getByRole('region', { name: 'アカウント' });
  await expect(account).toContainText('GitHub: octo');
  await expect(account).toContainText('環境は保存されていません');
  await expect(account.getByRole('button', { name: '復元' })).toHaveCount(0);
  await account.getByRole('button', { name: '環境を保存' }).click();
  await expect(account.getByRole('status')).toHaveText('保存しました。');
  await expect(account).toContainText('環境を保存：');
  await page.screenshot({ path: 'test-results/irori-account-settings.png' });
  const saved = JSON.parse(await fake.stored());
  if (saved.hibachis[0]?.repository !== 'octo/kb' || saved.preferences.theme !== 'dark')
    throw Error(`Unexpected saved environment: ${JSON.stringify(saved)}`);
  if (JSON.stringify(saved).includes(base)) throw Error('A device path reached GitHub');
  await app.close();

  // Device B starts empty and restores from the start screen.
  app = await launch(path.join(base, 'device-b'), homeB);
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await expect(page.locator('.workspace-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'GitHub から環境を復元' }).click();
  const sheet = page.getByRole('dialog', { name: '環境を復元' });
  await expect(sheet.getByRole('checkbox', { name: /Research/ })).toBeChecked();
  await expect(sheet).toContainText('octo/kb');
  await expect(sheet).toContainText('ワークスペース: Lab');
  await expect(sheet.locator('.restore-parent code')).toHaveText(path.join(homeB, 'irori'));
  await page.screenshot({ path: 'test-results/irori-account-restore.png' });
  await sheet.getByRole('button', { name: '復元', exact: true }).click();
  await expect(sheet.getByRole('status')).toHaveText(
    'hibachi 1 件とワークスペース 1 件を取り込みました。',
  );
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await sheet.getByRole('button', { name: '閉じる' }).click();
  await expect(sheet).toHaveCount(0);
  const card = page.locator('.workspace-card').filter({ hasText: 'Lab' });
  await expect(card).toContainText('Research');
  const cloned = await readFile(path.join(homeB, 'irori', 'kb', 'knowledge', 'note.md'), 'utf8');
  if (cloned !== '# Note\n') throw Error('The hibachi was not cloned');
  await card.click();
  await expect(page.getByRole('navigation', { name: 'hibachi' })).toContainText('Research');
  if (errors.length) throw Error(errors.join('\n'));
  console.log('Account UI smoke passed');
} finally {
  await app.close().catch(() => {});
  await rm(base, { recursive: true, force: true });
}
