import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { AgentService } from '../src/agents/service';
import { launch, killTree } from '../src/agents/process';
import { Rpc } from '../src/agents/rpc';
import { PiRpc } from '../src/agents/pi';

test('Both native JSONL envelopes preserve fragmented UTF-8 and bound records before a newline', async () => {
  for (const provider of ['codex', 'pi']) {
    for (const oversized of [false, true]) {
      const child = launch(
        process.execPath,
        [
          '-e',
          `
        process.stdin.once('data', () => {
          if (${oversized}) { process.stdout.write('x'.repeat(8 * 1024 * 1024 + 1)); return; }
          const response = ${
            provider === 'pi'
              ? "{ type: 'response', id: '1', success: true, data: '日本語' }"
              : "{ id: 1, result: '日本語' }"
          };
          const bytes = Buffer.from(JSON.stringify(response) + '\\r\\n');
          let i = 0;
          const timer = setInterval(() => { process.stdout.write(bytes.subarray(i, ++i)); if(i === bytes.length) clearInterval(timer); }, 1);
        });
      `,
        ],
        process.cwd(),
      );
      const abort = new AbortController();
      const rpc =
        provider === 'pi'
          ? new PiRpc(
              child,
              () => {},
              () => {},
              abort.signal,
            )
          : new Rpc(child, () => {});
      try {
        const request = rpc.request('probe', {});
        if (oversized) {
          await assert.rejects(request, /exceeds limit/);
          await assert.rejects(rpc.request('again', {}), /stopped/);
        } else assert.equal(await request, '日本語');
      } finally {
        rpc.fail(Error('Test ended'));
        await killTree(child);
      }
    }
  }
});
test('RPC rejects pending requests after process crash and handles fragmented JSON lines', async () => {
  const child = launch(
    process.execPath,
    [
      '-e',
      `process.stdin.once('data',()=>{process.stdout.write('{"id":1,"res');setTimeout(()=>{process.stdout.write('ult":{"ready":true}}\\n');},10);});`,
    ],
    process.cwd(),
  );
  const rpc = new Rpc(child, () => {});
  try {
    assert.deepEqual(await rpc.request('initialize', {}), { ready: true });
    const pending = assert.rejects(rpc.request('wait', {}), /exited/);
    await killTree(child);
    await pending;
  } finally {
    await killTree(child);
  }
});
test('A cancelled startup releases the mutation lock without launching a provider', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori agent lock '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(root);
  const s = await files.register(root, 'KB', 'personal');
  let outcome = '';
  const service = new AgentService(files, (e) => {
    if (e.type === 'done') outcome = e.outcome!;
  });
  const input = { scopeId: s.scopeId, agent: 'codex' as const, prompt: 'Do nothing' };
  service.start(input);
  assert.throws(() => service.start(input), /already running/);
  await service.cancel();
  assert.equal(service.busy(s.scopeId), false);
  assert.equal(outcome, 'cancelled');
});
test('Each space runs its own agent; a second run in the same space is refused', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori parallel runs '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const roots = [path.join(base, 'personal'), path.join(base, 'team')];
  for (const root of roots) await mkdir(root);
  const personal = await files.register(roots[0], 'Personal', 'personal');
  const team = await files.register(roots[1], 'Team', 'team');
  const outcomes = new Map<string, string>();
  const service = new AgentService(files, (e) => {
    if (e.type === 'done' && e.scopeId) outcomes.set(e.scopeId, e.outcome!);
  });
  const instruction = { agent: 'codex' as const, prompt: 'Do nothing' };
  service.start({ ...instruction, scopeId: personal.scopeId });
  service.start({ ...instruction, scopeId: team.scopeId });
  assert.deepEqual(
    service.runningScopes().sort(),
    [personal.scopeId, team.scopeId].sort(),
    'both spaces run at once',
  );
  assert.throws(
    () => service.start({ ...instruction, agent: 'claude', scopeId: personal.scopeId }),
    /already running/,
    'a space that is running refuses a second agent',
  );
  // Cancel synchronously, before either run reaches a provider launch.
  const stopPersonal = service.cancel(personal.scopeId);
  assert.equal(service.busy(team.scopeId), true, 'one cancellation leaves the other space running');
  const stopTeam = service.cancel(team.scopeId);
  await Promise.all([stopPersonal, stopTeam]);
  assert.equal(service.anyBusy, false);
  assert.deepEqual(
    [outcomes.get(personal.scopeId), outcomes.get(team.scopeId)],
    ['cancelled', 'cancelled'],
    'each run reports its own outcome',
  );
});
