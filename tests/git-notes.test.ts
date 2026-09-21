import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { GitService } from '../src/git/service';
import { AuthorshipStore } from '../src/knowledge/authorship';
import { formatNote, parseNote, rangeLines, sessionId } from '../src/git/notes';
import { authorshipSummary, type LineAuthor, type NoteAuthorship } from '../src/domain/knowledge';

const human: LineAuthor = { kind: 'human' };
const runId = '99999999-8888-4777-a666-555555555555';
const claude: LineAuthor = { kind: 'agent', agent: 'claude', runId };
const session = sessionId('claude', runId);
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
const identity = [
  '-c',
  'user.name=Git fixture',
  '-c',
  'user.email=fixture@example.invalid',
  '-c',
  'commit.gpgsign=false',
];
function git(root: string, ...args: string[]) {
  return execFileSync('git', [...identity, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}
/** A note in the standard's own layout, as git-ai writes it. */
const note = (attestations: string, metadata: object) =>
  `${attestations}---\n${JSON.stringify(metadata, null, 2)}\n`;
function addNote(root: string, oid: string, content: string) {
  execFileSync('git', [...identity, 'notes', '--ref=ai', 'add', '-f', '-F', '-', oid], {
    cwd: root,
    input: content,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
const notesOf = (root: string) =>
  git(root, 'notes', '--ref=ai', 'list').split('\n').filter(Boolean).length;

async function fixture(t: any) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori notes 日本語 '));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(root);
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Git fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  const space = await files.register(root, 'Personal', 'personal');
  await writeFile(path.join(root, '日本語 note.md'), '# Notes\n\nOriginal\n');
  await writeFile(path.join(root, 'other.md'), '# Other\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'Initial notes');
  const authorship = new AuthorshipStore(files.dataDir);
  const service = new GitService(files, () => true, authorship);
  t.after(async () => {
    await service.close();
    await rm(base, { recursive: true, force: true });
  });
  // The reader saved both notes through irori before any run touched them.
  const ref = { scopeId: space.scopeId, path: '日本語 note.md' };
  await authorship.observe(ref, '# Notes\n\nOriginal\n', human);
  await authorship.observe({ scopeId: space.scopeId, path: 'other.md' }, '# Other\n', human);
  return { base, root, files, space, service, authorship, ref, id: space.scopeId };
}
async function commit(service: GitService, id: string, paths: string[], message: string) {
  for (const p of paths) {
    const diff = await service.diff(id, p, false);
    await service.stage(id, p, true, diff.version);
  }
  return service.commit(id, message, (await service.status(id)).version);
}
/** A run appends two paragraphs to the fixture note and the reader adds a closing line. */
async function agentEdits(f: Awaited<ReturnType<typeof fixture>>) {
  const before = await readFile(path.join(f.root, f.ref.path), 'utf8');
  const byAgent = before + 'Agent paragraph one.\nAgent paragraph two.\n';
  await f.authorship.observe(f.ref, byAgent, claude);
  const text = byAgent + 'Reader afterword.\n';
  await f.authorship.observe(f.ref, text, human);
  await writeFile(path.join(f.root, f.ref.path), text);
  return text;
}

test("A commit through irori carries the standard's note for the lines an agent wrote, and a device with no record reads it back", async (t) => {
  const f = await fixture(t);
  const { service, root, base, authorship, ref, id } = f;
  // The reader's own lines are never attested: a save cannot tell what was
  // typed from what merely passed through it, so that commit carries no note.
  await writeFile(path.join(root, 'other.md'), '# Other\n\nReader only.\n');
  await authorship.observe({ scopeId: id, path: 'other.md' }, '# Other\n\nReader only.\n', human);
  let status = await commit(service, id, ['other.md'], 'Reader only');
  assert.equal(status.notice, undefined);
  assert.equal(notesOf(root), 0);

  await agentEdits(f);
  await writeFile(path.join(root, 'other.md'), '# Other\n\nReader again.\n');
  status = await commit(service, id, [ref.path, 'other.md'], 'Agent lines');
  assert.equal(status.notice, undefined);
  const head = git(root, 'rev-parse', 'HEAD');
  const raw = git(root, 'notes', '--ref=ai', 'show', head);
  assert.equal(
    session,
    's_' + createHash('sha256').update(`claude:${runId}`).digest('hex').slice(0, 14),
  );
  assert.match(raw, new RegExp(`^"日本語 note.md"\n  ${session}::t_[0-9a-f]{14} 4-5\n---\n`));
  const parsed = parseNote(raw)!;
  assert.deepEqual(
    parsed.files.map((file) => file.path),
    ['日本語 note.md'],
    'a file the reader alone changed is not named',
  );
  assert.deepEqual(parsed.metadata, {
    schema_version: 'authorship/3.0.0',
    base_commit_sha: head,
    prompts: {},
    sessions: { [session]: { agent_id: { tool: 'claude', id: runId, model: 'unknown' } } },
  });
  assert.equal(notesOf(root), 1);

  // Another device has no record of its own; the note names the agent's lines
  // wherever they have moved since, and nothing else.
  const other = new AuthorshipStore(path.join(base, 'other-device'));
  const rearranged =
    'Agent paragraph two.\n# Notes\nNew on this device.\nAgent paragraph one.\nReader afterword.\n';
  const noted = await service.noted(id, ref.path);
  const view = await other.view(ref, rearranged, noted);
  assert.deepEqual(kinds(view), ['noted:claude', null, null, 'noted:claude', null, null]);
  assert.match(
    authorshipSummary(view)!,
    /lines 1, 4 by Claude Code per the repository's authorship notes/,
  );
  assert.deepEqual(kinds(await other.view(ref, rearranged)), Array(6).fill(null));
});

test("A note in the standard's own format is read by content: session and legacy keys, quoted paths; human keys and unknown sessions are not", async (t) => {
  const { service, root, base, ref, id } = await fixture(t);
  const initial = git(root, 'rev-parse', 'HEAD');
  addNote(
    root,
    initial,
    note(
      '"日本語 note.md"\n' +
        '  s_a1a1a1a1a1a1a1::t_b2b2b2b2b2b2b2 1\n' +
        '  abcd1234abcd1234 3\n' +
        '  h_c3c3c3c3c3c3c3 1-3\n' +
        '  s_ffffffffffffff::t_b2b2b2b2b2b2b2 3\n' +
        'other.md\n' +
        '  s_a1a1a1a1a1a1a1::t_d4d4d4d4d4d4d4 1\n',
      {
        schema_version: 'authorship/3.0.0',
        git_ai_version: '1.4.5',
        base_commit_sha: initial,
        prompts: {
          abcd1234abcd1234: {
            agent_id: { tool: 'claude', id: 'conv_abc123', model: 'claude-sonnet-4-5' },
            total_additions: 1,
            total_deletions: 0,
            accepted_lines: 1,
            overriden_lines: 0,
          },
        },
        humans: { h_c3c3c3c3c3c3c3: { author: 'Fixture <fixture@example.invalid>' } },
        sessions: { s_a1a1a1a1a1a1a1: { agent_id: { tool: 'cursor', id: 'c', model: 'm' } } },
      },
    ),
  );
  const fresh = new AuthorshipStore(path.join(base, 'fresh'));
  // Lines are matched by their text, so the reordered note still resolves; the
  // human key changes nothing and the session the metadata lacks is skipped.
  assert.deepEqual(
    kinds(
      await fresh.view(
        ref,
        'Original\n\n# Notes\nTyped since.\n',
        await service.noted(id, ref.path),
      ),
    ),
    ['noted:claude', null, 'noted:cursor', null, null],
  );
  assert.deepEqual(
    kinds(
      await fresh.view(
        { scopeId: id, path: 'other.md' },
        '# Other\n',
        await service.noted(id, 'other.md'),
      ),
    ),
    ['noted:cursor', null],
  );
  // A later commit rewrites the attested line and carries an unreadable note:
  // the rewritten line loses the claim, the malformed note is ignored.
  await writeFile(path.join(root, ref.path), '# Notes\n\nOriginal, revised\n');
  git(root, 'commit', '-am', 'Revise');
  addNote(root, git(root, 'rev-parse', 'HEAD'), 'no divider here');
  await writeFile(path.join(root, ref.path), '# Notes\n\nOriginal, revised twice\n');
  git(root, 'commit', '-am', 'Revise again');
  addNote(root, git(root, 'rev-parse', 'HEAD'), 'x.md\n  s_1::t_2 1\n---\nnot json');
  assert.deepEqual(
    kinds(
      await fresh.view(
        ref,
        '# Notes\n\nOriginal, revised twice\nOriginal\n',
        await service.noted(id, ref.path),
      ),
    ),
    ['noted:cursor', null, null, 'noted:claude', null],
  );
});

test("A note another tool attached to the commit keeps every entry it had, with irori's after them; one irori cannot read is left alone", async (t) => {
  const f = await fixture(t);
  const { service, root, ref, id } = f;
  const hook = path.join(root, '.git/hooks/post-commit');
  const theirs = note(
    'other.md\n  s_11111111111111::t_22222222222222 1\n"日本語 note.md"\n  h_33333333333333 1\n',
    {
      schema_version: 'authorship/3.0.0',
      git_ai_version: '1.9.9',
      base_commit_sha: 'theirs',
      prompts: {},
      humans: { h_33333333333333: { author: 'Fixture <fixture@example.invalid>' } },
      sessions: { s_11111111111111: { agent_id: { tool: 'cursor', id: 'c1', model: 'm' } } },
    },
  );
  await writeFile(
    hook,
    `#!/bin/sh\ncat <<'NOTE' | git notes --ref=ai add -f -F - HEAD\n${theirs}NOTE\n`,
  );
  await chmod(hook, 0o700);
  await agentEdits(f);
  await writeFile(path.join(root, 'other.md'), '# Other\n\nReader again.\n');
  let status = await commit(service, id, [ref.path, 'other.md'], 'Both tools');
  assert.equal(status.notice, undefined);
  const merged = parseNote(git(root, 'notes', '--ref=ai', 'show', 'HEAD'))!;
  assert.deepEqual(
    merged.files.map((file) => [file.path, file.entries.map((e) => e.key.split('::')[0])]),
    [
      ['other.md', ['s_11111111111111']],
      ['日本語 note.md', ['h_33333333333333', session]],
    ],
  );
  assert.equal(merged.files[1].entries[1].ranges, '4-5');
  assert.deepEqual(
    { ...merged.metadata, sessions: undefined },
    {
      schema_version: 'authorship/3.0.0',
      git_ai_version: '1.9.9',
      base_commit_sha: 'theirs',
      prompts: {},
      humans: { h_33333333333333: { author: 'Fixture <fixture@example.invalid>' } },
      sessions: undefined,
    },
  );
  assert.deepEqual(Object.keys(merged.metadata.sessions as object).sort(), [
    's_11111111111111',
    session,
  ]);
  assert.equal(notesOf(root), 1);

  await writeFile(
    hook,
    '#!/bin/sh\necho "not a note at all" | git notes --ref=ai add -f -F - HEAD\n',
  );
  await agentEdits(f);
  status = await commit(service, id, [ref.path], 'Unreadable note');
  assert.match(status.notice!, /読めない/);
  assert.equal(git(root, 'notes', '--ref=ai', 'show', 'HEAD'), 'not a note at all');
  assert.equal(git(root, 'log', '-1', '--format=%s'), 'Unreadable note');
});

test("Fetch brings the remote's notes in, Push carries this device's, and diverged notes merge keeping this side's version", async (t) => {
  const f = await fixture(t);
  const { service, root, base, ref, id } = f;
  const remote = path.join(base, 'remote.git'),
    peer = path.join(base, 'peer');
  git(base, 'init', '--bare', '--initial-branch=main', remote);
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-u', 'origin', 'main');
  git(base, 'clone', remote, peer);
  const initial = git(root, 'rev-parse', 'HEAD');

  // A remote without notes is fetched as before: nothing to say, nothing created.
  let status = await service.sync(id, 'fetch', (await service.status(id)).version);
  assert.equal(status.notice, undefined);
  assert.equal(git(root, 'for-each-ref', 'refs/notes/'), '');

  await writeFile(path.join(peer, 'other.md'), '# Other\n\nCodex wrote this at the peer.\n');
  git(peer, 'add', 'other.md');
  git(peer, 'commit', '-m', 'Peer change');
  const peerCommit = git(peer, 'rev-parse', 'HEAD');
  const peerNote = (id: string) =>
    note(`other.md\n  s_c0dec0dec0dec0::t_11111111111111 3\n`, {
      schema_version: 'authorship/3.0.0',
      base_commit_sha: peerCommit,
      prompts: {},
      sessions: { s_c0dec0dec0dec0: { agent_id: { tool: 'codex', id, model: 'unknown' } } },
    });
  addNote(peer, peerCommit, peerNote('first'));
  git(peer, 'push', 'origin', 'main', 'refs/notes/ai:refs/notes/ai');
  status = await service.sync(id, 'pull', (await service.status(id)).version);
  assert.equal(status.notice, undefined);
  assert.equal(
    git(root, 'rev-parse', 'refs/notes/ai'),
    git(root, 'rev-parse', 'refs/notes/ai-remote/origin'),
  );
  assert.deepEqual(
    kinds(
      await f.authorship.view(
        { scopeId: id, path: 'other.md' },
        await readFile(path.join(root, 'other.md'), 'utf8'),
        await service.noted(id, 'other.md'),
      ),
    ),
    ['human', null, 'noted:codex', null],
    "the heading this device saw the reader save stays the reader's",
  );

  await agentEdits(f);
  status = await commit(service, id, [ref.path], 'Agent lines here');
  const local = git(root, 'rev-parse', 'HEAD');
  assert.equal(notesOf(root), 2);
  // The peer revises its note and annotates the initial commit, publishing only
  // notes: this device's branch push lands, its notes push does not.
  addNote(peer, peerCommit, peerNote('revised'));
  addNote(
    peer,
    initial,
    note('other.md\n  s_c0dec0dec0dec0::t_22222222222222 1\n', {
      schema_version: 'authorship/3.0.0',
      base_commit_sha: initial,
      prompts: {},
      sessions: {
        s_c0dec0dec0dec0: { agent_id: { tool: 'codex', id: 'revised', model: 'unknown' } },
      },
    }),
  );
  git(peer, 'push', 'origin', 'refs/notes/ai:refs/notes/ai');
  const published = git(remote, 'rev-parse', 'refs/notes/ai');
  status = await service.sync(id, 'push', (await service.status(id)).version);
  assert.match(status.notice!, /Fetch/);
  assert.equal(git(remote, 'rev-parse', 'main'), local);
  assert.equal(git(remote, 'rev-parse', 'refs/notes/ai'), published);

  // The peer then annotates this device's commit with a note of its own. Fetch
  // merges as git-ai does: a note only the peer changed arrives as the peer
  // wrote it, a note both sides wrote keeps this side's version, and the next
  // push carries everything.
  git(peer, 'pull', '--ff-only');
  addNote(
    peer,
    local,
    note('"日本語 note.md"\n  s_c0dec0dec0dec0::t_33333333333333 1\n', {
      schema_version: 'authorship/3.0.0',
      base_commit_sha: local,
      prompts: {},
      sessions: {
        s_c0dec0dec0dec0: { agent_id: { tool: 'codex', id: 'competing', model: 'unknown' } },
      },
    }),
  );
  git(peer, 'push', 'origin', 'refs/notes/ai:refs/notes/ai');
  status = await service.sync(id, 'fetch', (await service.status(id)).version);
  assert.equal(status.notice, undefined);
  assert.equal(notesOf(root), 3);
  assert.match(git(root, 'notes', '--ref=ai', 'show', peerCommit), /"id": "revised"/);
  assert.match(git(root, 'notes', '--ref=ai', 'show', local), new RegExp(`${session}::t_`));
  status = await service.sync(id, 'push', (await service.status(id)).version);
  assert.equal(status.notice, undefined);
  assert.equal(git(remote, 'rev-parse', 'refs/notes/ai'), git(root, 'rev-parse', 'refs/notes/ai'));
  const shared = parseNote(git(remote, 'notes', '--ref=ai', 'show', local))!;
  assert.deepEqual(shared.files[0].entries[0].key.split('::')[0], session);
  assert.equal(git(remote, 'for-each-ref', '--format=%(refname)', 'refs/notes/'), 'refs/notes/ai');
});

test("The note format round-trips, quotes paths with spaces, re-emits other tools' ranges as written, and is read in linear time", () => {
  const text =
    '"a b.md"\n  s_1::t_2 3,1-2\nc.md\n  h_3 5\n  abcd1234abcd1234 7-9,12\nempty.md\n---\n{"schema_version":"authorship/3.0.0","prompts":{}}';
  const parsed = parseNote(text)!;
  assert.deepEqual(
    parsed.files.map((file) => file.path),
    ['a b.md', 'c.md'],
  );
  assert.equal(
    formatNote(parsed),
    '"a b.md"\n  s_1::t_2 3,1-2\nc.md\n  h_3 5\n  abcd1234abcd1234 7-9,12\n---\n{\n  "schema_version": "authorship/3.0.0",\n  "prompts": {}\n}\n',
  );
  assert.deepEqual(rangeLines('3,1-2,9-12', 10), [1, 2, 3, 9, 10]);
  assert.equal(parseNote('a.md\n  key 1-\n---\n{}'), undefined);
  assert.equal(parseNote('a.md\n  key 1\n---\n[]'), undefined);
  const start = performance.now();
  assert.equal(parseNote('x.md\n  key ' + '1-'.repeat(60000) + '\n---\n{}'), undefined);
  assert.equal(rangeLines('1,'.repeat(8000) + '1', 500).length, 1);
  // Overlapping ranges from someone else's note cost the file's length, not their product.
  assert.equal(rangeLines('1-999999999,'.repeat(1300) + '1', 1_000_000).length, 1_000_000);
  const many = 'a.md\n' + '  s_x::t_y 1-3\n'.repeat(50000) + '---\n{"prompts":{}}';
  assert.equal(formatNote(parseNote(many)!).split('\n').length, 50006);
  assert.ok(performance.now() - start < 1000);
});
