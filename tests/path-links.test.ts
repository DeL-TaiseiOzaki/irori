import test from 'node:test';
import assert from 'node:assert/strict';
import { locatePath, writtenPath } from '../src/domain/path-links';
import { lineTarget, sourceMatch } from '../src/editor/search-navigation';

const roots = [
  { scopeId: 'a', root: '/home/me/vaults/notes' },
  { scopeId: 'b', root: '/home/me/vaults/notes-work/' },
  { scopeId: 'nested', root: '/home/me/vaults/notes/projects/inner' },
  { scopeId: 'win', root: 'C:\\Users\\me\\Vault' },
];

test('link destinations name files with the line Claude Code or Codex points at', () => {
  assert.deepEqual(writtenPath('src/app/main.tsx#L42', 'href'), {
    path: 'src/app/main.tsx',
    line: 42,
  });
  assert.deepEqual(writtenPath('src/a.ts#L42-L51', 'href'), { path: 'src/a.ts', line: 42 });
  assert.deepEqual(writtenPath('/home/me/x.md:7', 'href'), { path: '/home/me/x.md', line: 7 });
  assert.deepEqual(writtenPath('/home/me/x.md:7:3', 'href'), {
    path: '/home/me/x.md',
    line: 7,
    column: 3,
  });
  assert.deepEqual(writtenPath('wiki/My%20Page.md', 'href'), { path: 'wiki/My Page.md' });
  assert.deepEqual(writtenPath('file:///home/me/x.md#L3', 'href'), {
    path: '/home/me/x.md',
    line: 3,
  });
  assert.deepEqual(writtenPath('file:///C:/Users/me/Vault/a.md', 'href'), {
    path: 'C:/Users/me/Vault/a.md',
  });
  assert.deepEqual(writtenPath('C:\\Users\\me\\Vault\\a.md:2', 'href'), {
    path: 'C:/Users/me/Vault/a.md',
    line: 2,
  });
  assert.deepEqual(writtenPath('wiki/a.md#heading', 'href'), { path: 'wiki/a.md' });
});

test('web addresses and other schemes are not paths', () => {
  for (const value of [
    'https://example.com/a.md',
    'mailto:me@example.com',
    'javascript:alert(1)',
    'file://server/share/a.md',
    '//example.com/a.md',
    '~/notes/a.md',
    'wiki/',
    '#heading',
    '',
  ])
    assert.equal(writtenPath(value, 'href'), undefined, value);
});

test('inline code is a path only when it reads as a file', () => {
  assert.deepEqual(writtenPath('wiki/topic.md:12', 'code'), { path: 'wiki/topic.md', line: 12 });
  assert.deepEqual(writtenPath('AGENTS.md', 'code'), { path: 'AGENTS.md' });
  assert.deepEqual(writtenPath('journal/2026-10-13.md', 'code'), {
    path: 'journal/2026-10-13.md',
  });
  assert.deepEqual(writtenPath('src/foo.custom', 'code'), { path: 'src/foo.custom' });
  for (const value of [
    'npm run build',
    'irori.app',
    'example.com',
    'v0.2.13',
    'e.g.',
    'foo(bar.md)',
    '--file=a.md',
    'src/app',
    '$HOME/a.md',
    'wiki/My%20Page.md x',
  ])
    assert.equal(writtenPath(value, 'code'), undefined, value);
});

test('a relative path is read from the writing vault, an absolute one from any vault', () => {
  assert.deepEqual(locatePath({ path: 'wiki/a.md', line: 3 }, roots, 'a'), {
    scopeId: 'a',
    path: 'wiki/a.md',
    line: 3,
  });
  assert.deepEqual(locatePath({ path: './wiki/../journal/b.md' }, roots, 'a'), {
    scopeId: 'a',
    path: 'journal/b.md',
  });
  assert.deepEqual(locatePath({ path: '../notes-work/c.md' }, roots, 'a'), {
    scopeId: 'b',
    path: 'c.md',
  });
  assert.deepEqual(locatePath({ path: '/home/me/vaults/notes-work/c.md' }, roots), {
    scopeId: 'b',
    path: 'c.md',
  });
  // The innermost vault holding the file takes it.
  assert.deepEqual(locatePath({ path: '/home/me/vaults/notes/projects/inner/d.md' }, roots), {
    scopeId: 'nested',
    path: 'd.md',
  });
  assert.deepEqual(locatePath({ path: 'c:/users/me/vault/wiki/e.md' }, roots), {
    scopeId: 'win',
    path: 'wiki/e.md',
  });
});

test('paths outside every vault, or relative without a vault, lead nowhere', () => {
  assert.equal(locatePath({ path: '/etc/passwd' }, roots), undefined);
  assert.equal(locatePath({ path: '/home/me/vaults/notes' }, roots), undefined);
  assert.equal(locatePath({ path: '/home/me/vaults/notesx/a.md' }, roots), undefined);
  assert.equal(locatePath({ path: 'wiki/a.md' }, roots), undefined);
  assert.equal(locatePath({ path: '../../../../../etc/passwd' }, roots, 'a'), undefined);
  assert.equal(locatePath({ path: '../../outside.md' }, roots, 'a'), undefined);
});

test('a pointed line is selected by its words, past the marks a rich view hides', () => {
  const text = '# Title\r\n\n- [ ] Buy **milk** today\n> quoted line\nplain `code` here\n';
  assert.deepEqual(lineTarget(text, 1, true), {
    query: 'Title',
    line: 1,
    preview: '',
    column: 2,
  });
  assert.equal(lineTarget(text, 2, true), undefined);
  assert.equal(lineTarget(text, 3, true)?.query, 'Buy');
  assert.equal(lineTarget(text, 4, true)?.query, 'quoted line');
  assert.equal(lineTarget(text, 5, true)?.query, 'plain');
  assert.equal(lineTarget(text, 99, true), undefined);
  // Source shows the whole line, which the source view selects.
  const whole = lineTarget(text, 3, false)!;
  assert.equal(whole.query, '- [ ] Buy **milk** today');
  const match = sourceMatch(text, whole)!;
  assert.equal(text.slice(match.from, match.to), whole.query);
});
