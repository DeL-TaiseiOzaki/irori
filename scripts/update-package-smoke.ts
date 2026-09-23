// Applies this build's own update file to an installed copy with the platform's real tools,
// which the behaviour tests can only imitate: Squirrel's Update.exe on Windows, and hdiutil,
// ditto, codesign, plutil and Launch Services on the Mac. Runs in the package job after
// `npm run make`, on a disposable runner: it installs irori for the runner's user.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  glob,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { BundleInstaller, SquirrelInstaller } from '../src/host/update-installers';

const run = promisify(execFile);
const project = process.cwd();
const { version } = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8')) as {
  version: string;
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(what: string, probe: () => Promise<T | undefined>, ms = 120_000) {
  for (const deadline = Date.now() + ms; Date.now() < deadline; await pause(500)) {
    const value = await probe().catch(() => undefined);
    if (value !== undefined) return value;
  }
  throw Error(`Timed out waiting for ${what}`);
}
async function one(pattern: string) {
  const found: string[] = [];
  for await (const file of glob(pattern, { cwd: project })) found.push(path.join(project, file));
  assert.equal(found.length, 1, `Expected one ${pattern}, found ${found.length}`);
  return found[0];
}
async function sha1(file: string) {
  const hash = createHash('sha1');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  );

async function windows() {
  const root = path.join(process.env.LOCALAPPDATA!, 'irori');
  assert(!(await exists(root)), `${root} already exists on this runner`);
  const setup = await one('out/make/squirrel.windows/x64/*Setup.exe');
  const built = await one('out/make/squirrel.windows/x64/*-full.nupkg');
  // The installer a person runs. --silent installs without the first-run launch.
  await run(setup, ['--silent'], {
    env: { ...process.env, IRORI_AUTOMATIC_UPDATE_CHECKS: '0' },
    timeout: 300_000,
  });
  const installed = path.join(root, `app-${version}`);
  await until(
    'the installed version',
    async () => (await exists(path.join(installed, 'irori.exe'))) || undefined,
  );
  await run('taskkill', ['/F', '/IM', 'irori.exe']).catch(() => {});
  // Make the installation an older one, so that this build's package is an update to it:
  // Squirrel reads the installed version from packages\RELEASES and the app-<version> folder.
  const older = '0.0.1';
  const packages = path.join(root, 'packages');
  const local = (await readFile(path.join(packages, 'RELEASES'), 'utf8')).replace(/^\uFEFF/, '');
  const [digest, name, size] = local.trim().split(/\s+/);
  assert.equal(name, `irori-${version}-full.nupkg`, local);
  await rename(path.join(packages, name), path.join(packages, `irori-${older}-full.nupkg`));
  await writeFile(path.join(packages, 'RELEASES'), `${digest} irori-${older}-full.nupkg ${size}`);
  await rename(installed, path.join(root, `app-${older}`));

  // What UpdateService hands the installer: the verified package in its own feed folder.
  const feed = await mkdtemp(path.join(tmpdir(), 'irori-feed-'));
  const file = path.join(feed, path.basename(built));
  await copyFile(built, file);
  const installer = new SquirrelInstaller(path.join(root, `app-${older}`, 'irori.exe'));
  assert.equal(await installer.unavailable(), undefined);
  const started = Date.now();
  await installer.prepare({ file, version, size: (await stat(file)).size, sha1: await sha1(file) });
  const applied = (await readFile(path.join(packages, 'RELEASES'), 'utf8')).replace(/^\uFEFF/, '');
  assert.match(applied, new RegExp(`\\birori-${version.replaceAll('.', '\\.')}-full\\.nupkg\\b`));
  console.log(`Squirrel applied ${version} over ${older} in ${Date.now() - started} ms.`);

  // The restart: Update.exe waits for its parent to exit and then starts the newest version.
  // A short-lived parent stands in for irori, so the relaunch can be observed from here.
  const updateExe = path.join(root, 'Update.exe');
  await new Promise<void>((resolve, reject) => {
    const parent = spawn(
      process.execPath,
      [
        '-e',
        `require('node:child_process').spawn(${JSON.stringify(updateExe)}, ['--processStartAndWait', 'irori.exe'], { detached: true, stdio: 'ignore', windowsHide: true }).unref()`,
      ],
      { stdio: 'inherit', env: { ...process.env, IRORI_AUTOMATIC_UPDATE_CHECKS: '0' } },
    );
    parent.once('error', reject);
    parent.once('exit', (code) => (code === 0 ? resolve() : reject(Error(`exit ${code}`))));
  });
  const launched = path.join(root, `app-${version}`, 'irori.exe');
  await until('the relaunched version', async () => {
    const { stdout } = await run('powershell.exe', [
      '-NoProfile',
      '-Command',
      'Get-Process irori -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }',
    ]);
    return stdout
      .split(/\r?\n/)
      .some((line) => line.trim().toLowerCase() === launched.toLowerCase())
      ? true
      : undefined;
  });
  await run('taskkill', ['/F', '/IM', 'irori.exe']).catch(() => {});
  console.log(`Update.exe started ${launched} after its parent exited.`);
}

async function mac() {
  const built = path.join(project, 'out', `irori-darwin-${process.arch}`, 'irori.app');
  const image = await one('out/make/*.dmg');
  const applications = path.join(await mkdtemp(path.join(tmpdir(), 'irori-apps-')), 'Applications');
  await mkdir(applications);
  const bundle = path.join(applications, 'irori.app');
  // ditto, not Node's copy, keeps what the signature covers.
  await run('ditto', [built, bundle]);
  const before = (await stat(bundle)).ino;
  // Stands in for the running irori, whose exit the relaunch waits for.
  const running = spawn('/bin/sleep', ['600'], { stdio: 'ignore' });
  await new Promise((resolve) => running.once('spawn', resolve));
  const installer = new BundleInstaller(path.join(bundle, 'Contents', 'MacOS', 'irori'), {
    pid: running.pid,
  });
  assert.equal(await installer.unavailable(), undefined);
  const started = Date.now();
  await installer.prepare({ file: image, version, size: (await stat(image)).size, sha1: '' });
  const work = path.join(applications, '.irori-update');
  assert.equal((await stat(bundle)).ino, before, 'nothing installed changes before the restart');
  await installer.restart();
  assert.notEqual((await stat(bundle)).ino, before, 'the staged bundle took the installed path');
  await run('codesign', ['--verify', '--deep', '--strict', bundle]);
  console.log(`The disk image's bundle replaced the installed one in ${Date.now() - started} ms.`);
  assert(await exists(work), 'nothing is opened or removed while irori still runs');
  running.kill();
  const executable = path.join(bundle, 'Contents', 'MacOS', 'irori');
  const pid = await until('the relaunched bundle', async () => {
    const { stdout } = await run('pgrep', ['-f', executable]);
    return stdout.trim().split(/\s+/)[0] || undefined;
  });
  await until('the previous bundle to be removed', async () => !(await exists(work)) || undefined);
  process.kill(Number(pid));
  console.log(`Launch Services opened ${bundle} and the previous bundle was removed.`);
}

if (process.platform === 'win32') await windows();
else if (process.platform === 'darwin') await mac();
else throw Error(`No in-app update on ${process.platform}`);
console.log(
  `In-app update mechanics passed on ${process.platform}/${process.arch} for ${version}.`,
);
