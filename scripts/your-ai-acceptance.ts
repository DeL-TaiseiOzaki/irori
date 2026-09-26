// Real-provider acceptance for "your AI" handing work to brain sub-agents through
// Claude Code. It uses the person's own Claude Code sign-in and consumes its
// allowance, so it runs only on request (`npm run test:your-ai`) with the owner's
// authorization. Everything it writes is disposable; the observations go to
// test-results/your-ai-acceptance.json, which is not tracked.
import { query, type HookInput, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { toolFile, writeDecision, writeTools, type Delegation } from '../src/agents/delegation';
import { tmpdir } from 'node:os';
import path from 'node:path';

const base = await mkdtemp(path.join(tmpdir(), 'irori your-ai acceptance '));
const you = path.join(base, 'you');
const alpha = path.join(base, 'Alpha KB');
const beta = path.join(base, 'Beta KB');
const inside = (root: string, file: string) => {
  const relative = path.relative(root, path.resolve(root, file));
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};

// Two brains, each with its own Schema; Beta also defines an agent of its own.
for (const [root, name] of [
  [alpha, 'Alpha'],
  [beta, 'Beta'],
] as const) {
  await mkdir(path.join(root, 'Knowledge_Base'), { recursive: true });
  await writeFile(path.join(root, 'Knowledge_Base', 'note.md'), `# ${name} note\n`);
}
await writeFile(
  path.join(alpha, 'AGENTS.md'),
  '# Alpha brain\n\nEvery note created in this brain ends with the line `signed: alpha-lantern`.\n',
);
await writeFile(path.join(beta, 'AGENTS.md'), '# Beta brain\n');
await mkdir(path.join(beta, '.claude', 'agents'), { recursive: true });
await writeFile(
  path.join(beta, '.claude', 'agents', 'beta-own.md'),
  '---\nname: beta-own\ndescription: An agent the Beta brain defines for itself.\n---\nYou help in the Beta brain.\n',
);

// Your AI: its own Schema and one sub-agent definition per brain, as the
// brain-agents skill would have it write them.
await mkdir(path.join(you, '.claude', 'agents'), { recursive: true });
await writeFile(
  path.join(you, 'AGENTS.md'),
  "# Your AI\n\nYou coordinate the person's brains. Each brain has a sub-agent defined in `.claude/agents`. Hand work about a brain to its sub-agent, then report what it did and which files changed.\n",
);
const definition = (name: string, root: string) =>
  `---\nname: ${name}\ndescription: The ${name} brain's AI. Use it for any work in the ${name} brain at ${root}.\ntools: Read, Write, Edit, Glob, Grep\n---\nYou are the AI of the ${name} brain, whose folder is ${root}.\n\n1. Read ${path.join(root, 'AGENTS.md')} first and follow it.\n2. Work only inside ${root}.\n3. Finish by reporting the result and every file you changed.\n`;
await writeFile(path.join(you, '.claude', 'agents', 'alpha.md'), definition('alpha', alpha));
await writeFile(path.join(you, '.claude', 'agents', 'beta.md'), definition('beta', beta));
// A helper for the Alpha brain whose definition says nothing about staying inside
// it: only irori's rule keeps it there.
await writeFile(
  path.join(you, '.claude', 'agents', 'gamma.md'),
  '---\nname: gamma\ndescription: A file helper for the Alpha brain.\ntools: Read, Write\n---\nDo exactly what you are asked with files.\n',
);
const delegation: Delegation = {
  you,
  brains: [
    { scopeId: 'alpha', name: 'Alpha', agent: 'alpha', root: alpha },
    { scopeId: 'alpha', name: 'Alpha', agent: 'gamma', root: alpha },
    { scopeId: 'beta', name: 'Beta', agent: 'beta', root: beta },
  ],
};

type Record_ = Record<string, unknown>;
const log: Record_[] = [];
const note = (entry: Record_) => log.push({ at: log.length, ...entry });

async function turn(label: string, prompt: string, resume?: string) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8 * 60_000);
  const hook =
    (kind: string) =>
    async (input: HookInput): Promise<Record_> => {
      const common = {
        turn: label,
        hook: kind,
        agent_id: input.agent_id,
        agent_type: input.agent_type,
      };
      if (input.hook_event_name === 'SubagentStart' || input.hook_event_name === 'SubagentStop')
        note(common);
      if (input.hook_event_name === 'InstructionsLoaded')
        note({
          ...common,
          file: path.relative(base, input.file_path),
          reason: input.load_reason,
          trigger: input.trigger_file_path && path.relative(base, input.trigger_file_path),
        });
      if (input.hook_event_name === 'PreToolUse' && /^(Agent|Task)$/.test(input.tool_name)) {
        // A sub-agent in the background cannot ask the person, so its edits
        // would be refused: brain work runs in the foreground.
        const agentInput = input.tool_input as Record_;
        note({ ...common, tool: input.tool_name, background: agentInput.run_in_background });
        if (agentInput.run_in_background)
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'allow',
              updatedInput: { ...agentInput, run_in_background: false },
            },
          };
      } else if (input.hook_event_name === 'PreToolUse' && writeTools.test(input.tool_name)) {
        const file = toolFile(input.tool_input) ?? '';
        const decision = writeDecision(delegation, input.agent_type, file);
        note({
          ...common,
          tool: input.tool_name,
          file: path.relative(base, path.resolve(you, file)),
          denied: !decision.allow,
        });
        if (!decision.allow)
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: decision.reason,
            },
          };
      }
      return {};
    };
  let session = '';
  const response = query({
    prompt,
    options: {
      cwd: you,
      pathToClaudeCodeExecutable: 'claude',
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      permissionMode: 'default',
      additionalDirectories: [alpha, beta],
      resume,
      abortController: abort,
      hooks: {
        SubagentStart: [{ hooks: [hook('SubagentStart')] }],
        SubagentStop: [{ hooks: [hook('SubagentStop')] }],
        InstructionsLoaded: [{ hooks: [hook('InstructionsLoaded')] }],
        PreToolUse: [
          { matcher: 'Edit|MultiEdit|Write|NotebookEdit', hooks: [hook('PreToolUse')] },
          { matcher: 'Agent|Task', hooks: [hook('PreToolUse')] },
        ],
      },
      canUseTool: async (tool, input, options) => {
        const file = String((input as { file_path?: string }).file_path ?? '');
        const allowed =
          ['Write', 'Edit', 'MultiEdit', 'Read', 'Glob', 'Grep'].includes(tool) &&
          [alpha, beta, you].some((root) => inside(root, file) || file === '');
        note({
          turn: label,
          canUseTool: tool,
          agentID: options.agentID,
          file: file && path.relative(base, file),
          allowed,
        });
        return allowed
          ? { behavior: 'allow', updatedInput: input }
          : { behavior: 'deny', message: 'Not allowed in this acceptance run.' };
      },
    },
  });
  try {
    for await (const message of response as AsyncIterable<SDKMessage>) {
      const m = message as SDKMessage & Record_;
      if (m.type === 'system' && m.subtype === 'init') {
        session = String(m.session_id);
        note({ turn: label, init: true, agents: m.agents });
      } else if (m.type === 'system')
        note({
          turn: label,
          system: m.subtype,
          tool_use_id: m.tool_use_id,
          task_id: m.task_id,
          status: m.status,
          summary: typeof m.summary === 'string' ? m.summary.slice(0, 200) : undefined,
        });
      else if (m.type === 'assistant') {
        for (const block of m.message.content)
          if (block.type === 'tool_use')
            note({
              turn: label,
              tool_use: block.name,
              id: block.id,
              parent_tool_use_id: m.parent_tool_use_id,
              subagent_type: (block.input as Record_).subagent_type,
              run_in_background: (block.input as Record_).run_in_background,
            });
          else if (block.type === 'text' && !m.parent_tool_use_id)
            note({ turn: label, text: block.text.slice(0, 400) });
      } else if (m.type === 'user' && m.parent_tool_use_id)
        note({ turn: label, subagent_message: true, parent_tool_use_id: m.parent_tool_use_id });
      else if (m.type === 'result')
        note({ turn: label, result: m.subtype, is_error: m.is_error, cost: m.total_cost_usd });
    }
  } finally {
    clearTimeout(timer);
    response.close();
  }
  return session;
}

const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures.push(name);
};
try {
  const session = await turn(
    'first',
    [
      'This is an acceptance test of how work is handed to brain sub-agents; follow each step literally and report every outcome, including refusals.',
      '1. Use the alpha sub-agent to create Knowledge_Base/hello.md in the Alpha brain with the line "hello from alpha", following that brain\'s AGENTS.md.',
      `2. Use the gamma sub-agent to create ${path.join(beta, 'Knowledge_Base', 'gamma.md')} with the line "from gamma".`,
      `3. Yourself, without any sub-agent, try once to create ${path.join(beta, 'Knowledge_Base', 'direct.md')} with the line "direct".`,
      'Finish with one sentence per step.',
    ].join('\n'),
  );
  const read = (file: string) => readFile(file, 'utf8').catch(() => '');
  const hello = await read(path.join(alpha, 'Knowledge_Base', 'hello.md'));
  const first = log.filter((entry) => entry.turn === 'first');
  const init = first.find((entry) => entry.init);
  const agents = (init?.agents as string[] | undefined) ?? [];
  check(
    '1. the your-AI folder’s .claude/agents definitions load',
    agents.includes('alpha') && agents.includes('beta'),
  );
  console.log(`   a brain's own .claude/agents loads too: ${agents.includes('beta-own')}`);
  const delegations = first.filter(
    (entry) => entry.tool_use === 'Agent' || entry.tool_use === 'Task',
  );
  const delegation = delegations.find((entry) => entry.subagent_type === 'alpha');
  check('2a. the delegation names the brain sub-agent', !!delegation);
  const started = first.find(
    (entry) => entry.hook === 'SubagentStart' && entry.agent_type === 'alpha',
  );
  check('2b. SubagentStart gives the agent type and an id', !!started?.agent_id);
  check(
    '2c. sub-agent messages carry the delegation’s tool_use id',
    first.some((entry) => entry.parent_tool_use_id && entry.parent_tool_use_id === delegation?.id),
  );
  check(
    '2d. task_started and the report (task_notification) name the delegation',
    first.some(
      (entry) => entry.system === 'task_started' && entry.tool_use_id === delegation?.id,
    ) &&
      first.some(
        (entry) =>
          entry.system === 'task_notification' &&
          entry.tool_use_id === delegation?.id &&
          entry.task_id === started?.agent_id,
      ),
  );
  const asked = first.find(
    (entry) => entry.canUseTool === 'Write' && String(entry.file).includes('Alpha KB'),
  );
  check(
    '3a. the sub-agent’s write asks canUseTool with its agentID',
    !!asked && asked.agentID === started?.agent_id,
  );
  check(
    '3b. the note is written, signed as Alpha’s AGENTS.md asks',
    hello.includes('hello from alpha') && hello.includes('alpha-lantern'),
  );
  const denied = (who: string | undefined, file: string) =>
    first.some(
      (entry) =>
        entry.hook === 'PreToolUse' &&
        entry.denied &&
        entry.agent_type === who &&
        String(entry.file).endsWith(file),
    );
  check(
    '3c. a sub-agent is kept inside its brain',
    denied('gamma', 'gamma.md') && !(await read(path.join(beta, 'Knowledge_Base', 'gamma.md'))),
  );
  check(
    '3d. your AI itself does not write in a brain',
    denied(undefined, 'direct.md') && !(await read(path.join(beta, 'Knowledge_Base', 'direct.md'))),
  );

  await turn(
    'resumed',
    'Use the alpha sub-agent again, in the background (run_in_background), to append the line "again" to Knowledge_Base/hello.md in the Alpha brain. Then say "done".',
    session,
  );
  const again = await read(path.join(alpha, 'Knowledge_Base', 'hello.md'));
  const resumed = log.filter((entry) => entry.turn === 'resumed');
  check(
    '6. a resumed session still sees the definitions and delegates',
    ((resumed.find((entry) => entry.init)?.agents as string[] | undefined) ?? []).includes(
      'alpha',
    ) && again.includes('again'),
  );
  const result = resumed.findIndex((entry) => entry.result);
  const notified = resumed.findIndex((entry) => entry.system === 'task_notification');
  check(
    '4. a background request runs in the foreground, and the result follows the report',
    resumed.some((entry) => entry.hook === 'PreToolUse' && entry.background === true) &&
      notified >= 0 &&
      notified < result,
  );
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile(
    'test-results/your-ai-acceptance.json',
    JSON.stringify({ base: path.basename(base), failures, log }, null, 2),
  );
  await rm(base, { recursive: true, force: true });
}
console.log(
  failures.length
    ? `Your-AI acceptance: ${failures.length} check(s) failed; see test-results/your-ai-acceptance.json.`
    : 'Your-AI acceptance passed with Claude Code: definitions, delegation, attribution, the brain boundary and resume.',
);
process.exit(failures.length ? 1 : 0);
