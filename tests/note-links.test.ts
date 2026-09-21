import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { resolveLink } from '../src/host/links';
import { resolveNoteLink } from '../src/domain/note-links';
import { dispatchHost, type HostHandlers } from '../src/domain/host-requests';

async function fixture(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori links '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'Knowledge');
  await mkdir(root);
  const space = await files.register(root, 'リンクのKB', 'personal');
  const write = async (relative: string, text = '# note\n') => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  };
  return { base, root, files, space, write };
}

test('A link written in a note resolves against that note, not the knowledge base root', () => {
  const from = 'Knowledge_Base/wiki/topic.md';
  assert.deepEqual(resolveNoteLink(from, 'other.md'), {
    kind: 'internal',
    path: 'Knowledge_Base/wiki/other.md',
  });
  assert.deepEqual(resolveNoteLink(from, './other.md'), {
    kind: 'internal',
    path: 'Knowledge_Base/wiki/other.md',
  });
  assert.deepEqual(resolveNoteLink(from, '../decisions/2026-09-21.md'), {
    kind: 'internal',
    path: 'Knowledge_Base/decisions/2026-09-21.md',
  });
  // A heading in the target is navigation inside that page, not part of its identity.
  assert.deepEqual(resolveNoteLink(from, 'other.md#決定'), {
    kind: 'internal',
    path: 'Knowledge_Base/wiki/other.md',
  });
  // Editors percent-encode what a Markdown target cannot carry literally.
  assert.deepEqual(resolveNoteLink(from, '%E6%97%A5%E6%9C%AC%E8%AA%9E%20note.md'), {
    kind: 'internal',
    path: 'Knowledge_Base/wiki/日本語 note.md',
  });
  assert.deepEqual(resolveNoteLink('top.md', 'sub/deep/../page.md'), {
    kind: 'internal',
    path: 'sub/page.md',
  });
});

test('Only a relative path inside the knowledge base, or a web address, is followed', () => {
  const from = 'Knowledge_Base/wiki/topic.md';
  assert.deepEqual(resolveNoteLink(from, 'https://example.com/a?b=1'), {
    kind: 'external',
    url: 'https://example.com/a?b=1',
  });
  assert.deepEqual(resolveNoteLink(from, '#見出し'), { kind: 'anchor' });
  for (const href of [
    'mailto:someone@example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>',
    '//example.com/a',
    '/etc/passwd',
    'C:\\Windows\\system.ini',
    'sub\\page.md',
    '%E0%A4%A.md',
    '   ',
    '../../../../etc/passwd',
    'wiki/',
  ])
    assert.equal(
      resolveNoteLink(from, href).kind,
      'rejected',
      `${href} must not resolve to a path`,
    );
  // Leaving the knowledge base by one step too many is refused here; a folder inside
  // it resolves, and the host refuses it as something that is not a document.
  assert.equal(resolveNoteLink('top.md', '..').kind, 'rejected');
  assert.deepEqual(resolveNoteLink(from, '..'), {
    kind: 'internal',
    path: 'Knowledge_Base',
  });
});

test('The host answers what is actually at the link, through the space guards', async (t) => {
  const { root, files, space, write } = await fixture(t);
  await write('Knowledge_Base/wiki/topic.md', '# topic\n\n[次](other.md)\n');
  await write('Knowledge_Base/wiki/other.md');
  await write('Knowledge_Base/wiki/table.csv', 'id,label\n1,a\n');
  await mkdir(path.join(root, 'Knowledge_Base/wiki/folder'));
  const from = 'Knowledge_Base/wiki/topic.md';
  const link = (href: string) => resolveLink(files, space.scopeId, from, href);

  assert.deepEqual(await link('other.md'), {
    kind: 'file',
    path: 'Knowledge_Base/wiki/other.md',
    note: true,
  });
  assert.deepEqual(await link('table.csv'), {
    kind: 'file',
    path: 'Knowledge_Base/wiki/table.csv',
    note: false,
  });
  // A page that has not been written yet is missing, which is a fact about the
  // knowledge base rather than a failure to answer.
  assert.deepEqual(await link('planned.md'), {
    kind: 'missing',
    path: 'Knowledge_Base/wiki/planned.md',
  });
  assert.equal((await link('folder')).kind, 'rejected');
  assert.deepEqual(await link('https://example.com/'), {
    kind: 'external',
    url: 'https://example.com/',
  });
});

test('A link out of the space, or into another registered KB, is refused', async (t) => {
  const { base, root, files, space, write } = await fixture(t);
  await write('Knowledge_Base/wiki/topic.md');
  const outside = path.join(base, 'outside.md');
  await writeFile(outside, '# outside\n');
  await symlink(outside, path.join(root, 'Knowledge_Base/wiki/escape.md'));
  const nested = path.join(root, 'Knowledge_Base/nested');
  await mkdir(nested, { recursive: true });
  await writeFile(path.join(nested, 'inner.md'), '# inner\n');
  await files.register(nested, '入れ子のKB', 'personal');
  const from = 'Knowledge_Base/wiki/topic.md';

  // The symlink is a real entry here, so only the host's realpath check catches it.
  assert.equal((await resolveLink(files, space.scopeId, from, 'escape.md')).kind, 'rejected');
  assert.equal(
    (await resolveLink(files, space.scopeId, from, '../nested/inner.md')).kind,
    'rejected',
  );
});

test('Contents links are refused while the cloud connection is unverified', async (t) => {
  const { root, files, space, write } = await fixture(t);
  await write('Knowledge_Base/wiki/topic.md');
  await mkdir(path.join(root, 'contents/drive'), { recursive: true });
  await writeFile(path.join(root, 'contents/drive/report.md'), '# report\n');
  const resolved = await resolveLink(
    files,
    space.scopeId,
    'Knowledge_Base/wiki/topic.md',
    '../../contents/drive/report.md',
  );
  assert.equal(resolved.kind, 'rejected');
  assert.match(resolved.reason, /contents/);
});

test('The renderer reaches link resolution only through the validated request', async (t) => {
  const { files, space, write } = await fixture(t);
  await write('Knowledge_Base/wiki/topic.md');
  await write('Knowledge_Base/wiki/other.md');
  const handlers = {
    resolveLink: (scopeId: string, from: string, href: string) =>
      resolveLink(files, scopeId, from, href),
  } as unknown as HostHandlers;
  assert.deepEqual(
    await dispatchHost(handlers, 'resolveLink', [
      space.scopeId,
      'Knowledge_Base/wiki/topic.md',
      'other.md',
    ]),
    { kind: 'file', path: 'Knowledge_Base/wiki/other.md', note: true },
  );
  await assert.rejects(async () =>
    dispatchHost(handlers, 'resolveLink', ['not-a-uuid', 'topic.md', 'other.md']),
  );
  await assert.rejects(async () =>
    dispatchHost(handlers, 'resolveLink', [space.scopeId, 'topic.md', '']),
  );
});
