import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileService } from '../src/host/files';
import { YourAiService } from '../src/host/you';
import { SearchService } from '../src/host/search';
import { SchemaSettingsService } from '../src/host/schema-settings';
import { spaceFolder } from '../src/host/schema-folder';
import { AgentService } from '../src/agents/service';
import { codexHookTrust } from '../src/agents/hook-bridge';
import { patchFiles } from '../src/agents/tool-names';
import { version } from '../src/agents/process';
import { sharedSchemaId } from '../src/domain/you';
import type { AgentEvent, AgentId, StartRun } from '../src/domain/types';

// Protocol fixtures stand in for each CLI; no model runs. They do with irori's
// hooks, scripts and words what each CLI's source says it does (ADR 058).
const posix = { skip: process.platform === 'win32' && 'POSIX executable fixtures', timeout: 60000 };
const fixture = pathToFileURL(path.resolve('tests/fixtures/harnesses.mjs')).href;
const skill = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\nDo it.\n`;
const hooksJson = (hooks: Record<string, unknown>) => JSON.stringify({ hooks }, null, 2) + '\n';

async function harness(t: TestContext) {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'irori schema reach ')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = path.join(base, 'home');
  const bin = path.join(base, 'bin');
  await mkdir(home);
  await mkdir(bin);
  for (const id of ['pi', 'opencode', 'hermes'])
    await writeFile(
      path.join(bin, id),
      `#!/usr/bin/env node\nimport(${JSON.stringify(fixture)}).then(m=>m.run(${JSON.stringify(id)}));\n`,
      { mode: 0o700 },
    );
  const old = process.env.PATH;
  process.env.PATH = bin + path.delimiter + old;
  t.after(() => {
    process.env.PATH = old;
  });
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const you = new YourAiService(path.join(base, 'device'), home);
  const settings = new SchemaSettingsService(files, new SearchService(files), async (scopeId) =>
    scopeId === sharedSchemaId
      ? you.sharedFolder()
      : you.rootOf(scopeId)
        ? you.schemaFolder()
        : spaceFolder(files, scopeId),
  );
  const kb = path.join(base, 'KB');
  await mkdir(kb);
  await writeFile(path.join(kb, 'note.md'), '# Note\n');
  const space = await files.register(kb, 'Vault', 'personal');
  const asked: string[] = [];
  let answer = true;
  const approvals: string[][] = [];
  const execute = async (agent: AgentId, prompt: string, extra: Partial<StartRun> = {}) => {
    const events: AgentEvent[] = [];
    let end!: () => void;
    const done = new Promise<void>((resolve) => {
      end = resolve;
    });
    let service!: AgentService;
    service = new AgentService(
      files,
      (event) => {
        events.push(event);
        if (event.type === 'permission' || event.type === 'question') {
          asked.push(event.text);
          void service.respond(event.requestId!, answer);
        }
        if (event.type === 'done') end();
      },
      undefined,
      undefined,
      you,
    );
    service.approveConfig = async (found) => {
      approvals.push(found.map((item) => item.label ?? item.root));
      return true;
    };
    service.nestedInstructions = (scopeId) => settings.nestedInstructions(scopeId);
    t.after(() => service.cancel());
    service.start({ scopeId: space.scopeId, agent, prompt, ...extra });
    await done;
    return events;
  };
  const lines = async (file: string) =>
    (await readFile(file, 'utf8').catch(() => ''))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  return {
    base,
    bin,
    kb,
    files,
    you,
    settings,
    space,
    execute,
    lines,
    asked,
    approvals,
    answer: (value: boolean) => {
      answer = value;
    },
  };
}

/** The requests the Pi fixture was sent, in order. */
const piPrompts = async (lines: (file: string) => Promise<any[]>, kb: string) =>
  (await lines(path.join(kb, 'fixture-requests.jsonl')))
    .filter((call) => call.kind === 'pi' && call.type === 'prompt')
    .map((call) => call.message as string);

test(
  "a vault's rules, nested instructions and skills reach a CLI that does not load them, set through the settings",
  posix,
  async (t) => {
    const h = await harness(t);
    await h.settings.write(h.space.scopeId, 'AGENTS.md', 'VAULT-INSTRUCTIONS\n', null);
    await h.settings.write(h.space.scopeId, '.claude/rules/tone.md', 'VAULT-RULE\n', null);
    await mkdir(path.join(h.kb, 'Knowledge_Base', 'projects'), { recursive: true });
    await writeFile(path.join(h.kb, 'Knowledge_Base', 'projects', 'AGENTS.md'), 'PROJECTS\n');
    await h.settings.write(
      h.space.scopeId,
      '.agents/skills/digest/SKILL.md',
      skill('digest', 'VAULT-SKILL'),
      null,
    );
    // Pi: the rules and the nested instructions as words, the skill as `--skill`.
    assert.equal((await h.execute('pi', 'first')).at(-1)?.outcome, 'completed');
    const [first] = await piPrompts(h.lines, h.kb);
    assert.match(
      first,
      /parts of the Schema of the folder you work in \([^)]+\) that Pi does not load by itself/,
    );
    assert.match(first, /<folder-rule file="[^"]+tone\.md">\nVAULT-RULE\n<\/folder-rule>/);
    assert.match(first, /- Knowledge_Base\/projects\/AGENTS\.md/);
    assert.doesNotMatch(first, /VAULT-INSTRUCTIONS/, 'Pi reads AGENTS.md itself');
    const launch = (await h.lines(path.join(h.kb, 'fixture-requests.jsonl'))).find(
      (call) => call.kind === 'pi' && call.type === 'launch',
    );
    assert.ok(launch.args.includes('--skill'));
    assert.equal(
      launch.args[launch.args.indexOf('--skill') + 1],
      path.join(h.kb, '.agents', 'skills', 'digest'),
    );
    // The same session, unchanged: one line.
    await h.execute('pi', 'second');
    const [, second] = await piPrompts(h.lines, h.kb);
    assert.match(
      second,
      /parts of the Schema of .+ given earlier in this session still apply, unchanged/,
    );
    assert.doesNotMatch(second, /VAULT-RULE/);
    // A rule changed in the settings: whole again.
    const rule = await h.settings.read(h.space.scopeId, '.claude/rules/tone.md');
    await h.settings.write(h.space.scopeId, '.claude/rules/tone.md', 'VAULT-RULE-2\n', rule.hash);
    await h.execute('pi', 'third');
    assert.match((await piPrompts(h.lines, h.kb))[2], /VAULT-RULE-2/);
    // Every rule gone: the session hears that what it was given is gone.
    const changed = await h.settings.read(h.space.scopeId, '.claude/rules/tone.md');
    await h.settings.write(h.space.scopeId, '.claude/rules/tone.md', null, changed.hash);
    await rm(path.join(h.kb, 'Knowledge_Base', 'projects', 'AGENTS.md'));
    await h.execute('pi', 'fourth');
    assert.match((await piPrompts(h.lines, h.kb))[3], /given earlier in this session are gone/);
  },
);

test(
  'a compaction makes the next request whole again, and a SessionStart hook hears it',
  posix,
  async (t) => {
    const h = await harness(t);
    await h.you.create();
    await h.settings.write(sharedSchemaId, 'AGENTS.md', 'SHARED-INSTRUCTIONS\n', null);
    await h.settings.write(
      h.space.scopeId,
      '.claude/settings.json',
      hooksJson({
        SessionStart: [
          { matcher: 'compact', hooks: [{ type: 'command', command: 'echo AFTER-COMPACT' }] },
        ],
      }),
      null,
    );
    await h.execute('pi', 'one');
    await h.execute('pi', 'two compact-now');
    await h.execute('pi', 'three');
    const [one, two, three] = await piPrompts(h.lines, h.kb);
    assert.match(one, /SHARED-INSTRUCTIONS/);
    assert.match(two, /shared Schema given earlier in this session still applies/);
    // Pi compacted during the second request: the third hears everything whole.
    assert.match(three, /SHARED-INSTRUCTIONS/);
    assert.match(three, /<hook-context>\nAFTER-COMPACT\n<\/hook-context>/);
    assert.doesNotMatch(two, /AFTER-COMPACT/);
  },
);

test(
  "Pi and OpenCode run the Schema's tool hooks through irori's script: a denial and feedback",
  posix,
  async (t) => {
    for (const agent of ['pi', 'opencode'] as const) {
      const h = await harness(t);
      await h.you.create();
      // The shared Schema guards the shell; the vault's own hook says something after it.
      await h.settings.write(
        sharedSchemaId,
        '.claude/settings.json',
        hooksJson({
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [
                {
                  type: 'command',
                  command: `node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const i=JSON.parse(s);if(i.tool_input.command.includes('rm -rf')){process.stderr.write('NO-RM');process.exit(2)}})"`,
                },
              ],
            },
          ],
        }),
        null,
      );
      await h.settings.write(
        h.space.scopeId,
        '.claude/settings.json',
        hooksJson({
          PostToolUse: [
            {
              matcher: 'Bash',
              hooks: [{ type: 'command', command: 'echo LINT-SAYS-HI >&2; exit 2' }],
            },
          ],
        }),
        null,
      );
      const events = await h.execute(agent, 'run schema-hooks');
      assert.equal(events.at(-1)?.outcome, 'completed', JSON.stringify(events));
      const [result] = (await h.lines(path.join(h.kb, 'fixture-requests.jsonl'))).filter(
        (call) => call.type === 'schema-hooks',
      );
      if (agent === 'pi') {
        assert.deepEqual(result.pre[0], {
          block: true,
          reason: 'A PreToolUse hook of the Schema blocked this call: NO-RM',
        });
        assert.equal(
          result.post[0].content.at(-1).text,
          'PostToolUse hook feedback from the Schema:\nLINT-SAYS-HI',
        );
      } else {
        assert.equal(result.pre.block, 'A PreToolUse hook of the Schema blocked this call: NO-RM');
        assert.equal(
          result.post,
          'note.md\n\nPostToolUse hook feedback from the Schema:\nLINT-SAYS-HI',
        );
      }
      // Both Schemas' hooks were allowed before they ran.
      const labels = h.approvals.flat();
      assert.equal(labels.length, 2);
      assert.ok(labels.some((label) => /共通 Schema|shared Schema/.test(label)));
      assert.ok(labels.some((label) => /このフォルダ|This folder/.test(label)));
    }
  },
);

test(
  'a Stop hook keeps the turn going in the same session, and a UserPromptSubmit hook can stop or add to a request',
  posix,
  async (t) => {
    const h = await harness(t);
    await h.settings.write(
      h.space.scopeId,
      '.claude/settings.json',
      hooksJson({
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command:
                  'if [ -f stopped-once ]; then exit 0; fi; touch stopped-once; echo "RUN THE TESTS" >&2; exit 2',
              },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: 'command',
                command: `node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{if(JSON.parse(s).prompt.includes('forbidden')){process.stderr.write('NOT TODAY');process.exit(2)}console.log('TODAY-IS-FRIDAY')})"`,
              },
            ],
          },
        ],
      }),
      null,
    );
    const events = await h.execute('pi', 'please work');
    assert.equal(events.at(-1)?.outcome, 'completed', JSON.stringify(events));
    const prompts = await piPrompts(h.lines, h.kb);
    assert.equal(prompts.length, 2);
    assert.match(
      prompts[0],
      /please work\n\nirori: context from the Schema's UserPromptSubmit hooks:\n<hook-context>\nTODAY-IS-FRIDAY\n<\/hook-context>$/,
    );
    assert.match(
      prompts[1],
      /a Stop hook of the Schema did not let your turn end yet[\s\S]*RUN THE TESTS/,
    );
    // Both turns went to one session.
    const sessions = (await h.lines(path.join(h.kb, 'fixture-requests.jsonl')))
      .filter((call) => call.kind === 'pi' && call.type === 'launch')
      .map((call) => call.args.includes('--session'));
    assert.deepEqual(sessions, [false, true]);
    // A blocked request goes nowhere.
    const blocked = await h.execute('pi', 'forbidden words');
    assert.equal(blocked.at(-1)?.outcome, 'failed');
    assert.match(blocked.find((event) => event.type === 'error')?.text ?? '', /NOT TODAY/);
    assert.equal((await piPrompts(h.lines, h.kb)).length, 2);
  },
);

test(
  'Hermes Agent: PostToolUse hooks run once a call ran and speak in the next turn; PreToolUse needs the person',
  posix,
  async (t) => {
    const h = await harness(t);
    await h.settings.write(
      h.space.scopeId,
      '.claude/settings.json',
      hooksJson({
        PostToolUse: [
          {
            matcher: 'Read',
            hooks: [{ type: 'command', command: 'echo "CHECK THE DATE" >&2; exit 2' }],
          },
        ],
      }),
      null,
    );
    const events = await h.execute('hermes', 'read it');
    assert.equal(events.at(-1)?.outcome, 'completed', JSON.stringify(events));
    const hermes = (await h.lines(path.join(h.kb, 'fixture-requests.jsonl'))).filter(
      (call) => call.kind === 'hermes' && call.prompt !== undefined,
    );
    assert.match(hermes[1].prompt, /PostToolUse hook feedback from the Schema:\nCHECK THE DATE/);
    assert.ok(hermes[1].args.includes('--resume'));
    // The fixture reads a file on every turn, so the feedback would never end: it
    // stops after as many turns in a row as Claude Code allows Stop hooks.
    assert.equal(hermes.length, 9);
    assert.ok(events.some((event) => /8/.test(event.text) && event.type === 'status'));
    const sent = hermes.length;
    // A PreToolUse hook Hermes cannot run: the person is asked, and a refusal sends nothing.
    const settings = await h.settings.read(h.space.scopeId, '.claude/settings.json');
    await h.settings.write(
      h.space.scopeId,
      '.claude/settings.json',
      hooksJson({ PreToolUse: [{ hooks: [{ type: 'command', command: 'exit 0' }] }] }),
      settings.hash,
    );
    h.answer(false);
    const refused = await h.execute('hermes', 'guarded');
    assert.equal(refused.at(-1)?.outcome, 'cancelled');
    assert.match(h.asked.at(-1) ?? '', /Hermes Agent[^\n]*PreToolUse/);
    assert.equal(
      (await h.lines(path.join(h.kb, 'fixture-requests.jsonl'))).filter(
        (call) => call.kind === 'hermes' && call.prompt !== undefined,
      ).length,
      sent,
    );
  },
);

test(
  'Hermes Agent hears the vault skills it cannot find, and a changed AGENTS.md its session began without',
  posix,
  async (t) => {
    const h = await harness(t);
    await h.settings.write(h.space.scopeId, 'AGENTS.md', 'FIRST-INSTRUCTIONS\n', null);
    await h.settings.write(
      h.space.scopeId,
      '.agents/skills/digest/SKILL.md',
      skill('digest', 'VAULT-SKILL'),
      null,
    );
    await h.execute('hermes', 'one');
    const agents = await h.settings.read(h.space.scopeId, 'AGENTS.md');
    await h.settings.write(h.space.scopeId, 'AGENTS.md', 'SECOND-INSTRUCTIONS\n', agents.hash);
    await h.execute('hermes', 'two');
    await h.execute('hermes', 'three');
    const [one, two, three] = (await h.lines(path.join(h.kb, 'fixture-requests.jsonl')))
      .filter((call) => call.kind === 'hermes' && call.prompt !== undefined)
      .map((call) => call.prompt as string);
    assert.match(one, /- digest: VAULT-SKILL/);
    // A new session read AGENTS.md itself; a session that goes on hears the change once.
    assert.doesNotMatch(one, /FIRST-INSTRUCTIONS/);
    assert.match(two, /changed since this session began[\s\S]*SECOND-INSTRUCTIONS/);
    assert.doesNotMatch(three, /SECOND-INSTRUCTIONS/);
  },
);

// --- Codex ---------------------------------------------------------------------

// Answers as Codex's app server does, and as its hook engine: hooks given in a
// thread's configuration are listed by `hooks/list` with Codex's own key and hash
// (sha256 of the sorted JSON of the normalized hook), trusted when the
// configuration's `hooks.state` names that hash; a trusted hook runs as
// `$SHELL -lc` with its event on standard input.
const codexStandIn = `#!/usr/bin/env node
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const sorted = (v) => Array.isArray(v) ? '[' + v.map(sorted).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + sorted(v[k])).join(',') + '}' : JSON.stringify(v);
const labels = { PreToolUse: 'pre_tool_use', PostToolUse: 'post_tool_use', PreCompact: 'pre_compact', SubagentStop: 'subagent_stop' };
let config = {};
const log = (value) => fs.appendFileSync('codex-stand-in.jsonl', JSON.stringify(value) + '\\n');
const listed = () => {
  const hooks = config.hooks || {};
  const state = hooks.state || {};
  return Object.keys(hooks).filter((event) => event !== 'state').map((event) => {
    const handler = hooks[event][0].hooks[0];
    const identity = { event_name: labels[event], hooks: [{ ...handler, async: false }] };
    const salt = fs.existsSync('codex-salt') ? 'salt' : '';
    const currentHash = 'sha256:' + crypto.createHash('sha256').update(salt + sorted(identity)).digest('hex');
    const key = '/<session-flags>/config.toml:' + labels[event] + ':0:0';
    return { event, key, command: handler.command, enabled: true, currentHash, trustStatus: state[key] && state[key].trusted_hash === currentHash ? 'trusted' : 'untrusted' };
  });
};
const run = (event, payload) => {
  const hook = listed().find((item) => item.event === event && item.trustStatus === 'trusted');
  if (!hook) return undefined;
  const result = spawnSync('/bin/sh', ['-c', hook.command], { input: JSON.stringify({ hook_event_name: event, ...payload }), encoding: 'utf8' });
  return result.stdout;
};
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (!m.method || m.id === undefined) return;
  const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
  log({ method: m.method, params: m.params });
  if (m.method.startsWith('thread/')) {
    config = (m.params && m.params.config) || {};
    const agents = require('node:path').join(m.params.cwd, 'AGENTS.md');
    send({ id: m.id, result: { thread: { id: m.params.threadId || 'thread-1' }, instructionSources: fs.existsSync('codex-skips-agents') || !fs.existsSync(agents) ? [] : [agents] } });
    return;
  }
  if (m.method === 'hooks/list') {
    send({ id: m.id, result: { data: [{ cwd: process.cwd(), hooks: listed().map(({ event, ...hook }) => ({ ...hook, source: 'sessionFlags' })), warnings: [], errors: [] }] } });
    return;
  }
  if (m.method === 'turn/start') {
    if (fs.existsSync('fail-turn')) { send({ id: m.id, error: { code: -1, message: 'turn refused' } }); return; }
    send({ id: m.id, result: { turn: { id: 'turn-1' } } });
    const text = m.params.input.find((item) => item.type === 'text').text;
    if (text.includes('schema-hooks')) {
      log({ type: 'pre', stdout: run('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'rm -rf data' }, tool_use_id: 'c1' }) });
      log({ type: 'post', stdout: run('PostToolUse', { tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\\n*** Update File: notes/a.md\\n@@\\n-a\\n+b\\n*** End Patch' }, tool_response: 'ok', tool_use_id: 'c2' }) });
    }
    send({ method: 'item/agentMessage/delta', params: { delta: 'done' } });
    if (text.includes('compact-now')) send({ method: 'item/completed', params: { item: { type: 'contextCompaction', id: 'cc' } } });
    send({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
    return;
  }
  send({ id: m.id, result: {} });
});
`;

test("Codex's own trust hash for a hook is computed as Codex computes it", () => {
  // Vectors from codex-rs core/tests/suite/hooks.rs (rust-v0.167.0).
  const command = 'python3 -I -S ${PLUGIN_ROOT}/hooks/pre_tool_use_hook.py';
  const hash = (event: string) =>
    codexHookTrust(event, { type: 'command', command, timeout: 600 }, 'linux', '^Bash$').hash;
  assert.equal(
    hash('PreToolUse'),
    'sha256:c9ee1aca1b5d8c72b99df6571c87d61350b09f7f4594ae30e7250a2027e9d76b',
  );
  assert.equal(
    hash('PostToolUse'),
    'sha256:9eef43ad6f26b1f9b94f318a50445f8bb62c363da08152a2966b73d308bf42ba',
  );
  assert.equal(
    codexHookTrust('PreToolUse', { type: 'command', command: 'x', timeout: 1 }, 'linux').key,
    '/<session-flags>/config.toml:pre_tool_use:0:0',
  );
  assert.deepEqual(
    patchFiles(
      '*** Begin Patch\n*** Add File: a.md\n*** Update File: b.md\n*** Move to: c.md\n*** End Patch',
    ),
    ['a.md', 'b.md', 'c.md'],
  );
});

test(
  'Codex runs the Schema hooks through hooks of its own, trusted by their hash, and nothing goes when it would not run them',
  posix,
  async (t) => {
    const h = await harness(t);
    await writeFile(path.join(h.bin, 'codex'), codexStandIn, { mode: 0o700 });
    await h.settings.write(
      h.space.scopeId,
      '.claude/settings.json',
      hooksJson({
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo "NO-RM" >&2; exit 2' }] },
        ],
        PostToolUse: [
          {
            matcher: 'Edit|Write',
            hooks: [
              {
                type: 'command',
                command: `node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'PostToolUse',additionalContext:'EDITED '+JSON.parse(s).tool_input.file_path}}))})"`,
              },
            ],
          },
        ],
      }),
      null,
    );
    const events = await h.execute('codex', 'run schema-hooks');
    assert.equal(events.at(-1)?.outcome, 'completed', JSON.stringify(events));
    const log = await h.lines(path.join(h.kb, 'codex-stand-in.jsonl'));
    const start = log.find((m) => m.method === 'thread/start');
    // Codex keeps the whole of AGENTS.md, and holds only irori's hooks trusted, by hash.
    assert.equal(start.params.config.project_doc_max_bytes, 1048576);
    assert.equal(start.params.config.bypass_hook_trust, undefined);
    assert.deepEqual(Object.keys(start.params.config.hooks).sort(), [
      'PostToolUse',
      'PreToolUse',
      'state',
    ]);
    const pre = JSON.parse(log.find((m) => m.type === 'pre').stdout);
    assert.deepEqual(pre, {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'A PreToolUse hook of the Schema blocked this call: NO-RM',
      },
    });
    // apply_patch is an edit to a Schema hook, with the file it changes.
    const post = JSON.parse(log.find((m) => m.type === 'post').stdout);
    assert.equal(
      post.hookSpecificOutput.additionalContext,
      'PostToolUse hook feedback from the Schema:\nEDITED notes/a.md',
    );
    // Codex fingerprints otherwise: irori starts it once more with the trust Codex reported.
    await writeFile(path.join(h.kb, 'codex-salt'), '');
    const again = await h.execute('codex', 'run schema-hooks', {
      conversationId: undefined,
    });
    assert.equal(again.at(-1)?.outcome, 'completed', JSON.stringify(again));
    const posts = (await h.lines(path.join(h.kb, 'codex-stand-in.jsonl'))).filter(
      (m) => m.type === 'pre',
    );
    assert.equal(posts.length, 2);
    assert.match(posts[1].stdout, /NO-RM/);
    // Codex that does not list irori's hooks: nothing is sent.
    await writeFile(
      path.join(h.bin, 'codex'),
      codexStandIn.replace(
        "if (m.method === 'hooks/list') {",
        "if (m.method === 'hooks/list' && false) {",
      ),
      { mode: 0o700 },
    );
    const turns = (await h.lines(path.join(h.kb, 'codex-stand-in.jsonl'))).filter(
      (m) => m.method === 'turn/start',
    ).length;
    const refused = await h.execute('codex', 'run schema-hooks');
    assert.equal(refused.at(-1)?.outcome, 'failed');
    assert.match(
      refused.find((event) => event.type === 'error')?.text ?? '',
      /Codex が irori のフックを受け付けなかった|Codex did not take irori's hooks/,
    );
    assert.equal(
      (await h.lines(path.join(h.kb, 'codex-stand-in.jsonl'))).filter(
        (m) => m.method === 'turn/start',
      ).length,
      turns,
    );
  },
);

test(
  'a session counts as having heard the Schema only once its CLI took the request; an AGENTS.md Codex skipped goes as words',
  posix,
  async (t) => {
    const h = await harness(t);
    await writeFile(path.join(h.bin, 'codex'), codexStandIn, { mode: 0o700 });
    await h.you.create();
    await h.settings.write(sharedSchemaId, 'AGENTS.md', 'SHARED-INSTRUCTIONS\n', null);
    await h.settings.write(h.space.scopeId, 'AGENTS.md', 'VAULT-INSTRUCTIONS\n', null);
    // The first turn never starts: the thread exists, but it heard nothing.
    await writeFile(path.join(h.kb, 'fail-turn'), '');
    assert.equal((await h.execute('codex', 'first')).at(-1)?.outcome, 'failed');
    await rm(path.join(h.kb, 'fail-turn'));
    await h.execute('codex', 'second');
    await h.execute('codex', 'third compact-now');
    await h.execute('codex', 'fourth');
    const turns = (await h.lines(path.join(h.kb, 'codex-stand-in.jsonl')))
      .filter((m) => m.method === 'turn/start')
      .map(
        (m) => m.params.input.find((item: { type: string }) => item.type === 'text').text as string,
      );
    // The first turn was refused before Codex took it.
    assert.equal(turns.length, 4);
    assert.match(turns[1], /SHARED-INSTRUCTIONS/, 'the resumed thread never heard it');
    assert.match(turns[2], /shared Schema given earlier in this session still applies/);
    assert.match(turns[3], /SHARED-INSTRUCTIONS/, 'whole again after the compaction');
    // Codex says it loaded the vault's AGENTS.md itself.
    assert.doesNotMatch(turns[1], /VAULT-INSTRUCTIONS/);
    await writeFile(path.join(h.kb, 'codex-skips-agents'), '');
    await h.execute('codex', 'fifth');
    const last = (await h.lines(path.join(h.kb, 'codex-stand-in.jsonl')))
      .filter((m) => m.method === 'turn/start')
      .at(-1)
      .params.input.find((item: { type: string }) => item.type === 'text').text;
    assert.match(last, /<folder-instructions>\nVAULT-INSTRUCTIONS\n<\/folder-instructions>/);
  },
);

// --- Antigravity CLI -------------------------------------------------------------

// Reads `.agents/hooks.json` in each `--add-dir` folder, as the CLI reads `.agents/`
// in every workspace folder, and runs its hooks; `agy-ignores-hooks` makes it not.
const agyStandIn = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const log = (value) => fs.appendFileSync('agy-stand-in.jsonl', JSON.stringify(value) + '\\n');
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
const hooks = {};
if (!fs.existsSync('agy-ignores-hooks'))
  args.forEach((arg, i) => {
    if (arg !== '--add-dir') return;
    const file = path.join(args[i + 1], '.agents', 'hooks.json');
    if (!fs.existsSync(file)) return;
    for (const group of Object.values(JSON.parse(fs.readFileSync(file, 'utf8'))))
      for (const [event, list] of Object.entries(group)) hooks[event] = list[0].hooks[0].command;
  });
const run = (event, payload) => hooks[event] ? spawnSync('/bin/sh', ['-c', hooks[event]], { input: JSON.stringify(payload), encoding: 'utf8' }).stdout : undefined;
let input = '';
process.stdin.on('data', (c) => (input += c)).on('end', () => {
  const prompt = JSON.parse(input.trim().split('\\n')[0]).message.content;
  log({ args, prompt });
  send({ event: 'init', conversation_id: 'conv-1' });
  run('SessionStart', {});
  log({ type: 'invocation', stdout: run('PreInvocation', { invocationNum: 0 }) });
  if (prompt.includes('schema-hooks')) {
    log({ type: 'pre', stdout: run('PreToolUse', { toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf data' } }, stepIdx: 1 }) });
    send({ event: 'step_update', step_update: { conversation_id: 'conv-1', step_index: 1, step_type: 'tool', state: 'ACTIVE', tool_info: { name: 'run_command' } } });
    log({ type: 'post', stdout: run('PostToolUse', { toolCall: { name: 'view_file', args: { AbsolutePath: '/kb/note.md' } }, stepIdx: 2 }) });
    log({ type: 'invocation', stdout: run('PreInvocation', { invocationNum: 1 }) });
  }
  setTimeout(() => {
    send({ event: 'result', result: { status: 'SUCCESS', response: 'done', conversation_id: 'conv-1' } });
    process.exit(0);
  }, 50);
});
`;

test(
  "the Antigravity CLI runs the Schema hooks through irori's folder of hooks, and stops before a call they could not see",
  posix,
  async (t) => {
    const h = await harness(t);
    await writeFile(path.join(h.bin, 'agy'), agyStandIn, { mode: 0o700 });
    await h.settings.write(
      h.space.scopeId,
      '.claude/settings.json',
      hooksJson({
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo NO-RM >&2; exit 2' }] },
        ],
        PostToolUse: [
          {
            matcher: 'Read',
            hooks: [{ type: 'command', command: 'echo READ-CAREFULLY >&2; exit 2' }],
          },
        ],
      }),
      null,
    );
    const events = await h.execute('antigravity', 'run schema-hooks');
    assert.equal(events.at(-1)?.outcome, 'completed', JSON.stringify(events));
    const log = await h.lines(path.join(h.kb, 'agy-stand-in.jsonl'));
    assert.deepEqual(JSON.parse(log.find((m) => m.type === 'pre').stdout), {
      decision: 'deny',
      reason: 'A PreToolUse hook of the Schema blocked this call: NO-RM',
    });
    // PostToolUse feedback goes before the next model call.
    const invocations = log.filter((m) => m.type === 'invocation').map((m) => JSON.parse(m.stdout));
    assert.deepEqual(invocations[0], {});
    assert.deepEqual(invocations[1], {
      injectSteps: [
        { ephemeralMessage: 'PostToolUse hook feedback from the Schema:\nREAD-CAREFULLY' },
      ],
    });
    // The folder of hooks is irori's, in its data directory, and gone after the run.
    const added = log[0].args.filter(
      (_: string, i: number, all: string[]) => all[i - 1] === '--add-dir',
    );
    assert.ok(added.some((dir: string) => dir.startsWith(path.join(h.files.dataDir, 'agy-hooks'))));
    assert.equal(existsSync(added.at(-1)), false);
    assert.deepEqual(
      await readdir(path.join(h.kb)).then((names) => names.includes('.agents')),
      false,
    );
    // A CLI that did not load the hooks: the run stops before the call.
    await writeFile(path.join(h.kb, 'agy-ignores-hooks'), '');
    const stopped = await h.execute('antigravity', 'run schema-hooks');
    assert.equal(stopped.at(-1)?.outcome, 'failed');
    assert.match(
      stopped.find((event) => event.type === 'error')?.text ?? '',
      /irori のフックを読み込まなかった|did not load irori's hooks/,
    );
  },
);

// --- Claude Code -------------------------------------------------------------------

const claudeStandIn = (version: string) => `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv.includes('--version')) { console.log('${version} (Claude Code)'); process.exit(0); }
const args = process.argv.slice(2);
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type === 'control_request')
    send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: {} } });
  if (message.type === 'user') {
    const text = message.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    fs.appendFileSync('claude-stand-in.jsonl', JSON.stringify({ args, prompt: text }) + '\\n');
    send({ type: 'system', subtype: 'init', session_id: 'claude-session' });
    send({ type: 'result', subtype: 'success', result: 'done', is_error: false, session_id: 'claude-session', duration_ms: 1, duration_api_ms: 0, num_turns: 1, total_cost_usd: 0, usage: {}, modelUsage: {}, permission_denials: [] });
    setTimeout(() => process.exit(0), 50);
  }
});
`;

test(
  'Claude Code reads the vault Schema itself, and is told to read AGENTS.md beside a CLAUDE.md; an older one is given AGENTS.md',
  posix,
  async (t) => {
    const h = await harness(t);
    await writeFile(path.join(h.bin, 'claude'), claudeStandIn('2.1.319'), { mode: 0o700 });
    await h.settings.write(h.space.scopeId, 'AGENTS.md', 'VAULT-INSTRUCTIONS\n', null);
    await h.settings.write(h.space.scopeId, '.claude/rules/tone.md', 'VAULT-RULE\n', null);
    await writeFile(path.join(h.kb, 'CLAUDE.md'), 'Claude only.\n');
    assert.equal((await h.execute('claude', 'one')).at(-1)?.outcome, 'completed');
    let [record] = await h.lines(path.join(h.kb, 'claude-stand-in.jsonl'));
    assert.doesNotMatch(
      record.prompt,
      /VAULT-RULE|VAULT-INSTRUCTIONS/,
      'Claude Code loads both itself',
    );
    const settings = JSON.parse(record.args[record.args.indexOf('--settings') + 1]);
    assert.deepEqual(settings.pluginConfigs, {
      'cc-plugin-agents-md@builtin': { options: { instructionFiles: 'claude-md-and-agents-md' } },
    });
    // A version from before AGENTS.md support, as irori listed it, hears it from irori.
    await writeFile(path.join(h.bin, 'claude'), claudeStandIn('2.1.200'), { mode: 0o700 });
    assert.match(await version('claude'), /^2\.1\.200/);
    await rm(path.join(h.kb, 'claude-stand-in.jsonl'));
    await h.execute('claude', 'two', { conversationId: undefined });
    [record] = await h.lines(path.join(h.kb, 'claude-stand-in.jsonl'));
    assert.match(record.prompt, /VAULT-INSTRUCTIONS/);
    assert.doesNotMatch(record.prompt, /VAULT-RULE/);
  },
);
