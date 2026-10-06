import { execFileSync } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * A stand-in for gh that answers the REST calls irori makes for the account
 * `octo` from a folder: a repository is a folder, its file a file beside a
 * `.private` marker, and a write is refused when its sha is not the file's.
 */
export async function fakeGh(base: string) {
  const github = path.join(base, 'github');
  await mkdir(github, { recursive: true });
  const gh = path.join(base, 'gh');
  const log = path.join(base, 'gh.log');
  await writeFile(
    gh,
    `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const args = process.argv.slice(2), root = ${JSON.stringify(github)};
fs.appendFileSync(${JSON.stringify(log)}, args.join(' ') + '\\n');
const fail = (text) => { process.stderr.write(text + '\\n'); process.exit(1); };
const sha = (text) => crypto.createHash('sha1').update(text).digest('hex');
const joined = args.join(' ');
if (joined === 'api user --jq .login') { console.log('octo'); process.exit(0); }
if (joined === 'config get git_protocol --host github.com') { console.log('https'); process.exit(0); }
if (args[0] === 'api' && args[1] === '-X' && args[2] === 'POST' && args[3] === 'user/repos') {
  const name = args[args.indexOf('-f') + 1].slice('name='.length);
  const dir = path.join(root, 'octo', name);
  if (fs.existsSync(dir)) fail('gh: name already exists on this account (HTTP 422)');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.private'), String(args.includes('private=true')));
  process.exit(0);
}
let match = /^repos\\/([^/]+)\\/([^/]+)$/.exec(args[1] ?? '');
if (args[0] === 'api' && match) {
  const marker = path.join(root, match[1], match[2], '.private');
  if (!fs.existsSync(marker)) fail('gh: Not Found (HTTP 404)');
  console.log(fs.readFileSync(marker, 'utf8'));
  process.exit(0);
}
match = /^repos\\/([^/]+)\\/([^/]+)\\/contents\\/(.+)$/.exec(args[args[1] === '-X' ? 3 : 1] ?? '');
if (args[0] === 'api' && match) {
  const file = path.join(root, match[1], match[2], match[3]);
  if (args[1] === '-X') {
    const body = JSON.parse(fs.readFileSync(0, 'utf8'));
    const text = Buffer.from(body.content, 'base64').toString('utf8');
    const current = fs.existsSync(file) ? sha(fs.readFileSync(file, 'utf8')) : undefined;
    if (current && body.sha !== current) fail('gh: environment.json does not match ' + body.sha + ' (HTTP 409)');
    fs.writeFileSync(file, text);
    process.exit(0);
  }
  if (!fs.existsSync(file)) fail('gh: Not Found (HTTP 404)');
  const text = fs.readFileSync(file, 'utf8');
  const content = Buffer.from(text).toString('base64').replace(/(.{60})/g, '$1\\n');
  console.log(JSON.stringify({ sha: sha(text), encoding: 'base64', content }));
  process.exit(0);
}
fail('unknown command ' + joined);
`,
  );
  await chmod(gh, 0o755);
  const calls = async () =>
    (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  const stored = (file = 'environment.json') =>
    readFile(path.join(github, 'octo', 'irori-settings', file), 'utf8');
  return { gh, github, calls, stored };
}

/** A bare repository standing in for github.com/octo/<name>, holding `files` in one commit. */
export async function remote(base: string, name: string, files: Record<string, string>) {
  const bare = path.join(base, 'remotes', `${name}.git`);
  const work = path.join(base, 'remotes', `${name}-work`);
  await mkdir(work, { recursive: true });
  git(base, 'init', '--quiet', '--bare', '--initial-branch=main', bare);
  git(work, 'init', '--quiet', '--initial-branch=main');
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(work, file)), { recursive: true });
    await writeFile(path.join(work, file), text);
  }
  git(work, 'add', '-A');
  // Its own identity: a CI runner has none, and the caller's Git configuration is not set yet.
  git(
    work,
    '-c',
    'user.name=Git fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'Start',
  );
  git(work, 'push', '--quiet', bare, 'main');
  return { bare, url: `https://github.com/octo/${name}.git` };
}
