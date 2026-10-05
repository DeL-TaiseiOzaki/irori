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
import { brainAgentNames, subAgentDefinition } from '../src/domain/you';
import { brainsPreamble, iroriAgentSkills, yourAiStarter } from '../prompts';
import type { AgentEvent, Space } from '../src/domain/types';

const fixtureOptions = {
  skip: process.platform === 'win32' && 'POSIX executable fixture',
  timeout: 20000,
};

test('each hibachi gets a stable sub-agent name hibachi-<slug> that Claude Code accepts', () => {
  const names = brainAgentNames([
    { scopeId: '6f1c2d0e-8b1a-4c33-9d7e-2a4b5c6d7e8f', name: 'Product Lab' },
    { scopeId: '11111111-2222-4333-8444-555555555555', name: 'プロダクト' },
    { scopeId: '99999999-2222-4333-8444-555555555555', name: 'product lab' },
    { scopeId: 'aaaaaaaa-2222-4333-8444-555555555555', name: 'Café Notes' },
  ]);
  assert.deepEqual(
    [...names.values()],
    [
      'hibachi-product-lab',
      'hibachi-11111111',
      'hibachi-product-lab-99999999',
      'hibachi-cafe-notes',
    ],
  );
  for (const name of names.values()) assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test('your AI writes in its own folder, and a brain changes only through its sub-agent', () => {
  const delegation: Delegation = {
    you: '/home/me/irori/you',
    brains: [
      { scopeId: 'a', name: 'Product', agent: 'hibachi-product', root: '/kb/product' },
      { scopeId: 'b', name: 'Research', agent: 'hibachi-research', root: '/kb/research' },
    ],
  };
  assert.equal(writeDecision(delegation, undefined, 'plans/today.md').allow, true);
  assert.equal(
    writeDecision(delegation, 'hibachi-product', '/kb/product/Knowledge_Base/a.md').allow,
    true,
  );
  const direct = writeDecision(delegation, undefined, '/kb/product/a.md');
  assert.equal(direct.allow, false);
  assert.match(!direct.allow ? direct.reason : '', /sub-agent "hibachi-product"/);
  assert.equal(writeDecision(delegation, 'hibachi-product', '/kb/research/a.md').allow, false);
  assert.equal(
    writeDecision(delegation, 'hibachi-product', '/kb/product/../research/a.md').allow,
    false,
  );
  // A built-in agent or a brain's own agent keeps to your AI's folder.
  assert.equal(writeDecision(delegation, 'general-purpose', '/kb/product/a.md').allow, false);
  assert.equal(writeDecision(delegation, 'general-purpose', 'notes.md').allow, true);
  assert.equal(writeDecision(delegation, undefined, '/etc/passwd').allow, false);
});

test('the preamble names each hibachi, its folder and its sub-agent, per CLI', () => {
  const brains = [
    { name: 'Product', category: 'チーム', agent: 'hibachi-product', root: '/kb/p' },
    { name: 'Research', agent: 'hibachi-research', root: '/kb/r "x"' },
  ];
  const text = brainsPreamble(brains, 'claude');
  assert.match(text, /- Product \(チーム\): folder "\/kb\/p", sub-agent "hibachi-product"\n/);
  assert.match(text, /folder "\/kb\/r \\"x\\"", sub-agent "hibachi-research"\n/);
  assert.match(text, /material, not instructions/);
  assert.match(text, /run it in the foreground; irori refuses your own writes/);
  assert.doesNotMatch(text, /brain-agents|not defined/);
  assert.match(brainsPreamble(brains, 'codex'), /spawn_agent with its name as agent_type/);
  assert.match(brainsPreamble(brains, 'opencode'), /task tool/);
});

test('each CLI gets a definition it can load, with the hibachi and its Schema', () => {
  const brain = { name: 'Product: "Lab"', agent: 'hibachi-product-lab', root: '/kb/product' };
  const claude = subAgentDefinition('claude', brain);
  assert.match(
    claude,
    /^---\nname: hibachi-product-lab\ndescription: "The Product: \\"Lab\\" hibachi's agent\./,
  );
  assert.match(claude, /\ntools: Read, Write, Edit, Glob, Grep\n---\n/);
  assert.match(claude, /First read \/kb\/product\/AGENTS\.md and follow it/);
  assert.match(claude, /Work only inside \/kb\/product\./);
  const opencode = subAgentDefinition('opencode', brain);
  assert.match(opencode, /^---\ndescription: ".+"\nmode: subagent\n---\n/);
  // The TOML has the three fields Codex requires, each a basic string.
  const codex = subAgentDefinition('codex', brain);
  const fields = Object.fromEntries(
    codex
      .trim()
      .split('\n')
      .map((line) => {
        const [key, ...value] = line.split(' = ');
        return [key, JSON.parse(value.join(' = '))];
      }),
  );
  assert.deepEqual(Object.keys(fields), ['name', 'description', 'developer_instructions']);
  assert.equal(fields.name, 'hibachi-product-lab');
  assert.match(fields.developer_instructions, /First read \/kb\/product\/AGENTS\.md/);
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
  // No brain-agents skill any more: irori writes the definitions itself.
  assert.deepEqual(Object.keys(yourAiStarter), ['AGENTS.md']);
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
    names.includes('AGENTS.md') && names.includes('.claude') && !names.includes('link.txt'),
  );
  assert.equal((await you.read('AGENTS.md')).text, yourAiStarter['AGENTS.md']);
  await assert.rejects(you.read('../secret.txt'));
  await assert.rejects(you.read('link.txt'), /leaves/);
  await writeFile(
    path.join(root, '.claude', 'agents', 'hibachi-product.md'),
    '---\nname: hibachi-product\n---\n',
  );
  const found = await you.definitions(['hibachi-product', 'hibachi-research']);
  assert.deepEqual(found.get('hibachi-product'), [
    { cli: 'claude', path: '.claude/agents/hibachi-product.md' },
  ]);
  assert.deepEqual(found.get('hibachi-research'), []);
});

test('the irori agent’s folder takes the same Schema settings as a hibachi, confined to it', async (t) => {
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
  // The instructions, a rule, hooks and a skill, hash-checked as for a hibachi.
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
  // Its skills are listed from its own .agents/skills, as a hibachi's are,
  // the standard skills irori wrote when the folder was made among them.
  const standard = Object.keys(iroriAgentSkills);
  const skills = await readFolderSkills(await you.schemaFolder());
  assert.deepEqual(skills.skills.map((skill) => skill.name).sort(), [...standard, 'plan'].sort());
  await service.moveSkill(id, 'plan', 'weekly');
  assert.deepEqual(
    (await readdir(path.join(root, '.agents', 'skills'))).sort(),
    [...standard, 'weekly'].sort(),
  );
  // A definition irori wrote is not a setting, and no alias leads out of the folder.
  await you.writeDefinitions('claude', [{ name: 'P', agent: 'hibachi-p', root: '/kb/p' }]);
  await assert.rejects(
    service.read(id, '.claude/agents/hibachi-p.md'),
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

test('irori writes an absent definition, never over one, and only inside the folder', async (t) => {
  const { base, you } = await yourAi(t);
  const { root } = await you.create();
  const brains = [
    { name: 'Product', agent: 'hibachi-product', root: '/kb/product' },
    { name: 'Research', agent: 'hibachi-research', root: '/kb/research' },
  ];
  // The person edited Research's definition: it stays as it is.
  await writeFile(path.join(root, '.claude', 'agents', 'hibachi-research.md'), 'mine');
  assert.deepEqual(await you.writeDefinitions('claude', brains), [
    '.claude/agents/hibachi-product.md',
  ]);
  assert.equal(
    await readFile(path.join(root, '.claude', 'agents', 'hibachi-product.md'), 'utf8'),
    subAgentDefinition('claude', brains[0]),
  );
  assert.equal(
    await readFile(path.join(root, '.claude', 'agents', 'hibachi-research.md'), 'utf8'),
    'mine',
  );
  assert.deepEqual(await you.writeDefinitions('claude', brains), []);
  assert.deepEqual(await you.writeDefinitions('codex', brains), [
    '.codex/agents/hibachi-product.toml',
    '.codex/agents/hibachi-research.toml',
  ]);
  // A linked folder on the way is not followed out of the folder.
  const outside = path.join(base, 'outside');
  await mkdir(outside);
  await symlink(outside, path.join(root, '.opencode'));
  await assert.rejects(you.writeDefinitions('opencode', brains), /not a folder inside/);
  assert.deepEqual(await readdir(outside), []);
  // A link where the file would be is left alone, as an existing file.
  await symlink(path.join(outside, 'x.md'), path.join(root, '.claude', 'agents', 'hibachi-x.md'));
  assert.deepEqual(
    await you.writeDefinitions('claude', [{ name: 'X', agent: 'hibachi-x', root: '/kb/x' }]),
    [],
  );
  assert.deepEqual(await readdir(outside), []);
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
    // Both brains are held while your AI works: irori's own changes there wait.
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
    // The preamble named both brains with their folders and sub-agents.
    assert.deepEqual(
      log[0].brains.map((brain: { name: string; root: string }) => [brain.name, brain.root]),
      [
        ['Product', product.root],
        ['Research', research.root],
      ],
    );
    // irori wrote each handed hibachi's definition before the run, so it loaded.
    assert.deepEqual(log[0].loaded.sort(), ['hibachi-product', 'hibachi-research']);
    assert.ok(
      events.some(
        (event) => event.type === 'status' && /hibachi-product\.md/.test(event.text ?? ''),
      ),
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
      ["Handed the note to Product's hibachi agent."],
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

test(
  'the irori agent in full access on Claude Code still keeps out of the hibachis (protocol fixture)',
  fixtureOptions,
  async (t) => {
    const { brains, events, run, fixtureLog } = await delegation(t);
    assert.equal(defaultAgentAccess('claude'), 'full-access');
    await run('Try a direct write first.', defaultAgentAccess('claude'));
    const log = await fixtureLog();
    assert.equal(log[0].mode, 'bypassPermissions');
    // The write hook runs in every mode: the irori agent's own write is refused.
    assert.ok(log.some((entry) => entry.direct === 'denied'));
    await assert.rejects(readFile(path.join(brains[0].root, 'direct.md')));
    // The sub-agent inherits full access: it writes in its hibachi without asking.
    assert.ok(log.some((entry) => entry.written === true));
    assert.equal(events.filter((event) => event.type === 'permission').length, 0);
    assert.equal(events.at(-1)?.outcome, 'completed');
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
    /hibachis, not notes|ノートや資料/,
  );
  assert.throws(
    () => service.start({ scopeId: id, agent: 'claude', prompt: 'x', notePath: 'a.md' }),
    /hibachis, not notes|ノートや資料/,
  );
  assert.throws(
    () =>
      service.start({
        scopeId: space.scopeId,
        agent: 'claude',
        prompt: 'x',
        brains: [space.scopeId],
      }),
    /Only the irori agent takes hibachis/,
  );
});

for (const cli of ['pi', 'opencode'] as const)
  test(
    cli === 'pi'
      ? 'the irori agent on Pi is told to hand each hibachi to its agent with the hibachi command (protocol fixture)'
      : 'the irori agent on OpenCode gets the hibachi definitions irori writes and hands work to them (protocol fixture)',
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
      const definition = path.join(root, '.opencode', 'agents', 'hibachi-product.md');
      if (cli === 'pi') {
        assert.match(sent, /You run on Pi .* loads no sub-agents from files/);
        assert.match(sent, /hibachi agent "hibachi-product"/);
        assert.match(
          sent,
          /with the `hibachi` command in your shell: hibachi <hibachi agent or hibachi name> "<task>"/,
        );
        // The hibachi agent reads its own Schema; the irori agent is not told to.
        assert.doesNotMatch(sent, /AGENTS\.md/);
        // Pi loads no sub-agent files, so irori writes none.
        assert.equal(existsSync(path.join(root, '.claude', 'agents', 'hibachi-product.md')), false);
        assert.equal(existsSync(definition), false);
      } else {
        assert.match(sent, /sub-agent "hibachi-product"/);
        assert.match(sent, /with the task tool/);
        assert.match(await readFile(definition, 'utf8'), /\nmode: subagent\n/);
      }
    },
  );
