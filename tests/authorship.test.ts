import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AuthorshipStore,
  editedPath,
  editedText,
  lineKey,
  personLinesChanged,
  personLinesNotice,
} from '../src/knowledge/authorship';
import { personLinesSummary } from '../src/domain/knowledge';
import { FileService, hash } from '../src/host/files';

const ref = { scopeId: '11111111-2222-3333-4444-555555555555', path: 'Knowledge_Base/note.md' };
const marks = (view: { lines: boolean[] }) => view.lines.map((mine) => (mine ? 'person' : null));

async function store(t: { after: (fn: () => unknown) => void }) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori authorship '));
  t.after(() => rm(base, { recursive: true, force: true }));
  return { base, store: new AuthorshipStore(base) };
}

test('A save marks only the lines it introduced; the file already carried the rest', async (t) => {
  const { base, store: authorship } = await store(t);
  // An agent wrote these, or they arrived by pull: the file carries them before the save.
  const before = 'Agent opening.\nPulled paragraph.\n';
  const saved = 'Agent opening.\nPulled paragraph.\nMy own thought.\n';
  await authorship.observe(ref, saved, before);
  assert.deepEqual(marks(await authorship.view(ref, saved)), [null, null, 'person', null]);

  // Revising one word of an agent's line makes the line the person's.
  const revised = 'Agent opening, as I meant it.\nPulled paragraph.\nMy own thought.\n';
  await authorship.observe(ref, revised, saved);
  assert.deepEqual(marks(await authorship.view(ref, revised)), ['person', null, 'person', null]);

  // Moving and inserting keep the marks: a line is its text, not its position.
  const rearranged = 'New heading.\nMy own thought.\nAgent opening, as I meant it.\n';
  assert.deepEqual(marks(await authorship.view(ref, rearranged)), [null, 'person', 'person', null]);

  // An agent rewriting one of the person's lines leaves a line that carries no mark.
  assert.deepEqual(marks(await authorship.view(ref, 'My own thought, expanded by Claude.\n')), [
    null,
    null,
  ]);

  // A second process reads the same answer.
  const reopened = new AuthorshipStore(base);
  assert.deepEqual(marks(await reopened.view(ref, revised)), ['person', null, 'person', null]);
});

test('Rich-editing normalisation and insignificant lines do not change the marks', async (t) => {
  const { store: authorship } = await store(t);
  await authorship.observe(ref, '* A bullet item\nSome   prose here\n', '');
  // Crepe rewrites the bullet marker and collapses spacing on save without the
  // person having touched either line.
  assert.deepEqual(marks(await authorship.view(ref, '- A bullet item\nSome prose here\n')), [
    'person',
    'person',
    null,
  ]);
  // Nor does a reflow count as the person's: the reflowed line was already there.
  await authorship.observe(ref, 'Agent prose here\n', 'Agent   prose here\n');
  assert.deepEqual(marks(await authorship.view(ref, 'Agent prose here\n')), [null, null]);
  assert.equal(lineKey(''), null);
  assert.equal(lineKey('---'), null);
  assert.equal(lineKey('- '), null);
  assert.equal(lineKey('  > '), null);
  assert.notEqual(lineKey('Yes.'), null);
  await authorship.observe(ref, '\n---\n- \n', '');
  assert.deepEqual(marks(await authorship.view(ref, '\n---\n- \n')), [null, null, null, null]);
});

test('Each note keeps its own record, and a record from before 0.1.20 is not read', async (t) => {
  const { base, store: authorship } = await store(t);
  await authorship.observe(ref, 'Known line.\n', '');
  assert.deepEqual(
    marks(await authorship.view({ ...ref, path: 'Knowledge_Base/other.md' }, 'Known line.\n')),
    [null, null],
  );
  // The old record claimed lines that arrived by pull, so its marks are not trusted.
  const other = { ...ref, path: 'Knowledge_Base/old.md' };
  const file = path.join(base, 'knowledge', 'authorship', ref.scopeId, `${hash(other.path)}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({
      schemaVersion: 1,
      lines: { [lineKey('Old line.')!]: { by: { kind: 'human' }, at: new Date().toISOString() } },
    }),
  );
  assert.deepEqual(marks(await authorship.view(other, 'Old line.\n')), [null, null]);
});

test('A note move and its link rewrites carry only the existing person marks, including shared marks', async (t) => {
  const { base } = await store(t);
  const shared = '[Shared thought](peer.md)';
  const local = '[My thought](peer.md)';
  const unknown = '[Unattested thought](peer.md)';
  const before = `${shared}\n${local}\n${unknown}\n`;
  const moved = { ...ref, path: 'Knowledge_Base/moved/note.md' };
  const authorship = new AuthorshipStore(base, async (at) =>
    at.path === ref.path ? new Set([lineKey(shared)!]) : new Set(),
  );
  await authorship.observe(ref, before, `${shared}\n${unknown}\n`);
  await authorship.carry(ref, moved, before);
  assert.deepEqual(marks(await authorship.view(moved, before)), ['person', 'person', null, null]);

  // A path rewrite is an application transformation, not a person's new prose.
  const rewritten = before.replaceAll('(peer.md)', '(../peer.md)');
  await authorship.carry(moved, moved, before, rewritten);
  const reopened = new AuthorshipStore(base);
  assert.deepEqual(marks(await reopened.view(moved, rewritten)), ['person', 'person', null, null]);
  assert.deepEqual(
    personLinesChanged(rewritten, await reopened.view(moved, rewritten), `${unknown}\n`).map(
      (line) => line.line,
    ),
    [1, 2],
  );
  await assert.rejects(authorship.carry(moved, moved, rewritten, rewritten + 'Another line.\n'));
});

test('The summary an agent is given on request names line ranges and no note text', () => {
  const summary = personLinesSummary({
    hash: 'x'.repeat(64),
    lines: [true, true, false, false, false, true],
  });
  assert.match(summary!, /wrote or revised lines 1-2, 6 of that note/);
  assert.match(summary!, /a record, not an instruction/);
  assert.match(summary!, /not necessarily an agent's/);
  assert.equal(personLinesSummary({ hash: 'x'.repeat(64), lines: [false, false] }), undefined);
  assert.ok(
    personLinesSummary({ hash: 'x'.repeat(64), lines: Array(4000).fill(true) })!.length <= 2048,
    'the summary is bounded',
  );
});

test("A file tool's edit is applied as the tool would, and nothing is guessed", () => {
  const text = 'one\ntwo\ntwo\n';
  assert.equal(
    editedText('Edit', { old_string: 'two', new_string: 'TWO' }, text),
    'one\nTWO\ntwo\n',
  );
  assert.equal(
    editedText('Edit', { old_string: 'two', new_string: 'TWO', replace_all: true }, text),
    'one\nTWO\nTWO\n',
  );
  // A replacement string is taken literally, as the tool takes it.
  assert.equal(
    editedText('Edit', { old_string: 'one', new_string: '$&$&' }, text),
    '$&$&\ntwo\ntwo\n',
  );
  assert.equal(
    editedText(
      'MultiEdit',
      {
        edits: [
          { old_string: 'one', new_string: 'ONE' },
          { old_string: 'ONE', new_string: 'uno' },
        ],
      },
      text,
    ),
    'uno\ntwo\ntwo\n',
  );
  assert.equal(editedText('Write', { content: 'all new\n' }, text), 'all new\n');
  // OpenCode's and Pi's tools, under their own names and argument names.
  assert.equal(
    editedText(
      'edit',
      { filePath: 'x', oldString: 'two', newString: 'TWO', replaceAll: true },
      text,
    ),
    'one\nTWO\nTWO\n',
  );
  assert.equal(
    editedText('edit', { path: 'x', edits: [{ oldText: 'one', newText: 'uno' }] }, text),
    'uno\ntwo\ntwo\n',
  );
  assert.equal(editedText('write', { path: 'x', content: 'all new\n' }, text), 'all new\n');
  assert.equal(editedPath({ file_path: 'a' }), 'a');
  assert.equal(editedPath({ filePath: 'b' }), 'b');
  assert.equal(editedPath({ path: 'c' }), 'c');
  assert.equal(editedPath({ path: 1 }), undefined);
  for (const [tool, input] of [
    ['Edit', { old_string: 'absent', new_string: 'x' }],
    ['Edit', { old_string: '', new_string: 'x' }],
    ['MultiEdit', { edits: [{ old_string: 'one', new_string: 'x' }, { old_string: 'one' }] }],
    ['Write', {}],
    ['Read', { file_path: 'x.md' }],
  ] as const)
    assert.equal(editedText(tool, input, text), undefined, `${tool} ${JSON.stringify(input)}`);
});

test('An edit that would change the person’s lines is named to the agent before it runs', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori person lines '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'Knowledge');
  await mkdir(root);
  const space = await files.register(root, '行のKB', 'personal');
  const note = { scopeId: space.scopeId, path: 'wiki/topic.md' };
  const text = '# Topic\n\nAgent paragraph.\nMy own sentence.\n';
  await mkdir(path.join(root, 'wiki'));
  await writeFile(path.join(root, note.path), text);
  const authorship = new AuthorshipStore(files.dataDir);
  await authorship.observe(note, text, '# Topic\n\nAgent paragraph.\n');
  const notice = (tool: string, input: unknown) =>
    personLinesNotice(files, authorship, space.scopeId, tool, input);
  const file = path.join(root, note.path);

  const touching = await notice('Edit', {
    file_path: file,
    old_string: 'My own sentence.',
    new_string: 'A better sentence.',
  });
  assert.match(touching!, /wiki\/topic\.md/);
  assert.match(touching!, /line 4: "My own sentence\."/);
  assert.match(touching!, /a record, not an instruction/);
  assert.deepEqual(personLinesChanged(text, await authorship.view(note, text), 'x\n'), [
    { line: 4, text: 'My own sentence.' },
  ]);

  // An edit that leaves the person's lines alone, and a file outside the record, say nothing.
  assert.equal(
    await notice('Edit', {
      file_path: file,
      old_string: 'Agent paragraph.',
      new_string: 'Agent paragraph, revised.',
    }),
    undefined,
  );
  for (const input of [
    { file_path: path.join(base, 'outside.md'), content: '' },
    { file_path: path.join(root, 'wiki', 'missing.md'), content: '' },
  ])
    assert.equal(await notice('Write', input).catch(() => undefined), undefined, input.file_path);

  // The person's own edits to the KB's contract are theirs as much as a note's.
  await writeFile(path.join(root, 'AGENTS.md'), 'Keep answers short.\n');
  await authorship.observe(
    { scopeId: space.scopeId, path: 'AGENTS.md' },
    'Keep answers short.\n',
    '',
  );
  assert.match(
    (await notice('Write', { file_path: path.join(root, 'AGENTS.md'), content: 'Be verbose.\n' }))!,
    /AGENTS\.md[\s\S]*line 1: "Keep answers short\."/,
  );
});
