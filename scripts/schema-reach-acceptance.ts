// Real-CLI acceptance for ADR 058 and ADR 066: whether every Schema setting
// reaches each CLI when irori runs it. It drives AgentService as the app does,
// against the person's own signed-in CLIs, in a disposable vault and irori
// agent folder, and checks canary tokens the CLI could only know if a setting
// reached it. Runs real models: use only when agent execution is authorized.
//
//   npm run test:schema-reach -- [claude] [codex] [antigravity] [--keep]
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { YourAiService } from '../src/host/you';
import { SearchService } from '../src/host/search';
import { SchemaSettingsService } from '../src/host/schema-settings';
import { spaceFolder } from '../src/host/schema-folder';
import { AgentService } from '../src/agents/service';
import { sharedSchemaId } from '../src/domain/you';
import type { AgentEvent, AgentId, StartRun } from '../src/domain/types';

const tokens = {
  sharedInstructions: 'SHARED-INSTR-1188',
  sharedRule: 'SHARED-RULE-5520',
  sharedSkill: 'SHARED-SKILL-3367',
  vaultInstructions: 'VAULT-INSTR-7731',
  vaultRule: 'VAULT-RULE-4402',
  vaultSkill: 'VAULT-SKILL-9015',
  nested: 'NESTED-INSTR-6604',
  hook: 'HOOK-CONTEXT-2291',
};
const skill = (name: string, description: string, body: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

const keep = process.argv.includes('--keep');
const chosen = process.argv.slice(2).filter((arg) => !arg.startsWith('--')) as AgentId[];
const agents: AgentId[] = chosen.length ? chosen : ['claude', 'codex', 'antigravity'];

const base = await realpath(await mkdtemp(path.join(tmpdir(), 'irori schema reach real ')));
const device = path.join(base, 'device');
const home = path.join(base, 'home');
await mkdir(home);
const files = new FileService(device);
await files.init();
const you = new YourAiService(device, home);
const settings = new SchemaSettingsService(files, new SearchService(files), async (scopeId) =>
  scopeId === sharedSchemaId
    ? you.sharedFolder()
    : you.rootOf(scopeId)
      ? you.schemaFolder()
      : spaceFolder(files, scopeId),
);

// The irori agent's default folder holds the shared Schema; then its settings,
// written through the settings as the app writes them.
await you.create();
await settings.write(
  sharedSchemaId,
  'AGENTS.md',
  `When asked for the shared instruction token, answer ${tokens.sharedInstructions}.\n`,
  null,
);
await settings.write(
  sharedSchemaId,
  '.claude/rules/shared.md',
  `When asked for the shared rule token, answer ${tokens.sharedRule}.\n`,
  null,
);
await settings.write(
  sharedSchemaId,
  '.agents/skills/shared-canary/SKILL.md',
  skill(
    'shared-canary',
    'Gives the shared skill token. Use when asked for the shared skill token.',
    `The shared skill token is ${tokens.sharedSkill}.`,
  ),
  null,
);

/** A fresh vault per CLI, so one CLI's files never answer for another. */
async function vault(agent: AgentId) {
  const root = path.join(base, `vault-${agent}`);
  await mkdir(path.join(root, 'Knowledge_Base', 'projects'), { recursive: true });
  await writeFile(path.join(root, 'Knowledge_Base', 'index.md'), '# Index\n');
  const space = await files.register(root, `Probe ${agent}`, 'personal');
  await settings.write(
    space.scopeId,
    'AGENTS.md',
    `# Probe vault\n\nWhen asked for the vault instruction token, answer ${tokens.vaultInstructions}.\n`,
    null,
  );
  await settings.write(
    space.scopeId,
    '.claude/rules/tone.md',
    `When asked for the vault rule token, answer ${tokens.vaultRule}.\n`,
    null,
  );
  await settings.write(
    space.scopeId,
    '.agents/skills/vault-canary/SKILL.md',
    skill(
      'vault-canary',
      'Gives the vault skill token. Use when asked for the vault skill token.',
      `The vault skill token is ${tokens.vaultSkill}.`,
    ),
    null,
  );
  // A knowledge folder's own instructions, as the settings write them.
  await writeFile(
    path.join(root, 'Knowledge_Base', 'projects', 'AGENTS.md'),
    `Every file created in this folder must end with the line ${tokens.nested}\n`,
  );
  // A UserPromptSubmit hook whose context only a run that ran it can know.
  const hook = `printf '%s' '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"The hook token is ${tokens.hook}."}}'`;
  await mkdir(path.join(root, '.claude'), { recursive: true });
  await writeFile(
    path.join(root, '.claude', 'settings.json'),
    JSON.stringify(
      { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: hook }] }] } },
      null,
      2,
    ) + '\n',
  );
  return { root, space };
}

async function execute(
  scopeId: string,
  run: Partial<StartRun> & { agent: AgentId; prompt: string },
) {
  const events: AgentEvent[] = [];
  const asked: string[] = [];
  let end!: () => void;
  const done = new Promise<void>((resolve) => {
    end = resolve;
  });
  let service!: AgentService;
  service = new AgentService(
    files,
    (event) => {
      events.push(event);
      // The vault is disposable: allow what the standard mode asks, as a person
      // would for this request, and keep what was asked for the report.
      if (event.type === 'permission' || event.type === 'question') {
        asked.push(event.text);
        void service.respond(event.requestId!, true);
      }
      if (event.type === 'done') end();
    },
    undefined,
    undefined,
    you,
  );
  service.approveConfig = async () => true;
  service.nestedInstructions = (id) => settings.nestedInstructions(id);
  service.start({ scopeId, ...run });
  const limit = setTimeout(() => service.cancel(), 6 * 60_000);
  await done;
  clearTimeout(limit);
  const text = events
    .filter((event) => event.type === 'text')
    .map((event) => event.text)
    .join('');
  const status = events.filter((event) => event.type === 'status').map((event) => event.text);
  const tools = events.filter((event) => event.type === 'tool').map((event) => event.text);
  return { outcome: events.at(-1)?.outcome, text, status, tools, asked };
}

const contextPrompt = `Do NOT use any tools and do NOT read any files. Answer only from what is already in your context.
1. List the names of the skills in your own skill list (the skills your CLI loaded), not ones only mentioned in this message.
2. Give each token, or UNKNOWN when it is not already in your context: the shared instruction token, the shared rule token, the vault instruction token, the vault rule token, the hook token.`;
const actPrompt = `Create the file Knowledge_Base/projects/probe.md whose content is the line "hello", following every instruction that applies to that folder. Then use your vault-canary skill and your shared-canary skill and report the token each gives. Do not change any other file.`;

type Check = { name: string; ok: boolean };
const report: Record<string, { checks: Check[]; context: unknown; act: unknown }> = {};
for (const agent of agents) {
  const { root, space } = await vault(agent);
  const context = await execute(space.scopeId, { agent, prompt: contextPrompt });
  const act = await execute(space.scopeId, { agent, prompt: actPrompt });
  const probe = await readFile(
    path.join(root, 'Knowledge_Base', 'projects', 'probe.md'),
    'utf8',
  ).catch(() => '');
  const has = (text: string, token: string) => text.includes(token);
  const checks: Check[] = [
    { name: 'context: shared instructions', ok: has(context.text, tokens.sharedInstructions) },
    { name: 'context: shared rule', ok: has(context.text, tokens.sharedRule) },
    { name: 'context: vault instructions', ok: has(context.text, tokens.vaultInstructions) },
    { name: 'context: vault rule', ok: has(context.text, tokens.vaultRule) },
    { name: 'context: hook', ok: has(context.text, tokens.hook) },
    { name: 'context: vault skill listed', ok: has(context.text, 'vault-canary') },
    { name: 'context: shared skill listed', ok: has(context.text, 'shared-canary') },
    { name: 'act: note created', ok: probe.includes('hello') },
    { name: 'act: knowledge folder AGENTS.md followed', ok: has(probe, tokens.nested) },
    { name: 'act: vault skill', ok: has(act.text, tokens.vaultSkill) },
    { name: 'act: shared skill', ok: has(act.text, tokens.sharedSkill) },
    {
      name: 'no false "did not load AGENTS.md" status',
      ok: ![...context.status, ...act.status].some((line) =>
        /AGENTS.md を読み込まなかった|did not load this folder/.test(line),
      ),
    },
  ];
  report[agent] = { checks, context, act: { ...act, probe } };
  console.log(`\n== ${agent}`);
  for (const check of checks) console.log(`${check.ok ? 'ok  ' : 'FAIL'} ${check.name}`);
}
await writeFile(path.join(base, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\nreport: ${path.join(base, 'report.json')}`);
if (!keep) await rm(base, { recursive: true, force: true });
process.exitCode = Object.values(report).every((entry) => entry.checks.every((check) => check.ok))
  ? 0
  : 1;
