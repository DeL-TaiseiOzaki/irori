import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileService } from '../src/host/files';
import { AgentService } from '../src/agents/service';
import { SessionStore, sessionKey } from '../src/agents/sessions';
import type { AgentEvent, AgentId, StartRun } from '../src/domain/types';
import { classify } from '../src/domain/scopes';

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
  const execute = async (
    agent: AgentId,
    prompt: string,
    cancel = false,
    extra: Partial<StartRun> = {},
  ) => {
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
    service.start({ scopeId: space.scopeId, agent, prompt, ...extra });
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

test(
  'Durable queue claims launch once, retain history and reject session resets with pending messages',
  fixtureOptions,
  async (t) => {
    const { space, files, calls } = await setup(t);
    let completed!: () => void;
    const done = new Promise<void>((resolve) => {
      completed = resolve;
    });
    const service = new AgentService(files, (event) => {
      if (event.type === 'done') completed();
    });
    t.after(() => service.cancel());
    const input = {
      scopeId: space.scopeId,
      agent: 'pi' as const,
      prompt: 'queued instruction',
      notePath: 'note.md',
    };
    await service.queueMessage(input);
    const queue = await service.queueMessage({ ...input, prompt: 'keep pending' });
    await assert.rejects(service.resetSession(space.scopeId, 'pi'), /送信待ち/);
    const starts = await Promise.allSettled([
      service.startQueued(space.scopeId, 'pi', queue[0].id),
      service.startQueued(space.scopeId, 'pi', queue[0].id),
    ]);
    assert.equal(starts.filter((result) => result.status === 'fulfilled').length, 1);
    await done;
    assert.equal((await calls()).filter((call: any) => call.type === 'prompt').length, 1);
    await assert.rejects(service.startQueued(space.scopeId, 'pi', queue[0].id), /順序/);
    const restarted = new AgentService(files, () => {});
    const recovered = await restarted.conversation(space.scopeId, 'pi');
    assert.equal(recovered.queued[0].prompt, 'keep pending');
    assert.equal(recovered.events.filter((event) => event.role === 'user').length, 1);
    assert.equal(recovered.events.at(-1)?.outcome, 'completed');
    await restarted.removeQueued(space.scopeId, 'pi', queue[1].id);
    await restarted.resetSession(space.scopeId, 'pi');
    assert.deepEqual((await restarted.conversation(space.scopeId, 'pi')).events, recovered.events);
    const filename = path.join(
      files.dataDir,
      'agent-conversations',
      sessionKey({
        scopeId: space.scopeId,
        agent: 'pi',
        root: space.root,
      }) + '.json',
    );
    await writeFile(filename, '{broken');
    const damaged = new AgentService(files, () => {});
    await assert.rejects(damaged.startAccepted(input));
    await damaged.cancel();
    assert.equal((await calls()).filter((call: any) => call.type === 'prompt').length, 1);
    assert.equal(await readFile(filename, 'utf8'), '{broken');
  },
);

test(
  'A chosen skill reaches the harness ahead of the request, and an undeclared one stops the run',
  fixtureOptions,
  async (t) => {
    const { root, space, calls, execute } = await setup(t);
    await mkdir(path.join(root, '.agents', 'skills', 'distill'), { recursive: true });
    await writeFile(
      path.join(root, '.agents', 'skills', 'distill', 'SKILL.md'),
      '---\nname: distill\ndescription: Files yesterday.\n---\n\nOnly ever append.\n',
    );

    const run = await execute('pi', 'sort out yesterday', false, {
      skill: 'distill',
      notePath: 'note.md',
      sources: [{ scopeId: space.scopeId, path: 'note.md' }],
    });
    assert.equal(run.events.at(-1)?.outcome, 'completed', JSON.stringify(run.events));
    assert.ok(
      run.events.some((e) => e.type === 'status' && e.text.includes('distill')),
      'the conversation records which skill ran',
    );
    const sent = (await calls()).find((call: any) => call.type === 'prompt').message as string;
    assert.ok(sent.includes('Only ever append.'), 'the instructions are delivered');
    assert.ok(
      sent.indexOf('Only ever append.') < sent.indexOf('sort out yesterday'),
      'the request stays last',
    );
    assert.ok(
      sent.indexOf('Explicitly selected source observations') < sent.indexOf('sort out yesterday'),
      'selected-source context also precedes the user request',
    );
    assert.ok(sent.endsWith('sort out yesterday'), 'nothing follows the user request');

    const refused = await execute('pi', 'sort out yesterday', false, { skill: 'promote' });
    assert.equal(refused.events.at(-1)?.outcome, 'failed');
    assert.ok(refused.events.some((e) => e.type === 'error' && e.text.includes('promote')));
  },
);

test(
  "Running a harness adds no agent configuration to the user's KB",
  fixtureOptions,
  async (t) => {
    const { root, space, execute } = await setup(t);
    // claudian creates .claude/, .claude/commands, .claude/skills and .claude/agents in
    // the vault when its plugin loads. irori reads that layer and never writes it: a KB
    // must look the same after a turn as before one, in its schema layer.
    const schema = async () =>
      (await readdir(root))
        .filter((entry) => classify(space, entry) === 'schema')
        .sort()
        .join(' ');
    const before = await schema();
    assert.equal(
      before,
      '.gitignore .irori',
      'registration writes its own scope metadata and ignores contents',
    );
    for (const agent of ['pi', 'opencode'] as const) {
      const run = await execute(agent, 'ordinary request');
      assert.equal(run.events.at(-1)?.outcome, 'completed', JSON.stringify(run.events));
      assert.equal(await schema(), before, `${agent} left the schema layer unchanged`);
    }
    assert.equal(
      (await readdir(root)).includes('.claude'),
      false,
      'no harness directory appears in the KB',
    );
  },
);
