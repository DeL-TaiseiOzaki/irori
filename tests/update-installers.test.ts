import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BundleInstaller,
  SquirrelInstaller,
  relaunchScript,
  type Commands,
} from '../src/host/update-installers';

function recorder(
  respond: (
    file: string,
    args: string[],
  ) => Promise<{ stdout?: string; stderr?: string }> = async () => ({}),
) {
  const runs: string[][] = [];
  const detached: string[][] = [];
  const commands: Commands = {
    run: async (file, args) => {
      runs.push([file, ...args]);
      const { stdout = '', stderr = '' } = await respond(file, args);
      return { stdout, stderr };
    },
    detach: async (file, args) => {
      detached.push([file, ...args]);
    },
  };
  return { commands, runs, detached };
}

// %LOCALAPPDATA%\irori as Squirrel lays it out, with the running version's executable.
async function squirrelLayout() {
  const root = path.join(await mkdtemp(path.join(tmpdir(), 'irori-squirrel-')), 'irori');
  await mkdir(path.join(root, 'app-0.1.3'), { recursive: true });
  await writeFile(path.join(root, 'app-0.1.3', 'irori.exe'), 'running');
  await writeFile(path.join(root, 'Update.exe'), 'squirrel');
  const feed = path.join(root, 'feed');
  await mkdir(feed);
  const file = path.join(feed, 'irori-0.1.4-full.nupkg');
  await writeFile(file, 'package');
  return { root, execPath: path.join(root, 'app-0.1.3', 'irori.exe'), feed, file };
}

test('Squirrel applies the verified package from a local feed and starts it after exit', async () => {
  const { root, execPath, feed, file } = await squirrelLayout();
  const sha1 = 'a'.repeat(40);
  const { commands, runs, detached } = recorder(async (_file, args) => {
    assert.equal(
      await readFile(path.join(feed, 'RELEASES'), 'utf8'),
      `${'A'.repeat(40)} irori-0.1.4-full.nupkg 7`,
    );
    // What Update.exe --update leaves behind: the new version beside the running one.
    if (args[0] === '--update') {
      await mkdir(path.join(root, 'app-0.1.4'));
      await writeFile(path.join(root, 'app-0.1.4', 'irori.exe'), 'new');
    }
    return {};
  });
  const installer = new SquirrelInstaller(execPath, commands);
  assert.equal(await installer.unavailable(), undefined);
  await installer.prepare({ file, version: '0.1.4', size: 7, sha1 });
  assert.deepEqual(runs, [[path.join(root, 'Update.exe'), '--update', feed]]);
  await installer.restart();
  assert.deepEqual(detached, [
    [path.join(root, 'Update.exe'), '--processStartAndWait', 'irori.exe'],
  ]);
});

test('Squirrel reports a failed or empty update and an installation it did not make', async () => {
  const failing = await squirrelLayout();
  const refused = new SquirrelInstaller(
    failing.execPath,
    recorder(async () => {
      throw Error('exit code 1');
    }).commands,
  );
  await assert.rejects(
    refused.prepare({ file: failing.file, version: '0.1.4', size: 7, sha1: 'b'.repeat(40) }),
    /Windows の更新処理を完了できませんでした/,
  );
  const empty = await squirrelLayout();
  // Update.exe exits successfully without applying anything, e.g. when nothing is newer.
  const idle = new SquirrelInstaller(empty.execPath, recorder().commands);
  await assert.rejects(
    idle.prepare({ file: empty.file, version: '0.1.4', size: 7, sha1: 'c'.repeat(40) }),
    /更新後の irori 0\.1\.4 が見つかりません/,
  );
  await rm(path.join(empty.root, 'Update.exe'));
  assert.match((await idle.unavailable()) ?? '', /インストーラーで導入した irori/);
});

const identified =
  'Executable=irori\nIdentifier=io.github.deltaiseiozaki.irori\nFormat=app bundle\n';

// /Applications with an installed irori.app, and a disk image whose irori.app `hdiutil
// attach` makes appear at the requested mount point.
async function macLayout(
  options: { version?: string; identifier?: string; verify?: boolean } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), 'irori-bundle-'));
  const applications = path.join(root, 'Applications');
  const bundle = path.join(applications, 'irori.app');
  await mkdir(path.join(bundle, 'Contents', 'MacOS'), { recursive: true });
  await writeFile(path.join(bundle, 'Contents', 'MacOS', 'irori'), 'installed');
  const image = path.join(root, 'image');
  await mkdir(path.join(image, 'irori.app', 'Contents', 'MacOS'), { recursive: true });
  await writeFile(path.join(image, 'irori.app', 'Contents', 'MacOS', 'irori'), 'new');
  await writeFile(path.join(image, 'irori.app', 'Contents', 'Info.plist'), 'plist');
  const dmg = path.join(root, 'irori-0.1.4-macos-arm64.dmg');
  await writeFile(dmg, 'dmg');
  const { commands, runs, detached } = recorder(async (file, args) => {
    if (file === 'hdiutil' && args[0] === 'attach') {
      assert.equal(args[1], dmg);
      await cp(image, args.at(-1)!, { recursive: true });
    }
    if (file === 'hdiutil' && args[0] === 'detach')
      await rm(path.join(args[1], 'irori.app'), { recursive: true });
    if (file === 'ditto') await cp(args[0], args[1], { recursive: true });
    if (file === 'codesign' && args[0] === '--verify' && options.verify === false)
      throw Error('invalid signature');
    if (file === 'codesign' && args[0] === '--display')
      return {
        stderr: options.identifier
          ? identified.replace('io.github.deltaiseiozaki.irori', options.identifier)
          : identified,
      };
    if (file === 'plutil') return { stdout: `${options.version ?? '0.1.4'}\n` };
    return {};
  });
  const installer = new BundleInstaller(path.join(bundle, 'Contents', 'MacOS', 'irori'), {
    pid: 4242,
    commands,
    open: '/usr/bin/open',
  });
  return { root, applications, bundle, dmg, installer, runs, detached };
}
const executable = (bundle: string) =>
  readFile(path.join(bundle, 'Contents', 'MacOS', 'irori'), 'utf8');

test('the Mac bundle is staged beside the installed one, checked, and swapped at restart', async () => {
  const { applications, bundle, dmg, installer, runs, detached } = await macLayout();
  assert.equal(await installer.unavailable(), undefined);
  await installer.prepare({ file: dmg, version: '0.1.4', size: 3, sha1: 'd'.repeat(40) });
  const work = path.join(applications, '.irori-update');
  assert.equal(await executable(path.join(work, 'irori.app')), 'new');
  assert.equal(await executable(bundle), 'installed', 'nothing installed changes before restart');
  const mount = runs[0].at(-1)!;
  assert.deepEqual(
    runs.map((command) => command.slice(0, 2)),
    [
      ['hdiutil', 'attach'],
      ['ditto', path.join(mount, 'irori.app')],
      ['hdiutil', 'detach'],
      ['codesign', '--verify'],
      ['codesign', '--display'],
      ['plutil', '-extract'],
    ],
  );
  await assert.rejects(stat(mount), 'the mount point is removed once detached');
  await installer.restart();
  assert.equal(await executable(bundle), 'new');
  assert.equal(await executable(path.join(work, 'previous.app')), 'installed');
  assert.deepEqual(detached, [
    ['/bin/sh', '-c', relaunchScript, 'irori-update', '4242', bundle, work, '/usr/bin/open'],
  ]);
  await installer.cleanup();
  await assert.rejects(stat(work));
});

test('a disk image holding another app, version or broken signature is refused', async () => {
  for (const [options, pattern] of [
    [{ identifier: 'com.example.other' }, /irori ではありません/],
    [{ version: '0.1.3' }, /0\.1\.3 が公開版 0\.1\.4 と一致しません/],
    [{ verify: false }, /署名を確認できませんでした/],
  ] as const) {
    const { bundle, dmg, installer } = await macLayout(options);
    await assert.rejects(
      installer.prepare({ file: dmg, version: '0.1.4', size: 3, sha1: 'e'.repeat(40) }),
      pattern,
    );
    assert.equal(await executable(bundle), 'installed');
  }
});

test('a failed swap puts the running bundle back', async () => {
  // Nothing staged: the second rename fails, and the first is undone.
  const unstaged = await macLayout();
  await mkdir(path.join(unstaged.applications, '.irori-update'));
  await assert.rejects(unstaged.installer.restart(), /irori を置き換えられませんでした（ENOENT）/);
  assert.equal(await executable(unstaged.bundle), 'installed');
  // No folder to move the running bundle into: nothing moves at all.
  const unprepared = await macLayout();
  await assert.rejects(unprepared.installer.restart(), /ENOENT/);
  assert.equal(await executable(unprepared.bundle), 'installed');
  // The relaunch cannot start: both renames are undone, so the next launch is not orphaned.
  const stuck = await macLayout();
  await stuck.installer.prepare({
    file: stuck.dmg,
    version: '0.1.4',
    size: 3,
    sha1: 'f'.repeat(40),
  });
  const failing = new BundleInstaller(path.join(stuck.bundle, 'Contents', 'MacOS', 'irori'), {
    commands: {
      run: async () => ({ stdout: '', stderr: '' }),
      detach: async () => {
        throw Error('spawn failed');
      },
    },
  });
  await assert.rejects(failing.restart(), /新しい版を起動する準備ができませんでした/);
  assert.equal(await executable(stuck.bundle), 'installed');
  assert.equal(
    await executable(path.join(stuck.applications, '.irori-update', 'irori.app')),
    'new',
  );
});

test('only a bundle irori can rewrite is offered the in-app update', async () => {
  const { installer } = await macLayout();
  assert.equal(await installer.unavailable(), undefined);
  const translocated = new BundleInstaller(
    '/private/var/folders/xy/AppTranslocation/1234/d/irori.app/Contents/MacOS/irori',
  );
  assert.match((await translocated.unavailable()) ?? '', /アプリケーション」フォルダに移して/);
  const loose = new BundleInstaller('/opt/irori/irori');
  assert.match((await loose.unavailable()) ?? '', /バンドルを特定できない/);
  if (process.getuid?.() !== 0) {
    const readOnly = await macLayout();
    await chmod(readOnly.applications, 0o555);
    try {
      assert.match((await readOnly.installer.unavailable()) ?? '', /書き込めない/);
    } finally {
      await chmod(readOnly.applications, 0o755);
    }
  }
});

test('the relaunch script waits for irori to exit, opens the new bundle and removes the old', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'irori-relaunch-'));
  const work = path.join(root, '.irori-update');
  await mkdir(path.join(work, 'previous.app'), { recursive: true });
  const opened = path.join(root, 'opened');
  const open = path.join(root, 'open');
  await writeFile(open, `#!/bin/sh\nprintf '%s' "$1" > "${opened}"\n`);
  await chmod(open, 0o755);
  const running = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
    stdio: 'ignore',
  });
  await new Promise((resolve) => running.once('spawn', resolve));
  const bundle = path.join(root, 'irori.app');
  const script = spawn(
    '/bin/sh',
    ['-c', relaunchScript, 'irori-update', String(running.pid), bundle, work, open],
    { stdio: 'ignore' },
  );
  const finished = new Promise((resolve) => script.once('exit', resolve));
  await new Promise((resolve) => setTimeout(resolve, 600));
  await assert.rejects(stat(opened), 'nothing opens while irori still runs');
  await stat(work);
  running.kill();
  assert.equal(await finished, 0);
  assert.equal(await readFile(opened, 'utf8'), bundle);
  await assert.rejects(stat(work));
});
