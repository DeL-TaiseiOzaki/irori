import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';
import { SettingsService } from '../src/host/settings';
import { fakeGh, git, remote } from '../tests/fixtures/github';
import { chooseJapanese } from '../tests/fixtures/japanese-interface';

// The environment kept on the GitHub account (ADR 026): one device saves its
// vaults, workspaces, preferences and the irori agent's routines (ADR 043) from
// the start screen's settings, before opening any workspace, and a new device
// restores them from the start screen. A's routine secret goes along sealed with a
// passphrase (ADR 047) and is sealed again with B's key.
// gh is a stand-in answering from a folder.
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

// Device A has the vault, a workspace and a dark theme.
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
await new SettingsService(filesA.dataDir).save({ theme: 'dark', language: 'ja' });
// Both devices have an irori agent folder that is not a repository; A's has a routine.
const routineYaml =
  'name: 受信箱\nsteps:\n  - agent: irori\n    access: default\n    prompt: 受信箱をまとめて\n';
await mkdir(path.join(homeA, 'irori', 'you', 'routines', 'Inbox'), { recursive: true });
await writeFile(path.join(homeA, 'irori', 'you', 'AGENTS.md'), '# irori agent\n');
await writeFile(path.join(homeA, 'irori', 'you', 'routines', 'Inbox', 'routine.yaml'), routineYaml);
// A's shared Schema is a file B lacks (ADR 048).
await mkdir(path.join(homeA, 'irori', 'you', '.irori', 'shared'), { recursive: true });
await writeFile(path.join(homeA, 'irori', 'you', '.irori', 'shared', 'AGENTS.md'), 'Be brief.\n');
await mkdir(path.join(homeB, 'irori', 'you'), { recursive: true });
// The reversible store stands in for the OS key on a display without a keychain.
const token = 'xoxb-account-smoke-0123456789';
const sealedHere = (value: string) => Buffer.from(`test:${value}`, 'utf8').toString('base64');
await writeFile(
  path.join(filesA.dataDir, 'secrets.json'),
  JSON.stringify({ schemaVersion: 1, values: { SLACK_TOKEN: sealedHere(token) } }),
);
const passphrase = 'account smoke passphrase';
await writeFile(path.join(homeB, 'irori', 'you', 'AGENTS.md'), '# irori agent\n');

const launch = (data: string, home: string) => {
  const env = {
    ...process.env,
    IRORI_DATA_DIR: data,
    HOME: home,
    GIT_CONFIG_GLOBAL: globalConfig,
    PATH: [bin, process.env.PATH].filter(Boolean).join(path.delimiter),
    IRORI_TEST_KEYSTORE: 'reversible',
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
  await page.getByRole('button', { name: /^設定/ }).click();
  const account = page.getByRole('region', { name: 'アカウント' });
  // The start screen's settings leave out what needs a workspace or is already there.
  await expect(page.locator('.settings-popover')).not.toContainText('Schema');
  await expect(page.getByRole('region', { name: '更新' })).toHaveCount(0);
  await expect(account).toContainText('GitHub: octo');
  await expect(account).toContainText('環境は保存されていません');
  await expect(account.getByRole('button', { name: '復元' })).toHaveCount(0);
  const phrase = account.getByLabel('シークレット 1 件も保存する合言葉');
  await phrase.fill('short');
  await expect(account.getByRole('button', { name: '環境を保存' })).toBeDisabled();
  await phrase.fill(passphrase);
  await account.getByRole('button', { name: '環境を保存' }).click();
  await expect(account.getByRole('status')).toHaveText('保存しました。');
  await expect(phrase).toHaveValue('');
  await expect(account).toContainText('環境を保存：');
  await page.screenshot({ path: 'test-results/irori-account-settings.png' });
  await page.keyboard.press('Escape');
  await page.locator('.workspace-card').filter({ hasText: 'Lab' }).click();
  await page.getByRole('button', { name: /^設定/ }).click();
  await expect(account).toContainText('環境を保存：');
  await expect(page.locator('.settings-popover')).toContainText('Schema');
  const saved = JSON.parse(await fake.stored());
  if (saved.vaults[0]?.repository !== 'octo/kb' || saved.preferences.theme !== 'dark')
    throw Error(`Unexpected saved environment: ${JSON.stringify(saved)}`);
  if (JSON.stringify(saved).includes(base)) throw Error('A device path reached GitHub');
  const routines = JSON.parse(await fake.stored('routines.json'));
  if (routines.routines[0]?.files[0]?.text !== routineYaml)
    throw Error(`Unexpected saved routines: ${JSON.stringify(routines)}`);
  const agentFiles = JSON.parse(await fake.stored('irori-agent.json'));
  if (
    agentFiles.files.map((file: { path: string }) => file.path).join() !==
    '.irori/shared/AGENTS.md,AGENTS.md'
  )
    throw Error(`Unexpected saved irori agent files: ${JSON.stringify(agentFiles)}`);
  const keys = await fake.stored('routine-keys.json');
  if (JSON.parse(keys).names?.join() !== 'SLACK_TOKEN')
    throw Error(`Unexpected saved secrets: ${keys}`);
  if ([token, sealedHere(token), passphrase].some((value) => keys.includes(value)))
    throw Error('A secret value or the passphrase reached GitHub');
  await app.close();

  // Device B starts empty and restores from the start screen, read in Japanese like device A.
  await chooseJapanese(path.join(base, 'device-b'));
  app = await launch(path.join(base, 'device-b'), homeB);
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await expect(page.locator('.workspace-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'GitHub から環境を復元' }).click();
  const sheet = page.getByRole('dialog', { name: '環境を復元' });
  await expect(sheet.getByRole('checkbox', { name: /Research/ })).toBeChecked();
  await expect(sheet).toContainText('octo/kb');
  await expect(sheet).toContainText('ワークスペース: Lab');
  await expect(sheet.getByRole('checkbox', { name: /受信箱/ })).toBeChecked();
  // B's AGENTS.md is the same; only the shared Schema is missing.
  await expect(sheet.getByRole('checkbox', { name: /irori agent のファイル/ })).toBeChecked();
  await expect(sheet.locator('label').filter({ hasText: 'irori agent のファイル' })).toContainText(
    '1 件',
  );
  await expect(sheet.getByRole('checkbox', { name: /SLACK_TOKEN/ })).toBeChecked();
  const restoreButton = sheet.getByRole('button', { name: '復元', exact: true });
  await expect(restoreButton).toBeDisabled();
  // A wrong passphrase stops the restore before anything is cloned.
  await sheet.getByLabel('合言葉').fill('not the passphrase');
  await restoreButton.click();
  await expect(sheet).toContainText('合言葉が違うため、シークレットを開けません。');
  await sheet.getByLabel('合言葉').fill(passphrase);
  await expect(sheet.locator('.restore-parent code')).toHaveText(path.join(homeB, 'irori'));
  await page.screenshot({ path: 'test-results/irori-account-restore.png' });
  await restoreButton.click();
  await expect(sheet.getByRole('status')).toHaveText(
    'vault 1 件・ワークスペース 1 件・irori agent のファイル 1 件・ルーティン 1 件・シークレット 1 件を取り込みました。',
  );
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await sheet.getByRole('button', { name: '閉じる' }).click();
  await expect(sheet).toHaveCount(0);
  const card = page.locator('.workspace-card').filter({ hasText: 'Lab' });
  await expect(card).toContainText('Research');
  const cloned = await readFile(path.join(homeB, 'irori', 'kb', 'knowledge', 'note.md'), 'utf8');
  if (cloned !== '# Note\n') throw Error('The vault was not cloned');
  const added = await readFile(
    path.join(homeB, 'irori', 'you', 'routines', 'Inbox', 'routine.yaml'),
    'utf8',
  );
  if (added !== routineYaml) throw Error('The routine was not added');
  const sharedB = await readFile(
    path.join(homeB, 'irori', 'you', '.irori', 'shared', 'AGENTS.md'),
    'utf8',
  );
  if (sharedB !== 'Be brief.\n') throw Error('The shared Schema was not restored');
  const keptB = JSON.parse(await readFile(path.join(base, 'device-b', 'secrets.json'), 'utf8'));
  if (keptB.values.SLACK_TOKEN !== sealedHere(token))
    throw Error('The secret was not sealed on device B');
  await card.click();
  await expect(page.getByRole('navigation', { name: 'vault' })).toContainText('Research');
  if (errors.length) throw Error(errors.join('\n'));
  console.log('Account UI smoke passed');
} finally {
  await app.close().catch(() => {});
  await rm(base, { recursive: true, force: true });
}
