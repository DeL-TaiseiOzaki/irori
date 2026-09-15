import test from 'node:test';
import assert from 'node:assert/strict';
import { webAddress, externalUrl } from '../src/domain/links';
import { hostArguments } from '../src/domain/host-requests';

test('ordinary web addresses from a reply are accepted and normalised', () => {
  assert.equal(webAddress('https://example.com/docs')?.href, 'https://example.com/docs');
  assert.equal(webAddress('http://example.com')?.href, 'http://example.com/');
  assert.equal(
    webAddress('https://例え.テスト/ページ?q=日本語')?.protocol,
    'https:',
    'internationalised hosts and queries stay openable',
  );
});

test('every other scheme is refused, so a reply cannot reach the device', () => {
  for (const value of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,<script>alert(1)</script>',
    'mailto:someone@example.com',
    'irori://open',
    'vscode://file/etc/passwd',
    '//example.com',
    '/notes/README.md',
    'example.com',
    '',
    'https://',
    `https://example.com/${'x'.repeat(4096)}`,
  ])
    assert.equal(webAddress(value), undefined, `${value || '(empty)'} must not be openable`);
});

test('the request validator rejects the same values before they reach the host', () => {
  assert.equal(externalUrl.safeParse('https://example.com').success, true);
  for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'notes/README.md'])
    assert.equal(externalUrl.safeParse(value).success, false, `${value} must not validate`);
});

test('openUrl is registered, so the preload allowlist carries it', () => {
  assert.ok('openUrl' in hostArguments);
  assert.equal(hostArguments.openUrl.safeParse(['https://example.com']).success, true);
  assert.equal(hostArguments.openUrl.safeParse(['file:///etc/passwd']).success, false);
  assert.equal(hostArguments.openUrl.safeParse([]).success, false);
});
