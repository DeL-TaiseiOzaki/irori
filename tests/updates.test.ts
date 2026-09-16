import test from 'node:test';
import assert from 'node:assert/strict';
import { UpdateService, officialReleasesEndpoint } from '../src/host/updates';

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
