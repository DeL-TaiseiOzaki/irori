import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { UpdateState } from '../src/domain/updates';
import { UpdateService, officialReleasesEndpoint, type UpdateInstaller } from '../src/host/updates';

const repository = 'https://github.com/DeL-TaiseiOzaki/irori';
const windowsInstaller = 'windows-x64-Setup.exe';
const macInstaller = 'macos-arm64.dmg';
function installer(tag: string, suffix: string) {
  const name = `irori-${tag.replace(/^v/, '').split('-')[0]}-${suffix}`;
  return {
    name,
    browser_download_url: `${repository}/releases/download/${tag}/${name}`,
    state: 'uploaded',
    size: 300000000,
  };
}
function release(tag = 'v0.1.4-preview.1', overrides: Record<string, unknown> = {}) {
  return {
    tag_name: tag,
    html_url: `${repository}/releases/tag/${tag}`,
    draft: false,
    prerelease: tag.includes('-'),
    assets: [installer(tag, windowsInstaller)],
    ...overrides,
  };
}
function fixture(
  data: unknown,
  options: Partial<ConstructorParameters<typeof UpdateService>[0]> = {},
) {
  const requests: { input: string; options?: RequestInit }[] = [];
  const service = new UpdateService({
    currentVersion: '0.1.3',
    platform: 'win32',
    arch: 'x64',
    fetch: async (input, init) => {
      requests.push({ input: String(input), options: init });
      return Response.json(data);
    },
    ...options,
  });
  return { service, requests };
}

test('update checks are explicit, fixed to the public endpoint, and include Windows previews', async () => {
  const { service, requests } = fixture([release('v0.1.2'), release()]);
  assert.equal(requests.length, 0);
  const result = await service.check();
  assert.equal(result.status, 'available');
  assert.equal(result.release?.tag, 'v0.1.4-preview.1');
  assert.equal(result.currentVersion, '0.1.3');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].input, officialReleasesEndpoint);
  assert.equal(requests[0].options?.redirect, 'error');
  assert.equal(requests[0].options?.credentials, 'omit');
  assert.equal(new Headers(requests[0].options?.headers).has('authorization'), false);
  const opened: string[] = [];
  await service.open('release', async (url) => {
    opened.push(url);
  });
  await service.open('download', async (url) => {
    opened.push(url);
  });
  assert.deepEqual(opened, [result.release?.releaseUrl, result.release?.downloadUrl]);
  assert.equal(requests.length, 1, 'opening the browser does not fetch or install an artifact');
});

test('installed core versions match delivery preview tags without offering an older build', async () => {
  for (const currentVersion of ['0.1.4', '0.1.5', '0.2.0', '1.0.0']) {
    const { service } = fixture([release()], { currentVersion });
    assert.equal((await service.check()).status, 'current', currentVersion);
  }
  const { service } = fixture([release('v0.1.4-preview.2')], { currentVersion: '0.1.4-preview.1' });
  assert.equal((await service.check()).status, 'available');
});

test('release ordering uses numeric versions and ignores drafts and unrelated prerelease channels', async () => {
  const { service } = fixture([
    release('v0.9.0'),
    release('v0.11.0-preview.1'),
    release('v0.10.0'),
    release('v0.12.0', { draft: true }),
    release('v1.0.0-beta.1'),
    release('v0.13.0', { prerelease: true }),
    release('v0.11.0-preview.2'),
  ]);
  assert.equal((await service.check()).release?.tag, 'v0.11.0-preview.2');
  const stable = fixture([release('v0.11.0-preview.2'), release('v0.11.0')]);
  assert.equal((await stable.service.check()).release?.tag, 'v0.11.0');
});

test('only published Windows x64 installers are considered compatible', async () => {
  const old = release('v0.1.3-preview.1');
  for (const assets of [
    [],
    [{ ...release().assets[0], state: 'new' }],
    [{ ...release().assets[0], name: 'irori-macos-arm64.dmg' }],
  ]) {
    const { service } = fixture([release('v0.2.0', { assets }), old]);
    assert.equal((await service.check()).release?.tag, old.tag_name);
  }
  const { service } = fixture([release('v0.2.0', { assets: [] })]);
  const result = await service.check();
  assert.equal(result.status, 'error');
  assert.equal(result.reason, 'unavailable');
});

test('targets without a published installer make no request and advertise no download', async () => {
  for (const [platform, arch] of [
    ['darwin', 'x64'],
    ['linux', 'x64'],
    ['win32', 'arm64'],
  ]) {
    const { service, requests } = fixture([release()], { platform, arch });
    const result = await service.check();
    assert.equal(result.status, 'unsupported');
    assert.equal(result.release, undefined);
    assert.equal(requests.length, 0);
    await assert.rejects(service.open('download', async () => assert.fail('must not open')));
  }
});

test('an Apple silicon Mac is offered the published disk image, not the Windows installer', async () => {
  const tag = 'v0.1.5-preview.2';
  const published = release(tag, {
    assets: [installer(tag, windowsInstaller), installer(tag, macInstaller)],
  });
  const { service, requests } = fixture([published], { platform: 'darwin', arch: 'arm64' });
  const result = await service.check();
  assert.equal(result.status, 'available');
  assert.equal(result.release?.tag, tag);
  assert.equal(
    result.release?.downloadUrl,
    `${repository}/releases/download/${tag}/irori-0.1.5-${macInstaller}`,
  );
  assert.equal(requests.length, 1);
  const opened: string[] = [];
  await service.open('download', async (url) => {
    opened.push(url);
  });
  assert.deepEqual(opened, [result.release?.downloadUrl]);
});

test('a release carrying only the other platform installer is not offered', async () => {
  const onMac = fixture([release('v0.1.5-preview.1')], { platform: 'darwin', arch: 'arm64' });
  const macResult = await onMac.service.check();
  assert.equal(macResult.status, 'error');
  assert.equal(macResult.reason, 'unavailable');
  const tag = 'v0.1.5-preview.2';
  const onWindows = fixture([release(tag, { assets: [installer(tag, macInstaller)] })]);
  const windowsResult = await onWindows.service.check();
  assert.equal(windowsResult.status, 'error');
  assert.equal(windowsResult.reason, 'unavailable');
});

test('release and download URLs must exactly match the official repository, tag and installer', async () => {
  for (const url of [
    'https://example.invalid/installer.exe',
    `${repository}.evil.invalid/releases/tag/v0.1.4-preview.1`,
    'javascript:alert(1)',
    `${release().html_url}?redirect=evil`,
    release().html_url.replace('https://', 'http://'),
    release().html_url.replace('github.com', 'user@github.com'),
  ]) {
    for (const item of [
      release(undefined, { html_url: url }),
      release(undefined, { assets: [{ ...release().assets[0], browser_download_url: url }] }),
    ]) {
      const { service } = fixture([item]);
      assert.equal((await service.check()).reason, 'unavailable');
      await assert.rejects(service.open('download', async () => assert.fail('must not open')));
    }
  }
  const { service } = fixture([release()]);
  await assert.rejects(service.open('release', async () => assert.fail('must check first')));
  await service.check();
  await assert.rejects(
    service.open('https://example.invalid' as 'release', async () => assert.fail('invalid target')),
  );
});

test('invalid response shapes and unsupported current versions are explicit errors', async () => {
  for (const data of [{}, [{ tag_name: 'v0.1.4' }], Array.from({ length: 101 }, () => release())]) {
    assert.equal((await fixture(data).service.check()).reason, 'invalid');
  }
  const badVersion = fixture([release()], { currentVersion: 'development' });
  assert.equal((await badVersion.service.check()).reason, 'invalid');
  assert.equal(badVersion.requests.length, 0);
  const malformed = fixture([], { fetch: async () => new Response('{') });
  assert.equal((await malformed.service.check()).reason, 'invalid');
});

test('offline, rate limiting, and HTTP failures return useful errors and can be retried', async () => {
  for (const status of [403, 429, 500]) {
    const { service } = fixture([], { fetch: async () => new Response('', { status }) });
    assert.equal((await service.check()).reason, status === 500 ? 'offline' : 'rate-limited');
  }
  let online = false;
  const { service } = fixture([], {
    fetch: async () => {
      if (!online) throw Error('private proxy detail must not reach UI');
      return Response.json([release()]);
    },
  });
  const failed = await service.check();
  assert.equal(failed.reason, 'offline');
  assert(!failed.detail.includes('proxy'));
  online = true;
  assert.equal((await service.check()).status, 'available');
  online = false;
  await service.check();
  await assert.rejects(
    service.open('download', async () => assert.fail('stale update must not open')),
  );
});

test('both declared and streamed response size are bounded', async () => {
  const oversize = ' '.repeat(2 * 1024 * 1024 + 1);
  for (const response of [
    new Response('[]', { headers: { 'content-length': String(oversize.length) } }),
    new Response(oversize),
  ]) {
    const { service } = fixture([], { fetch: async () => response });
    assert.equal((await service.check()).reason, 'invalid');
  }
});

test('the whole request has a deadline, including fetch and a stalled body stream', async () => {
  let cancelled = false;
  const stalled = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  for (const fetch of [
    async () => new Promise<Response>(() => {}),
    async () => new Response(stalled),
  ]) {
    const { service } = fixture([], { fetch, timeoutMs: 15 });
    assert.equal((await service.check()).reason, 'timeout');
  }
  assert(cancelled);
});

test('concurrent manual checks share one in-flight public request', async () => {
  let resolve!: (response: Response) => void;
  let requests = 0;
  const { service } = fixture([], {
    fetch: async () => {
      requests++;
      return new Promise<Response>((done) => {
        resolve = done;
      });
    },
  });
  const first = service.check();
  const second = service.check();
  assert.equal(first, second);
  assert.equal(requests, 1);
  resolve(Response.json([release()]));
  assert.equal((await second).status, 'available');
});

// Applying a release from inside the application.
const publishedBytes = Buffer.from(
  Array.from({ length: 300_000 }, (_value, index) => (index * 7919) % 251),
);
const digest = (algorithm: 'sha256' | 'sha1', bytes: Buffer) =>
  createHash(algorithm).update(bytes).digest('hex');
const download = (tag: string, name: string) => `${repository}/releases/download/${tag}/${name}`;
function uploaded(tag: string, name: string, size: number) {
  return { name, browser_download_url: download(tag, name), state: 'uploaded', size };
}
const windowsPackage = (tag: string) => `irori-${tag.slice(1).split('-')[0]}-full.nupkg`;
function releaseWith(tag: string, names: string[], packageSize = publishedBytes.length) {
  return release(tag, {
    assets: names.map((name) => uploaded(tag, name, name.endsWith('.txt') ? 200 : packageSize)),
  });
}
const fullWindowsRelease = (tag = 'v0.1.4-preview.1') =>
  releaseWith(tag, [
    `irori-${tag.slice(1).split('-')[0]}-${windowsInstaller}`,
    windowsPackage(tag),
    'SHA256SUMS.txt',
  ]);
// GitHub answers a release download with a redirect to its download host.
function chunked(bytes: Buffer, size = 65_536) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(new Uint8Array(bytes.subarray(offset, offset + size)));
      offset += size;
    },
  });
}
function publication(options: {
  releases?: unknown[];
  sums?: string;
  body?: () => Response;
  redirect?: (url: string) => string;
}) {
  const tag = 'v0.1.4-preview.1';
  const name = windowsPackage(tag);
  const requests: { url: string; init?: RequestInit }[] = [];
  const hosted = new Map<string, () => Response>([
    [
      'https://objects.example.test/sums',
      () => new Response(options.sums ?? `${digest('sha256', publishedBytes)}  ${name}\n`),
    ],
    [
      'https://objects.example.test/package',
      options.body ??
        (() =>
          new Response(chunked(publishedBytes), {
            headers: { 'content-length': String(publishedBytes.length) },
          })),
    ],
  ]);
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === officialReleasesEndpoint)
      return Response.json(options.releases ?? [fullWindowsRelease(tag)]);
    const redirect = options.redirect ?? ((to: string) => to);
    if (url === download(tag, 'SHA256SUMS.txt'))
      return new Response(null, {
        status: 302,
        headers: { location: redirect('https://objects.example.test/sums') },
      });
    if (url === download(tag, name))
      return new Response(null, {
        status: 302,
        headers: { location: redirect('https://objects.example.test/package') },
      });
    const target = hosted.get(url);
    return target ? target() : new Response('', { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, requests, name, tag };
}
async function installation(
  options: Partial<ConstructorParameters<typeof UpdateService>[0]> & {
    unavailable?: string;
    prepare?: (update: { file: string; version: string; size: number; sha1: string }) => void;
  } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), 'irori-update-test-'));
  const directory = path.join(root, 'updates');
  const staged: { file: string; version: string; size: number; sha1: string; bytes: Buffer }[] = [];
  const calls: string[] = [];
  const states: UpdateState[] = [];
  const installer: UpdateInstaller = {
    unavailable: async () => options.unavailable,
    cleanup: async () => {
      calls.push('cleanup');
    },
    prepare: async (update) => {
      calls.push('prepare');
      staged.push({ ...update, bytes: await readFile(update.file) });
      options.prepare?.(update);
    },
    restart: async () => {
      calls.push('restart');
    },
  };
  const service = new UpdateService({
    currentVersion: '0.1.3',
    platform: 'win32',
    arch: 'x64',
    installer,
    directory,
    onState: (state) => states.push(structuredClone(state)),
    ...options,
  });
  return { service, directory, staged, calls, states, root };
}

test('an available release says whether this installation can apply it itself', async () => {
  const offered = async (releases: unknown[], options: Parameters<typeof installation>[0] = {}) => {
    const { fetch } = publication({ releases });
    const { service } = await installation({ fetch, ...options });
    const result = await service.check();
    assert.equal(result.status, 'available');
    return result.install;
  };
  assert.deepEqual(await offered([fullWindowsRelease()]), { available: true });
  const tag = 'v0.1.4-preview.1';
  for (const names of [
    [`irori-0.1.4-${windowsInstaller}`, 'SHA256SUMS.txt'],
    [`irori-0.1.4-${windowsInstaller}`, windowsPackage(tag)],
  ]) {
    const install = await offered([releaseWith(tag, names)]);
    assert.equal(install?.available, false);
    assert.match(install?.available === false ? install.detail : '', /インストーラーを取得/);
  }
  const refused = await offered([fullWindowsRelease()], {
    unavailable: 'この場所では更新できません。',
  });
  assert.deepEqual(refused, { available: false, detail: 'この場所では更新できません。' });
  const browserOnly = await offered([fullWindowsRelease()], { installer: undefined });
  assert.equal(browserOnly?.available, false);
  // A Mac applies the same disk image a person would download.
  const mac = await offered([releaseWith(tag, [`irori-0.1.4-${macInstaller}`, 'SHA256SUMS.txt'])], {
    platform: 'darwin',
    arch: 'arm64',
  });
  assert.deepEqual(mac, { available: true });
  const current = await installation({ fetch: publication({}).fetch, currentVersion: '0.1.4' });
  assert.equal((await current.service.check()).install, undefined);
});

test('an update is downloaded through the redirect, verified, staged and then removed', async () => {
  const { fetch, requests, name } = publication({});
  const { service, directory, staged, calls, states } = await installation({ fetch });
  assert.equal((await service.check()).install?.available, true);
  assert.equal(await service.install(), true);
  assert.equal(staged.length, 1);
  assert.equal(path.basename(staged[0].file), name);
  assert.equal(staged[0].version, '0.1.4');
  assert.equal(staged[0].size, publishedBytes.length);
  assert.equal(staged[0].sha1, digest('sha1', publishedBytes));
  assert(staged[0].bytes.equals(publishedBytes));
  await assert.rejects(stat(directory), 'the downloaded bytes are not kept once staged');
  const phases = states.map((state) => state.install.phase);
  assert.deepEqual([...new Set(phases)], ['idle', 'downloading', 'preparing', 'ready']);
  const progress = states.flatMap((state) =>
    state.install.phase === 'downloading' ? [state.install.received] : [],
  );
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), publishedBytes.length);
  assert.deepEqual(service.state().install, { phase: 'ready', version: '0.1.4' });
  for (const request of requests.slice(1)) {
    assert.equal(request.init?.redirect, 'manual');
    assert.equal(request.init?.credentials, 'omit');
    assert.equal(new Headers(request.init?.headers).has('authorization'), false);
  }
  assert.equal(await service.install(), true, 'a prepared update is not downloaded again');
  assert.equal(staged.length, 1);
  await service.restart();
  assert.deepEqual(calls, ['prepare', 'restart']);
  // A shutdown that stopped after the switch is retried without switching again.
  await service.restart();
  assert.equal(await service.install(), true);
  assert.deepEqual(calls, ['prepare', 'restart']);
});

test('bytes that differ from the published checksum or size are never staged', async () => {
  const tag = 'v0.1.4-preview.1';
  const name = windowsPackage(tag);
  const altered = Buffer.from(publishedBytes);
  altered[1000] ^= 1;
  const cases: Parameters<typeof publication>[0][] = [
    { sums: `${digest('sha256', altered)}  ${name}\n` },
    { sums: `${digest('sha256', publishedBytes)}  another.nupkg\n` },
    { sums: 'not a checksum line\n' },
    { body: () => new Response(chunked(Buffer.concat([publishedBytes, Buffer.from([1])]))) },
    { body: () => new Response(chunked(publishedBytes.subarray(1))) },
    {
      body: () =>
        new Response(chunked(publishedBytes), {
          headers: { 'content-length': String(publishedBytes.length + 1) },
        }),
    },
    { body: () => new Response('', { status: 500 }) },
  ];
  for (const options of cases) {
    const { fetch } = publication(options);
    const { service, staged, directory } = await installation({ fetch });
    await service.check();
    assert.equal(await service.install(), false);
    const state = service.state().install;
    assert.equal(state.phase, 'failed');
    assert.match(state.phase === 'failed' ? state.detail : '', /。/);
    assert.equal(staged.length, 0);
    await assert.rejects(stat(directory));
    await assert.rejects(service.restart(), 'a failed update cannot restart');
  }
});

test('downloads follow HTTPS redirects only, and not endlessly', async () => {
  for (const redirect of [
    (to: string) => to.replace('https://', 'http://'),
    (to: string) => to.replace('https://', 'https://user:secret@'),
  ]) {
    const { fetch, requests } = publication({ redirect });
    const { service, staged } = await installation({ fetch });
    await service.check();
    assert.equal(await service.install(), false);
    assert.equal(staged.length, 0);
    assert(!requests.some((request) => request.url.startsWith('http://')));
  }
  let hops = 0;
  const looping = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === officialReleasesEndpoint) return Response.json([fullWindowsRelease()]);
    hops++;
    return new Response(null, { status: 302, headers: { location: `${url}?again` } });
  }) as typeof globalThis.fetch;
  const { service } = await installation({ fetch: looping });
  await service.check();
  assert.equal(await service.install(), false);
  assert(hops <= 6, `followed ${hops} redirects`);
});

test('a download can be cancelled, and one that stops receiving is abandoned', async () => {
  const stalled = () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(publishedBytes.subarray(0, 1000)));
        },
      }),
    );
  const cancelled = await installation({ fetch: publication({ body: stalled }).fetch });
  await cancelled.service.check();
  const pending = cancelled.service.install();
  assert.equal(cancelled.service.install(), pending, 'one download at a time');
  while (
    cancelled.service.state().install.phase !== 'downloading' ||
    (cancelled.service.state().install as { received: number }).received === 0
  )
    await new Promise((resolve) => setTimeout(resolve, 5));
  await cancelled.service.cancel();
  assert.equal(await pending, false);
  assert.deepEqual(cancelled.service.state().install, { phase: 'idle' });
  assert.equal(cancelled.staged.length, 0);
  await assert.rejects(stat(cancelled.directory));

  const idle = await installation({ fetch: publication({ body: stalled }).fetch, idleMs: 30 });
  await idle.service.check();
  assert.equal(await idle.service.install(), false);
  const state = idle.service.state().install;
  assert.equal(state.phase, 'failed');
  assert.match(state.phase === 'failed' ? state.detail : '', /ダウンロードが進まなく/);
  assert.equal(idle.staged.length, 0);
});

test('installing needs a check that offered an update this installation can apply', async () => {
  const { fetch } = publication({});
  const unchecked = await installation({ fetch });
  await assert.rejects(unchecked.service.install(), /更新を確認/);
  await assert.rejects(unchecked.service.restart(), /準備ができていません/);
  const current = await installation({ fetch, currentVersion: '0.1.4' });
  await current.service.check();
  await assert.rejects(current.service.install(), /更新を確認/);
  const refused = await installation({ fetch, unavailable: '更新できません。' });
  await refused.service.check();
  await assert.rejects(refused.service.install(), /更新を確認/);
  const failing = await installation({
    fetch,
    prepare: () => {
      throw Error('Squirrel が失敗しました。');
    },
  });
  await failing.service.check();
  assert.equal(await failing.service.install(), false);
  assert.deepEqual(failing.service.state().install, {
    phase: 'failed',
    version: '0.1.4',
    detail: 'Squirrel が失敗しました。',
  });
  await assert.rejects(failing.service.restart());
});

test('automatic checks start after a delay, repeat, report through state and can stop', async () => {
  let checks = 0;
  const { fetch } = publication({});
  const counting = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === officialReleasesEndpoint) checks++;
    return fetch(input, init);
  }) as typeof globalThis.fetch;
  const { service, states } = await installation({ fetch: counting });
  const stop = service.watch({ delayMs: 20, intervalMs: 40 });
  assert.equal(checks, 0, 'nothing is requested before the delay');
  while (checks < 2) await new Promise((resolve) => setTimeout(resolve, 5));
  stop();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const seen = checks;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(checks, seen, 'stopped checks do not run');
  assert.equal(states.at(-1)?.check?.status, 'available');
  // A prepared update keeps the release it was prepared for.
  assert.equal(await service.install(), true);
  const before = checks;
  const again = service.watch({ delayMs: 1, intervalMs: 5 });
  await new Promise((resolve) => setTimeout(resolve, 60));
  again();
  assert.equal(checks, before);
});

test('cleanup removes an unfinished download and what the installer left behind', async () => {
  const { service, directory, calls } = await installation({});
  await mkdir(path.join(directory, '0.1.4'), { recursive: true });
  await writeFile(path.join(directory, '0.1.4', 'partial'), 'x');
  await service.cleanup();
  await assert.rejects(stat(directory));
  assert.deepEqual(calls, ['cleanup']);
});

test('a server that keeps sending past the published size is stopped, not read to the end', async () => {
  let pulled = 0;
  const endless = () =>
    new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulled > publishedBytes.length * 50) return controller.close();
          const chunk = new Uint8Array(65_536);
          pulled += chunk.byteLength;
          controller.enqueue(chunk);
        },
      }),
    );
  const { service, staged } = await installation({ fetch: publication({ body: endless }).fetch });
  await service.check();
  assert.equal(await service.install(), false);
  assert.equal(staged.length, 0);
  assert(pulled < publishedBytes.length * 2, `read ${pulled} bytes`);
});
