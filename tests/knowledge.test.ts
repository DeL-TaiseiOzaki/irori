import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { FileService } from '../src/host/files';
import { KnowledgeStore } from '../src/knowledge/store';
import { CloudOutbox, rcloneDelivery } from '../src/cloud/outbox';
import { Rclone } from '../src/cloud/rclone';
import { hostArguments } from '../src/domain/host-requests';
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
test('Source navigation follows repeated explicit moves, preserving versions and separate reused paths', async (t) => {
  const { files, root, space, note, store } = await fixture(t);
  const run = await store.begin(randomUUID(), {
    scopeId: space.scopeId,
    agent: 'codex',
    prompt: 'fixture',
    notePath: note.path,
  });
  const original = run.sources[0];
  assert.deepEqual(await store.locate(original), {
    state: 'matching',
    current: { scopeId: space.scopeId, path: note.path },
  });
  await writeFile(path.join(root, note.path), 'Changed version');
  assert.equal((await store.locate(original)).state, 'changed');
  const changed = await store.capture(note);
  await rename(path.join(root, note.path), path.join(root, '移動先.md'));
  assert.equal((await store.locate(original)).state, 'missing');
  const next = { scopeId: space.scopeId, path: '移動先.md' };
  await assert.rejects(store.rebind(original, next), /版が一致/);
  await store.rebind(changed, next);
  assert.deepEqual(await store.locate(original), { state: 'changed', current: next });
  assert.deepEqual(await store.locate(changed), { state: 'matching', current: next });
  await rename(path.join(root, next.path), path.join(root, 'Again.md'));
  const final = { ...next, path: 'Again.md' };
  // Even the original historical path can locate the ID after a second move.
  await store.rebind(changed, final);
  await writeFile(path.join(root, note.path), note.text);
  assert.notEqual((await store.capture(note)).id, original.id);
  const restarted = new KnowledgeStore(files.dataDir, (ref) =>
    files.resolve(ref.scopeId, ref.path),
  );
  assert.deepEqual(await restarted.locate(original), { state: 'changed', current: final });
  assert.equal((await restarted.capture(final)).id, original.id);
  assert.deepEqual((await restarted.history(space.scopeId)).runs[0].sources[0], original);
  assert.equal(await restarted.sourceText(original), note.text);
  assert.equal(await readFile(path.join(root, note.path), 'utf8'), note.text);
});
test('Rebinding rejects copies, occupied identities, wrong scopes and untrusted paths without moving bytes', async (t) => {
  const { root, space, note, store, files, base } = await fixture(t);
  const version = await store.capture(note);
  const next = { scopeId: space.scopeId, path: 'copy.md' };
  await writeFile(path.join(root, next.path), note.text);
  await assert.rejects(store.rebind(version, next), /現在の場所に資料/);
  const copy = await store.capture(next);
  await rm(path.join(root, note.path));
  await assert.rejects(store.rebind(version, next), /登録状態/);
  await assert.rejects(
    store.rebind({ ...version, id: randomUUID() }, { ...next, path: 'unused.md' }),
    /登録状態/,
  );
  await assert.rejects(store.rebind(version, { ...next, scopeId: randomUUID() }), /同じスペース/);
  for (const relative of [
    '../outside.md',
    '/absolute.md',
    'C:/outside.md',
    'C:outside.md',
    'dir\\file.md',
    'a/../b.md',
    './copy.md',
    'a//b.md',
    'a\0.md',
  ]) {
    const destination = { ...next, path: relative };
    assert.equal(hostArguments.rebindSource.safeParse([version, destination]).success, false);
    await assert.rejects(store.rebind(version, destination));
  }
  // Existing records may contain POSIX names that are not portable new destinations.
  assert.equal(
    hostArguments.locateSource.safeParse([{ ...version, path: 'a:legacy.md' }]).success,
    true,
  );
  const other = path.join(base, 'Other');
  await mkdir(other);
  const otherSpace = await files.register(other, 'Other', 'team');
  await writeFile(path.join(other, 'source.md'), note.text);
  await symlink(other, path.join(root, 'alias'), 'junction');
  await assert.rejects(store.rebind(version, { ...next, path: 'alias/source.md' }), /boundary/);
  assert.equal((await store.locate(version)).state, 'missing');
  assert.equal((await store.capture(next)).id, copy.id);
  assert.notEqual(
    (await store.capture({ scopeId: otherSpace.scopeId, path: 'source.md' })).id,
    version.id,
  );
  assert.equal(await readFile(path.join(root, next.path), 'utf8'), note.text);
  assert.equal(await store.sourceText(version), note.text);
});
test('Unavailable and corrupt source locations never become a matching path or an automatic rebind', async (t) => {
  const { files, root, note, store } = await fixture(t);
  const version = await store.capture(note);
  assert.deepEqual(await store.locate({ ...version, id: randomUUID() }), { state: 'unbound' });
  const unavailable = new KnowledgeStore(files.dataDir, async () => {
    throw Error('Connection unavailable');
  });
  assert.equal((await unavailable.locate(version)).state, 'unavailable');
  await assert.rejects(
    unavailable.rebind(version, { scopeId: version.scopeId, path: 'elsewhere.md' }),
    /Connection unavailable/,
  );
  await rm(path.join(root, note.path));
  await mkdir(path.join(root, note.path));
  assert.equal((await store.locate(version)).state, 'unavailable');
  const index = path.join(store.directory, `index-${version.scopeId}.json`);
  await writeFile(index, JSON.stringify({ [version.path]: version.id, duplicate: version.id }));
  await assert.rejects(store.locate(version), /重複/);
  await assert.rejects(
    store.rebind(version, { scopeId: version.scopeId, path: 'elsewhere.md' }),
    /重複/,
  );
});
test('Outbox retains unsent bytes across restart, uncertain completion and remote conflicts', async (t) => {
  const { files, note, store } = await fixture(t);
  const target = {
    ownerId: randomUUID(),
    mountId: randomUUID(),
    folderId: 'fixture-folder',
    accountId: randomUUID(),
    driveId: 'fixture-drive',
  };
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
  assert.equal((await restarted.list(target.ownerId))[0].accountId, target.accountId);
  assert.equal((await restarted.list(target.ownerId))[0].driveId, target.driveId);
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
test('Legacy unbound preparations retain restore access and cannot acquire a delivery account implicitly', async (t) => {
  const { files, note, store } = await fixture(t);
  const target = {
    ownerId: randomUUID(),
    mountId: randomUUID(),
    folderId: 'fixture-folder',
    accountId: randomUUID(),
  };
  const outbox = new CloudOutbox(files.dataDir, store);
  const prepared = await outbox.prepare(target, note);
  const filename = path.join(files.dataDir, 'cloud-outbox', target.ownerId, `${prepared.id}.json`);
  const { accountId: _account, ...legacy } = prepared;
  await writeFile(filename, JSON.stringify(legacy));
  await files.save({ ...note, text: 'A newer version after legacy preparation' });
  const restarted = new CloudOutbox(files.dataDir, store);
  const [retained] = await restarted.list(target.ownerId);
  assert.equal(retained.accountId, undefined);
  assert.equal(await store.sourceText(retained.source), note.text);
  let remoteCalls = 0;
  const remote = {
    observe: async () => {
      remoteCalls++;
      return null;
    },
    copy: async () => {
      remoteCalls++;
    },
  };
  await assert.rejects(
    restarted.deliver(target.ownerId, retained.id, target, remote),
    /アカウント情報/,
  );
  assert.equal(remoteCalls, 0);
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), legacy);
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
      accountId: randomUUID(),
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
