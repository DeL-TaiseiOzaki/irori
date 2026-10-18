import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileService } from '../src/host/files';
import { YourAiService } from '../src/host/you';
import { SearchService } from '../src/host/search';
import { SchemaSettingsService } from '../src/host/schema-settings';
import { readFolderSkills } from '../src/host/skills';
import { AgentService } from '../src/agents/service';
import { defaultAgentAccess } from '../src/domain/agent-access';
import { writeDecision, type Delegation } from '../src/agents/delegation';
import { brainAgentNames } from '../src/domain/you';
import { iroriAgentSkills, yourAiStarter } from '../prompts';
import type { AgentEvent, Space } from '../src/domain/types';

const fixtureOptions = {
  skip: process.platform === 'win32' && 'POSIX executable fixture',
  timeout: 20000,
};

test('each vault gets a stable vault agent name vault-<slug>', () => {
  const names = brainAgentNames([
    { scopeId: '6f1c2d0e-8b1a-4c33-9d7e-2a4b5c6d7e8f', name: 'Product Lab' },
    { scopeId: '11111111-2222-4333-8444-555555555555', name: 'プロダクト' },
    { scopeId: '99999999-2222-4333-8444-555555555555', name: 'product lab' },
    { scopeId: 'aaaaaaaa-2222-4333-8444-555555555555', name: 'Café Notes' },
  ]);
  assert.deepEqual(
    [...names.values()],
    ['vault-product-lab', 'vault-11111111', 'vault-product-lab-99999999', 'vault-cafe-notes'],
  );
  for (const name of names.values()) assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test('your AI writes in its own folder; a vault changes only through its vault agent', () => {
  const delegation: Delegation = {
    you: '/home/me/irori/you',
    brains: [
      { scopeId: 'a', name: 'Product', agent: 'vault-product', root: '/kb/product' },
      { scopeId: 'b', name: 'Research', agent: 'vault-research', root: '/kb/research' },
    ],
  };
  assert.equal(writeDecision(delegation, 'plans/today.md').allow, true);
  // A name that only starts with two dots is still inside the folder.
  assert.equal(writeDecision(delegation, '..plans/today.md').allow, true);
  assert.equal(writeDecision(delegation, '../elsewhere.md').allow, false);
  // A vault is its vault agent's: your AI, and any sub-agent of its own, hands it
  // the work with `irori call` (ADR 050).
  const direct = writeDecision(delegation, '/kb/product/a.md');
  assert.equal(direct.allow, false);
  assert.match(!direct.allow ? direct.reason : '', /irori call vault-product/);
  assert.equal(writeDecision(delegation, '/kb/product/../research/a.md').allow, false);
  assert.equal(writeDecision(delegation, '/etc/passwd').allow, false);
  // A vault's work folder is scratch: your AI may write there.
  const working: Delegation = {
    ...delegation,
    brains: [
      { ...delegation.brains[0], work: '/kb/product/.irori/work' },
      { ...delegation.brains[1], work: '/home/me/Documents/research work' },
    ],
  };
  assert.equal(writeDecision(working, '/kb/product/.irori/work/try.py').allow, true);
  assert.equal(writeDecision(working, '/kb/product/a.md').allow, false);
  assert.equal(writeDecision(working, '/home/me/Documents/research work/x.csv').allow, true);
  assert.equal(writeDecision(working, '/home/me/Documents/x.csv').allow, false);
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
  // No vault agent definitions: the irori agent hands vaults with `irori call` (ADR 050).
  assert.equal(existsSync(path.join(ready.root, '.claude', 'agents')), false);
  assert.deepEqual(Object.keys(yourAiStarter), ['AGENTS.md']);
  assert.match(yourAiStarter['AGENTS.md'], /irori call <name> "<task>"/);
  // The standard skills, and nothing else, under .agents.
  assert.deepEqual(
    (await readdir(path.join(ready.root, '.agents', 'skills'))).sort(),
    Object.keys(iroriAgentSkills).sort(),
  );
  assert.deepEqual(ready.missingSkills, []);
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
    names.includes('AGENTS.md') && names.includes('.agents') && !names.includes('link.txt'),
  );
  assert.equal((await you.read('AGENTS.md')).text, yourAiStarter['AGENTS.md']);
  await assert.rejects(you.read('../secret.txt'));
  await assert.rejects(you.read('link.txt'), /leaves/);
});

test('the irori agent’s folder takes the same Schema settings as a vault, confined to it', async (t) => {
  const { base, you } = await yourAi(t);
  const { id, root } = await you.create();
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const service = new SchemaSettingsService(files, new SearchService(files), (scopeId) => {
    assert.equal(scopeId, id);
    return you.schemaFolder();
  });
  await mkdir(path.join(root, 'plans'));
  await writeFile(path.join(root, 'plans', 'AGENTS.md'), '# not instructions\n');
  const listing = await service.list(id);
  // Only the root AGENTS.md: the folder has no knowledge folders.
  assert.deepEqual(listing.instructions, ['AGENTS.md']);
  assert.deepEqual(listing.folders, []);
  await assert.rejects(service.read(id, 'plans/AGENTS.md'), /cannot be changed|変更できません/);
  await assert.rejects(
    service.write(id, 'plans/b/AGENTS.md', '# b\n', null),
    /cannot be changed|変更できません/,
  );
  // The instructions, a rule, hooks and a skill, hash-checked as for a vault.
  const agents = await service.read(id, 'AGENTS.md');
  assert.equal(agents.text, yourAiStarter['AGENTS.md']);
  await service.write(id, 'AGENTS.md', '# Mine\n', agents.hash);
  await assert.rejects(service.write(id, 'AGENTS.md', '# Again\n', agents.hash), /CONFLICT/);
  const mine = await service.read(id, 'AGENTS.md');
  await assert.rejects(
    service.write(id, 'AGENTS.md', null, mine.hash),
    /cannot be changed|変更できません/,
  );
  await service.write(id, '.claude/rules/tone.md', 'Be brief.\n', null);
  await service.write(id, '.claude/settings.json', '{"hooks":{}}\n', null);
  await service.write(
    id,
    '.agents/skills/plan/SKILL.md',
    '---\nname: plan\ndescription: Plans a week.\n---\n\nPlan.\n',
    null,
  );
  const after = await service.list(id);
  assert.deepEqual(after.rules, ['.claude/rules/tone.md']);
  assert.equal(after.claudeSettings, true);
  // Its skills are listed from its own .agents/skills, as a vault's are,
  // the standard skills irori wrote when the folder was made among them.
  const standard = Object.keys(iroriAgentSkills);
  const skills = await readFolderSkills(await you.schemaFolder());
  assert.deepEqual(skills.skills.map((skill) => skill.name).sort(), [...standard, 'plan'].sort());
  await service.moveSkill(id, 'plan', 'weekly');
  assert.deepEqual(
    (await readdir(path.join(root, '.agents', 'skills'))).sort(),
    [...standard, 'weekly'].sort(),
  );
  // A sub-agent definition is not a setting, and no alias leads out of the folder.
  await mkdir(path.join(root, '.claude', 'agents'), { recursive: true });
  await writeFile(path.join(root, '.claude', 'agents', 'vault-p.md'), '---\nname: vault-p\n---\n');
  await assert.rejects(
    service.read(id, '.claude/agents/vault-p.md'),
    /cannot be changed|変更できません/,
  );
  const outside = path.join(base, 'outside');
  await mkdir(outside);
  await rm(path.join(root, '.claude', 'rules'), { recursive: true });
  await symlink(outside, path.join(root, '.claude', 'rules'));
  await assert.rejects(
    service.write(id, '.claude/rules/x.md', 'x\n', null),
    /cannot be changed|変更できません/,
  );
  assert.deepEqual(await readdir(outside), []);
});

// A Codex app server whose turn waits for a `release` file in its folder.
const heldCodex = `#!/usr/bin/env node
const fs = require('node:fs');
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
const thread = 'fixture-thread-' + process.pid;
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (!m.method || m.id === undefined) return;
  fs.appendFileSync('protocol.jsonl', JSON.stringify({ method: m.method, threadId: m.params.threadId }) + '\\n');
  if (m.method !== 'turn/start') return send({ id: m.id, result: { thread: { id: thread } } });
  send({ id: m.id, result: { turn: { id: 'turn-' + process.pid } } });
  const timer = setInterval(() => {
    if (!fs.existsSync('release')) return;
    clearInterval(timer);
    send({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
  }, 50);
});
`;

test(
  'two threads of the irori agent run at once in its folder, each with its own session, kept to its workspace (protocol fixture)',
  fixtureOptions,
  async (t) => {
    const { base, you } = await yourAi(t);
    const bin = path.join(base, 'bin');
    await mkdir(bin);
    await writeFile(path.join(bin, 'codex'), heldCodex, { mode: 0o700 });
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
    const service = new AgentService(
      files,
      (event) => events.push(event),
      undefined,
      undefined,
      you,
    );
    t.after(() => service.cancel());
    const [here, there] = [
      '8f0c1d84-63c5-4a5e-9d7e-0d3c8d0f2a11',
      'a3b9e6f2-5c47-4e8b-b1d2-7f6e5d4c3b2a',
    ];
    const start = (prompt: string) =>
      service.startAccepted({
        scopeId: id,
        agent: 'codex',
        access: 'full-access',
        prompt,
        brains: brains.map((brain) => brain.scopeId),
        workspace: here,
        conversationId: service.createConversation(id, 'codex', here),
      });
    const runs = await Promise.all([start('First thread'), start('Second thread')]);
    const conversationOf = (runId: string) =>
      events.find((event) => event.runId === runId && event.conversationId)!.conversationId!;
    const [one, two] = runs.map(conversationOf);
    assert.notEqual(one, two);
    assert.equal(service.running(id), true);
    const rows = await service.conversationList(id, here);
    assert.deepEqual(
      rows.filter((row) => 'running' in row && row.running).length,
      2,
      'both run at once',
    );
    await writeFile(path.join(root, 'release'), '');
    const ended = () =>
      runs.every((runId) => events.some((event) => event.runId === runId && event.type === 'done'));
    while (!ended()) await new Promise((resolve) => setTimeout(resolve, 50));
    for (const runId of runs)
      assert.equal(
        events.find((event) => event.runId === runId && event.type === 'done')?.outcome,
        'completed',
      );
    assert.equal(events.filter((event) => event.type === 'error').length, 0);
    // irori writes no vault agent definitions: the vaults go with `irori call`.
    assert.equal(existsSync(path.join(root, '.codex', 'agents')), false);
    // Each thread started its own native session.
    const protocol = (await readFile(path.join(root, 'protocol.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(protocol.filter((m) => m.method === 'thread/start').length, 2);
    assert.equal(
      new Set(protocol.filter((m) => m.method === 'turn/start').map((m) => m.threadId)).size,
      2,
    );
    // A thread opens in its own workspace only, even when a view names it.
    assert.equal((await service.conversation(id, 'codex', one, here)).id, one);
    await assert.rejects(service.conversation(id, 'codex', one, there), /別のワークスペース/);
    const reserved = service.createConversation(id, 'codex', here);
    await assert.rejects(service.conversation(id, 'codex', reserved, there), /別のワークスペース/);
    assert.deepEqual(await service.conversationList(id, there), []);
  },
);

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
  // A hand-off's request shows twice, in the vault and with the irori agent: answered once.
  const answered = new Set<string>();
  const service = new AgentService(
    files,
    (event) => {
      events.push(event);
      if (event.type === 'permission' && !answered.has(event.requestId!)) {
        answered.add(event.requestId!);
        setTimeout(() => service.respond(event.requestId!, true), 0);
      }
      if (event.type === 'done' && !event.delegate && event.scopeId === id) finished();
    },
    undefined,
    undefined,
    you,
  );
  t.after(() => service.cancel());
  const run = async (prompt: string, access?: 'default' | 'full-access') => {
    events.length = 0;
    done = new Promise<void>((resolve) => {
      finished = resolve;
    });
    await service.startAccepted({
      scopeId: id,
      agent: 'claude',
      access,
      prompt,
      brains: brains.map((b) => b.scopeId),
    });
    return done;
  };
  const fixtureLog = async (folder = root) =>
    (await readFile(path.join(folder, 'your-ai-fixture.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  return { files, brains, id, root, service, events, run, fixtureLog };
}

test(
  'your AI hands a vault to its vault agent with irori call, and every step says which vault (protocol fixture)',
  fixtureOptions,
  async (t) => {
    const { brains, id, root, service, events, run, fixtureLog } = await delegation(t);
    const [product, research] = brains;
    const pending = run('Write a decision note.');
    // Both vaults are held while your AI works: irori's own changes there wait.
    // The person's conversations in them still run beside it (ADR 020).
    assert.equal(service.busy(product.scopeId), true);
    assert.equal(service.busy(research.scopeId), true);
    await pending;
    assert.equal(service.busy(product.scopeId), false);
    assert.equal(
      await readFile(path.join(product.root, 'Knowledge_Base', 'from-your-ai.md'), 'utf8'),
      '# From your AI\n',
    );
    const log = await fixtureLog();
    // The preamble named both vaults with their folders and vault agents.
    assert.deepEqual(
      log[0].brains.map((brain: { name: string; root: string }) => [brain.name, brain.root]),
      [
        ['Product', product.root],
        ['Research', research.root],
      ],
    );
    assert.match(log[0].prompt, /irori call <vault agent or vault name>/);
    // irori writes no definitions into the irori agent's folder (ADR 050).
    assert.equal(existsSync(path.join(root, '.claude', 'agents')), false);
    const called = log.find((entry) => entry.called);
    assert.equal(called.status, 0, called.stderr);
    assert.match(called.stdout, /Wrote Knowledge_Base\/from-your-ai\.md\./);
    // The vault agent ran in its vault, as the person's own run there does: the
    // vault's introduction, then the task.
    const [vault] = await fixtureLog(product.root);
    assert.equal(vault.role, 'vault');
    assert.match(vault.prompt, /^irori: you are the agent of the "Product" vault/);
    assert.match(
      vault.prompt,
      /irori: the irori agent handed you this task\.[\s\S]*Write a note in Product$/,
    );
    // In the irori agent's mode: its request comes to the irori agent's view too.
    assert.equal(vault.mode, 'default');
    const hand = events.find((event) => event.delegate?.state === 'started');
    assert.equal(hand?.delegate?.scopeId, product.scopeId);
    assert.equal(hand?.text, 'Write a note in Product');
    const task = hand!.delegate!.task;
    const step = events.find(
      (event) => event.type === 'tool' && event.text === 'Write' && event.delegate,
    );
    assert.deepEqual(step?.delegate, { scopeId: product.scopeId, task, state: 'working' });
    const asked = events.find((event) => event.type === 'permission' && event.delegate);
    assert.deepEqual(asked?.delegate, { scopeId: product.scopeId, task, state: 'working' });
    assert.ok(events.some((event) => event.resolved === asked?.requestId && event.scopeId === id));
    const report = events.find((event) => event.delegate?.state === 'reported');
    assert.equal(report?.text, 'Wrote Knowledge_Base/from-your-ai.md.');
    const own = events.filter((event) => event.scopeId === id);
    assert.equal(own.at(-1)?.outcome, 'completed');
    // The vault agent's own words stay with its hand-off; the reply is your AI's.
    assert.deepEqual(
      own.filter((event) => event.type === 'text').map((event) => event.text),
      [
        'Handed the note to the Product agent: `Knowledge_Base/from-your-ai.md`. My plan: `plans/next.md`.',
      ],
    );
    // The hand-offs are kept with the conversation.
    const saved = await service.conversation(id, 'claude');
    assert.ok(saved.events.some((event) => event.delegate?.state === 'reported'));
  },
);

test(
  'your AI cannot write in a vault itself: it is told to use irori call (protocol fixture)',
  fixtureOptions,
  async (t) => {
    const { brains, run, fixtureLog } = await delegation(t);
    await run('Try a direct write first.');
    const log = await fixtureLog();
    const direct = log.find((entry) => entry.direct);
    assert.equal(direct.direct, 'denied');
    assert.match(direct.reason, /irori call vault-product/);
    await assert.rejects(readFile(path.join(brains[0].root, 'direct.md')));
    assert.ok((await fixtureLog(brains[0].root)).some((entry) => entry.written === true));
  },
);

test(
  'the irori agent in full access on Claude Code still keeps out of the vaults (protocol fixture)',
  fixtureOptions,
  async (t) => {
    const { brains, id, events, run, fixtureLog } = await delegation(t);
    assert.equal(defaultAgentAccess('claude'), 'full-access');
    await run('Try a direct write first.', defaultAgentAccess('claude'));
    const log = await fixtureLog();
    assert.equal(log[0].mode, 'bypassPermissions');
    // The write hook runs in every mode: the irori agent's own write is refused.
    assert.ok(log.some((entry) => entry.direct === 'denied'));
    await assert.rejects(readFile(path.join(brains[0].root, 'direct.md')));
    // The vault agent runs in the same mode: it writes in its vault without asking.
    const vault = await fixtureLog(brains[0].root);
    assert.equal(vault[0].mode, 'bypassPermissions');
    assert.ok(vault.some((entry) => entry.written === true));
    assert.equal(events.filter((event) => event.type === 'permission').length, 0);
    assert.equal(events.filter((event) => event.scopeId === id).at(-1)?.outcome, 'completed');
  },
);

test(
  'a vault’s own definition of its agent goes with the hand-off; its other definitions are its sub-agents on any CLI (protocol fixture)',
  fixtureOptions,
  async (t) => {
    const { brains, root, run, fixtureLog } = await delegation(t);
    const [product] = brains;
    // The Product vault defines its agent for Codex, and two sub-agents in
    // Codex's and OpenCode's formats; the vault agent here runs on Claude Code.
    await mkdir(path.join(product.root, '.codex', 'agents'), { recursive: true });
    await mkdir(path.join(product.root, '.opencode', 'agents'), { recursive: true });
    await writeFile(
      path.join(product.root, '.codex', 'agents', 'vault-agent.toml'),
      'name = "vault-agent"\ndescription = "Product decisions and specs."\nmodel = "gpt-test"\ndeveloper_instructions = """\nFile every decision under Knowledge_Base/.\n"""\n',
    );
    await writeFile(
      path.join(product.root, '.codex', 'agents', 'reviewer.toml'),
      'description = "Reviews a decision."\ndeveloper_instructions = "Review it."\n',
    );
    await writeFile(
      path.join(product.root, '.opencode', 'agents', 'scribe.md'),
      '---\ndescription: Writes minutes.\nmode: subagent\n---\n\nWrite the minutes.\n',
    );
    // An earlier irori's definition in the irori agent's folder is not used.
    await mkdir(path.join(root, '.claude', 'agents'), { recursive: true });
    await writeFile(
      path.join(root, '.claude', 'agents', 'vault-product.md'),
      '---\nname: vault-product\ndescription: The Product agent.\n---\n\nOld.\n',
    );
    await run('Write a decision note.');
    const [irori] = await fixtureLog();
    assert.equal(irori.brains[0].description, 'Product decisions and specs.');
    assert.equal(irori.disallowed, 'Agent(vault-product)');
    assert.deepEqual(irori.agents, []);
    const [vault] = await fixtureLog(product.root);
    assert.match(
      vault.prompt,
      /\.codex\/agents\/vault-agent\.toml\. Follow it:\n<vault-agent-definition>\nFile every decision under Knowledge_Base\/\.\n<\/vault-agent-definition>/,
    );
    // Codex's model is not Claude Code's: the irori agent's choice stands.
    assert.equal(vault.model, undefined);
    // Its sub-agents in the other formats reach Claude Code; its own agent is not one of them.
    assert.deepEqual(vault.agents.sort(), ['reviewer', 'scribe']);
  },
);

test(
  'Claude Code runs with the shared Schema’s hooks beside the folder’s own (protocol fixture)',
  fixtureOptions,
  async (t) => {
    const { root, run, fixtureLog } = await delegation(t);
    await run('Write a decision note.');
    // Without shared hooks no settings are added.
    assert.equal((await fixtureLog())[0].settings, undefined);
    const hooks = {
      Stop: [{ hooks: [{ type: 'command', command: 'echo stopped', timeout: 5 }] }],
    };
    const settings = path.join(root, '.irori', 'shared', '.claude', 'settings.json');
    await mkdir(path.dirname(settings), { recursive: true });
    await writeFile(settings, JSON.stringify({ hooks, model: 'not-shared' }));
    await run('Write a decision note.');
    const launched = (await fixtureLog()).filter((entry) => entry.prompt !== undefined).at(-1);
    // Only the hooks are carried: the shared Schema sets nothing else of Claude Code's.
    assert.deepEqual(JSON.parse(launched.settings), { hooks });
  },
);

test('only your AI takes brains, on any CLI, without notes or materials', async (t) => {
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
    () => service.start({ scopeId: id, agent: 'pi', prompt: 'x', notePath: 'a.md' }),
    /vaults, not notes|ノートや資料/,
  );
  assert.throws(
    () => service.start({ scopeId: id, agent: 'claude', prompt: 'x', notePath: 'a.md' }),
    /vaults, not notes|ノートや資料/,
  );
  assert.throws(
    () =>
      service.start({
        scopeId: space.scopeId,
        agent: 'claude',
        prompt: 'x',
        brains: [space.scopeId],
      }),
    /Only the irori agent takes vaults/,
  );
});

for (const cli of ['pi', 'opencode'] as const)
  test(
    `the irori agent on ${cli === 'pi' ? 'Pi' : 'OpenCode'} is told to hand each vault to its agent with irori call (protocol fixture)`,
    fixtureOptions,
    async (t) => {
      const { base, you } = await yourAi(t);
      const bin = path.join(base, 'bin');
      await mkdir(bin);
      await writeFile(
        path.join(bin, cli),
        `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/harnesses.mjs')).href)}).then(m=>m.run(${JSON.stringify(cli)}));\n`,
        { mode: 0o700 },
      );
      const previous = process.env.PATH;
      process.env.PATH = bin + path.delimiter + previous;
      t.after(() => {
        process.env.PATH = previous;
      });
      const files = new FileService(path.join(base, 'device'));
      await files.init();
      const brainRoot = path.join(base, 'Product');
      await mkdir(brainRoot);
      const brain = await files.register(brainRoot, 'Product', 'team');
      const { id, root } = await you.create();
      let finished!: () => void;
      const done = new Promise<void>((resolve) => {
        finished = resolve;
      });
      const events: AgentEvent[] = [];
      const service = new AgentService(
        files,
        (event) => {
          events.push(event);
          if (event.type === 'done') finished();
        },
        undefined,
        undefined,
        you,
      );
      t.after(() => service.cancel());
      await service.startAccepted({
        scopeId: id,
        agent: cli,
        access: defaultAgentAccess(cli),
        prompt: 'Tidy the product notes.',
        brains: [brain.scopeId],
      });
      // The brain is held as it is for Claude Code.
      assert.equal(service.busy(brain.scopeId), true);
      await done;
      assert.equal(events.at(-1)?.outcome, 'completed', JSON.stringify(events));
      assert.equal(service.busy(brain.scopeId), false);
      const requests = (await readFile(path.join(root, 'fixture-requests.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const sent = (
        cli === 'pi'
          ? requests.find((call) => call.type === 'prompt').message
          : requests.find((call) => call.route?.endsWith('/message')).body.parts[0].text
      ) as string;
      assert.ok(sent.includes(`Product (チーム): folder ${JSON.stringify(brainRoot)}`), sent);
      assert.ok(sent.endsWith('Tidy the product notes.'));
      // Every CLI hands a vault's work with `irori call` (ADR 050).
      assert.match(sent, /vault agent "vault-product"/);
      assert.match(
        sent,
        /with `irori call` in your shell: irori call <vault agent or vault name> "<task>"/,
      );
      // The vault agent reads its own Schema; the irori agent is not told to.
      assert.doesNotMatch(sent, /AGENTS\.md/);
      // irori writes no sub-agent files for the vaults.
      for (const dir of ['.claude', '.codex', '.opencode'])
        assert.equal(existsSync(path.join(root, dir, 'agents')), false);
    },
  );
