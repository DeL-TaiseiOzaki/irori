import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentService } from '../src/agents/service';
import { ModelCatalog } from '../src/agents/models';
import { FileService } from '../src/host/files';
import { effortChoices, keptEffort } from '../src/domain/agent-effort';
import { hostArguments } from '../src/domain/host-requests';
import type { AgentEvent, AgentId, StartRun } from '../src/domain/types';

const fixture = {
  skip: process.platform === 'win32' && 'POSIX executable fixture',
  timeout: 20000,
};

test('A model offers its own thinking levels, else its default model’s, else the CLI’s', () => {
  const list = {
    models: [
      { id: 'fast', label: 'Fast', efforts: ['low', 'medium'], defaultEffort: 'low' },
      { id: 'deep', label: 'Deep', default: true, efforts: ['medium', 'high', 'xhigh'] },
      { id: 'plain', label: 'Plain' },
    ],
    custom: false,
    efforts: ['off', 'on'],
  };
  assert.deepEqual(effortChoices(list, 'fast'), {
    levels: ['low', 'medium'],
    default: 'low',
    custom: false,
  });
  // The CLI's default model, and a name typed in, take the default model's levels.
  assert.deepEqual(effortChoices(list, '').levels, ['medium', 'high', 'xhigh']);
  assert.deepEqual(effortChoices(list, 'typed-in').levels, ['medium', 'high', 'xhigh']);
  assert.deepEqual(effortChoices(list, 'plain').levels, ['off', 'on']);
  // Hermes Agent: nothing to pick and nothing to type.
  assert.deepEqual(effortChoices({ models: [], custom: true }, ''), { levels: [], custom: false });
  // A level the model does not take is dropped; a typed one is kept where levels are typed.
  assert.equal(keptEffort(effortChoices(list, 'fast'), 'xhigh'), '');
  assert.equal(keptEffort(effortChoices(list, 'deep'), 'xhigh'), 'xhigh');
  assert.equal(keptEffort({ levels: [], custom: true }, 'max'), 'max');

  // A level is a plain word: never an option, never shell syntax.
  const start = (effort: string) =>
    hostArguments.start.safeParse([
      { scopeId: crypto.randomUUID(), agent: 'codex', prompt: 'x', effort },
    ]).success;
  assert.equal(start('high'), true);
  assert.equal(start('--yolo'), false);
  assert.equal(start('high; rm -rf'), false);
  assert.equal(
    hostArguments.saveDeviceSettings.safeParse([
      { yourAi: { agent: 'pi', models: {}, efforts: { pi: 'xhigh' } } },
    ]).success,
    true,
  );
});

// Codex's app server, played without a model: it lists two models with their
// levels and records each turn it is asked to start.
const codexFixture = `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv.includes('--version')) { console.log('codex-cli 0.160.0'); process.exit(0); }
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if (!m.method || m.id === undefined) return;
  const level = (reasoningEffort) => ({ reasoningEffort, description: reasoningEffort });
  const result = m.method === 'model/list'
    ? { data: [
        { id: 'a', model: 'gpt-a', displayName: 'GPT A', hidden: false, isDefault: true,
          supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'].map(level), defaultReasoningEffort: 'medium' },
        { id: 'b', model: 'gpt-b', displayName: 'GPT B', hidden: false, isDefault: false,
          supportedReasoningEfforts: [level('minimal'), level('--bad')], defaultReasoningEffort: 'none' },
      ], nextCursor: null }
    : m.method.startsWith('thread/') ? { thread: { id: 'fixture-thread' } }
    : m.method === 'turn/start' ? { turn: { id: 'fixture-turn' } } : {};
  send({ id: m.id, result });
  if (m.method !== 'turn/start') return;
  fs.appendFileSync('codex-turns.jsonl', JSON.stringify(m.params) + '\\n');
  send({ method: 'turn/completed', params: { threadId: 'fixture-thread', turn: { id: 'fixture-turn', status: 'completed' } } });
});
`;

// Claude Code's stream-json, played without a model: it lists its models with
// their effort levels and records the arguments it was started with.
const claudeFixture = `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv.includes('--version')) { console.log('2.1.300 (Claude Code)'); process.exit(0); }
fs.appendFileSync(require('node:path').join(process.cwd(), 'claude-arguments.jsonl'), JSON.stringify(process.argv.slice(2)) + '\\n');
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const timer = setTimeout(() => process.exit(2), 8000);
const models = [
  { value: 'default', displayName: 'Default', description: '', resolvedModel: 'claude-opus',
    supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'opus', displayName: 'Opus', description: '', resolvedModel: 'claude-opus',
    supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'haiku', displayName: 'Haiku', description: '', resolvedModel: 'claude-haiku', supportsEffort: false },
];
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const message = JSON.parse(line);
  if (message.type === 'control_request')
    send({type:'control_response',response:{subtype:'success',request_id:message.request_id,
      response: message.request.subtype === 'initialize' ? { models } : {}}});
  if (message.type === 'user') {
    send({type:'system',subtype:'init',session_id:'fixture-session'});
    send({type:'result',subtype:'success',result:'done',is_error:false,session_id:'fixture-session',duration_ms:1,duration_api_ms:0,num_turns:1,total_cost_usd:0,usage:{},modelUsage:{},permission_denials:[]});
    clearTimeout(timer);
  }
});
`;

async function setup(t: any, cli: AgentId, script: string) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori effort fixture '));
  const previous = { path: process.env.PATH, home: process.env.HOME };
  t.after(async () => {
    process.env.PATH = previous.path;
    process.env.HOME = previous.home;
    await rm(base, { recursive: true, force: true });
  });
  const bin = path.join(base, 'bin');
  const root = path.join(base, 'KB');
  const home = path.join(base, 'home');
  await mkdir(bin);
  await mkdir(root);
  await mkdir(home);
  await writeFile(path.join(bin, cli), script, { mode: 0o700 });
  process.env.PATH = bin + path.delimiter + previous.path;
  // The lists are read in the home folder; the fixture's records stay in the test's.
  process.env.HOME = home;
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const space = await files.register(root, 'KB', 'personal');
  const execute = async (input: Omit<StartRun, 'scopeId' | 'prompt'>) => {
    const events: AgentEvent[] = [];
    let done!: () => void;
    const completed = new Promise<void>((resolve) => {
      done = resolve;
    });
    const service = new AgentService(files, (event) => {
      events.push(event);
      if (event.type === 'done') done();
    });
    t.after(() => service.cancel());
    service.start({ scopeId: space.scopeId, prompt: 'Think about it', ...input });
    await completed;
    assert.equal(events.at(-1)?.outcome, 'completed', JSON.stringify(events.slice(-3)));
    return events;
  };
  return { root, execute };
}

test(
  'Codex lists each model’s levels and takes the chosen one for the turn',
  fixture,
  async (t) => {
    const { root, execute } = await setup(t, 'codex', codexFixture);
    const list = await new ModelCatalog().models('codex');
    assert.deepEqual(list.models, [
      {
        id: 'gpt-a',
        label: 'GPT A',
        default: true,
        efforts: ['low', 'medium', 'high', 'xhigh'],
        defaultEffort: 'medium',
      },
      // A level that could pass for an option is left out, and so is a default it does not list.
      { id: 'gpt-b', label: 'GPT B', efforts: ['minimal'] },
    ]);
    assert.equal(list.customEffort, undefined);

    const events = await execute({ agent: 'codex', model: 'gpt-a', effort: 'xhigh' });
    assert.ok(events.some((event) => event.type === 'status' && /xhigh/.test(event.text)));
    await execute({ agent: 'codex' });
    const turns = (await readFile(path.join(root, 'codex-turns.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(turns[0].effort, 'xhigh');
    assert.equal(turns[0].model, 'gpt-a');
    assert.equal('effort' in turns[1], false, 'no level: the CLI’s own');
  },
);

test(
  'Claude Code lists each model’s effort levels and starts with the chosen one',
  fixture,
  async (t) => {
    const { root, execute } = await setup(t, 'claude', claudeFixture);
    const list = await new ModelCatalog().models('claude');
    assert.deepEqual(list, {
      models: [
        {
          id: 'opus',
          label: 'Opus',
          default: true,
          efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        },
        // A model without effort takes no level.
        { id: 'haiku', label: 'Haiku', efforts: [] },
      ],
      custom: false,
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    });
    assert.deepEqual(effortChoices(list, 'haiku').levels, []);
    assert.deepEqual(effortChoices(list, 'claude-typed-in').levels, list.efforts);

    await execute({ agent: 'claude', effort: 'max' });
    await execute({ agent: 'claude' });
    const [first, second] = (await readFile(path.join(root, 'claude-arguments.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);
    assert.equal(first[first.indexOf('--effort') + 1], 'max');
    assert.equal(second.includes('--effort'), false);
  },
);
