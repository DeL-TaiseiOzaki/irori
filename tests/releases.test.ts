import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseSchema } from '../website/release';

test('download manifests reject unsafe, mismatched and unversioned installers before building', () => {
  const manifest = (
    url: string,
    version: string | null = '0.1.0',
    notes: string | null = 'https://example.invalid/releases/tag/v0.1.0',
  ) => ({
    version,
    notes,
    downloads: { 'windows-x64': { url, size: '100 MB' }, 'macos-arm64': null, 'macos-x64': null },
  });
  assert(releaseSchema.safeParse(manifest('https://example.invalid/windows.exe')).success);
  for (const url of [
    'http://example.invalid/windows.exe',
    'https://user:pass@example.invalid/windows.exe',
    'javascript:alert(1)',
    'https://example.invalid/mac.dmg',
  ])
    assert.equal(releaseSchema.safeParse(manifest(url)).success, false);
  assert.equal(
    releaseSchema.safeParse(manifest('https://example.invalid/windows.exe', null)).success,
    false,
  );
});

test('a published manifest must name release notes that the page can link safely', () => {
  const manifest = (version: string | null, notes: string | null) => ({
    version,
    notes,
    downloads: { 'windows-x64': null, 'macos-arm64': null, 'macos-x64': null },
  });
  assert(releaseSchema.safeParse(manifest(null, null)).success);
  // A version without notes would leave the published page linking an older release.
  assert.equal(releaseSchema.safeParse(manifest('0.1.0', null)).success, false);
  assert.equal(
    releaseSchema.safeParse(manifest(null, 'https://example.invalid/releases')).success,
    false,
  );
  for (const notes of ['http://example.invalid/releases', 'javascript:alert(1)', 'not-a-url'])
    assert.equal(releaseSchema.safeParse(manifest('0.1.0', notes)).success, false);
});
