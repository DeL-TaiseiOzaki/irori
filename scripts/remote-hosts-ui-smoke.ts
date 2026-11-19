import { _electron as electron, expect, type Page } from '@playwright/test';
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
// does every one while the file `down` exists. One named `asks` wants a password and a
// verification code, asked as ssh asks them: through the program SSH_ASKPASS names, the
// question as its argument and the answer on its output, three tries at the password.
// Told to ask nothing (BatchMode), or with no such program, it is refused at once.
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
    'asks=; batch=',
    'for arg; do',
    '  [ "$arg" = asks ] && asks=1',
    '  [ "$arg" = BatchMode=yes ] && batch=1',
    'done',
    'if [ -n "$asks" ]; then',
    '  denied() { echo "you@asks: Permission denied (publickey,keyboard-interactive)." >&2; exit 255; }',
    '  [ -z "$batch" ] && [ -n "$SSH_ASKPASS" ] || denied',
    '  ok=; for try in 1 2 3; do',
    '    [ "$("$SSH_ASKPASS" "(you@asks) Password: ")" = "open sesame" ] && { ok=1; break; }',
    '  done',
    '  [ -n "$ok" ] || denied',
    '  [ "$("$SSH_ASKPASS" "(you@asks) Verification code: ")" = 123456 ] || denied',
    'fi',
    'HOME="$IRORI_FAKE_SSH_HOME" exec sh -c "$last"',
    '',
  ].join('\n'),
);
await chmod(path.join(bin, 'ssh'), 0o755);
// The vault agent's CLI on the host: the `pi` protocol fixture, on the PATH its vault host inherits.
await writeFile(
  path.join(bin, 'pi'),
  `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/harnesses.mjs')).href)}).then(m=>m.run('pi'));\n`,
  { mode: 0o700 },
);

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
// The person's own ssh configuration: a host by name, sixty more in an included file, and
// patterns, which are no hosts but say where the hosts they match are.
await mkdir(path.join(env.HOME, '.ssh'), { recursive: true });
await writeFile(
  path.join(env.HOME, '.ssh', 'config'),
  [
    'Include cluster',
    'Host lab-gpu',
    '  HostName gpu.lab.example.com',
    '  User taro',
    '  Port 2222',
    'Host node*',
    '  HostName %h.cluster.example.com',
    'Host *.internal !bastion.internal',
    '  User ops',
    '',
  ].join('\n'),
);
await writeFile(
  path.join(env.HOME, '.ssh', 'cluster'),
  Array.from({ length: 60 }, (_, at) => `Host node${String(at + 1).padStart(2, '0')}\n`).join(''),
);
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
  // The hosts of ~/.ssh/config and of the file it includes are offered by name, with what
  // ssh would obtain for each; a pattern is not a host. A long list shows its first rows
  // and is filtered by typing.
  const offered = settings.getByRole('region', { name: 'ssh の設定にあるホスト' });
  const filter = offered.getByRole('searchbox', { name: 'ssh の設定のホストを絞り込む' });
  await expect(offered.getByRole('button')).toHaveCount(50);
  await expect(offered).toContainText('ほかに 11 件あります');
  await filter.fill('GPU');
  await expect(offered.getByRole('button')).toHaveCount(1);
  await expect(offered.getByRole('button', { name: /^lab-gpu/ })).toContainText(
    'taro@gpu.lab.example.com:2222',
  );
  await filter.fill('node6');
  await expect(offered.getByRole('button')).toHaveCount(1);
  await expect(offered.getByRole('button', { name: /^node60/ })).toContainText(
    'node60.cluster.example.com',
  );
  await filter.fill('no such host');
  await expect(offered.getByRole('button')).toHaveCount(0);
  await expect(offered).toContainText('一致するホストがありません');
  await filter.fill('');
  await offered.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/remote-hosts-config.png' });
  await settings.getByRole('button', { name: '接続先を入力して追加' }).click();
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
  await settings.getByRole('button', { name: '接続先を入力して追加' }).click();
  await settings.getByRole('textbox', { name: 'SSH ホストの名前' }).fill('Broken');
  await settings.getByRole('textbox', { name: 'SSH の接続先' }).fill('broken');
  await settings.getByRole('button', { name: '追加', exact: true }).click();
  const broken = settings.getByRole('region', { name: 'Broken' });
  await broken.getByRole('button', { name: '接続', exact: true }).click();
  await expect(broken.locator('.remote-state.error')).toBeVisible({ timeout: 30_000 });
  await broken.getByRole('button', { name: 'Broken を削除' }).click();
  await expect(broken).toHaveCount(0);

  // A host that asks for a password and a verification code: ssh's own words are asked
  // in the window, a wrong answer is asked again with a word about it, and the connection
  // opens once both are given. What is typed is unseen until the person asks to see it.
  await settings.getByRole('button', { name: '接続先を入力して追加' }).click();
  await settings.getByRole('textbox', { name: 'SSH ホストの名前' }).fill('Asks');
  await settings.getByRole('textbox', { name: 'SSH の接続先' }).fill('asks');
  await settings.getByRole('button', { name: '追加', exact: true }).click();
  const asks = settings.getByRole('region', { name: 'Asks' });
  await asks.getByRole('button', { name: '接続', exact: true }).click();
  const question = page.getByRole('dialog', { name: 'Asks に接続' });
  const words = question.locator('.ssh-question-text');
  const typed = question.getByRole('textbox', { name: 'ssh への答え' });
  await expect(words).toHaveText('(you@asks) Password:');
  await expect(typed).toHaveAttribute('type', 'password');
  await expect(typed).toBeFocused();
  await expect(asks).toContainText('入力を待っています');
  await typed.fill('not this');
  await question.getByRole('checkbox', { name: '入力を表示' }).check();
  await expect(typed).toHaveAttribute('type', 'text');
  await question.getByRole('button', { name: '送信' }).click();
  await expect(question).toContainText('前の入力は受け付けられませんでした');
  await expect(typed).toHaveValue('');
  await expect(typed).toHaveAttribute('type', 'password');
  await typed.fill('open sesame');
  // The dialog has risen into place by now.
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/remote-hosts-question.png' });
  await typed.press('Enter');
  await expect(words).toHaveText('(you@asks) Verification code:');
  await expect(question).not.toContainText('前の入力は受け付けられませんでした');
  await typed.fill('123456');
  await question.getByRole('button', { name: '送信' }).click();
  await expect(question).toHaveCount(0);
  await expect(asks).toContainText('接続済み', { timeout: 60_000 });
  // Given no answer, the login ends and says so; nothing asks again until 接続 is pressed.
  await asks.getByRole('button', { name: '編集' }).click();
  await asks.getByRole('textbox', { name: 'SSH のポート' }).fill('2200');
  await asks.getByRole('button', { name: '保存' }).click();
  await asks.getByRole('button', { name: '接続', exact: true }).click();
  await expect(words).toHaveText('(you@asks) Password:');
  await page.keyboard.press('Escape');
  await expect(question).toHaveCount(0);
  await expect(asks.locator('.remote-state.error')).toContainText('入力を取り消した');
  await page.waitForTimeout(500);
  await expect(question).toHaveCount(0);
  await asks.getByRole('button', { name: 'Asks を削除' }).click();
  await expect(asks).toHaveCount(0);

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

  // Its own agent runs on the host, in a conversation kept there (ADR 061, amended 0.2.79).
  await page.getByRole('button', { name: 'vault agent', exact: true }).click();
  const column = page.getByRole('complementary', { name: 'Remote notes agent' });
  await expect(column.getByRole('note')).toContainText(
    'SSH ホスト「Lab server」にインストールされた CLI で動きます',
  );
  await column.getByLabel('エージェント', { exact: true }).selectOption('pi');
  await column
    .getByLabel('エージェントへの指示')
    .fill('run: echo from-the-column > made-there.txt');
  await column.getByRole('button', { name: '送信', exact: true }).click();
  await expect(column.locator('.message.user')).toHaveText([
    'run: echo from-the-column > made-there.txt',
  ]);
  await expect
    .poll(() => readFile(path.join(notes, 'made-there.txt'), 'utf8').catch(() => ''), {
      timeout: 30_000,
    })
    .toContain('from-the-column');
  await expect(column.getByRole('button', { name: '停止', exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  // The conversation is listed from its host.
  await column.getByRole('button', { name: '履歴', exact: true }).click();
  await expect(column.locator('.history-row')).toHaveCount(1);
  await column.getByRole('button', { name: '履歴', exact: true }).click();
  await page.screenshot({ path: 'test-results/remote-hosts-vault.png' });

  // Its terminal is the host's, reached by ssh, in the vault's folder there.
  await page.keyboard.press('Control+Backquote');
  const terminal = page.getByRole('region', { name: 'Remote notes のターミナル' });
  await expect(terminal.locator('.terminal-remote')).toHaveText('ssh Lab server');
  await expect(terminal.getByLabel('ターミナルのシェル')).toHaveCount(0);
  await expect(terminal.locator('.terminal-state')).toHaveText('実行中');
  await terminal.locator('.xterm-helper-textarea').focus();
  await page.keyboard.insertText('pwd > from-the-terminal.txt');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => readFile(path.join(notes, 'from-the-terminal.txt'), 'utf8').catch(() => ''), {
      timeout: 15_000,
    })
    .toBe(`${notes}\n`);
  await page.screenshot({ path: 'test-results/remote-hosts-terminal.png' });
  await terminal.getByRole('button', { name: '終了して閉じる' }).click();
  await expect(terminal).toHaveCount(0);
  await expect(banner(page)).toHaveCount(0);

  // irori mode's mapping draws the host's vault in a box named after the host, apart
  // from this computer's vault, and reads the host with the vault's name.
  await rail(page).getByRole('button', { name: 'irori mode', exact: true }).click();
  const mapping = page.getByRole('region', { name: 'vault マッピング' });
  await expect(mapping).toBeVisible();
  await expect(page.locator('.islands.level-exit, .overview.level-return')).toHaveCount(0);
  const area = mapping.locator('.map-host');
  await expect(area).toHaveCount(1);
  await expect(area).toContainText('Lab server');
  await expect(area).toContainText('SSH ホスト');
  const remoteNode = mapping.getByRole('button', { name: 'Remote notes を開く', exact: true });
  const homeNode = mapping.getByRole('button', { name: 'Home を開く', exact: true });
  await expect(remoteNode).toHaveAccessibleDescription(/Lab server/);
  await expect(homeNode).toHaveAccessibleDescription('');
  const centre = async (locator: typeof area) => {
    const box = (await locator.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const bounds = (await area.boundingBox())!;
  const within = ({ x, y }: { x: number; y: number }) =>
    x > bounds.x && x < bounds.x + bounds.width && y > bounds.y && y < bounds.y + bounds.height;
  expect(within(await centre(remoteNode))).toBe(true);
  expect(within(await centre(homeNode))).toBe(false);
  // The whole vault, its name and its state, is inside the box.
  const remoteBox = (await remoteNode.boundingBox())!;
  expect(remoteBox.y).toBeGreaterThanOrEqual(bounds.y);
  expect(remoteBox.y + remoteBox.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  await expect(mapping.locator('.map-legend')).toContainText('SSH ホスト上の vault');
  await page.screenshot({ path: 'test-results/remote-hosts-mapping.png' });
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
  // A host of the ssh configuration is chosen by its name alone: it is added, connected
  // and its folders are on show, as with Remote-SSH. It is then a host like the others.
  const configured = register.getByRole('region', { name: 'ssh の設定にあるホスト' });
  await configured.getByRole('searchbox', { name: 'ssh の設定のホストを絞り込む' }).fill('lab');
  await page.screenshot({ path: 'test-results/remote-hosts-choice.png' });
  await configured.getByRole('button', { name: /^lab-gpu/ }).click();
  const chosen = page.getByRole('dialog', { name: 'lab-gpu のフォルダを vault にする' });
  await expect(chosen.getByRole('textbox', { name: 'ホストのフォルダのパス' })).toHaveValue(
    remoteHome,
    { timeout: 60_000 },
  );
  await chosen.getByRole('button', { name: 'キャンセル' }).click();
  // Added, it is no longer offered; the other hosts of the configuration still are.
  await expect(configured.getByRole('button', { name: /^lab-gpu/ })).toHaveCount(0);
  await configured.getByRole('searchbox', { name: 'ssh の設定のホストを絞り込む' }).fill('');
  await expect(configured.getByRole('button')).toHaveCount(50);
  await expect(
    register.getByRole('list', { name: 'SSH ホスト' }).getByRole('button', { name: /^lab-gpu/ }),
  ).toContainText('接続済み');
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
