import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileService } from '../src/host/files';
import { AgentService } from '../src/agents/service';
import { SessionStore, sessionKey } from '../src/agents/sessions';
import type { AgentEvent, AgentId, StartRun } from '../src/domain/types';
import { classify } from '../src/domain/scopes';
import { AuthorshipStore } from '../src/knowledge/authorship';
import { addNoteComment } from '../src/host/comments';
import { withRequests } from '../src/domain/conversation';
import { ModelCatalog, parseOpenCodeModels, parsePiModels } from '../src/agents/models';
import { piModelArgs } from '../src/agents/pi';
import { hostArguments } from '../src/domain/host-requests';
import { openCodeModel } from '../src/agents/opencode';

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
  for (const id of ['pi', 'opencode', 'hermes'])
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
    assert.equal(service.busy(space.scopeId), false);
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
  'OpenCode sends explicit session permissions, renews them on resume and fails before prompting if unconfirmed',
  fixtureOptions,
  async (t) => {
    const { root, calls, execute } = await setup(t);
    await execute('opencode', 'native default');
    for (const prompt of ['full first', 'full continued']) {
      const result = await execute('opencode', prompt, false, { access: 'full-access' });
      assert.equal(result.events.at(-1)?.outcome, 'completed', JSON.stringify(result.events));
    }
    await execute('opencode', 'native again');
    const permission = [{ permission: '*', pattern: '*', action: 'allow' }];
    const requests = await calls();
    assert.deepEqual(
      requests
        .filter((c: any) => c.route === '/session' && c.method === 'POST')
        .map((c: any) => c.body?.permission),
      [undefined, permission, undefined],
      'changing access uses a fresh session; standard mode does not override native config',
    );
    assert.deepEqual(requests.find((c: any) => c.method === 'PATCH').body.permission, permission);
    await writeFile(path.join(root, 'ignore-access'), 'fixture');
    const failed = await execute('opencode', 'must not reach provider', false, {
      access: 'full-access',
    });
    assert.equal(failed.events.at(-1)?.outcome, 'failed');
    assert.ok(failed.events.some((e) => e.type === 'error' && e.text.includes('アクセス設定')));
    assert.equal((await calls()).filter((c: any) => c.route.endsWith('/message')).length, 4);
  },
);
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

    // A retired name fails with the reason the KB wrote down, not as an unknown skill.
    await mkdir(path.join(root, '.agents', 'skills', 'old'), { recursive: true });
    await writeFile(
      path.join(root, '.agents', 'skills', 'old', 'RETIRED.md'),
      '---\nretired: 2026-09-21\nreason: Folded into distill.\nreplacement: distill\n---\n',
    );
    const retired = await execute('pi', 'sort out yesterday', false, { skill: 'old' });
    assert.equal(retired.events.at(-1)?.outcome, 'failed');
    assert.ok(
      retired.events.some(
        (e) =>
          e.type === 'error' && e.text.includes('退役') && e.text.includes('Folded into distill'),
      ),
    );
  },
);

test(
  "The person's lines reach the request only when the person asks",
  fixtureOptions,
  async (t) => {
    const { root, space, files, calls, execute } = await setup(t);
    const text = '# Fixture\n\nAn agent paragraph.\nMy own sentence.\n';
    await writeFile(path.join(root, 'note.md'), text);
    await new AuthorshipStore(files.dataDir).observe(
      { scopeId: space.scopeId, path: 'note.md' },
      text,
      '# Fixture\n\nAn agent paragraph.\n',
    );
    const sent = async (extra: Partial<StartRun>) => {
      const run = await execute('pi', 'tidy the note', false, { notePath: 'note.md', ...extra });
      assert.equal(run.events.at(-1)?.outcome, 'completed', JSON.stringify(run.events));
      return (await calls()).filter((call: any) => call.type === 'prompt').at(-1).message as string;
    };
    assert.ok(!(await sent({})).includes('wrote or revised'), 'not on every turn');
    const asked = await sent({ personLines: true });
    assert.ok(asked.includes('wrote or revised lines 4 of that note'), asked);
    assert.ok(asked.endsWith('tidy the note'), 'the request stays last');
  },
);

test(
  "A hibachi agent is given its note's comments, and otherwise where the hibachi keeps them",
  fixtureOptions,
  async (t) => {
    const { root, space, files, calls, execute } = await setup(t);
    await writeFile(path.join(root, 'other.md'), '# Other\n');
    const sent = async (extra: Partial<StartRun>) => {
      const run = await execute('pi', 'address the comments', false, extra);
      assert.equal(run.events.at(-1)?.outcome, 'completed', JSON.stringify(run.events));
      return (await calls()).filter((call: any) => call.type === 'prompt').at(-1).message as string;
    };
    assert.ok(!(await sent({ notePath: 'note.md' })).includes('.irori/comments'), 'none, no words');
    await addNoteComment(
      files,
      { userEmail: async () => 'alice@example.com' },
      space.scopeId,
      'note.md',
      {
        body: 'Say what the fixture is for.',
        quote: 'Fixture',
        line: 1,
      },
    );
    const onNote = await sent({ notePath: 'note.md' });
    assert.ok(onNote.includes('".irori/comments/note.md.json"'), onNote);
    assert.ok(
      onNote.includes('- line 1, on "Fixture" (human:alice): Say what the fixture is for.'),
      onNote,
    );
    assert.ok(onNote.endsWith('address the comments'), 'the request stays last');
    const elsewhere = await sent({ notePath: 'other.md' });
    assert.ok(elsewhere.includes('This hibachi has 1 comment from people on 1 file'), elsewhere);
    assert.ok(!elsewhere.includes('Say what the fixture is for.'), elsewhere);
    assert.ok((await sent({})).includes('This hibachi has 1 comment'), 'without a note as well');
  },
);

test(
  "Before a file tool would change the person's lines, Pi and OpenCode hear which, once",
  fixtureOptions,
  async (t) => {
    const { root, space, files, calls, execute } = await setup(t);
    const text = '# Fixture\n\nAn agent paragraph.\nMy own sentence.\n';
    await writeFile(path.join(root, 'note.md'), text);
    await new AuthorshipStore(files.dataDir).observe(
      { scopeId: space.scopeId, path: 'note.md' },
      text,
      '# Fixture\n\nAn agent paragraph.\n',
    );
    const hooks = async (agent: AgentId, prompt: string) => {
      const before = (await calls().catch(() => [])).length;
      const run = await execute(agent, prompt);
      assert.equal(run.events.at(-1)?.outcome, 'completed', JSON.stringify(run.events));
      return (await calls())
        .slice(before)
        .filter((call: any) => call.type === 'hook')
        .map((call: any) => call.reason as string | undefined);
    };
    for (const agent of ['pi', 'opencode'] as const) {
      const [held, again] = await hooks(agent, 'rewrite line 4');
      assert.match(held!, /line 4: "My own sentence\."/, `${agent} hears which line`);
      assert.match(held!, /a record, not an instruction/);
      assert.match(held!, /the same call again runs it/);
      assert.equal(again, undefined, `${agent}: the same call again runs`);
      assert.deepEqual(await hooks(agent, 'rewrite line 3'), [undefined, undefined], agent);
    }
    // The script each CLI loads is irori's own, outside the KB.
    assert.ok(!(await readdir(root)).some((entry) => entry.includes('person-lines')));
    assert.deepEqual((await readdir(path.join(files.dataDir, 'agents'))).sort(), [
      'person-lines-opencode.js',
      'person-lines-pi.js',
    ]);
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
    for (const agent of ['pi', 'opencode', 'hermes'] as const) {
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

test(
  'Two brains run at once, and a waiting request can be answered from a freshly read conversation',
  fixtureOptions,
  async (t) => {
    const { space, files } = await setup(t);
    const otherRoot = path.join(path.dirname(space.root), 'Other KB');
    await mkdir(otherRoot);
    const other = await files.register(otherRoot, 'Other', 'team');
    const ended = new Map<string, () => void>();
    const done = (scopeId: string) =>
      new Promise<void>((resolve) => {
        ended.set(scopeId, resolve);
      });
    const waiting = new Map<string, () => void>();
    const asked = (scopeId: string) =>
      new Promise<void>((resolve) => {
        waiting.set(scopeId, resolve);
      });
    const service = new AgentService(files, (event) => {
      if (event.type === 'permission' || event.type === 'question') waiting.get(event.scopeId!)?.();
      if (event.type === 'done') ended.get(event.scopeId!)?.();
    });
    t.after(() => service.cancel());
    const firstAsked = asked(space.scopeId);
    const secondAsked = asked(other.scopeId);
    const firstDone = done(space.scopeId);
    const secondDone = done(other.scopeId);
    await service.startAccepted({ scopeId: space.scopeId, agent: 'pi', prompt: 'dialog' });
    await service.startAccepted({ scopeId: other.scopeId, agent: 'pi', prompt: 'dialog' });
    await Promise.all([firstAsked, secondAsked]);
    assert.deepEqual(service.runningScopes().sort(), [space.scopeId, other.scopeId].sort());
    // The saved history holds the request as text; the snapshot carries the live one.
    const read = await service.conversation(other.scopeId, 'pi');
    assert.equal(read.requests?.length, 1);
    assert.equal(
      read.events.some((event) => event.type === 'permission'),
      false,
    );
    const [request] = withRequests(read).filter((event) => event.requestId);
    assert.equal(request.requestId, read.requests![0].requestId);
    assert.equal(
      withRequests(read).filter((event) => event.text === request.text).length,
      1,
      'the status line is replaced, not repeated',
    );
    assert.deepEqual((await service.conversation(space.scopeId, 'pi')).requests?.length, 1);
    // Answering one brain leaves the other waiting.
    const input = asked(other.scopeId);
    service.respond(request.requestId!, false);
    await input;
    const next = (await service.conversation(other.scopeId, 'pi')).requests!;
    assert.equal(next.length, 1);
    assert.notEqual(next[0].requestId, request.requestId);
    service.respond(next[0].requestId!, true, { [next[0].questions?.[0].id ?? '']: 'Choice' });
    await secondDone;
    assert.equal(service.busy(other.scopeId), false);
    assert.equal(service.busy(space.scopeId), true);
    assert.deepEqual((await service.conversation(other.scopeId, 'pi')).requests, []);
    await service.cancel(space.scopeId);
    await firstDone;
  },
);

test(
  'Hermes Agent streams stream-json, saves and resumes its session, and passes model and access (protocol fixture)',
  fixtureOptions,
  async (t) => {
    const { root, space, files, calls, execute } = await setup(t);
    const hermes = async () => (await calls()).filter((call: any) => call.kind === 'hermes');
    const first = await execute('hermes', 'ordinary request');
    assert.equal(first.events.at(-1)?.outcome, 'completed', JSON.stringify(first.events));
    assert.deepEqual(
      first.events.filter((e) => e.type === 'text').map((e) => e.text),
      ['日本語\u2028', 'の応答'],
      'deltas stream, and the final text is not repeated',
    );
    assert.deepEqual(
      first.events.filter((e) => e.type === 'tool').map((e) => e.text),
      ['read_file', 'read_file'],
    );
    assert.match(await readFile(path.join(root, 'note.md'), 'utf8'), /Fixture Hermes edit/);
    // The prompt travels on stdin, never on the command line.
    const [call] = await hermes();
    assert.equal(call.prompt, 'ordinary request');
    assert.deepEqual(call.args, ['chat', '--query-file', '-', '--format', 'stream-json']);
    const store = new SessionStore(files.dataDir);
    const binding = { scopeId: space.scopeId, root, agent: 'hermes' as const };
    assert.equal((await store.read(binding))!.handle, '20260927_120000_fixture');

    const full = await execute('hermes', 'rotate', false, {
      access: 'full-access',
      model: 'anthropic/claude-x',
    });
    assert.equal(full.events.at(-1)?.outcome, 'completed', JSON.stringify(full.events));
    assert.ok(
      full.events.some((e) => e.type === 'status' && e.text.includes('anthropic/claude-x')),
    );
    // A new access mode starts a new conversation; the model and --yolo are passed.
    assert.deepEqual((await hermes()).at(-1).args.slice(5), ['-m', 'anthropic/claude-x', '--yolo']);
    assert.equal((await store.read(binding))!.handle, '20260927_120500_rotated');
    const resumed = await execute('hermes', 'final only', false, { access: 'full-access' });
    assert.equal(resumed.events.at(-1)?.outcome, 'completed', JSON.stringify(resumed.events));
    assert.deepEqual((await hermes()).at(-1).args.slice(5), [
      '--resume',
      '20260927_120500_rotated',
      '--yolo',
    ]);
    assert.deepEqual(
      resumed.events.filter((e) => e.type === 'text').map((e) => e.text),
      ['日本語\u2028の応答'],
      'the final text stands in when no delta carried it',
    );

    assert.equal(
      (await execute('hermes', 'fail', false, { access: 'full-access' })).events.at(-1)?.outcome,
      'failed',
    );
    const crashed = await execute('hermes', 'crash', false, { access: 'full-access' });
    assert.equal(crashed.events.at(-1)?.outcome, 'failed');
    assert.ok(
      crashed.events.some(
        (e) => e.type === 'error' && /without a result|結果を返さず/.test(e.text),
      ),
    );
    const held = await execute('hermes', 'hold', true, { access: 'full-access' });
    assert.equal(held.events.at(-1)?.outcome, 'cancelled');
    await writeFile(path.join(root, 'fail-resume'), 'fixture');
    const lost = await execute('hermes', 'again', false, { access: 'full-access' });
    assert.equal(lost.events.at(-1)?.outcome, 'failed');
    assert.ok(lost.events.some((e) => e.type === 'error' && e.text.includes('Session not found')));
    assert.equal(
      (await store.read(binding))!.handle,
      '20260927_120500_rotated',
      'a failed resume keeps its handle',
    );
  },
);

test('Each CLI gets the chosen model in its own form', fixtureOptions, async (t) => {
  assert.deepEqual(piModelArgs(), []);
  assert.deepEqual(piModelArgs('anthropic/claude-x'), [
    '--provider',
    'anthropic',
    '--model',
    'claude-x',
  ]);
  assert.deepEqual(piModelArgs('claude-x'), ['--model', 'claude-x']);
  assert.deepEqual(openCodeModel('openrouter/vendor/model'), {
    providerID: 'openrouter',
    modelID: 'vendor/model',
  });
  assert.throws(() => openCodeModel('no-provider'), /provider\/model|プロバイダ/);
  const { calls, execute } = await setup(t);
  for (const agent of ['pi', 'opencode'] as const) {
    const run = await execute(agent, 'ordinary request', false, {
      model: 'anthropic/claude-fixture',
    });
    assert.equal(run.events.at(-1)?.outcome, 'completed', JSON.stringify(run.events));
  }
  const log = await calls();
  assert.deepEqual(log.find((call: any) => call.route?.endsWith('/message')).body.model, {
    providerID: 'anthropic',
    modelID: 'claude-fixture',
  });
  assert.deepEqual(
    log
      .filter((call: any) => call.type === 'launch')
      .at(-1)
      .args.slice(2, 6),
    ['--provider', 'anthropic', '--model', 'claude-fixture'],
  );
  // A model is an argument to the CLI: never an option.
  const service = new AgentService((await setup(t)).files, () => {});
  assert.throws(() =>
    service.start({ scopeId: randomUUID(), agent: 'pi', prompt: 'x', model: '--yolo' }),
  );
});

test('Model lists are read from each installed CLI once per version', fixtureOptions, async (t) => {
  assert.deepEqual(
    parseOpenCodeModels('anthropic/a\nnoise line\n\x1b[1mopenai/b\x1b[0m\nanthropic/a\n'),
    [
      { id: 'anthropic/a', label: 'anthropic/a' },
      { id: 'openai/b', label: 'openai/b' },
    ],
  );
  assert.deepEqual(parsePiModels('No models available. Log in first.'), []);
  await setup(t);
  const catalog = new ModelCatalog();
  assert.deepEqual(await catalog.models('opencode'), {
    models: [
      { id: 'anthropic/claude-fixture', label: 'anthropic/claude-fixture' },
      { id: 'openrouter/vendor/model-x', label: 'openrouter/vendor/model-x' },
    ],
    custom: false,
  });
  assert.deepEqual(
    (await catalog.models('pi')).models.map((model) => model.id),
    ['anthropic/claude-fixture', 'openai/gpt-fixture'],
  );
  // The renderer may ask only for a known CLI.
  assert.equal(hostArguments.agentModels.safeParse(['hermes']).success, true);
  assert.equal(hostArguments.agentModels.safeParse(['gpt']).success, false);
  // Hermes prints no list: a model is typed in.
  assert.deepEqual(await catalog.models('hermes'), { models: [], custom: true });
  let reads = 0;
  const counted = new ModelCatalog(async () => {
    reads++;
    return [{ id: 'm', label: 'M' }];
  });
  await counted.models('pi');
  await counted.models('pi');
  assert.equal(reads, 1, 'kept for the same CLI version');
  // A stand-in answers `claude --version`, so the check does not depend on Claude Code being installed.
  const bin = process.env.PATH!.split(path.delimiter)[0];
  await writeFile(
    path.join(bin, 'claude'),
    `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/harnesses.mjs')).href)}).then(m=>m.run('claude'));\n`,
    { mode: 0o700 },
  );
  const failing = new ModelCatalog(async () => {
    throw Error('unreachable');
  });
  const failed = await failing.models('claude');
  assert.equal(failed.custom, true);
  assert.match(failed.error!, /unreachable/);
  assert.ok(
    failed.models.some((model) => model.id === 'sonnet'),
    'Claude Code aliases stand in',
  );
});
