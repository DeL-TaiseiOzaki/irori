import test from 'node:test';
import assert from 'node:assert/strict';
import { manifestFor, sizeLabel, type PublishedAsset } from '../website/manifest';

const base = 'https://github.com/DeL-TaiseiOzaki/irori/releases';
const release = {
  tag_name: 'v0.2.1-preview.1',
  html_url: `${base}/tag/v0.2.1-preview.1`,
  draft: false,
  prerelease: true,
};
const asset = (name: string, size: number, state = 'uploaded'): PublishedAsset => ({
  name,
  size,
  state,
  browser_download_url: `${base}/download/v0.2.1-preview.1/${name}`,
});
// The files v0.2.1-preview.1 was published with.
const published = [
  asset('irori-0.2.1-full.nupkg', 175376329),
  asset('irori-0.2.1-macos-arm64.dmg', 141844720),
  asset('irori-0.2.1-windows-x64-Setup.exe', 176206848),
  asset('SHA256SUMS.txt', 283),
];

test('The generated manifest matches the one written by hand for 0.2.1', () => {
  assert.deepEqual(manifestFor(release, published), {
    version: '0.2.1',
    notes: `${base}/tag/v0.2.1-preview.1`,
    downloads: {
      'windows-x64': {
        url: `${base}/download/v0.2.1-preview.1/irori-0.2.1-windows-x64-Setup.exe`,
        size: '168.0 MiB',
      },
      'macos-arm64': {
        url: `${base}/download/v0.2.1-preview.1/irori-0.2.1-macos-arm64.dmg`,
        size: '135.3 MiB',
      },
    },
  });
  assert.equal(sizeLabel(1048576), '1.0 MiB');
});

test('An installer still uploading is not offered, and a release without one fails', () => {
  const partial = published.map((item) =>
    item.name.endsWith('.dmg') ? { ...item, state: 'starter' } : item,
  );
  assert.equal(manifestFor(release, partial).downloads['macos-arm64'], null);
  assert.throws(
    () =>
      manifestFor(
        release,
        published.filter((item) => !/\.(dmg|exe)$/.test(item.name)),
      ),
    /no uploaded installer/,
  );
});

test('Only a published preview can be offered', () => {
  assert.throws(() => manifestFor({ ...release, draft: true }, published), /not a published/);
  assert.throws(() => manifestFor({ ...release, prerelease: false }, published), /not a published/);
  assert.throws(
    () => manifestFor({ ...release, tag_name: 'v0.2.1' }, published),
    /not a preview tag/,
  );
});
