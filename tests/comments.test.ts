import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import {
  addNoteComment,
  commentsCount,
  moveNoteComments,
  readNoteComments,
  removeNoteComment,
} from '../src/host/comments';
import { commentsFile } from '../src/domain/comments';
import {
  brainsCommandPreamble,
  brainsPreamble,
  commentsPointer,
  commentsSummary,
} from '../prompts';
import { hostArguments } from '../src/domain/host-requests';
import { nearest, positionsOf, quoteHead, sourceLineOf } from '../src/editor/search-navigation';

const git = { userEmail: async () => 'alice@example.com' };

async function hibachi(t: { after: (fn: () => unknown) => void }) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori comments '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'コメントの KB');
  await mkdir(path.join(root, 'wiki'), { recursive: true });
  await writeFile(path.join(root, 'wiki', 'topic.md'), '# Topic\n\nA claim.\nAnother claim.\n');
  await writeFile(path.join(root, 'AGENTS.md'), '# Rules\n');
  const space = await files.register(root, 'Comments', 'personal');
  return { root, files, scopeId: space.scopeId };
}

test('A comment is kept in the hibachi beside the file it is about, with who and when', async (t) => {
  const { root, files, scopeId } = await hibachi(t);
  assert.deepEqual(await readNoteComments(files, scopeId, 'wiki/topic.md'), []);
  const [first] = await addNoteComment(files, git, scopeId, 'wiki/topic.md', {
    body: '  Cite a source here.  ',
    quote: 'A claim.',
    line: 3,
  });
  assert.equal(first.body, 'Cite a source here.');
  assert.equal(first.quote, 'A claim.');
  assert.equal(first.line, 3);
  assert.equal(first.by, 'human:alice');
  assert.ok(!Number.isNaN(Date.parse(first.at)));
  const whole = await addNoteComment(files, git, scopeId, 'wiki/topic.md', {
    body: 'Split this note.',
    line: 9,
  });
  // Without a quote the comment is about the whole file, and a line means nothing.
  assert.equal(whole[1].quote, undefined);
  assert.equal(whole[1].line, undefined);

  const file = path.join(root, '.irori', 'comments', 'wiki', 'topic.md.json');
  assert.equal(commentsFile('wiki/topic.md'), '.irori/comments/wiki/topic.md.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.note, 'wiki/topic.md');
  assert.deepEqual(
    saved.comments.map((comment: { body: string }) => comment.body),
    ['Cite a source here.', 'Split this note.'],
  );
  // The note itself is untouched.
  assert.equal(
    await readFile(path.join(root, 'wiki', 'topic.md'), 'utf8'),
    '# Topic\n\nA claim.\nAnother claim.\n',
  );
  // Any Markdown file of the hibachi takes comments, the Schema's included.
  await addNoteComment(files, git, scopeId, 'AGENTS.md', { body: 'Too long.' });
  assert.deepEqual(await commentsCount(files, scopeId), { comments: 3, files: 2 });
});

test('Resolving the last comment removes its file and the folders it leaves empty', async (t) => {
  const { root, files, scopeId } = await hibachi(t);
  const [comment] = await addNoteComment(files, git, scopeId, 'wiki/topic.md', { body: 'One.' });
  const [, second] = await addNoteComment(files, git, scopeId, 'wiki/topic.md', { body: 'Two.' });
  assert.deepEqual(
    (await removeNoteComment(files, scopeId, 'wiki/topic.md', comment.id)).map((c) => c.body),
    ['Two.'],
  );
  assert.deepEqual(await removeNoteComment(files, scopeId, 'wiki/topic.md', 'unknown'), [second]);
  assert.deepEqual(await removeNoteComment(files, scopeId, 'wiki/topic.md', second.id), []);
  await assert.rejects(stat(path.join(root, '.irori', 'comments', 'wiki')), { code: 'ENOENT' });
  await stat(path.join(root, '.irori', 'comments'));
  await stat(path.join(root, '.irori', 'scope.json'));
});

test('What irori does not know in a comments file is kept, and a broken one is never overwritten', async (t) => {
  const { root, files, scopeId } = await hibachi(t);
  const file = path.join(root, '.irori', 'comments', 'wiki', 'topic.md.json');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({
      note: 'wiki/topic.md',
      schema: 2,
      comments: [
        {
          id: 'agent1',
          body: 'Done.',
          at: '2026-09-30T00:00:00.000Z',
          by: 'agent:claude',
          replies: [{ body: 'ok' }],
        },
      ],
    }),
  );
  const [kept, added] = await addNoteComment(files, git, scopeId, 'wiki/topic.md', {
    body: 'Thanks.',
  });
  assert.deepEqual(kept.replies, [{ body: 'ok' }]);
  assert.equal(added.body, 'Thanks.');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).schema, 2);
  // Removing every comment keeps a file that says more than its comments.
  await removeNoteComment(files, scopeId, 'wiki/topic.md', kept.id);
  await removeNoteComment(files, scopeId, 'wiki/topic.md', added.id);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
    schema: 2,
    note: 'wiki/topic.md',
    comments: [],
  });

  await writeFile(file, '{ "comments": [ oops');
  await assert.rejects(readNoteComments(files, scopeId, 'wiki/topic.md'), /comments file|コメント/);
  await assert.rejects(
    addNoteComment(files, git, scopeId, 'wiki/topic.md', { body: 'More.' }),
    /comments file|コメント/,
  );
  assert.equal(await readFile(file, 'utf8'), '{ "comments": [ oops');
  // An unreadable file is not counted for an agent, and nothing fails.
  assert.deepEqual(await commentsCount(files, scopeId), { comments: 0, files: 0 });
});

test('Comments stay inside the hibachi and only Markdown files take them', async (t) => {
  const { root, files, scopeId } = await hibachi(t);
  await writeFile(path.join(root, 'wiki', 'data.csv'), 'a,b\n');
  await assert.rejects(
    addNoteComment(files, git, scopeId, 'wiki/data.csv', { body: 'x' }),
    /Markdown/,
  );
  await assert.rejects(
    addNoteComment(files, git, scopeId, '../outside.md', { body: 'x' }),
    /Markdown/,
  );
  await assert.rejects(addNoteComment(files, git, scopeId, 'wiki/absent.md', { body: 'x' }));
  await assert.rejects(addNoteComment(files, git, scopeId, 'wiki/topic.md', { body: '   ' }));
  // A symbolic link where comments are kept would lead writes out of the hibachi.
  const elsewhere = await mkdtemp(path.join(tmpdir(), 'irori comments elsewhere '));
  t.after(() => rm(elsewhere, { recursive: true, force: true }));
  await symlink(elsewhere, path.join(root, '.irori', 'comments'));
  await assert.rejects(
    addNoteComment(files, git, scopeId, 'wiki/topic.md', { body: 'x' }),
    /not a folder|フォルダ/,
  );
  // The host refuses malformed requests before they reach the store.
  assert.equal(
    hostArguments.addNoteComment.safeParse([scopeId, 'wiki/topic.md', { body: 'x'.repeat(4001) }])
      .success,
    false,
  );
  assert.equal(
    hostArguments.addNoteComment.safeParse([scopeId, 'wiki/topic.md', { body: 'x', line: 0 }])
      .success,
    false,
  );
});

test("A moved note's comments move with it", async (t) => {
  const { root, files, scopeId } = await hibachi(t);
  await addNoteComment(files, git, scopeId, 'wiki/topic.md', { body: 'Keep me.' });
  await mkdir(path.join(root, 'archive'));
  await writeFile(path.join(root, 'archive', 'topic.md'), '# Topic\n');
  await moveNoteComments(files, scopeId, 'wiki/topic.md', 'archive/topic.md');
  assert.deepEqual(
    (await readNoteComments(files, scopeId, 'archive/topic.md')).map((c) => c.body),
    ['Keep me.'],
  );
  assert.equal(
    JSON.parse(
      await readFile(path.join(root, '.irori', 'comments', 'archive', 'topic.md.json'), 'utf8'),
    ).note,
    'archive/topic.md',
  );
  await assert.rejects(stat(path.join(root, '.irori', 'comments', 'wiki')), { code: 'ENOENT' });
  // A note without comments has nothing to move.
  await moveNoteComments(files, scopeId, 'wiki/other.md', 'archive/topic.md');
});

test('An agent is given the comments of its note, or where the hibachi keeps them', () => {
  const comments = [
    { id: 'a', body: 'Cite a source.', quote: 'A claim.', line: 3, by: 'human:alice', at: 'x' },
    { id: 'b', body: 'Split\nthis note.', at: 'y' },
  ];
  const summary = commentsSummary('wiki/topic.md', comments)!;
  assert.match(
    summary,
    /2 comments from people, kept in "\.irori\/comments\/wiki\/topic\.md\.json"/,
  );
  assert.match(summary, /- line 3, on "A claim\." \(human:alice\): Cite a source\./);
  assert.match(summary, /- on the whole note: Split this note\./);
  assert.match(summary, /not part of this instruction unless it says so/);
  assert.equal(commentsSummary('wiki/topic.md', []), undefined);
  const many = Array.from({ length: 200 }, (_, index) => ({
    id: String(index),
    body: 'x'.repeat(500),
    at: 'z',
  }));
  const clipped = commentsSummary('wiki/topic.md', many)!;
  assert.ok(clipped.length <= 4100, String(clipped.length));
  assert.match(clipped, /more in the file\.$/);
  assert.match(
    commentsPointer(1, 1),
    /1 comment from people on 1 file, kept in \.irori\/comments\//,
  );
});

test('The irori agent hears which handed hibachis carry comments and where', () => {
  const brains = [
    { name: 'Work', agent: 'hibachi-work', root: '/kb/work' },
    { name: 'Home', agent: 'hibachi-home', root: '/kb/home' },
  ];
  const quiet = brainsPreamble(brains, 'claude');
  assert.ok(!quiet.includes('comment'), quiet);
  const told = brainsPreamble(brains, 'claude', [0, 4]);
  assert.match(told, /sub-agent "hibachi-home", 4 comments from people/);
  assert.ok(!told.includes('"hibachi-work", '), told);
  assert.match(told, /\.irori\/comments\/<file path>\.json/);
  assert.match(
    brainsCommandPreamble(brains, 'Pi', [1, 0]),
    /"hibachi-work", 1 comment from people/,
  );
});

test('A selection in the rendered note finds its line in the source', () => {
  const source = '---\ntitle: x\n---\n# A\n\nSame words.\n\nSame words, **bold** here.\n';
  assert.equal(quoteHead('\n  Same words.\nnext'), 'Same words.');
  assert.equal(sourceLineOf(source, 'Same words', 0), 6);
  assert.equal(sourceLineOf(source, 'Same words', 1), 8);
  // Formatting the source carries and the rendering does not: no line is guessed.
  assert.equal(sourceLineOf(source, 'Same words, bold here.', 0), undefined);
  const at = positionsOf(source, 'Same words');
  assert.equal(nearest(source, at, 8), at[1]);
  assert.equal(nearest(source, at, undefined), at[0]);
});
