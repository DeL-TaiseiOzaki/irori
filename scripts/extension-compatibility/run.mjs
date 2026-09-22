// SPDX-License-Identifier: MIT
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import treeKill from 'tree-kill';

const [supplied, ...options] = process.argv.slice(2);
if (!supplied || !path.isAbsolute(supplied) || options.some((value) => value !== '--no-sandbox'))
  throw Error(
    'Usage: node scripts/extension-compatibility/run.mjs /absolute/path/to/desktop-executable [--no-sandbox]',
  );
const executable = await realpath(supplied);
if (/[\\/]remote-cli[\\/]/.test(executable) || /\.(?:cmd|bat)$/i.test(executable))
  throw Error(
    'Supply an isolated desktop executable (Code.exe on Windows), not a remote CLI or command shim',
  );
const repository = fileURLToPath(new URL('../../', import.meta.url));
const extension = path.join(repository, 'tests', 'fixtures', 'extension-compatibility');
const directory = await mkdtemp(path.join(tmpdir(), 'irori-extension-probe-'));
let child;
let timer;
try {
  const workspace = path.join(directory, 'workspace');
  const profile = path.join(directory, 'profile');
  const result = path.join(directory, 'result.json');
  await mkdir(workspace);
  await mkdir(path.join(profile, 'User'), { recursive: true });
  await writeFile(path.join(workspace, 'sample.iroriprobe'), 'before\n');
  await writeFile(
    path.join(profile, 'User', 'settings.json'),
    JSON.stringify({
      'workbench.startupEditor': 'none',
      'security.workspace.trust.enabled': false,
      'telemetry.telemetryLevel': 'off',
      'update.mode': 'none',
      'extensions.autoUpdate': false,
      'extensions.autoCheckUpdates': false,
    }),
  );
  const env = { ...process.env, IRORI_COMPATIBILITY_RESULT: result };
  for (const key of [
    'VSCODE_IPC_HOOK_CLI',
    'VSCODE_IPC_HOOK',
    'VSCODE_CWD',
    'ELECTRON_RUN_AS_NODE',
  ])
    delete env[key];
  child = spawn(
    executable,
    [
      ...options,
      '--new-window',
      '--wait',
      '--skip-welcome',
      '--skip-release-notes',
      '--user-data-dir',
      profile,
      '--extensions-dir',
      path.join(directory, 'extensions'),
      '--extensionDevelopmentPath',
      extension,
      '--extensionTestsPath',
      path.join(extension, 'test.cjs'),
      workspace,
    ],
    { env, stdio: ['ignore', 'ignore', 'ignore'] },
  );
  const exit = await new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      if (child.pid) treeKill(child.pid, 'SIGKILL', () => {});
      reject(Error('The supplied desktop runtime did not complete the probe within 90 seconds'));
    }, 90000);
    child.once('error', reject);
    child.once('exit', (code) => resolve(code));
  });
  clearTimeout(timer);
  const report = JSON.parse(
    await readFile(result, 'utf8').catch(() => {
      throw Error(`Desktop runtime exited ${exit} without extension execution evidence`);
    }),
  );
  const output = path.join(repository, 'test-results', 'extension-compatibility');
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (exit !== 0 || report.state !== 'passed') process.exitCode = 1;
} finally {
  clearTimeout(timer);
  if (child?.pid && child.exitCode === null && child.signalCode === null)
    await new Promise((resolve) => treeKill(child.pid, 'SIGKILL', () => resolve()));
  await rm(directory, { recursive: true, force: true });
}
