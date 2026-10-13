import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { FileService } from '../src/host/files';
import { addNoteComment, moveFolderComments, readNoteComments } from '../src/host/comments';
import { brokenLinks, carriedImage, movedWith } from '../src/domain/vault-move';
import { hostArguments } from '../src/domain/host-requests';

async function fixture(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori vault move '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const vault = async (name: string) => {
    const root = path.join(base, name);
    await mkdir(root);
    const space = await files.register(root, name, 'personal');
    return {
      id: space.scopeId,
      write: async (relative: string, text: string | Buffer) => {
        const file = path.join(root, relative);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, text);
      },
      read: (relative: string) => readFile(path.join(root, relative), 'utf8'),
      exists: (relative: string) =>
        lstat(path.join(root, relative)).then(
          () => true,
          () => false,
        ),
    };
  };
  return { base, files, a: await vault('A'), b: await vault('B') };
}
const git = { userEmail: async () => 'person@example.com' };
const noTrash = async () => assert.fail('a move on one volume renames');

test('Links between what moves to another vault and what stays are the ones that break', () => {
  const image = `_assets/image-${'a'.repeat(64)}.png`;
  const notes = [
    { path: 'K/a.md', text: '[b](b.md) [c](sub/c.md) [d](sub/d.md)' },
    { path: 'K/b.md', text: '[a](a.md)' },
    { path: 'K/sub/c.md', text: `[d](d.md) [a](../a.md) ![x](${image}) [web](https://x.test)` },
    { path: 'K/sub/d.md', text: '[c](c.md)' },
  ];
  // A folder: a.md's two links in and c.md's link out; links inside the folder hold.
  assert.equal(brokenLinks(notes, 'K/sub'), 3);
  // A note: its three links out, and b.md's and c.md's links in.
  assert.equal(brokenLinks(notes, 'K/a.md'), 5);
  // A note's managed image goes with it: two links out, two in.
  assert.equal(brokenLinks(notes, 'K/sub/c.md'), 4);
  assert.ok(carriedImage('K/sub/c.md', `K/sub/${image}`));
  assert.ok(!carriedImage('K/sub/c.md', `K/${image}`));
  assert.ok(movedWith('K/sub', 'K/sub/c.md') && !movedWith('K/sub', 'K/subway.md'));
});

test('A note moves into another vault with its managed images, comments and draft', async (t) => {
  const { files, a, b } = await fixture(t);
  const bytes = Buffer.from('png bytes');
  const image = `_assets/image-${createHash('sha256').update(bytes).digest('hex')}.png`;
  await a.write(`Knowledge_Base/${image}`, bytes);
  await a.write('Knowledge_Base/note.md', `# Note\n\n![x](${image})\n`);
  await b.write('Knowledge_Base/inbox/note.md', 'taken');
  await addNoteComment(files, git, a.id, 'Knowledge_Base/note.md', { body: 'keep this' });
  const note = await files.read(a.id, 'Knowledge_Base/note.md');
  await files.draft({ ...note, text: '# Note\n\nunsaved\n' });

  const moved = await files.moveAcross(
    a.id,
    'Knowledge_Base/note.md',
    b.id,
    'Knowledge_Base/inbox',
    noTrash,
  );
  assert.equal(moved.entry.path, 'Knowledge_Base/inbox/note 2.md');
  assert.deepEqual(moved.files, ['Knowledge_Base/note.md']);
  assert.equal(await b.read('Knowledge_Base/inbox/note.md'), 'taken');
  assert.match(await b.read('Knowledge_Base/inbox/note 2.md'), /!\[x\]/);
  assert.equal(await b.read(`Knowledge_Base/inbox/${image}`), 'png bytes');
  assert.ok(!(await a.exists('Knowledge_Base/note.md')));
  // The image stays for any other note that shows it.
  assert.ok(await a.exists(`Knowledge_Base/${image}`));
  assert.equal(
    (await files.read(b.id, 'Knowledge_Base/inbox/note 2.md')).draft?.text,
    '# Note\n\nunsaved\n',
  );

  const kept = await moveFolderComments(
    files,
    a.id,
    { from: 'Knowledge_Base/note.md', to: moved.entry.path },
    b.id,
  );
  assert.deepEqual(kept, []);
  assert.deepEqual(
    (await readNoteComments(files, b.id, moved.entry.path)).map((comment) => comment.body),
    ['keep this'],
  );
});

test('A folder moves whole; the knowledge folder and the same vault are refused', async (t) => {
  const { files, a, b } = await fixture(t);
  await a.write('Knowledge_Base/project/one.md', '[two](two.md)');
  await a.write('Knowledge_Base/project/data/table.csv', 'a,b');
  await b.write('Knowledge_Base/.keep', '');
  const moved = await files.moveAcross(
    a.id,
    'Knowledge_Base/project',
    b.id,
    'Knowledge_Base',
    noTrash,
  );
  assert.equal(moved.entry.path, 'Knowledge_Base/project');
  assert.deepEqual(moved.files.sort(), [
    'Knowledge_Base/project/data/table.csv',
    'Knowledge_Base/project/one.md',
  ]);
  assert.equal(await b.read('Knowledge_Base/project/data/table.csv'), 'a,b');
  assert.ok(!(await a.exists('Knowledge_Base/project')));
  await assert.rejects(files.moveAcross(a.id, 'Knowledge_Base', b.id, 'Knowledge_Base', noTrash));
  await a.write('Knowledge_Base/x.md', 'x');
  await assert.rejects(
    files.moveAcross(a.id, 'Knowledge_Base/x.md', a.id, 'Knowledge_Base', noTrash),
  );
  // Only knowledge: a hidden Schema file is not knowledge.
  await a.write('.irori/notes.json', '{}');
  await assert.rejects(
    files.moveAcross(a.id, '.irori/notes.json', b.id, 'Knowledge_Base', noTrash),
  );
});

test('The host takes cross-vault moves only with vault ids and paths', () => {
  const id = '6d1a3c84-9f0e-4c8b-9a51-2f3e4d5c6b7a';
  assert.ok(hostArguments.moveToVault.safeParse([id, 'K/a.md', id, 'K']).success);
  assert.ok(!hostArguments.moveToVault.safeParse([id, 'K/a.md', 'not a vault', 'K']).success);
  assert.ok(!hostArguments.vaultMoveLinks.safeParse([id, '']).success);
});
