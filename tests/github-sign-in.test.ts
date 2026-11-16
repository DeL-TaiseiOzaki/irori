import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { GitHubCli } from '../src/git/github';
import { GitAuthorStore } from '../src/git/author';
import { GitProcess } from '../src/git/process';
import { GitHubSignInService } from '../src/host/github-sign-in';
import { setLanguage } from '../src/domain/i18n';
import { fakeDeviceCode, fakeGh, git } from './fixtures/github';

// Messages are matched in English.
setLanguage('en');

/**
 * One device signing in (ADR 062): gh is the stand-in, Git's own settings are
 * a file of the test, and the browser and clipboard are recorded.
 */
async function device(
  t: { after: (fn: () => unknown) => void },
  { signedOut = true, config = '', email = null as string | null } = {},
) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori sign-in 日本語 '));
  const globalConfig = path.join(base, 'gitconfig');
  await writeFile(globalConfig, config);
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  const fake = await fakeGh(base, { signedOut, profile: { name: 'Octo Cat', email } });
  const github = new GitHubCli(async () => fake.gh);
  const author = new GitAuthorStore(base, new GitProcess('git', async () => undefined));
  const opened: string[] = [],
    copied: string[] = [];
  const service = new GitHubSignInService({
    github,
    author,
    open: async (url) => void opened.push(url),
    copy: (text) => void copied.push(text),
  });
  t.after(async () => {
    await service.cancel();
    await github.close();
    await author.close();
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
    await rm(base, { recursive: true, force: true });
  });
  const config_ = (key: string) => {
    try {
      return git(base, 'config', '--global', '--get', key).trim();
    } catch {
      return '';
    }
  };
  return { base, fake, github, service, opened, copied, config: config_, globalConfig };
}

test('the status tells a missing GitHub CLI, a signed-out one and the account', async (t) => {
  const { github, fake } = await device(t);
  assert.deepEqual(await new GitHubCli(async () => undefined).status(), { state: 'missing' });
  assert.deepEqual(await github.status(), { state: 'signed-out' });
  await writeFile(path.join(path.dirname(fake.gh), 'gh-signed-in'), '');
  assert.deepEqual(await github.status(), { state: 'signed-in', login: 'octo' });
});

test('signing in shows the code, opens GitHub and gives an unset Git author the account', async (t) => {
  const { service, fake, opened, copied, config } = await device(t);
  const code = await service.start();
  assert.deepEqual(code, { code: fakeDeviceCode, url: 'https://github.com/login/device' });
  await service.open();
  assert.deepEqual(copied, [fakeDeviceCode]);
  assert.deepEqual(opened, ['https://github.com/login/device']);
  // Nothing is decided until the person approves on GitHub.
  const finished = service.finish();
  await fake.approve();
  const result = await finished;
  assert.equal(result.login, 'octo');
  assert.deepEqual(result.filled, ['name', 'email']);
  // Without a public email, GitHub's noreply address attributes the commits.
  assert.equal(config('user.name'), 'Octo Cat');
  assert.equal(config('user.email'), '583231+octo@users.noreply.github.com');
  assert.deepEqual(
    { name: result.author.name, email: result.author.email },
    { name: 'Octo Cat', email: '583231+octo@users.noreply.github.com' },
  );
  assert.ok((await fake.calls()).includes('auth login --web --hostname github.com'));
});

test('signing in keeps a Git author part that is already set', async (t) => {
  const { service, fake, config } = await device(t, {
    config: '[user]\n\tname = Taisei\n',
    email: 'octo@example.com',
  });
  await service.start();
  const finished = service.finish();
  await fake.approve();
  const result = await finished;
  assert.deepEqual(result.filled, ['email']);
  assert.equal(config('user.name'), 'Taisei');
  // The public profile email is used when the account shows one.
  assert.equal(config('user.email'), 'octo@example.com');
});

test('cancelling stops the waiting GitHub CLI', async (t) => {
  const { service, fake } = await device(t);
  await service.start();
  const finished = assert.rejects(service.finish(), /cancelled/);
  const pid = await fake.loginPid();
  await service.cancel();
  await finished;
  assert.throws(() => process.kill(pid, 0));
  await assert.rejects(service.open(), /not started/);
});

test('a second start replaces the sign-in still waiting', async (t) => {
  const { service, fake } = await device(t);
  await service.start();
  const first = await fake.loginPid();
  const abandoned = assert.rejects(service.finish(), /cancelled/);
  await service.start();
  await abandoned;
  assert.throws(() => process.kill(first, 0));
  const finished = service.finish();
  await fake.approve();
  assert.equal((await finished).login, 'octo');
});

test('the page is read once gh has written its whole line', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori sign-in pieces '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const gh = path.join(base, 'gh');
  // gh's stderr arrives in two pieces, the first ending inside the address.
  await writeFile(
    gh,
    `#!/bin/sh\nprintf '! First copy your one-time code: abcd-1234\\nOpen this URL to continue in your web browser: https://github.com/lo' >&2\nsleep 0.3\nprintf 'gin/device\\n' >&2\nexit 0\n`,
    { mode: 0o755 },
  );
  const shown: unknown[] = [];
  await new GitHubCli(async () => gh).signIn((code) => void shown.push(code)).catch(() => {});
  assert.deepEqual(shown, [{ code: 'ABCD-1234', url: 'https://github.com/login/device' }]);
});

test('gh failing before it shows a code is the answer to starting', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori sign-in token '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const gh = path.join(base, 'gh');
  await writeFile(
    gh,
    `#!/bin/sh\necho 'The value of the GH_TOKEN environment variable is being used for authentication.' >&2\nexit 1\n`,
    { mode: 0o755 },
  );
  const github = new GitHubCli(async () => gh);
  const service = new GitHubSignInService({
    github,
    author: new GitAuthorStore(base),
    open: async () => {},
    copy: () => {},
  });
  await assert.rejects(service.start(), /GH_TOKEN/);
});

test('the Git author is read, offered from the account while unset, and saved', async (t) => {
  const { service, fake, config, globalConfig } = await device(t, { signedOut: false });
  const unset = await service.author();
  assert.deepEqual(unset, {
    name: '',
    email: '',
    github: { name: 'Octo Cat', email: '583231+octo@users.noreply.github.com' },
  });
  // Offering it writes nothing.
  assert.equal(await readFile(globalConfig, 'utf8'), '');
  const saved = await service.saveAuthor({ name: ' Taisei ', email: 'taisei@example.com' });
  assert.deepEqual(saved, { name: 'Taisei', email: 'taisei@example.com' });
  assert.equal(config('user.name'), 'Taisei');
  // A complete author asks GitHub nothing.
  const before = (await fake.calls()).length;
  await service.author();
  assert.equal((await fake.calls()).length, before);
  await assert.rejects(service.saveAuthor({ name: 'A', email: 'not an email' }), /email/);
  await assert.rejects(
    service.saveAuthor({ name: 'A <b>', email: 'a@example.com' }),
    /author name/,
  );
  assert.equal(config('user.email'), 'taisei@example.com');
});
