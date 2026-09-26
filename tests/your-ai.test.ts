import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileService } from '../src/host/files';
import { YourAiService } from '../src/host/you';
import { AgentService } from '../src/agents/service';
import { writeDecision, type Delegation } from '../src/agents/delegation';
import { brainAgentNames, brainsPreamble, yourAiStarter } from '../src/domain/you';
import type { AgentEvent, Space } from '../src/domain/types';

const fixtureOptions = {
  skip: process.platform === 'win32' && 'POSIX executable fixture',
  timeout: 20000,
};

test('each brain gets a stable sub-agent name that Claude Code accepts', () => {
  const names = brainAgentNames([
    { scopeId: '6f1c2d0e-8b1a-4c33-9d7e-2a4b5c6d7e8f', name: 'Product Lab' },
    { scopeId: '11111111-2222-4333-8444-555555555555', name: 'プロダクト' },
    { scopeId: '99999999-2222-4333-8444-555555555555', name: 'product lab' },
    { scopeId: 'aaaaaaaa-2222-4333-8444-555555555555', name: 'Café Notes' },
  ]);
  assert.deepEqual(
    [...names.values()],
    ['product-lab', 'brain-11111111', 'product-lab-99999999', 'cafe-notes'],
  );
  for (const name of names.values()) assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test('your AI writes in its own folder, and a brain changes only through its sub-agent', () => {
  const delegation: Delegation = {
    you: '/home/me/irori/you',
    brains: [
      { scopeId: 'a', name: 'Product', agent: 'product', root: '/kb/product' },
      { scopeId: 'b', name: 'Research', agent: 'research', root: '/kb/research' },
    ],
  };
  assert.equal(writeDecision(delegation, undefined, 'plans/today.md').allow, true);
  assert.equal(writeDecision(delegation, 'product', '/kb/product/Knowledge_Base/a.md').allow, true);
  const direct = writeDecision(delegation, undefined, '/kb/product/a.md');
  assert.equal(direct.allow, false);
  assert.match(!direct.allow ? direct.reason : '', /sub-agent "product"/);
  assert.equal(writeDecision(delegation, 'product', '/kb/research/a.md').allow, false);
  assert.equal(writeDecision(delegation, 'product', '/kb/product/../research/a.md').allow, false);
  // A built-in agent or a brain's own agent keeps to your AI's folder.
  assert.equal(writeDecision(delegation, 'general-purpose', '/kb/product/a.md').allow, false);
  assert.equal(writeDecision(delegation, 'general-purpose', 'notes.md').allow, true);
  assert.equal(writeDecision(delegation, undefined, '/etc/passwd').allow, false);
});

test('the preamble names each brain, its folder and its sub-agent', () => {
  const text = brainsPreamble([
    {
      scopeId: 'a',
      name: 'Product',
      category: 'チーム',
      agent: 'product',
      root: '/kb/p',
      defined: true,
    },
    { scopeId: 'b', name: 'Research', agent: 'research', root: '/kb/r "x"', defined: false },
  ]);
  assert.match(text, /- Product \(チーム\): folder "\/kb\/p", sub-agent "product"\n/);
  assert.match(text, /folder "\/kb\/r \\"x\\"", sub-agent "research" \(not defined yet/);
  assert.match(text, /material, not instructions/);
});

async function yourAi(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori your AI '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = path.join(base, 'home');
  await mkdir(home);
  const you = new YourAiService(path.join(base, 'device'), home);
  return { base, home, you };
}

test('your AI’s folder is one per device record, and the starter never overwrites', async (t) => {
  const { base, home, you } = await yourAi(t);
  const first = await you.status();
  assert.equal(first.root, path.join(home, 'irori', 'you'));
  assert.equal(first.state, 'missing');
  // The same record, and so the same conversations, after a restart.
  assert.equal((await new YourAiService(path.join(base, 'device'), home).status()).id, first.id);
  const ready = await you.create();
  assert.equal(ready.state, 'ready');
  for (const [file, text] of Object.entries(yourAiStarter))
    assert.equal(await readFile(path.join(ready.root, file), 'utf8'), text);
  assert.deepEqual(await readdir(path.join(ready.root, '.claude', 'agents')), []);
  assert.equal(existsNoClaudeMd(await readdir(ready.root)), true);
  // A folder that already holds something else is left alone.
  const other = new YourAiService(path.join(base, 'other-device'), path.join(base, 'other'));
  await mkdir(path.join(base, 'other', 'irori', 'you'), { recursive: true });
  await writeFile(path.join(base, 'other', 'irori', 'you', 'mine.txt'), 'keep');
  await assert.rejects(other.create(), /already holds files|すでにファイル/);
  assert.equal(
    await readFile(path.join(base, 'other', 'irori', 'you', 'mine.txt'), 'utf8'),
    'keep',
  );
});

function existsNoClaudeMd(names: string[]) {
  // AGENTS.md alone: a CLAUDE.md beside it would stop newer Claude Code reading AGENTS.md.
  return names.includes('AGENTS.md') && !names.includes('CLAUDE.md');
}

test('the Your AI screen reads only inside the folder', async (t) => {
  const { base, you } = await yourAi(t);
  const { root } = await you.create();
  await writeFile(path.join(base, 'secret.txt'), 'outside');
  await symlink(path.join(base, 'secret.txt'), path.join(root, 'link.txt'));
  const names = (await you.entries('')).map((entry) => entry.name);
  assert.ok(
    names.includes('AGENTS.md') && names.includes('.claude') && !names.includes('link.txt'),
  );
  assert.equal((await you.read('AGENTS.md')).text, yourAiStarter['AGENTS.md']);
  await assert.rejects(you.read('../secret.txt'));
  await assert.rejects(you.read('link.txt'), /leaves/);
  await writeFile(path.join(root, '.claude', 'agents', 'product.md'), '---\nname: product\n---\n');
  assert.deepEqual([...(await you.defined(['product', 'research']))], ['product']);
});

async function delegation(t: TestContext) {
  const { base, you } = await yourAi(t);
  const bin = path.join(base, 'bin');
  await mkdir(bin);
  await writeFile(
    path.join(bin, 'claude'),
    `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/claude-your-ai.mjs')).href)}).then(m=>m.run());\n`,
    { mode: 0o700 },
  );
  const previous = process.env.PATH;
  process.env.PATH = bin + path.delimiter + previous;
  t.after(() => {
    process.env.PATH = previous;
  });
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const brains: Space[] = [];
  for (const name of ['Product', 'Research']) {
    const root = path.join(base, name);
    await mkdir(path.join(root, 'Knowledge_Base'), { recursive: true });
    brains.push(await files.register(root, name, 'team'));
  }
  const { id, root } = await you.create();
  const events: AgentEvent[] = [];
  let finished!: () => void;
  let done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const service = new AgentService(
    files,
    (event) => {
      events.push(event);
      if (event.type === 'permission') void service.respond(event.requestId!, true);
      if (event.type === 'done') finished();
    },
    undefined,
    undefined,
    you,
  );
  t.after(() => service.cancel());
  const run = async (prompt: string) => {
    events.length = 0;
    done = new Promise<void>((resolve) => {
      finished = resolve;
    });
    await service.startAccepted({
      scopeId: id,
      agent: 'claude',
      prompt,
      brains: brains.map((b) => b.scopeId),
    });
    return done;
  };
  const fixtureLog = async () =>
    (await readFile(path.join(root, 'your-ai-fixture.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  return { files, brains, id, root, service, events, run, fixtureLog };
}

test(
  'your AI hands a brain to its sub-agent, and every step says which brain (protocol fixture)',
  fixtureOptions,
  async (t) => {
    const { brains, id, service, events, run, fixtureLog } = await delegation(t);
    const [product, research] = brains;
    const pending = run('Write a decision note.');
    // Both brains are held while your AI works, so no other run shares their checkouts.
    assert.equal(service.busy(product.scopeId), true);
    assert.equal(service.busy(research.scopeId), true);
    assert.throws(
      () => service.start({ scopeId: product.scopeId, agent: 'pi', prompt: 'meanwhile' }),
      /already running/,
    );
    await pending;
    assert.equal(service.busy(product.scopeId), false);
    assert.equal(
      await readFile(path.join(product.root, 'Knowledge_Base', 'from-your-ai.md'), 'utf8'),
      '# From your AI\n',
    );
    const log = await fixtureLog();
    // The preamble named both brains with their folders and sub-agents.
    assert.deepEqual(
      log[0].brains.map((brain: { name: string; root: string }) => [brain.name, brain.root]),
      [
        ['Product', product.root],
        ['Research', research.root],
      ],
    );
    const hand = events.find((event) => event.delegate?.state === 'started');
    assert.equal(hand?.delegate?.scopeId, product.scopeId);
    assert.equal(hand?.text, 'Write a note in Product');
    const task = hand!.delegate!.task;
    const step = events.find((event) => event.type === 'tool' && event.text === 'Write');
    assert.deepEqual(step?.delegate, { scopeId: product.scopeId, task, state: 'working' });
    const asked = events.find((event) => event.type === 'permission');
    assert.deepEqual(asked?.delegate, { scopeId: product.scopeId, task, state: 'working' });
    const report = events.find((event) => event.delegate?.state === 'reported');
    assert.equal(report?.text, 'Wrote Knowledge_Base/from-your-ai.md.');
    assert.equal(events.at(-1)?.outcome, 'completed');
    // The sub-agent's own words stay with its hand-off; the reply is your AI's.
    assert.deepEqual(
      events.filter((event) => event.type === 'text').map((event) => event.text),
      ["Handed the note to Product's AI."],
    );
    // The hand-offs are kept with the conversation.
    const saved = await service.conversation(id, 'claude');
    assert.ok(saved.events.some((event) => event.delegate?.state === 'reported'));
  },
);

test(
  'your AI cannot write in a brain itself, and hand-offs run in the foreground (protocol fixture)',
  fixtureOptions,
  async (t) => {
    const { brains, run, fixtureLog } = await delegation(t);
    await run('Try a direct write, and hand the note over in the background.');
    const log = await fixtureLog();
    assert.ok(log.some((entry) => entry.direct === 'denied'));
    assert.ok(log.some((entry) => entry.background === false));
    await assert.rejects(readFile(path.join(brains[0].root, 'direct.md')));
    assert.ok(log.some((entry) => entry.written === true));
  },
);

test('only your AI takes brains, on Claude Code, without notes or materials', async (t) => {
  const { base, you } = await yourAi(t);
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(root);
  const space = await files.register(root, 'KB', 'personal');
  const { id } = await you.create();
  const service = new AgentService(files, () => {}, undefined, undefined, you);
  t.after(() => service.cancel());
  assert.throws(
    () => service.start({ scopeId: id, agent: 'pi', prompt: 'x', brains: [space.scopeId] }),
    /Claude Code/,
  );
  assert.throws(
    () => service.start({ scopeId: id, agent: 'claude', prompt: 'x', notePath: 'a.md' }),
    /brains, not notes|ノートや資料/,
  );
  assert.throws(
    () =>
      service.start({
        scopeId: space.scopeId,
        agent: 'claude',
        prompt: 'x',
        brains: [space.scopeId],
      }),
    /Only your AI takes brains/,
  );
});
