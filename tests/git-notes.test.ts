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
import { formatNote, humanId, parseNote, rangeLines } from '../src/git/notes';
import { personLinesSummary, type NoteAuthorship } from '../src/domain/knowledge';

const committer = 'Git fixture <fixture@example.invalid>';
const person = humanId(committer);
const marked = (view: NoteAuthorship) =>
  view.lines.flatMap((mine, index) => (mine ? [index + 1] : []));
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
  const noted = (ref: { scopeId: string; path: string }) => service.noted(ref.scopeId, ref.path);
  const authorship = new AuthorshipStore(files.dataDir, noted);
  const service: GitService = new GitService(files, () => true, authorship);
  t.after(async () => {
    await service.close();
    await rm(base, { recursive: true, force: true });
  });
  const ref = { scopeId: space.scopeId, path: '日本語 note.md' };
  /** Another device: no record of its own, the same repository's notes. */
  const elsewhere = new AuthorshipStore(path.join(base, 'other-device'), noted);
  return {
    base,
    root,
    files,
    space,
    service,
    authorship,
    elsewhere,
    ref,
    id: space.scopeId,
    noted,
  };
}
async function commit(service: GitService, id: string, paths: string[], message: string) {
  for (const p of paths) {
    const diff = await service.diff(id, p, false);
    await service.stage(id, p, true, diff.version);
  }
  return service.commit(id, message, (await service.status(id)).version);
}
/** A run appends two paragraphs to the fixture note and the person saves a closing line. */
async function edits(f: Awaited<ReturnType<typeof fixture>>) {
  const before = await readFile(path.join(f.root, f.ref.path), 'utf8');
  const byAgent = before + 'Agent paragraph one.\nAgent paragraph two.\n';
  const text = byAgent + 'Person afterword.\n';
  await f.authorship.observe(f.ref, text, byAgent);
  await writeFile(path.join(f.root, f.ref.path), text);
  return text;
}

test("A commit through irori names the person's lines as the committer's, and a device with no record reads them back", async (t) => {
  const f = await fixture(t);
  const { service, root, ref, id, elsewhere } = f;
  // An agent's lines alone are never attested, so that commit carries no note.
  await writeFile(path.join(root, 'other.md'), '# Other\n\nAgent only.\n');
  let status = await commit(service, id, ['other.md'], 'Agent only');
  assert.equal(status.notice, undefined);
  assert.equal(notesOf(root), 0);

  await edits(f);
  await writeFile(path.join(root, 'other.md'), '# Other\n\nAgent again.\n');
  status = await commit(service, id, [ref.path, 'other.md'], 'Person lines');
  assert.equal(status.notice, undefined);
  const head = git(root, 'rev-parse', 'HEAD');
  const raw = git(root, 'notes', '--ref=ai', 'show', head);
  assert.equal(person, 'h_' + createHash('sha256').update(committer).digest('hex').slice(0, 14));
  assert.equal(raw.split('---')[0], `"日本語 note.md"\n  ${person} 6\n`);
  assert.deepEqual(parseNote(raw)!.metadata, {
    schema_version: 'authorship/3.0.0',
    base_commit_sha: head,
    prompts: {},
    humans: { [person]: { author: committer } },
  });
  assert.equal(notesOf(root), 1);

  // Another device names the line wherever it has moved since, and nothing else.
  const rearranged = 'Person afterword.\n# Notes\nNew on that device.\nAgent paragraph one.\n';
  const view = await elsewhere.view(ref, rearranged);
  assert.deepEqual(marked(view), [1]);
  assert.match(personLinesSummary(view)!, /A person wrote or revised lines 1 of that note/);
  assert.match(personLinesSummary(view)!, /recorded in the repository's authorship notes/);
  assert.deepEqual(
    marked(await new AuthorshipStore(path.join(f.base, 'no-notes')).view(ref, rearranged)),
    [],
  );
});

test("A note in the standard's own format is read by content: human keys, quoted paths; session and legacy keys are not", async (t) => {
  const { service, root, ref, id, elsewhere } = await fixture(t);
  const initial = git(root, 'rev-parse', 'HEAD');
  addNote(
    root,
    initial,
    note(
      '"日本語 note.md"\n' +
        '  s_a1a1a1a1a1a1a1::t_b2b2b2b2b2b2b2 1\n' +
        '  abcd1234abcd1234 1\n' +
        '  h_c3c3c3c3c3c3c3 3\n' +
        'other.md\n' +
        '  h_c3c3c3c3c3c3c3 1\n',
      {
        schema_version: 'authorship/3.0.0',
        git_ai_version: '1.4.5',
        base_commit_sha: initial,
        prompts: {
          abcd1234abcd1234: { agent_id: { tool: 'claude', id: 'conv', model: 'm' } },
        },
        humans: { h_c3c3c3c3c3c3c3: { author: 'Someone <someone@example.invalid>' } },
        sessions: { s_a1a1a1a1a1a1a1: { agent_id: { tool: 'cursor', id: 'c', model: 'm' } } },
      },
    ),
  );
  // Lines are matched by their text, so the reordered note still resolves.
  assert.deepEqual(marked(await elsewhere.view(ref, 'Original\n\n# Notes\nTyped since.\n')), [1]);
  assert.deepEqual(
    marked(await elsewhere.view({ scopeId: id, path: 'other.md' }, '# Other\n')),
    [1],
  );
  // Later commits rewrite the attested line and carry unreadable notes: the
  // rewritten line loses the claim, the malformed notes are ignored.
  await writeFile(path.join(root, ref.path), '# Notes\n\nOriginal, revised\n');
  git(root, 'commit', '-am', 'Revise');
  addNote(root, git(root, 'rev-parse', 'HEAD'), 'no divider here');
  await writeFile(path.join(root, ref.path), '# Notes\n\nOriginal, revised twice\n');
  git(root, 'commit', '-am', 'Revise again');
  addNote(root, git(root, 'rev-parse', 'HEAD'), 'x.md\n  h_1 1\n---\nnot json');
  assert.deepEqual(
    marked(await elsewhere.view(ref, '# Notes\n\nOriginal, revised twice\nOriginal\n')),
    [4],
  );
  assert.equal((await service.noted(id, ref.path)).size, 1);
});

test("A note another tool attached to the commit keeps every entry it had, with the person's last; one irori cannot read is left alone", async (t) => {
  const f = await fixture(t);
  const { service, root, ref, id } = f;
  const hook = path.join(root, '.git/hooks/post-commit');
  const theirs = note(
    `other.md\n  s_11111111111111::t_22222222222222 1\n"日本語 note.md"\n  ${person} 1\n  s_11111111111111::t_22222222222222 4-5\n`,
    {
      schema_version: 'authorship/3.0.0',
      git_ai_version: '1.9.9',
      base_commit_sha: 'theirs',
      prompts: {},
      humans: { h_33333333333333: { author: 'Other <other@example.invalid>' } },
      sessions: { s_11111111111111: { agent_id: { tool: 'cursor', id: 'c1', model: 'm' } } },
    },
  );
  await writeFile(
    hook,
    `#!/bin/sh\ncat <<'NOTE' | git notes --ref=ai add -f -F - HEAD\n${theirs}NOTE\n`,
  );
  await chmod(hook, 0o700);
  await edits(f);
  let status = await commit(service, id, [ref.path], 'Both tools');
  assert.equal(status.notice, undefined);
  const merged = parseNote(git(root, 'notes', '--ref=ai', 'show', 'HEAD'))!;
  assert.deepEqual(
    merged.files.map((file) => [file.path, file.entries.map((e) => `${e.key} ${e.ranges}`)]),
    [
      ['other.md', ['s_11111111111111::t_22222222222222 1']],
      // The same person's entry is replaced by one naming both its line and
      // the one this device saw; it comes last, as git-ai reads entries.
      ['日本語 note.md', ['s_11111111111111::t_22222222222222 4-5', `${person} 1,6`]],
    ],
  );
  assert.deepEqual(merged.metadata, {
    schema_version: 'authorship/3.0.0',
    git_ai_version: '1.9.9',
    base_commit_sha: 'theirs',
    prompts: {},
    humans: {
      h_33333333333333: { author: 'Other <other@example.invalid>' },
      [person]: { author: committer },
    },
    sessions: { s_11111111111111: { agent_id: { tool: 'cursor', id: 'c1', model: 'm' } } },
  });
  assert.equal(notesOf(root), 1);

  await writeFile(
    hook,
    '#!/bin/sh\necho "not a note at all" | git notes --ref=ai add -f -F - HEAD\n',
  );
  await edits(f);
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

  await writeFile(path.join(peer, 'other.md'), '# Other\n\nA collaborator wrote this.\n');
  git(peer, 'add', 'other.md');
  git(peer, 'commit', '-m', 'Peer change');
  const peerCommit = git(peer, 'rev-parse', 'HEAD');
  const collaborator = 'h_c011ab0c011ab0';
  const peerNote = (author: string) =>
    note(`other.md\n  ${collaborator} 3\n`, {
      schema_version: 'authorship/3.0.0',
      base_commit_sha: peerCommit,
      prompts: {},
      humans: { [collaborator]: { author } },
    });
  addNote(peer, peerCommit, peerNote('Collaborator <c@example.invalid>'));
  git(peer, 'push', 'origin', 'main', 'refs/notes/ai:refs/notes/ai');
  status = await service.sync(id, 'pull', (await service.status(id)).version);
  assert.equal(status.notice, undefined);
  assert.equal(
    git(root, 'rev-parse', 'refs/notes/ai'),
    git(root, 'rev-parse', 'refs/notes/ai-remote/origin'),
  );
  assert.deepEqual(
    marked(
      await f.authorship.view(
        { scopeId: id, path: 'other.md' },
        await readFile(path.join(root, 'other.md'), 'utf8'),
      ),
    ),
    [3],
    "the collaborator's line arrives as a person's",
  );

  await edits(f);
  status = await commit(service, id, [ref.path], 'Person lines here');
  const local = git(root, 'rev-parse', 'HEAD');
  assert.equal(notesOf(root), 2);
  // The peer revises its note and annotates the initial commit, publishing only
  // notes: this device's branch push lands, its notes push does not.
  addNote(peer, peerCommit, peerNote('Collaborator, revised <c@example.invalid>'));
  addNote(
    peer,
    initial,
    note(`other.md\n  ${collaborator} 1\n`, {
      schema_version: 'authorship/3.0.0',
      base_commit_sha: initial,
      prompts: {},
      humans: { [collaborator]: { author: 'Collaborator <c@example.invalid>' } },
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
    note(`"日本語 note.md"\n  ${collaborator} 1\n`, {
      schema_version: 'authorship/3.0.0',
      base_commit_sha: local,
      prompts: {},
      humans: { [collaborator]: { author: 'Collaborator <c@example.invalid>' } },
    }),
  );
  git(peer, 'push', 'origin', 'refs/notes/ai:refs/notes/ai');
  status = await service.sync(id, 'fetch', (await service.status(id)).version);
  assert.equal(status.notice, undefined);
  assert.equal(notesOf(root), 3);
  assert.match(git(root, 'notes', '--ref=ai', 'show', peerCommit), /revised/);
  assert.match(git(root, 'notes', '--ref=ai', 'show', local), new RegExp(`${person} 6`));
  status = await service.sync(id, 'push', (await service.status(id)).version);
  assert.equal(status.notice, undefined);
  assert.equal(git(remote, 'rev-parse', 'refs/notes/ai'), git(root, 'rev-parse', 'refs/notes/ai'));
  const shared = parseNote(git(remote, 'notes', '--ref=ai', 'show', local))!;
  assert.equal(shared.files[0].entries[0].key, person);
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
