import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { FileService } from '../src/host/files';
import { KnowledgeStore } from '../src/knowledge/store';
import { CloudOutbox, rcloneDelivery } from '../src/cloud/outbox';
import { Rclone } from '../src/cloud/rclone';
async function fixture(t: any) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori-knowledge-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(root);
  const space = await files.register(root, 'Fixture', 'personal');
  const note = await files.createNote(space.scopeId, 'Source');
  const store = new KnowledgeStore(files.dataDir, (ref) => files.resolve(ref.scopeId, ref.path));
  return { base, files, root, space, note, store };
}
test('Run/source identities retain exact historical bytes, separate copies and explicit artifact provenance', async (t) => {
  const { files, root, space, note, store } = await fixture(t);
  const runId = randomUUID();
  const run = await store.begin(runId, {
    scopeId: space.scopeId,
    agent: 'codex',
    prompt: 'fixture',
    notePath: note.path,
    sources: [note],
  });
  assert.equal(run.sources.length, 1);
  await store.finish(run, 'completed');
  await files.save({ ...note, text: 'A later observed version\n' });
  const current = await store.capture(note);
  assert.equal(current.id, run.sources[0].id);
  assert.notEqual(current.hash, run.sources[0].hash);
  assert.equal(await store.sourceText(run.sources[0]), note.text);
  await writeFile(path.join(root, 'copy.md'), note.text);
  assert.notEqual(
    (await store.capture({ scopeId: space.scopeId, path: 'copy.md' })).id,
    current.id,
  );
  // Arbitrary artifacts retain bytes; registration records a human assertion, not authorship proof.
  await writeFile(path.join(root, 'slides.pptx'), Buffer.from([80, 75, 3, 4, 0, 1]));
  const artifact = await store.artifact({ scopeId: space.scopeId, path: 'slides.pptx' }, runId);
  assert.equal(artifact.runId, run.id);
  assert.equal(artifact.evidence, 'manual-registration');
  assert.deepEqual(await store.bytes(artifact.source), Buffer.from([80, 75, 3, 4, 0, 1]));
  await assert.rejects(store.finish(run, 'failed'), /immutable/);
  const restarted = new KnowledgeStore(files.dataDir, (ref) =>
    files.resolve(ref.scopeId, ref.path),
  );
  assert.equal((await restarted.history(space.scopeId)).runs[0].outcome, 'completed');
  await rename(path.join(root, note.path), path.join(root, 'moved.md'));
  const relocated = { scopeId: space.scopeId, path: 'moved.md' };
  await restarted.rebind(current, relocated);
  assert.equal((await restarted.capture(relocated)).id, current.id);
  assert.equal(await restarted.sourceText(run.sources[0]), note.text);
  await rm(path.join(root, 'moved.md'));
  assert.equal(await restarted.sourceText(current), 'A later observed version\n');
  await writeFile(store.blobPath(current.hash), 'corrupt');
  await assert.rejects(store.bytes(current), /整合性/);
});
test('Outbox retains unsent bytes across restart, uncertain completion and remote conflicts', async (t) => {
  const { files, note, store } = await fixture(t);
  const target = { ownerId: randomUUID(), mountId: randomUUID(), folderId: 'fixture-folder' };
  const outbox = new CloudOutbox(files.dataDir, store);
  const pending = await outbox.prepare(target, note);
  await files.save({ ...note, text: 'Changed after preparation' });
  let remote: { hash: string; size: number } | null = null;
  let copies = 0;
  const transport = {
    observe: async () => remote,
    copy: async () => {
      copies++;
      remote = { hash: pending.source.hash, size: pending.source.size };
      throw Error('connection lost after copy');
    },
  };
  assert.equal(
    (await outbox.deliver(target.ownerId, pending.id, target, transport)).state,
    'failed',
  );
  const restarted = new CloudOutbox(files.dataDir, store);
  assert.equal((await restarted.list(target.ownerId))[0].state, 'failed');
  assert.equal(await store.sourceText(pending.source), note.text);
  assert.equal(
    (await restarted.deliver(target.ownerId, pending.id, target, transport)).state,
    'confirmed',
  );
  assert.equal(copies, 1);
  const next = await restarted.prepare(target, note);
  assert.equal(
    (await restarted.deliver(target.ownerId, next.id, target, transport)).state,
    'failed',
  );
  assert.equal(copies, 1);
  await assert.rejects(
    restarted.deliver(target.ownerId, next.id, { ...target, folderId: 'other' }, transport),
    /識別情報/,
  );
  const filename = path.join(files.dataDir, 'cloud-outbox', target.ownerId, `${next.id}.json`);
  const record = JSON.parse(await readFile(filename, 'utf8'));
  record.state = 'uploading';
  await writeFile(filename, JSON.stringify(record));
  remote = { hash: next.source.hash, size: next.source.size };
  assert.equal(
    (
      await new CloudOutbox(files.dataDir, store).deliver(
        target.ownerId,
        next.id,
        target,
        transport,
      )
    ).state,
    'confirmed',
  );
});
test(
  'Actual rclone copies retained bytes and confirms a downloaded hash on disposable local destinations',
  { skip: !process.env.IRORI_TEST_RCLONE_PATH },
  async (t) => {
    const { base, files, note, store } = await fixture(t);
    const remote = path.join(base, 'destination');
    await mkdir(remote);
    const rpc = new Rclone(files.dataDir, process.env.IRORI_TEST_RCLONE_PATH);
    t.after(() => rpc.close());
    const target = {
      ownerId: randomUUID(),
      mountId: randomUUID(),
      folderId: 'local-engineering-fixture',
    };
    const outbox = new CloudOutbox(files.dataDir, store);
    const pending = await outbox.prepare(target, note);
    const result = await outbox.deliver(
      target.ownerId,
      pending.id,
      target,
      rcloneDelivery(rpc, remote),
    );
    assert.equal(result.state, 'confirmed');
    assert.equal(await readFile(path.join(remote, pending.name), 'utf8'), note.text);
  },
);
