import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileService } from '../src/host/files';
import { AgentService } from '../src/agents/service';
import { SessionStore } from '../src/agents/sessions';
import type { AgentEvent, AgentId } from '../src/domain/types';

const fixtureOptions = {
  skip: process.platform === 'win32' && 'POSIX executable fixture',
  timeout: 25000,
};
async function setup(t: any) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori harness fixture '));
  const bin = path.join(base, 'bin');
  await mkdir(bin);
  const old = process.env.PATH;
  process.env.PATH = bin + path.delimiter + old;
  t.after(async () => {
    process.env.PATH = old;
    await rm(base, { recursive: true, force: true });
  });
  for (const id of ['pi', 'opencode'])
    await writeFile(
      path.join(bin, id),
      `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/harnesses.mjs')).href)}).then(m=>m.run(${JSON.stringify(id)}));\n`,
      { mode: 0o700 },
    );
  const root = path.join(base, 'KB 日本語');
  await mkdir(root);
  await writeFile(path.join(root, 'note.md'), '# Fixture\n');
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const space = await files.register(root, 'Fixture', 'personal');
  const calls = async () =>
    (await readFile(path.join(root, 'fixture-requests.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  const execute = async (agent: AgentId, prompt: string, cancel = false) => {
    const events: AgentEvent[] = [];
    let end!: () => void;
    const done = new Promise<void>((resolve) => {
      end = resolve;
    });
    const service = new AgentService(files, (event) => {
      events.push(event);
      if (event.type === 'permission' || event.type === 'question')
        void service.respond(event.requestId!, event.type !== 'permission', {
          [event.questions?.[0].id ?? '']: event.questions?.[0].multiple
            ? ['Choice', 'Second']
            : 'Choice',
        });
      if (cancel && event.type === 'tool') void service.cancel();
      if (event.type === 'done') end();
    });
    t.after(() => service.cancel());
    service.start({ scopeId: space.scopeId, agent, prompt });
    if (cancel && agent === 'opencode') {
      for (
        let n = 0;
        n < 100 && !(await calls().catch(() => [])).some((c: any) => c.route?.endsWith('/message'));
        n++
      )
        await new Promise((r) => setTimeout(r, 10));
      await service.cancel();
    }
    await done;
    assert.equal(service.busy, false);
    return { events, service };
  };
  return { root, space, files, calls, execute };
}
for (const agent of ['pi', 'opencode'] as const) {
  test(
    `${agent} adapter streams, answers native dialogs, resumes and preserves failed handles (protocol fixture)`,
    fixtureOptions,
    async (t) => {
      const { root, space, files, calls, execute } = await setup(t);
      const first = await execute(agent, 'dialog');
      assert.equal(first.events.at(-1)?.outcome, 'completed', JSON.stringify(first.events));
      assert.equal(first.events.filter((e) => e.type === 'text').length, 1);
      assert.ok(!JSON.stringify(first.events).includes('DO NOT DISPLAY'));
      assert.ok(first.events.some((e) => e.type === 'permission'));
      assert.ok(first.events.some((e) => e.type === 'question'));
      const store = new SessionStore(files.dataDir);
      const binding = { scopeId: space.scopeId, root, agent };
      const handle = (await store.read(binding))!.handle;
      assert.ok(handle);
      assert.equal((await execute(agent, 'again')).events.at(-1)?.outcome, 'completed');
      if (agent === 'opencode') {
        assert.deepEqual(
          (await calls()).find((c: any) => c.route === '/question/question/reply').body.answers,
          [['Choice', 'Second']],
        );
        assert.equal(
          (await calls()).filter((c: any) => c.route === '/session' && c.method === 'POST').length,
          1,
        );
        assert.equal(
          (await calls()).find((c: any) => c.route === '/permission/permission/reply').body.reply,
          'reject',
        );
        await writeFile(path.join(root, 'fail-resume'), 'fixture');
      } else {
        assert.equal(
          (await calls()).find((c: any) => c.type === 'extension_ui_response' && c.id === 'confirm')
            .cancelled,
          true,
        );
        assert.ok(first.events.find((e) => e.type === 'text')?.text.includes('\u2028'));
        await rm(handle);
      }
      assert.equal((await execute(agent, 'again')).events.at(-1)?.outcome, 'failed');
      assert.equal((await store.read(binding))!.handle, handle);
      await first.service.resetSession(space.scopeId, agent);
      assert.equal((await store.status(binding)).state, 'empty');
    },
  );
  test(
    `${agent} adapter exposes errors and releases the mutation lock on cancellation (protocol fixture)`,
    fixtureOptions,
    async (t) => {
      const { execute } = await setup(t);
      assert.equal((await execute(agent, 'fail')).events.at(-1)?.outcome, 'failed');
      assert.equal((await execute(agent, 'hold', true)).events.at(-1)?.outcome, 'cancelled');
      assert.equal((await execute(agent, 'crash')).events.at(-1)?.outcome, 'failed');
    },
  );
}
test(
  'Pi extension-only commands complete without pretending to run a model',
  fixtureOptions,
  async (t) => {
    const { execute } = await setup(t);
    const result = await execute('pi', '/fixture');
    assert.equal(result.events.at(-1)?.outcome, 'completed');
    assert.equal(result.events.filter((e) => e.type === 'text').length, 0);
  },
);
