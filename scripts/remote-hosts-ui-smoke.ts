import { _electron as electron, expect, type Page } from '@playwright/test';
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { SettingsService } from '../src/host/settings';
import { WorkspaceService } from '../src/host/workspaces';
import { chooseJapanese } from '../tests/fixtures/japanese-interface';

// A vault on an SSH host (ADR 061), through the real stack with no network and no
// real SSH: a stand-in `ssh` runs the command irori gives it as another home on this
// machine, where irori installs its vault host with the Node of this checkout. The
// window adds the host in the settings, connects, makes a folder there a vault, shows
// it read-only beside a vault of this computer, and takes it off the list again.
// Run `npm run build` first: the built `dist-host/vault-host.cjs` is what is installed.
const base = await mkdtemp(path.join(tmpdir(), 'irori remote hosts UI '));
const remoteHome = path.join(base, 'remote home');
const notes = path.join(remoteHome, 'notes');
await mkdir(path.join(notes, 'Knowledge_Base'), { recursive: true });
await writeFile(
  path.join(notes, 'Knowledge_Base', 'welcome.md'),
  '# Welcome\n\nThis note lives on the SSH host.\n',
);
const bin = path.join(base, 'bin');
await mkdir(bin);
// irori runs `ssh [options] -- <destination> <command>`, where the command is one
// POSIX `sh -c '…'` string. A destination named `broken` fails as ssh does, and so
// does every one while the file `down` exists.
const down = path.join(base, 'down');
await writeFile(
  path.join(bin, 'ssh'),
  [
    '#!/bin/sh',
    'if [ -e "$IRORI_FAKE_SSH_DOWN" ]; then',
    '  echo "ssh: connect to host lab port 22: Connection refused" >&2',
    '  exit 255',
    'fi',
    'for arg; do',
    '  if [ "$arg" = broken ]; then',
    '    echo "ssh: Could not resolve hostname broken: Name or service not known" >&2',
    '    exit 255',
    '  fi',
    'done',
    'for last; do :; done',
    'HOME="$IRORI_FAKE_SSH_HOME" exec sh -c "$last"',
    '',
  ].join('\n'),
);
await chmod(path.join(bin, 'ssh'), 0o755);

const files = new FileService(path.join(base, 'device'));
await files.init();
const local = path.join(base, 'Home');
await mkdir(path.join(local, 'Knowledge_Base'), { recursive: true });
await writeFile(path.join(local, 'Knowledge_Base', 'here.md'), '# Here\n');
const home = await files.register(local, 'Home', 'personal');
await new WorkspaceService(files).save('Lab', [home.scopeId]);
// The vault agent's column is where its agent would be asked.
await new SettingsService(files.dataDir).save({ vaultAgent: true });
await chooseJapanese(files.dataDir);
const env = {
  ...process.env,
  HOME: path.join(base, 'home'),
  PATH: `${bin}${path.delimiter}${process.env.PATH}`,
  IRORI_DATA_DIR: files.dataDir,
  IRORI_FAKE_SSH_HOME: remoteHome,
  IRORI_FAKE_SSH_DOWN: down,
  IRORI_VAULT_HOST_NODE: path.resolve('node_modules/node/bin/node'),
  IRORI_VAULT_HOST_IDLE_MS: '2000',
} as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
await mkdir(env.HOME, { recursive: true });
await mkdir('test-results', { recursive: true });
const errors: string[] = [];
const launch = () =>
  electron.launch({
    args: [...(process.getuid?.() === 0 ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '.'],
    env,
  });
const rail = (page: Page) => page.getByRole('navigation', { name: 'vault' });
const tile = (page: Page, name: string) =>
  rail(page).getByRole('button', { name: new RegExp(`^${name}・AI`) });
// A red banner on the stage or over the window.
const banner = (page: Page) => page.locator('.error[role="alert"]');
async function openLab(page: Page) {
  page.on('pageerror', (error) => errors.push(String(error)));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
  await page.locator('.workspace-card').filter({ hasText: 'Lab' }).click();
  await expect(tile(page, 'Home')).toBeVisible();
}

let app = await launch();
try {
  const page = await app.firstWindow();
  await openLab(page);

  // The settings part: a host added, connected, and a folder there made a vault.
  await page.getByRole('button', { name: /^設定（/ }).click();
  const settings = page.getByRole('dialog', { name: '設定' });
  await settings.getByRole('button', { name: 'SSH ホスト' }).click();
  await expect(settings.getByText('~/.irori-host').first()).toBeVisible();
  await settings.getByRole('button', { name: 'SSH ホストを追加' }).click();
  // The destination is checked before anything is saved.
  await settings.getByRole('textbox', { name: 'SSH ホストの名前' }).fill('Lab server');
  await settings.getByRole('textbox', { name: 'SSH の接続先' }).fill('-oProxyCommand=x');
  await settings.getByRole('button', { name: '追加', exact: true }).click();
  await expect(settings.getByRole('alert')).toContainText('user@host');
  await settings.getByRole('textbox', { name: 'SSH の接続先' }).fill('lab');
  await settings.getByRole('button', { name: '追加', exact: true }).click();
  const server = settings.getByRole('region', { name: 'Lab server' });
  await expect(server).toContainText('未接続');
  await server.getByRole('button', { name: '接続', exact: true }).click();
  // The first connection installs the vault host, with the progress on show.
  await expect(server).toContainText('接続済み', { timeout: 120_000 });
  await expect(server).toContainText('linux');

  // A host that cannot be reached says why.
  await settings.getByRole('button', { name: 'SSH ホストを追加' }).click();
  await settings.getByRole('textbox', { name: 'SSH ホストの名前' }).fill('Broken');
  await settings.getByRole('textbox', { name: 'SSH の接続先' }).fill('broken');
  await settings.getByRole('button', { name: '追加', exact: true }).click();
  const broken = settings.getByRole('region', { name: 'Broken' });
  await broken.getByRole('button', { name: '接続', exact: true }).click();
  await expect(broken.locator('.remote-state.error')).toBeVisible({ timeout: 30_000 });
  await broken.getByRole('button', { name: 'Broken を削除' }).click();
  await expect(broken).toHaveCount(0);

  await server.getByRole('button', { name: 'Lab server に vault を追加' }).click();
  const chooser = page.getByRole('dialog', { name: 'Lab server のフォルダを vault にする' });
  await expect(chooser.getByRole('textbox', { name: 'ホストのフォルダのパス' })).toHaveValue(
    remoteHome,
  );
  await chooser.getByRole('listitem').filter({ hasText: 'notes' }).click();
  await expect(chooser.getByRole('textbox', { name: 'ホストのフォルダのパス' })).toHaveValue(notes);
  await expect(chooser).toContainText('.irori/scope.json');
  await chooser.getByRole('textbox', { name: 'スペース名' }).fill('Remote notes');
  await page.screenshot({ path: 'test-results/remote-hosts-folder.png' });
  await chooser.getByRole('button', { name: 'vault にする' }).click();
  await expect(chooser).toHaveCount(0);
  await expect(server.getByRole('list', { name: 'Lab server の vault' })).toContainText(
    'Remote notes',
  );
  // A host whose vaults are still listed is not removed.
  await server.getByRole('button', { name: 'Lab server を削除' }).click();
  await expect(server.getByRole('alert')).toContainText('一覧から外してから');
  await page.screenshot({ path: 'test-results/remote-hosts-settings.png' });
  await settings.getByRole('button', { name: '閉じる', exact: true }).click();

  // The vault joined the workspace and is on show, its host named where it is.
  await expect(tile(page, 'Remote notes')).toBeVisible();
  const panel = page.locator('.brain-panel').first();
  await expect(panel).toHaveAttribute('aria-label', 'Remote notes');
  await expect(panel.locator('.brain-header')).toContainText('Lab server');
  const knowledge = panel.getByRole('region', { name: 'Knowledge', exact: true });
  const welcome = knowledge.getByRole('button', { name: 'welcome', exact: true });
  await expect(welcome).toBeVisible();
  // The explorer offers nothing that edits.
  await expect(panel.getByRole('button', { name: 'Remote notes にノートを作成' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '新しいフォルダ' })).toHaveCount(0);
  await welcome.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '開く', exact: true })).toBeVisible();
  for (const name of ['名前を変更', '移動', '削除', '新しいノート', 'コピー', '切り取り'])
    await expect(page.getByRole('menuitem', { name, exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Its note opens read-only, with its text from the host.
  await welcome.click();
  await expect(page.locator('.ProseMirror')).toContainText('This note lives on the SSH host.');
  await expect(page.locator('.stage-bar')).toContainText('読み取り専用');

  // Its own agent column offers no instruction box: the irori agent hands it work.
  await page.getByRole('button', { name: 'vault agent', exact: true }).click();
  const column = page.getByRole('complementary', { name: 'Remote notes agent' });
  await expect(column).toContainText('irori モードで irori agent に依頼してください');
  await expect(column.locator('.composer')).toBeHidden();
  await page.screenshot({ path: 'test-results/remote-hosts-vault.png' });
  await expect(banner(page)).toHaveCount(0);
} catch (error) {
  await (await app.firstWindow()).screenshot({ path: 'test-results/remote-hosts-failure.png' });
  throw error;
} finally {
  await app.close();
}

// Opened again while its host cannot be reached, the workspace shows the vault with
// no banner: its panel says so and connects once the host answers. Then the vault
// leaves the list.
await writeFile(down, '');
app = await launch();
try {
  const page = await app.firstWindow();
  await openLab(page);
  await tile(page, 'Remote notes').click();
  const panel = page.locator('.brain-panel').first();
  await expect(panel).toHaveAttribute('aria-label', 'Remote notes');
  const offline = panel.locator('.remote-vault-state');
  await expect(offline).toContainText('接続していません', { timeout: 30_000 });
  await expect(offline).toContainText('Connection refused');
  await page.screenshot({ path: 'test-results/remote-hosts-offline.png' });
  await expect(banner(page)).toHaveCount(0);
  await rm(down);
  await offline.getByRole('button', { name: '接続', exact: true }).click();
  await expect(
    panel
      .getByRole('region', { name: 'Knowledge', exact: true })
      .getByRole('button', { name: 'welcome', exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(offline).toHaveCount(0);
  await expect(banner(page)).toHaveCount(0);

  // Where vaults are added, an SSH host is a source beside a folder, a clone and a new one.
  await rail(page).getByRole('button', { name: 'vault を追加' }).click();
  const register = page.getByRole('dialog', { name: 'スペース登録' });
  await register.getByRole('button', { name: 'SSH ホスト', exact: true }).click();
  await register.getByRole('button', { name: /^Lab server/ }).click();
  const again = page.getByRole('dialog', { name: 'Lab server のフォルダを vault にする' });
  await expect(again.getByRole('listitem').filter({ hasText: 'notes' })).toContainText('vault');
  await again.getByRole('button', { name: 'キャンセル' }).click();
  await page
    .getByRole('dialog', { name: 'スペース登録' })
    .getByRole('button', { name: 'キャンセル' })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await panel.getByRole('button', { name: 'vault のメニュー' }).click();
  await page.getByRole('menuitem', { name: '一覧から外す' }).click();
  const leave = page.getByRole('dialog', { name: 'Remote notes を一覧から外す' });
  await expect(leave).toContainText('そのまま残ります');
  await leave.getByRole('button', { name: '一覧から外す' }).click();
  await expect(tile(page, 'Remote notes')).toHaveCount(0);
  await expect(page.locator('.brain-panel').first()).toHaveAttribute('aria-label', 'Home');
  await expect(banner(page)).toHaveCount(0);
} catch (error) {
  await (await app.firstWindow()).screenshot({ path: 'test-results/remote-hosts-failure.png' });
  throw error;
} finally {
  await app.close();
}

// The folder on the host and its note are untouched; the vault's declaration stays there.
expect(await readFile(path.join(notes, 'Knowledge_Base', 'welcome.md'), 'utf8')).toContain(
  'This note lives on the SSH host.',
);
await stat(path.join(notes, '.irori', 'scope.json'));
const workspaces = JSON.parse(await readFile(path.join(files.dataDir, 'workspaces.json'), 'utf8'));
expect(workspaces[0].scopeIds).toEqual([home.scopeId]);

// The vault host ends on its own once idle; one still running is stopped here.
const pid = Number(
  await readFile(path.join(remoteHome, '.irori-host', 'data', 'host.pid'), 'utf8').catch(() => ''),
);
if (pid)
  try {
    process.kill(pid);
  } catch {
    // Already gone.
  }
await rm(base, { recursive: true, force: true });
expect(errors).toEqual([]);
console.log(
  'Remote hosts UI passed: host added and connected, folder made a vault, shown read-only, taken off the list.',
);
