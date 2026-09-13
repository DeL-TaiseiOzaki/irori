import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseSchema } from '../website/release';

test('download manifests reject unsafe, mismatched and unversioned installers before building', () => {
  const manifest = (url: string, version: string | null = '0.1.0') => ({
    version,
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
