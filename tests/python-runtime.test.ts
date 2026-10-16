import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { PythonRuntime, uvRelease, uvVersion, type UvRelease } from '../src/host/python-runtime';

async function folder(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori python '));
  t.after(() => rm(base, { recursive: true, force: true }));
  return base;
}

/** A gzipped tar laid out as uv's: `<folder>/uv` beside `<folder>/uvx`. */
async function tarball(base: string) {
  const inner = path.join(base, 'archive', 'uv-x86_64-unknown-linux-gnu');
  await mkdir(inner, { recursive: true });
  await writeFile(path.join(inner, 'uvx'), 'not uv\n');
  await writeFile(path.join(inner, 'uv'), '#!/bin/sh\necho uv\n');
  const file = path.join(base, 'uv.tar.gz');
  execFileSync('tar', [
    'czf',
    file,
    '-C',
    path.join(base, 'archive'),
    'uv-x86_64-unknown-linux-gnu',
  ]);
  return readFile(file);
}

function described(name: string, bytes: Buffer): UvRelease {
  return { name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** GitHub's answer: a redirect from the release to its download host, then the bytes. */
function github(bytes: Buffer, download = 'https://objects.example/uv') {
  const asked: string[] = [];
  const fetch = (async (url: string | URL | Request) => {
    asked.push(String(url));
    if (String(url).startsWith('https://github.com/'))
      return new Response(null, { status: 302, headers: { location: download } });
    return new Response(new Uint8Array(bytes));
  }) as typeof globalThis.fetch;
  return { fetch, asked };
}

test('uv is pinned for every device irori ships to', () => {
  for (const [platform, arch] of [
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['linux', 'arm64'],
    ['linux', 'x64'],
    ['win32', 'arm64'],
    ['win32', 'x64'],
  ]) {
    const release = uvRelease(platform, arch);
    assert.ok(release, `${platform}-${arch}`);
    assert.match(release.sha256, /^[0-9a-f]{64}$/);
    assert.equal(release.name.endsWith('.zip'), platform === 'win32');
  }
  assert.equal(uvRelease('freebsd', 'x64'), undefined);
});

test('Python is added once: uv from its release, into irori data, nowhere else', async (t) => {
  const base = await folder(t);
  const bytes = await tarball(base);
  const { fetch, asked } = github(bytes);
  const dataDir = path.join(base, 'data');
  const python = new PythonRuntime({
    dataDir,
    fetch,
    release: described('uv-x86_64-unknown-linux-gnu.tar.gz', bytes),
    platform: 'linux',
  });
  assert.equal(await python.uv(), undefined);
  const [first, second] = await Promise.all([python.install(), python.install()]);
  assert.equal(first, second);
  assert.equal(first, path.join(dataDir, 'runtimes', 'uv', uvVersion, 'uv'));
  assert.deepEqual(asked, [
    `https://github.com/astral-sh/uv/releases/download/${uvVersion}/uv-x86_64-unknown-linux-gnu.tar.gz`,
    'https://objects.example/uv',
  ]);
  assert.equal(await readFile(first, 'utf8'), '#!/bin/sh\necho uv\n');
  assert.ok((await stat(first)).mode & 0o100);
  assert.equal(await python.uv(), first);
  // Already here: nothing is fetched again.
  await python.install();
  assert.equal(asked.length, 2);
  for (const value of Object.values(python.env()))
    if (path.isAbsolute(value)) assert.ok(value.startsWith(path.join(dataDir, 'runtimes')), value);
  assert.equal(python.env().UV_NO_CONFIG, '1');
  assert.equal(python.env().UV_PYTHON_PREFERENCE, 'only-managed');
});

test('a download that differs from the pinned uv is refused and leaves nothing', async (t) => {
  const base = await folder(t);
  const bytes = await tarball(base);
  const dataDir = path.join(base, 'data');
  const release = described('uv.tar.gz', bytes);
  const changed = new PythonRuntime({
    dataDir,
    fetch: github(bytes).fetch,
    release: { ...release, sha256: '0'.repeat(64) },
    platform: 'linux',
  });
  await assert.rejects(changed.install(), /一致しません|did not match/);
  const longer = new PythonRuntime({
    dataDir,
    fetch: github(Buffer.concat([bytes, Buffer.from('x')])).fetch,
    release,
    platform: 'linux',
  });
  await assert.rejects(longer.install(), /一致しません|did not match/);
  // A redirect away from HTTPS is not followed.
  const plain = new PythonRuntime({
    dataDir,
    fetch: github(bytes, 'http://objects.example/uv').fetch,
    release,
    platform: 'linux',
  });
  await assert.rejects(plain.install(), /ダウンロードできません|Could not download/);
  const offline = new PythonRuntime({
    dataDir,
    fetch: (async () => {
      throw TypeError('fetch failed');
    }) as typeof fetch,
    release,
    platform: 'linux',
  });
  await assert.rejects(offline.install(), /ダウンロードできません|Could not download/);
  assert.equal(existsSync(path.join(dataDir, 'runtimes')), false);
});

test('on Windows uv.exe comes from the zip', async (t) => {
  const base = await folder(t);
  const zip = new JSZip();
  zip.file('uv.exe', 'MZ uv');
  zip.file('uvx.exe', 'MZ uvx');
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const dataDir = path.join(base, 'data');
  const python = new PythonRuntime({
    dataDir,
    fetch: github(bytes).fetch,
    release: described('uv-x86_64-pc-windows-msvc.zip', bytes),
    platform: 'win32',
  });
  const uv = await python.install();
  assert.equal(path.basename(uv), 'uv.exe');
  assert.equal(await readFile(uv, 'utf8'), 'MZ uv');
});
