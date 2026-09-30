import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentService } from '../src/agents/service';
import { FileService } from '../src/host/files';
import { KnowledgeStore } from '../src/knowledge/store';
import { CloudAccounts } from '../src/cloud/accounts';
import { CloudService } from '../src/cloud/service';
import { DataConsent } from '../src/host/data-consent';
import type { CloudStorage } from '../src/cloud/storage';
import type { AgentEvent, AgentId, StartRun } from '../src/domain/types';
import { fixture, FixtureRclone, mountedFixture } from './fixtures/cloud';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => (resolve = accept));
  return { promise, resolve };
}

async function agentFixture(t: TestContext, authorize: (agent: AgentId) => Promise<void>) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori-data-boundary-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'KB');
  await mkdir(root);
  await writeFile(path.join(root, 'note.md'), '# Synthetic material\n');
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const space = await files.register(root, 'Fixture KB', 'personal');
  let reads = 0;
  const read = files.read.bind(files);
  files.read = async (...args) => {
    reads++;
    return read(...args);
  };
  const knowledge = new KnowledgeStore(files.dataDir, (ref) =>
    files.resolve(ref.scopeId, ref.path),
  );
  let captures = 0;
  knowledge.begin = async () => {
    captures++;
    throw Error('Stop before any provider launch');
  };
  const events: AgentEvent[] = [];
  const done = deferred<void>();
  const service = new AgentService(
    files,
    (event) => {
      events.push(event);
      if (event.type === 'done') done.resolve();
    },
    knowledge,
    undefined,
    undefined,
    authorize,
  );
  const input: StartRun = {
    scopeId: space.scopeId,
    agent: 'codex',
    prompt: 'Synthetic instruction only',
    notePath: 'note.md',
    personLines: true,
  };
  return {
    files,
    service,
    events,
    done: done.promise,
    input,
    reads: () => reads,
    captures: () => captures,
  };
}

test(
  'Rejected agent execution never reads material, creates history or retains a busy run',
  { timeout: 5000 },
  async (t) => {
    const value = await agentFixture(t, async () => {
      throw Error('Declined fixture disclosure');
    });
    await assert.rejects(value.service.startAccepted(value.input), /Declined fixture/);
    await value.done;
    assert.equal(value.reads(), 0);
    assert.equal(value.captures(), 0);
    assert.equal(value.service.anyBusy, false);
    assert.equal(value.events.at(-1)?.outcome, 'failed');
    assert.deepEqual(await value.service.conversationList(value.input.scopeId), []);
    assert.deepEqual(
      await readdir(path.join(value.files.dataDir, 'knowledge')).catch(() => []),
      [],
    );
  },
);

test(
  'Rejected queued instruction remains pending with its exact context and no material read',
  { timeout: 5000 },
  async (t) => {
    const value = await agentFixture(t, async () => {
      throw Error('Declined fixture disclosure');
    });
    await value.service.queueMessage(value.input);
    assert.equal(await value.service.pending(value.input.scopeId), 1);
    await assert.rejects(value.service.startNextQueued(value.input.scopeId), /Declined fixture/);
    await value.done;
    assert.equal(value.service.anyBusy, false);
    assert.equal(value.reads(), 0);
    assert.equal(value.captures(), 0);
    assert.equal(await value.service.pending(value.input.scopeId), 1);
    const conversation = await value.service.conversation(value.input.scopeId, 'codex');
    assert.equal(conversation.queued[0].prompt, value.input.prompt);
    assert.equal(conversation.queued[0].notePath, 'note.md');
    assert.equal(conversation.events.length, 0);
  },
);

test(
  'An agent waits before reading context and cancellation during confirmation rejects acceptance',
  { timeout: 5000 },
  async (t) => {
    const entered = deferred<void>();
    const answer = deferred<void>();
    const value = await agentFixture(t, async () => {
      entered.resolve();
      await answer.promise;
    });
    const accepted = value.service.startAccepted(value.input);
    const rejected = assert.rejects(accepted, /取り消|cancelled/);
    await entered.promise;
    assert.equal(value.reads(), 0);
    assert.equal(value.captures(), 0);
    const stopped = value.service.cancel(value.input.scopeId);
    answer.resolve();
    await Promise.all([rejected, stopped, value.done]);
    assert.equal(value.service.anyBusy, false);
    assert.equal(value.events.at(-1)?.outcome, 'cancelled');
    assert.equal(value.reads(), 0);
    assert.equal(value.captures(), 0);
    assert.deepEqual(await value.service.conversationList(value.input.scopeId), []);
  },
);

test(
  'Confirmed agent execution reads context only after the confirmation resolves',
  { timeout: 5000 },
  async (t) => {
    const entered = deferred<void>();
    const answer = deferred<void>();
    const value = await agentFixture(t, async () => {
      entered.resolve();
      await answer.promise;
    });
    const accepted = value.service.startAccepted(value.input);
    await entered.promise;
    assert.equal(value.reads(), 0);
    answer.resolve();
    await accepted;
    await value.done;
    assert(value.reads() > 0);
    assert.equal(value.captures(), 1);
    assert(value.events.some((event) => event.text.includes('Stop before any provider launch')));
  },
);

test(
  'A rejected routine agent step finishes without capturing its inputs or creating history',
  { timeout: 5000 },
  async (t) => {
    const value = await agentFixture(t, async () => {
      throw Error('Declined fixture disclosure');
    });
    const started = value.service.startStep(value.input, {
      preamble: 'Synthetic routine step',
      directories: [],
      notice: 'Synthetic routine',
      env: {},
    });
    const ended = await started.done;
    assert.equal(ended.outcome, 'failed');
    assert.match(ended.error ?? '', /Declined fixture/);
    assert.equal(value.reads(), 0);
    assert.equal(value.captures(), 0);
    assert.equal(value.service.anyBusy, false);
    assert.deepEqual(await value.service.conversationList(value.input.scopeId), []);
  },
);

test('Rejected Google account creation never creates an account or starts authentication', async (t) => {
  const { files, rpc } = await fixture(t);
  const accounts = new CloudAccounts(
    files.dataDir,
    rpc,
    async () => assert.fail('No browser'),
    {
      clientId: 'synthetic-client',
      clientSecret: 'synthetic-secret',
    },
    async () => {
      throw Error('Declined fixture disclosure');
    },
  );
  const previous = await accounts.list();
  await assert.rejects(accounts.add('Another account'), /Declined fixture/);
  assert.deepEqual(await accounts.list(), previous);
  assert.deepEqual(rpc.calls, []);
});

test('Rejected Google reauthorization preserves the ready account and its on-disk identity', async (t) => {
  const { files, accountId, rpc } = await fixture(t);
  const accounts = new CloudAccounts(
    files.dataDir,
    rpc,
    async () => assert.fail('No browser'),
    {
      clientId: 'synthetic-client',
      clientSecret: 'synthetic-secret',
    },
    async () => {
      throw Error('Declined fixture disclosure');
    },
  );
  const before = await readFile(path.join(files.dataDir, 'cloud-accounts.json'), 'utf8');
  await assert.rejects(accounts.reauthorize(accountId), /Declined fixture/);
  assert.equal((await accounts.list()).find((item) => item.id === accountId)?.state, 'ready');
  assert.equal(await readFile(path.join(files.dataDir, 'cloud-accounts.json'), 'utf8'), before);
  assert.deepEqual(rpc.calls, []);
});

test('Drive and folder listing wait for consent before sending provider requests', async (t) => {
  const { files, accountId } = await fixture(t);
  for (const operation of ['drives', 'folders'] as const) {
    const entered = deferred<void>();
    const answer = deferred<void>();
    const rpc = new FixtureRclone();
    const accounts = new CloudAccounts(
      files.dataDir,
      rpc,
      async () => {},
      undefined,
      async () => {
        entered.resolve();
        await answer.promise;
      },
    );
    const pending =
      operation === 'drives' ? accounts.drives(accountId) : accounts.folders(accountId, 'root');
    await entered.promise;
    assert.equal(rpc.calls.length, 0);
    answer.resolve();
    const folders = await pending;
    assert(folders.length > 0);
    assert.deepEqual(
      rpc.calls.map((call) => call.method),
      [operation === 'drives' ? 'backend/command' : 'operations/list'],
    );
  }
});

test('Rejected remote folder access sends no request and does not partially register a connection', async (t) => {
  const { files, space, accountId, rpc } = await fixture(t);
  const cloud = new CloudService(files, async () => {}, rpc, undefined, {
    allow: async () => {
      throw Error('Declined fixture disclosure');
    },
    require: async () => {
      throw Error('Missing fixture receipt');
    },
  });
  await assert.rejects(cloud.accounts.drives(accountId), /Declined fixture/);
  await assert.rejects(cloud.accounts.folders(accountId, 'root'), /Declined fixture/);
  await assert.rejects(
    cloud.add({
      scopeId: space.scopeId,
      accountId,
      folder: { id: 'folder-one', parentId: 'root', name: 'Source' },
      contentsRoot: 'contents',
      name: 'Fixture mount',
    }),
    /Declined fixture/,
  );
  assert.deepEqual(rpc.calls, []);
  assert.equal(cloud.busy, false);
  assert.deepEqual(await cloud.connections(space.scopeId), []);
  assert.deepEqual(await readdir(path.join(files.dataDir, 'cloud-bindings')).catch(() => []), []);
});

test('Background connection requires a receipt before any rclone call and keeps its declaration usable', async (t) => {
  const { files, space, accountId, rpc, cloud: setup } = await fixture(t);
  const connection = await setup.add({
    scopeId: space.scopeId,
    accountId,
    folder: { id: 'folder-one', parentId: 'root', name: 'Source' },
    contentsRoot: 'contents',
    name: 'Fixture mount',
  });
  rpc.calls.length = 0;
  let prompts = 0;
  const cloud = new CloudService(files, async () => {}, rpc, undefined, {
    allow: async () => {
      prompts++;
    },
    require: async () => {
      throw Error('Missing fixture receipt');
    },
  });
  await assert.rejects(cloud.connect(space.scopeId, connection.mountId), /Missing fixture receipt/);
  assert.equal(cloud.busy, false);
  assert.equal(prompts, 0, 'background reconnect never opens a dialog');
  assert.deepEqual(rpc.calls, []);
  assert.equal((await cloud.connections(space.scopeId))[0].state, 'disconnected');
  assert.deepEqual(rpc.calls, [], 'listing a disconnected declaration stays local');
});

for (const operation of ['setAccess', 'moveConnection'] as const) {
  test(`Reset consent prevents ${operation} from partially changing a live mount`, async (t) => {
    const {
      base,
      files,
      space,
      cloud: original,
      connection,
      target,
      rpc,
    } = await mountedFixture(t, { writable: true });
    await writeFile(path.join(target, 'note.md'), '# Synthetic mounted note\n');
    const destinationRoot = path.join(base, 'Destination KB');
    await mkdir(destinationRoot);
    const destination = await files.register(destinationRoot, 'Destination', 'personal');
    // A legacy workspace owns the same synthetic declaration, binding and mount.
    // Only the move case needs that ownership; the destination is an ordinary KB.
    const storage: CloudStorage = {
      dataDir: files.dataDir,
      get: (id) => ({
        ...files.get(id),
        ...(id === space.scopeId && operation === 'moveConnection' ? { workspace: true } : {}),
      }),
      list: () =>
        files.list().map((entry) => ({
          ...entry,
          ...(entry.scopeId === space.scopeId && operation === 'moveConnection'
            ? { workspace: true }
            : {}),
        })),
      resolve: (id, relative) => files.resolve(id, relative),
    };
    let prompts = 0;
    const consent = new DataConsent(files.dataDir, async () => {
      prompts++;
      return true;
    });
    await consent.allow('google');
    await consent.reset();
    const cloud = new CloudService(storage, async () => {}, rpc, undefined, {
      allow: () => consent.allow('google'),
      require: () => consent.require('google'),
    });
    const key = `${space.scopeId}:${connection.mountId}`;
    const mounted = original['mounted'].get(key)!;
    cloud['mounted'].set(key, mounted);
    cloud['states'].set(key, { state: 'mounted' });
    const declaration = path.join(space.root, '.irori', 'cloud-mounts.json');
    const bindingDirectory = path.join(files.dataDir, 'cloud-bindings');
    const binding = path.join(bindingDirectory, `${space.scopeId}-${connection.mountId}.json`);
    const before = {
      declaration: await readFile(declaration, 'utf8'),
      binding: await readFile(binding, 'utf8'),
      bindings: await readdir(bindingDirectory),
    };
    const destinationDeclaration = path.join(destination.root, '.irori', 'cloud-mounts.json');
    const destinationBefore = await readFile(destinationDeclaration, 'utf8').catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
      },
    );
    rpc.calls.length = 0;
    await assert.rejects(
      operation === 'setAccess'
        ? cloud.setAccess(space.scopeId, connection.mountId, 'read-only')
        : cloud.moveConnection(space.scopeId, connection.mountId, destination.scopeId),
      /確認|Confirm/,
    );
    assert.equal(cloud.busy, false);
    assert.equal(prompts, 1, 'a service remount must not prompt again in the background');
    assert.equal(rpc.calls.length, 0, 'reject before querying uploads or unmounting');
    assert.strictEqual(cloud['mounted'].get(key), mounted);
    assert.equal(cloud['mounted'].size, 1);
    assert.deepEqual(cloud['states'].get(key), { state: 'mounted' });
    assert.equal(await readFile(declaration, 'utf8'), before.declaration);
    assert.equal(await readFile(binding, 'utf8'), before.binding);
    assert.deepEqual(await readdir(bindingDirectory), before.bindings);
    assert.equal(
      await readFile(destinationDeclaration, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
      }),
      destinationBefore,
    );
    assert.equal(
      await readFile(path.join(target, 'note.md'), 'utf8'),
      '# Synthetic mounted note\n',
    );
  });
}
