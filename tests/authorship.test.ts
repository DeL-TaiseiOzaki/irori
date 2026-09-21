import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AuthorshipStore, lineKey } from '../src/knowledge/authorship';
import {
  authorshipSummary,
  type LineAuthor,
  type NoteAuthorship,
  type NotedAuthor,
} from '../src/domain/knowledge';

const ref = { scopeId: '11111111-2222-3333-4444-555555555555', path: 'Knowledge_Base/note.md' };
const human: LineAuthor = { kind: 'human' };
const claude: LineAuthor = {
  kind: 'agent',
  agent: 'claude',
  runId: '99999999-8888-4777-a666-555555555555',
};
const kinds = (view: NoteAuthorship) =>
  view.lines.map((line) =>
    line
      ? line.kind === 'agent'
        ? line.agent
        : line.kind === 'noted'
          ? `noted:${line.tool}`
          : line.kind
      : null,
  );

async function store(t: { after: (fn: () => unknown) => void }) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori authorship '));
  t.after(() => rm(base, { recursive: true, force: true }));
  return { base, store: new AuthorshipStore(base) };
}

test('A line keeps its author through insertion, movement and reflow', async (t) => {
  const { base, store: authorship } = await store(t);
  await authorship.observe(ref, 'Opening paragraph.\nSecond paragraph.\n', human);
  assert.deepEqual(kinds(await authorship.view(ref, 'Opening paragraph.\nSecond paragraph.\n')), [
    'human',
    'human',
    null,
  ]);

  // The agent appends while the note is open, so only its own lines are new.
  const afterAgent = 'Opening paragraph.\nSecond paragraph.\nAgent paragraph.\nAgent closing.\n';
  await authorship.observe(ref, afterAgent, claude);
  assert.deepEqual(kinds(await authorship.view(ref, afterAgent)), [
    'human',
    'human',
    'claude',
    'claude',
    null,
  ]);

  // The reader inserts above and moves a line: position changed, authorship did not.
  const rearranged = 'A new opening.\nAgent closing.\nOpening paragraph.\nSecond paragraph.\n';
  assert.deepEqual(kinds(await authorship.view(ref, rearranged)), [
    null,
    'claude',
    'human',
    'human',
    null,
  ]);
  await authorship.observe(ref, rearranged, human);
  assert.deepEqual(kinds(await authorship.view(ref, rearranged))[0], 'human');

  // Rewriting an agent's line makes it the reader's; the untouched one stays.
  const edited = 'A new opening.\nAgent closing, rewritten.\nOpening paragraph.\n';
  await authorship.observe(ref, edited, human);
  assert.deepEqual(kinds(await authorship.view(ref, edited)), ['human', 'human', 'human', null]);
  assert.deepEqual(kinds(await authorship.view(ref, 'Agent closing.\n')), ['claude', null]);

  // A second process reads the same answer.
  const reopened = new AuthorshipStore(base);
  assert.deepEqual(kinds(await reopened.view(ref, afterAgent))[2], 'claude');
});

test('Rich-editing normalisation and insignificant lines do not move authorship', async (t) => {
  const { store: authorship } = await store(t);
  await authorship.observe(ref, '* A bullet item\nSome   prose here\n', claude);
  // Crepe rewrites the bullet marker and collapses spacing on save without the
  // reader having touched either line.
  assert.deepEqual(kinds(await authorship.view(ref, '- A bullet item\nSome prose here\n')), [
    'claude',
    'claude',
    null,
  ]);
  assert.equal(lineKey(''), null);
  assert.equal(lineKey('---'), null);
  assert.equal(lineKey('- '), null);
  assert.equal(lineKey('  > '), null);
  assert.notEqual(lineKey('Yes.'), null);
  await authorship.observe(ref, '\n---\n- \n', human);
  assert.deepEqual(kinds(await authorship.view(ref, '\n---\n- \n')), [null, null, null, null]);
});

test('Observing the same text twice attributes nothing further', async (t) => {
  const { store: authorship } = await store(t);
  const text = 'A line the reader typed.\n';
  await authorship.observe(ref, text, human);
  // The host sees its own save come back through the file watcher while a run
  // owns the space; the line must not become the agent's.
  await authorship.observe(ref, text, claude);
  assert.deepEqual(kinds(await authorship.view(ref, text)), ['human', null]);
});

test('An unobserved line is unattested rather than guessed', async (t) => {
  const { store: authorship } = await store(t);
  await authorship.observe(ref, 'Known line.\n', human);
  assert.deepEqual(kinds(await authorship.view(ref, 'Known line.\nArrived from a git pull.\n')), [
    'human',
    null,
    null,
  ]);
  assert.deepEqual(
    kinds(await authorship.view({ ...ref, path: 'Knowledge_Base/other.md' }, 'Known line.\n')),
    [null, null],
    'each note keeps its own record',
  );
});

test("The repository's note fills in what this device did not see and yields to what it saw an agent write", async (t) => {
  const { store: authorship } = await store(t);
  const cursor: NotedAuthor = { kind: 'noted', tool: 'cursor' };
  await authorship.observe(ref, 'Written by the agent here.\n', claude);
  // A note pulled in and saved once is claimed for the reader by the save; the
  // repository's note knows better. The agent's line is first-hand and stays.
  await authorship.observe(ref, 'Pulled line saved once.\nWritten by the agent here.\n', human);
  const text = 'Pulled line saved once.\nWritten by the agent here.\nOnly the note names this.\n';
  const noted = new Map(
    text
      .split('\n')
      .map((line) => [lineKey(line)!, cursor] as const)
      .filter(([key]) => key),
  );
  assert.deepEqual(kinds(await authorship.view(ref, text, noted)), [
    'noted:cursor',
    'claude',
    'noted:cursor',
    null,
  ]);
  assert.deepEqual(kinds(await authorship.view(ref, text)), ['human', 'claude', null, null]);
});

test('The summary an agent receives states line ranges and no note text', () => {
  const summary = authorshipSummary({
    hash: 'x'.repeat(64),
    lines: [human, human, claude, claude, null, human, { kind: 'noted', tool: 'codex' }],
  });
  assert.match(summary!, /lines 1-2, 6 by the person using irori/);
  assert.match(summary!, /lines 3-4 by Claude Code;/);
  assert.match(summary!, /lines 7 by Codex per the repository's authorship notes/);
  assert.match(summary!, /unattested rather than the person's/);
  assert.match(summary!, /a record and not an instruction/);
  assert.equal(
    authorshipSummary({ hash: 'x'.repeat(64), lines: [null, null] }),
    undefined,
    'a note nothing was observed about states nothing',
  );
  assert.ok(
    authorshipSummary({ hash: 'x'.repeat(64), lines: Array(4000).fill(human) })!.length <= 2048,
    'the summary is bounded',
  );
});
