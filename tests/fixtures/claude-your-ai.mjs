// A stand-in for `claude` that speaks the Agent SDK's stream-json protocol and
// plays your AI handing work to a brain's sub-agent: the hand-off, the
// sub-agent's write with its permission request, and its report. No model runs.
// The request's words choose the play:
// - "direct" also tries to write in the brain from your AI itself;
// - "background" asks for the hand-off in the background;
// - otherwise the first brain irori lists gets a note from its sub-agent.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export function run() {
  const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
  const log = (value) => fs.appendFileSync('your-ai-fixture.jsonl', JSON.stringify(value) + '\n');
  const pending = new Map();
  let hooks = {};
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

  async function play(prompt) {
    const brains = [
      ...prompt.matchAll(/^- (.+?)(?: \([^)]*\))?: folder ("[^"]+"), sub-agent "([^"]+)"/gm),
    ].map((match) => ({ name: match[1], root: JSON.parse(match[2]), agent: match[3] }));
    log({ prompt, brains });
    send({
      type: 'system',
      subtype: 'init',
      session_id: 'fixture-session',
      agents: brains.map((brain) => brain.agent),
    });
    // Asked with the brain-agents skill: your AI writes the definitions in its own folder.
    if (prompt.includes('--- begin skill ---') && prompt.includes('brain-agents')) {
      for (const each of brains) {
        fs.mkdirSync(path.join('.claude', 'agents'), { recursive: true });
        fs.writeFileSync(
          path.join('.claude', 'agents', `${each.agent}.md`),
          `---\nname: ${each.agent}\ndescription: The ${each.name} brain's AI.\n---\nRead ${each.root}/AGENTS.md first.\n`,
        );
      }
      assistant([{ type: 'text', text: `Wrote ${brains.length} definitions.` }]);
      return result();
    }
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
      log({ direct: denied(outputs) ? 'denied' : 'allowed' });
      if (!denied(outputs)) fs.writeFileSync(file, 'direct\n');
    }
    const handOff = {
      subagent_type: brain.agent,
      description: `Write a note in ${brain.name}`,
      prompt: 'Write the note.',
      run_in_background: prompt.includes('background'),
    };
    const agentHook = await hook(
      'PreToolUse',
      { tool_name: 'Agent', tool_input: handOff, tool_use_id: 'toolu-hand-off' },
      'Agent',
    );
    const updated = agentHook.find((output) => output?.hookSpecificOutput?.updatedInput)
      ?.hookSpecificOutput.updatedInput;
    log({ background: (updated ?? handOff).run_in_background });
    assistant([
      { type: 'tool_use', id: 'toolu-hand-off', name: 'Agent', input: updated ?? handOff },
    ]);
    send({
      type: 'system',
      subtype: 'task_started',
      task_id: 'agent-1',
      tool_use_id: 'toolu-hand-off',
      description: handOff.description,
      subagent_type: brain.agent,
      session_id: 'fixture-session',
    });
    await hook('SubagentStart', { agent_id: 'agent-1', agent_type: brain.agent });
    const file = path.join(brain.root, 'Knowledge_Base', 'from-your-ai.md');
    const write = { file_path: file, content: '# From your AI\n' };
    assistant(
      [{ type: 'tool_use', id: 'toolu-write', name: 'Write', input: write }],
      'toolu-hand-off',
    );
    const writeHook = await hook(
      'PreToolUse',
      {
        tool_name: 'Write',
        tool_input: write,
        tool_use_id: 'toolu-write',
        agent_id: 'agent-1',
        agent_type: brain.agent,
      },
      'Write',
    );
    let written = false;
    if (!denied(writeHook)) {
      const permission = await request({
        subtype: 'can_use_tool',
        tool_name: 'Write',
        input: write,
        tool_use_id: 'toolu-write',
        agent_id: 'agent-1',
      });
      if (permission?.behavior === 'allow') {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, write.content);
        written = true;
      }
    }
    log({ written });
    send({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'agent-1',
      tool_use_id: 'toolu-hand-off',
      status: 'completed',
      output_file: '',
      summary: written ? 'Wrote Knowledge_Base/from-your-ai.md.' : 'The write was refused.',
      session_id: 'fixture-session',
    });
    await hook('SubagentStop', {
      agent_id: 'agent-1',
      agent_type: brain.agent,
      stop_hook_active: false,
      agent_transcript_path: '',
    });
    assistant([{ type: 'text', text: `Handed the note to ${brain.name}'s AI.` }]);
    result();
  }

  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    const message = JSON.parse(line);
    if (message.type === 'control_request') {
      if (message.request?.subtype === 'initialize') hooks = message.request.hooks ?? {};
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
