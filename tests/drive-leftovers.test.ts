// What Google Drive connections left on this device when irori stopped connecting to
// Drive itself (ADR 023): changed files rclone never uploaded, still in its write
// cache, and copies once prepared for upload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DriveLeftovers } from '../src/cloud/leftovers';
import { FileService } from '../src/host/files';
import { KnowledgeStore } from '../src/knowledge/store';
import { pendingWrite } from '../src/domain/knowledge';
import { hostArguments } from '../src/domain/host-requests';

async function dataDir(t: any) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori leftovers 日本語 '));
  t.after(() => rm(base, { recursive: true, force: true }));
  return base;
}

/** One file in rclone's VFS cache: its state in `vfsMeta`, its bytes in `vfs`. */
async function cached(
  dir: string,
  rel: string,
  { dirty = true, modTime = '2026-10-01T00:00:00Z', bytes = 'bytes' } = {},
) {
  const meta = path.join(dir, 'rclone', 'cache', 'vfsMeta', ...rel.split('/'));
  const data = path.join(dir, 'rclone', 'cache', 'vfs', ...rel.split('/'));
  await mkdir(path.dirname(meta), { recursive: true });
  await mkdir(path.dirname(data), { recursive: true });
  await writeFile(
    meta,
    JSON.stringify({
      ModTime: modTime,
      ATime: modTime,
      Size: Buffer.byteLength(bytes),
      Rs: [],
      Fingerprint: '',
      Dirty: dirty,
    }),
  );
  await writeFile(data, bytes);
}

test('Only changed files rclone never uploaded are listed', async (t) => {
  const dir = await dataDir(t);
  assert.deepEqual(await new DriveLeftovers(dir).unsent(), []);
  await cached(dir, 'irori_abc{folder}/研究/b.md', { bytes: 'Changed B' });
  await cached(dir, 'irori_abc{folder}/a.md', { bytes: 'Changed A' });
  // Uploaded already, or not rclone's record at all.
  await cached(dir, 'irori_abc{folder}/uploaded.md', { dirty: false });
  await mkdir(path.join(dir, 'rclone', 'cache', 'vfsMeta', 'other'), { recursive: true });
  await writeFile(path.join(dir, 'rclone', 'cache', 'vfsMeta', 'other', 'broken.md'), '{');
  await writeFile(
    path.join(dir, 'rclone', 'cache', 'vfsMeta', 'other', 'unrelated.json'),
    JSON.stringify({ Dirty: true }),
  );
  assert.deepEqual(await new DriveLeftovers(dir).unsent(), [
    { path: 'irori_abc{folder}/a.md', key: 'irori_abc{folder}/a.md@2026-10-01T00:00:00Z' },
    {
      path: 'irori_abc{folder}/研究/b.md',
      key: 'irori_abc{folder}/研究/b.md@2026-10-01T00:00:00Z',
    },
  ]);
});

test('Unsent files are saved with their folders, never over a file, and not offered again', async (t) => {
  const dir = await dataDir(t);
  await cached(dir, 'x/a.md', { bytes: 'Changed A' });
  await cached(dir, 'x/Folder/b.md', { bytes: 'Changed B' });
  await cached(dir, 'x/sent.md', { dirty: false, bytes: 'Sent' });
  const leftovers = new DriveLeftovers(dir);
  const destination = path.join(dir, 'Saved 保存');
  assert.equal(await leftovers.exportUnsent(destination), 2);
  assert.equal(await readFile(path.join(destination, 'x', 'a.md'), 'utf8'), 'Changed A');
  assert.equal(await readFile(path.join(destination, 'x', 'Folder', 'b.md'), 'utf8'), 'Changed B');
  assert.deepEqual((await readdir(path.join(destination, 'x'))).sort(), ['Folder', 'a.md']);
  // Saved once, they are remembered across restarts; the cache itself is left as it was.
  assert.deepEqual(await new DriveLeftovers(dir).unsent(), []);
  assert.equal(
    await readFile(path.join(dir, 'rclone', 'cache', 'vfs', 'x', 'a.md'), 'utf8'),
    'Changed A',
  );
  // A later change of the same file is offered again.
  await cached(dir, 'x/a.md', { modTime: '2026-10-02T00:00:00Z', bytes: 'Changed again' });
  assert.deepEqual(
    (await leftovers.unsent()).map((item) => item.path),
    ['x/a.md'],
  );
  // Saving it where the earlier copy is replaces nothing, and it stays offered.
  await assert.rejects(leftovers.exportUnsent(destination), { code: 'EEXIST' });
  assert.equal(await readFile(path.join(destination, 'x', 'a.md'), 'utf8'), 'Changed A');
  assert.deepEqual(
    (await leftovers.unsent()).map((item) => item.path),
    ['x/a.md'],
  );
  const elsewhere = path.join(dir, 'Elsewhere');
  assert.equal(await leftovers.exportUnsent(elsewhere), 1);
  assert.equal(await readFile(path.join(elsewhere, 'x', 'a.md'), 'utf8'), 'Changed again');
  assert.deepEqual(await leftovers.unsent(), []);
  // With nothing left, a save copies nothing.
  assert.equal(await leftovers.exportUnsent(path.join(dir, 'Empty')), 0);
});

test('Copies once prepared for upload stay restorable, and unreadable records are counted', async (t) => {
  const base = await dataDir(t);
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(root);
  const space = await files.register(root, 'Fixture', 'personal');
  const note = await files.createNote(space.scopeId, 'Source');
  const store = new KnowledgeStore(files.dataDir, (ref) => files.resolve(ref.scopeId, ref.path));
  const leftovers = new DriveLeftovers(files.dataDir);
  assert.deepEqual(await leftovers.prepared(), { entries: [], unreadable: 0 });
  // A preparation as irori wrote it before 0.1.67, for a connection since removed.
  const ownerId = randomUUID();
  const prepared = pendingWrite.parse({
    id: randomUUID(),
    ownerId,
    mountId: randomUUID(),
    folderId: 'gone-folder',
    accountId: randomUUID(),
    name: 'Source.md',
    source: await store.capture(note),
    createdAt: new Date().toISOString(),
    state: 'pending',
  });
  const directory = path.join(files.dataDir, 'cloud-outbox', ownerId);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${prepared.id}.json`), JSON.stringify(prepared));
  // Unreadable, and a record whose identity does not match its file name.
  await writeFile(path.join(directory, `${randomUUID()}.json`), '{');
  await writeFile(path.join(directory, `${randomUUID()}.json`), JSON.stringify(prepared));
  // Not a preparation at all.
  await writeFile(path.join(directory, 'notes.txt'), 'ignored');
  await mkdir(path.join(files.dataDir, 'cloud-outbox', 'not-an-owner'));
  await rm(root, { recursive: true });
  const recovered = await new DriveLeftovers(files.dataDir).prepared();
  assert.deepEqual(recovered.entries, [prepared]);
  assert.equal(recovered.unreadable, 2);
  // The kept bytes outlive the hibachi they came from.
  assert.equal(await store.sourceText(recovered.entries[0].source), note.text);
  assert.deepEqual(hostArguments.recoverableCloudWrites.parse([]), []);
  assert.throws(() => hostArguments.recoverableCloudWrites.parse([ownerId]));
  assert.deepEqual(hostArguments.unsentDriveChanges.parse([]), []);
  assert.deepEqual(hostArguments.exportUnsentDriveChanges.parse([]), []);
  assert.throws(() => hostArguments.exportUnsentDriveChanges.parse(['/tmp']));
});
