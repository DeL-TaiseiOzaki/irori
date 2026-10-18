// A stand-in for `claude` that speaks the Agent SDK's stream-json protocol and
// plays both sides of a hand-off (ADR 050). No model runs.
// - As the irori agent (a request listing handed vaults), it hands the first
//   vault a note with `irori call`, run as its Bash tool would, and reports.
//   "direct" first tries to write in the vault itself.
// - As a vault agent handed a task, it writes the note in its vault, asking
//   for the write unless it runs in bypassPermissions, and reports.
// As Claude Code does, hooks run in every permission mode. Each side logs to
// your-ai-fixture.jsonl in the folder it works in.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFile } from 'node:child_process';

export function run() {
  const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
  const log = (value) => fs.appendFileSync('your-ai-fixture.jsonl', JSON.stringify(value) + '\n');
  const pending = new Map();
  const mode = process.argv.includes('--permission-mode')
    ? process.argv[process.argv.indexOf('--permission-mode') + 1]
    : 'default';
  const flag = (name) =>
    process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
  let hooks = {};
  let agents = {};
  let next = 0;
  const request = (body) =>
    new Promise((resolve) => {
      const id = `fixture-${++next}`;
      pending.set(id, resolve);
      send({ type: 'control_request', request_id: id, request: body });
    });
  const callbacks = (event, tool) =>
    (hooks[event] ?? [])
      .filter(
        (matcher) => !matcher.matcher || new RegExp(`^(${matcher.matcher})$`).test(tool ?? ''),
      )
      .flatMap((matcher) => matcher.hookCallbackIds);
  const hook = async (event, input, tool) => {
    const outputs = [];
    for (const id of callbacks(event, tool))
      outputs.push(
        await request({
          subtype: 'hook_callback',
          callback_id: id,
          input: {
            hook_event_name: event,
            session_id: 'fixture-session',
            transcript_path: '',
            cwd: process.cwd(),
            ...input,
          },
        }),
      );
    return outputs;
  };
  const denied = (outputs) =>
    outputs.some((output) => output?.hookSpecificOutput?.permissionDecision === 'deny');
  const assistant = (content, parent = null) =>
    send({
      type: 'assistant',
      parent_tool_use_id: parent,
      session_id: 'fixture-session',
      message: {
        id: `msg-${++next}`,
        type: 'message',
        role: 'assistant',
        model: 'fixture',
        content,
        stop_reason: null,
        stop_sequence: null,
        usage: {},
      },
    });
  const result = () =>
    send({
      type: 'result',
      subtype: 'success',
      result: 'done',
      is_error: false,
      session_id: 'fixture-session',
      duration_ms: 1,
      duration_api_ms: 0,
      num_turns: 1,
      total_cost_usd: 0,
      usage: {},
      modelUsage: {},
      permission_denials: [],
    });

  const started = () =>
    send({
      type: 'system',
      subtype: 'init',
      session_id: 'fixture-session',
      agents: Object.keys(agents),
    });
  // What irori gave this run beside the words: settings, sub-agents, refusals, model.
  const launched = () => ({
    mode,
    agents: Object.keys(agents),
    ...(flag('--settings') && { settings: flag('--settings') }),
    ...(flag('--disallowedTools') && { disallowed: flag('--disallowedTools') }),
    ...(flag('--model') && { model: flag('--model') }),
  });

  async function vault(prompt) {
    log({ role: 'vault', prompt, ...launched() });
    started();
    const file = path.join(process.cwd(), 'Knowledge_Base', 'from-your-ai.md');
    const write = { file_path: file, content: '# From your AI\n' };
    assistant([{ type: 'tool_use', id: 'toolu-write', name: 'Write', input: write }]);
    const outputs = await hook(
      'PreToolUse',
      { tool_name: 'Write', tool_input: write, tool_use_id: 'toolu-write' },
      'Write',
    );
    let written = false;
    if (!denied(outputs)) {
      const permission =
        mode === 'bypassPermissions'
          ? { behavior: 'allow' }
          : await request({
              subtype: 'can_use_tool',
              tool_name: 'Write',
              input: write,
              tool_use_id: 'toolu-write',
            });
      if (permission?.behavior === 'allow') {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, write.content);
        written = true;
      }
    }
    log({ written });
    assistant([
      {
        type: 'text',
        text: written ? 'Wrote Knowledge_Base/from-your-ai.md.' : 'The write was refused.',
      },
    ]);
    result();
  }

  async function play(prompt) {
    if (prompt.includes('irori: the irori agent handed you this task')) return vault(prompt);
    const brains = [
      ...prompt.matchAll(
        /^- (.+?)(?: \([^)]*\))?: folder ("(?:[^"\\]|\\.)*"), vault agent "([^"]+)"(?:, its agent: ("(?:[^"\\]|\\.)*"))?/gm,
      ),
    ].map((match) => ({
      name: match[1],
      root: JSON.parse(match[2]),
      agent: match[3],
      ...(match[4] && { description: JSON.parse(match[4]) }),
    }));
    log({ prompt, brains, ...launched() });
    started();
    const brain = brains[0];
    if (!brain) {
      assistant([{ type: 'text', text: 'No brain was handed to me.' }]);
      return result();
    }
    if (prompt.includes('direct')) {
      const file = path.join(brain.root, 'direct.md');
      const outputs = await hook(
        'PreToolUse',
        {
          tool_name: 'Write',
          tool_input: { file_path: file, content: 'direct\n' },
          tool_use_id: 'toolu-direct',
        },
        'Write',
      );
      const reason = outputs.find((output) => output?.hookSpecificOutput)?.hookSpecificOutput
        ?.permissionDecisionReason;
      log({ direct: denied(outputs) ? 'denied' : 'allowed', reason });
      if (!denied(outputs)) fs.writeFileSync(file, 'direct\n');
    }
    // The hand-off, as Claude Code's Bash tool runs it: `irori` from the run's PATH.
    const task = `Write a note in ${brain.name}`;
    const command = { command: `irori call ${brain.agent} "${task}"` };
    assistant([{ type: 'tool_use', id: 'toolu-call', name: 'Bash', input: command }]);
    const called = await new Promise((resolve) =>
      execFile(
        'irori',
        ['call', brain.agent, task],
        { env: process.env },
        (error, stdout, stderr) =>
          resolve({ status: error ? (error.code ?? 1) : 0, stdout, stderr }),
      ),
    );
    log({ called: brain.agent, ...called });
    send({
      type: 'user',
      parent_tool_use_id: null,
      session_id: 'fixture-session',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu-call',
            content: called.stdout || called.stderr,
          },
        ],
      },
    });
    // Paths as a reply writes them: the vault agent's, relative to its vault, and
    // the irori agent's own plan, relative to where it works.
    fs.mkdirSync(path.join(process.cwd(), 'plans'), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), 'plans', 'next.md'), '# Next\n');
    assistant([
      {
        type: 'text',
        text: `Handed the note to the ${brain.name} agent: \`Knowledge_Base/from-your-ai.md\`. My plan: \`plans/next.md\`.`,
      },
    ]);
    result();
  }

  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    const message = JSON.parse(line);
    if (message.type === 'control_request') {
      if (message.request?.subtype === 'initialize') {
        hooks = message.request.hooks ?? {};
        agents = message.request.agents ?? {};
      }
      send({
        type: 'control_response',
        response: { subtype: 'success', request_id: message.request_id, response: {} },
      });
    }
    if (message.type === 'control_response') {
      const resolve = pending.get(message.response.request_id);
      pending.delete(message.response.request_id);
      resolve?.(message.response.response);
    }
    if (message.type === 'user') {
      const content = message.message.content;
      const prompt =
        typeof content === 'string' ? content : content.map((part) => part.text ?? '').join('');
      play(prompt).catch((error) => {
        log({ error: String(error) });
        process.exit(3);
      });
    }
  });
}
