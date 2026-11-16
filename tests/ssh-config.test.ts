import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { readSshConfigHosts, systemSshConfig } from '../src/host/ssh-config';

/** A home folder with an ssh configuration, and no system file unless one is named. */
async function home(t: TestContext, files: Record<string, string>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'irori ssh config '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
  return dir;
}
const read = (dir: string, system: string | null = null) =>
  readSshConfigHosts({ home: dir, system });

test('each name of a Host line is a host, with what its block says of it', async (t) => {
  const dir = await home(t, {
    '.ssh/config': [
      '# my machines',
      'Host gpu1',
      '  HostName gpu1.lab.example.com',
      '  User taro',
      '  Port 2222',
      '',
      'Host box-a box-b',
      '    hostname %h.internal',
      '    user=hanako',
      'Host bare',
      '',
    ].join('\n'),
  });
  assert.deepEqual(await read(dir), [
    { alias: 'gpu1', hostName: 'gpu1.lab.example.com', user: 'taro', port: 2222 },
    { alias: 'box-a', hostName: 'box-a.internal', user: 'hanako' },
    { alias: 'box-b', hostName: 'box-b.internal', user: 'hanako' },
    { alias: 'bare' },
  ]);
});

test('a pattern is how to connect, not a host: wildcards and negations are left out', async (t) => {
  const dir = await home(t, {
    '.ssh/config': [
      'Host *.example.com !bad.example.com jump',
      '  User jumper',
      'Host node?',
      'Host real',
      '  HostName 10.0.0.5',
      'Host gone !gone',
    ].join('\n'),
  });
  // `jump` is a name on a line that also holds patterns. A name its own line refuses is no host.
  assert.deepEqual(await read(dir), [
    { alias: 'jump', user: 'jumper' },
    { alias: 'real', hostName: '10.0.0.5' },
  ]);
});

test('a host is shown with what ssh would obtain for it, patterns included, first value first', async (t) => {
  const dir = await home(t, {
    '.ssh/config': [
      'Host gpu1',
      '  HostName 10.0.0.5',
      'Host *.lab !old.lab',
      '  User labuser',
      '  Port 2200',
      'Host a.lab old.lab',
      '  User later',
      'Host *',
      '  User everyone',
      '  HostName %h.example.com',
      'Host after',
      '  User too-late',
    ].join('\n'),
  });
  assert.deepEqual(await read(dir), [
    { alias: 'gpu1', hostName: '10.0.0.5', user: 'everyone' },
    { alias: 'a.lab', hostName: 'a.lab.example.com', user: 'labuser', port: 2200 },
    { alias: 'old.lab', hostName: 'old.lab.example.com', user: 'later' },
    { alias: 'after', hostName: 'after.example.com', user: 'everyone' },
  ]);
  // Said before any Host line, a value is every host's.
  const top = await home(t, { '.ssh/config': 'Port 2022\nHost one\n  Port 22\nHost two\n' });
  assert.deepEqual(await read(top), [
    { alias: 'one', port: 2022 },
    { alias: 'two', port: 2022 },
  ]);
});

test('a configuration written on Windows reads the same: a byte-order mark, CRLF, quotes and =', async (t) => {
  const dir = await home(t, {
    '.ssh/config':
      '\uFEFFHost "quoted"\r\n  HostName = "host.example.com"\r\n  USER\tme # trailing words\r\n\r\nHost=eq\r\n  Port=22022\r\n',
  });
  assert.deepEqual(await read(dir), [
    { alias: 'quoted', hostName: 'host.example.com', user: 'me' },
    { alias: 'eq', port: 22022 },
  ]);
});

test('a host named twice is listed once, and a value ssh would refuse is not shown', async (t) => {
  const dir = await home(t, {
    '.ssh/config': [
      'Host twice',
      '  User first',
      '  User second',
      'Host twice other',
      '  User third',
      '  HostName later.example.com',
      '  Port notaport',
      '  Port 70000',
    ].join('\n'),
  });
  assert.deepEqual(await read(dir), [
    { alias: 'twice', user: 'first', hostName: 'later.example.com' },
    { alias: 'other', user: 'third', hostName: 'later.example.com' },
  ]);
});

test('included files are read where ssh looks for them, in order, patterns and all', async (t) => {
  const dir = await home(t, {
    '.ssh/config': [
      'Include config.d/*.conf',
      'Include ~/.ssh/extra "spaced name"',
      'Include missing-file nowhere/*',
      'Host plain',
    ].join('\n'),
    '.ssh/config.d/20-work.conf': 'Host work\n  HostName work.example.com\n',
    // A file named without a folder is in ~/.ssh, whichever file names it.
    '.ssh/config.d/10-home.conf': 'Include nested\nHost home\n',
    '.ssh/config.d/ignored.txt': 'Host not-read\n',
    '.ssh/config.d/.hidden.conf': 'Host hidden\n',
    '.ssh/nested': 'Host deep\n',
    '.ssh/extra': 'Host extra\n',
    '.ssh/spaced name': 'Host spaced\n',
  });
  assert.deepEqual(await read(dir), [
    { alias: 'deep' },
    { alias: 'home' },
    { alias: 'work', hostName: 'work.example.com' },
    { alias: 'extra' },
    { alias: 'spaced' },
    { alias: 'plain' },
  ]);
});

test("a file included inside a block is read for that block's hosts alone, as ssh reads it", async (t) => {
  const dir = await home(t, {
    '.ssh/config': [
      'Host last',
      '  Include inside',
      '  User outer',
      'Host *.lab !old.lab',
      '  Include lab',
      'Match all',
      '  Include shared',
      'Host other',
      '  Include shared',
      'Host *',
      '  Include everyone',
    ].join('\n'),
    // Before its own first Host line an included file speaks of the block it stands in.
    '.ssh/inside':
      'Port 2200\nHost within\n  User inner\nHost last\n  HostName last.example.com\nHost *\n  User inner-star\n',
    '.ssh/lab': 'Host gpu.lab\n  User labber\nHost old.lab elsewhere\n',
    '.ssh/shared': 'Host shared\n  Port 2022\n',
    '.ssh/everyone': 'Host any\n  HostName any.example.com\n',
  });
  // `within`, `old.lab` and `elsewhere` stand where ssh never reads for them. `other` is a
  // name of the main file; the file its block includes a second time adds nothing.
  assert.deepEqual(await read(dir), [
    { alias: 'last', port: 2200, hostName: 'last.example.com', user: 'inner-star' },
    { alias: 'gpu.lab', user: 'labber' },
    { alias: 'shared', port: 2022 },
    { alias: 'other' },
    { alias: 'any', hostName: 'any.example.com' },
  ]);
});

test('what a Match may or may not set is not shown, and Match all is every host’s', async (t) => {
  const dir = await home(t, {
    '.ssh/config': [
      'Host a',
      '  HostName a.example.com',
      'Match host a.example.com exec "true"',
      '  User conditional',
      '  Include matched',
      'Match final all',
      '  Port 2200',
      'Host b',
      '  User bee',
      '  HostName b.example.com',
    ].join('\n'),
    '.ssh/matched': 'Host inner\n  HostName inner.example.com\n',
  });
  // The Match names no host of its own. Whether its user or a later one is used cannot be
  // told here, so none is shown; the address of `inner` hangs on the same Match.
  assert.deepEqual(await read(dir), [
    { alias: 'a', hostName: 'a.example.com', port: 2200 },
    { alias: 'inner', port: 2200 },
    { alias: 'b', hostName: 'b.example.com', port: 2200 },
  ]);
});

test('a file that includes itself, a folder, or nothing at all gives what can be read', async (t) => {
  const looping = await home(t, {
    '.ssh/config': 'Include config other\nHost one\n',
    '.ssh/other': 'Include config\nHost two\n',
  });
  assert.deepEqual(await read(looping), [{ alias: 'two' }, { alias: 'one' }]);
  const none = await home(t, {});
  assert.deepEqual(await read(none), []);
  const folder = await home(t, { '.ssh/config/placeholder': '' });
  assert.deepEqual(await read(folder), []);
});

test('a name ssh could not take as one plain argument is not offered', async (t) => {
  const dir = await home(t, {
    '.ssh/config': 'Host -oProxyCommand=evil ok\nHost "has space"\nHost a;b\n',
  });
  assert.deepEqual(await read(dir), [{ alias: 'ok' }]);
});

test("the system's file is read after the person's, and its hosts come after theirs", async (t) => {
  const dir = await home(t, {
    '.ssh/config': 'Host mine\n  User me\n',
    'etc/ssh_config': 'Include ssh_config.d/*\nHost shared mine\n  User system\n',
    'etc/ssh_config.d/site': 'Host site\n',
  });
  assert.deepEqual(await read(dir, path.join(dir, 'etc', 'ssh_config')), [
    { alias: 'mine', user: 'me' },
    { alias: 'site' },
    { alias: 'shared', user: 'system' },
  ]);
  assert.equal(systemSshConfig('linux'), '/etc/ssh/ssh_config');
  assert.equal(
    systemSshConfig('win32', { ProgramData: 'D:\\Data' }),
    path.join('D:\\Data', 'ssh', 'ssh_config'),
  );
});

test('a configuration of thousands of hosts is read whole and quickly', async (t) => {
  const many = Array.from(
    { length: 6000 },
    (_, at) => `Host node${at}\n  HostName 10.0.${at >> 8}.${at & 255}\n`,
  );
  const dir = await home(t, {
    '.ssh/config': `${many.join('')}Host node1?\n  Port 2200\nHost *\n  User ops\n`,
  });
  const began = Date.now();
  const hosts = await read(dir);
  assert.equal(hosts.length, 6000);
  assert.deepEqual(hosts[12], { alias: 'node12', hostName: '10.0.0.12', port: 2200, user: 'ops' });
  assert.deepEqual(hosts[5999], { alias: 'node5999', hostName: '10.0.23.111', user: 'ops' });
  assert.ok(Date.now() - began < 5000);
});

test('what is shown of each host is what ssh itself resolves (ssh -G)', async (t) => {
  if (spawnSync('ssh', ['-G', 'localhost'], { encoding: 'utf8' }).status !== 0)
    return t.skip('no ssh that answers -G on this computer');
  // `ssh -F` still looks in the real ~/.ssh for a file named without a folder, so each is named in full.
  const dir = await mkdtemp(path.join(tmpdir(), 'irori-ssh-g-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const at = (name: string) => path.join(dir, '.ssh', name);
  const files: Record<string, string> = {
    config: [
      `Include ${at('first')}`,
      'Host last',
      `  Include ${at('inside')}`,
      '  User outer',
      'Host *.lab !old.lab',
      `  Include ${at('lab')}`,
      '  Port 2200',
      'Host a.lab old.lab jump',
      '  User later',
      'Match all',
      `  Include ${at('first')}`,
      '  Port 2022',
      'Host *',
      '  User everyone',
      '  HostName %h.example.com',
      'Host after',
      '  User too-late',
    ].join('\n'),
    first: 'Host one two\n  HostName=10.0.0.%h\nHost two\n  User "second"\n',
    inside: 'Port 2222\nHost within\n  User inner\nHost last\n  HostName last.example.com\n',
    lab: 'Host gpu.lab\n  User labber\nHost old.lab elsewhere\n  User unreached\n',
  };
  await mkdir(path.join(dir, '.ssh'));
  for (const [name, text] of Object.entries(files)) await writeFile(at(name), `${text}\n`);
  const hosts = await read(dir);
  assert.deepEqual(
    hosts.map((host) => host.alias),
    ['one', 'two', 'last', 'gpu.lab', 'a.lab', 'old.lab', 'jump', 'after'],
  );
  for (const host of hosts) {
    const said = spawnSync('ssh', ['-G', '-F', at('config'), '--', host.alias], {
      encoding: 'utf8',
    });
    assert.equal(said.status, 0, said.stderr);
    const value = (key: string) =>
      new RegExp(`^${key} (.*)$`, 'm').exec(said.stdout)?.[1] ?? assert.fail(`no ${key}`);
    assert.deepEqual(
      {
        alias: host.alias,
        hostName: host.hostName ?? host.alias,
        user: host.user ?? userInfo().username,
        port: host.port ?? 22,
      },
      {
        alias: host.alias,
        hostName: value('hostname'),
        user: value('user'),
        port: Number(value('port')),
      },
    );
  }
});
