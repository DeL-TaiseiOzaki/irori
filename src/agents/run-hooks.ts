import { t } from '../domain/i18n';
import type { AgentId } from '../domain/types';
import { hookDenied, hookToolFeedback } from '../../prompts';
import type { BridgeAnswer, BridgeEvent } from './hook-bridge';
import type { HookEvent, HookOutcome, SchemaHookRunner } from './schema-hooks';
import { cliToolInput, hookTool } from './tool-names';

/**
 * How many times in a row Stop hooks may keep a turn going, as Claude Code
 * allows: 8, or `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`. The count starts again when
 * the agent calls a tool.
 */
export function stopHookCap(env: NodeJS.ProcessEnv = process.env) {
  const set = Number(env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP);
  return Number.isInteger(set) && set > 0 ? set : 8;
}

/**
 * The Schema's hooks over one run of a CLI that does not run them itself
 * (ADR 058): the events irori sees itself (SessionStart, UserPromptSubmit, Stop,
 * SessionEnd, Notification) and those the CLI's plugin, extension or hook
 * passes to irori (PreToolUse, PostToolUse, PreCompact). What the hooks say for
 * the person is shown in the run; what they say for the agent goes to it.
 */
export class RunHooks {
  /** PreToolUse context for calls that ran, given with their results. */
  private later = new Map<string, string[]>();
  constructor(
    readonly runner: SchemaHookRunner,
    private agent: AgentId,
    private io: {
      /** A line in the run for the person. */
      status: (text: string) => void;
      /** Asks the person; true when they allow. */
      ask: (text: string, details: unknown) => Promise<boolean>;
      /** A hook said `continue: false`: the run ends, with its reason. */
      halt: (reason: string) => void;
    },
  ) {}
  private report(event: HookEvent, outcome: HookOutcome) {
    for (const notice of outcome.notices)
      this.io.status(t(`${event} フック: ${notice}`, `${event} hook: ${notice}`));
    if (outcome.halt) this.io.halt(outcome.halt);
    return outcome;
  }
  private async run(
    event: HookEvent,
    input: Record<string, unknown>,
    match?: { value: string; also?: string[] },
  ) {
    if (!this.runner.has(event)) return { context: [], notices: [] } as HookOutcome;
    return this.report(event, await this.runner.run(event, input, match));
  }
  /** Context for the request from SessionStart hooks. */
  async sessionStart(source: 'startup' | 'resume' | 'compact') {
    return (await this.run('SessionStart', { source }, { value: source })).context;
  }
  /** Whether UserPromptSubmit hooks let the request go, and the context they add to it. */
  async userPromptSubmit(prompt: string) {
    const outcome = await this.run('UserPromptSubmit', { prompt });
    return { blocked: outcome.blocked ?? outcome.halt, context: outcome.context };
  }
  /**
   * What Stop hooks say when the turn would end: a block's reason, or context,
   * either of which keeps the turn going as in Claude Code.
   */
  async stop(active: boolean, last: string) {
    const outcome = await this.run('Stop', {
      stop_hook_active: active,
      last_assistant_message: last,
    });
    return outcome.halt
      ? { context: [] as string[] }
      : { blocked: outcome.blocked, context: outcome.context };
  }
  /**
   * A permission the CLI asks the person for: PermissionRequest hooks may
   * answer it instead. Undefined leaves it to the person.
   */
  async permission(name: string, input: unknown) {
    if (!this.runner.has('PermissionRequest')) return undefined;
    const tool = hookTool(this.agent, name, input);
    const outcome = await this.run(
      'PermissionRequest',
      { tool_name: tool.name, tool_input: tool.input },
      { value: tool.name, also: [name, ...(tool.also ?? [])] },
    );
    return outcome.decision;
  }
  /** After the CLI compacted the session: PostCompact hooks hear it, and decide nothing. */
  postCompact(trigger: 'manual' | 'auto' = 'auto') {
    if (!this.runner.has('PostCompact')) return;
    void this.run('PostCompact', { trigger, compact_summary: '' }, { value: trigger }).catch(
      () => {},
    );
  }
  /** The person is asked something: Notification hooks hear it, and the run does not wait for them. */
  notification(message: string, type: 'permission_prompt' | 'elicitation_dialog') {
    if (!this.runner.has('Notification')) return;
    void this.run('Notification', { message, notification_type: type }, { value: type }).catch(
      () => {},
    );
  }
  async sessionEnd() {
    await this.run('SessionEnd', { reason: 'other' }, { value: 'other' });
  }
  /** Answers what the CLI's plugin, extension or hook asks about one event. */
  async answer(event: BridgeEvent): Promise<BridgeAnswer> {
    if (event.event === 'PreCompact') {
      const trigger = event.trigger === 'manual' ? 'manual' : 'auto';
      const outcome = await this.run(
        'PreCompact',
        { trigger, custom_instructions: event.instructions ?? '' },
        { value: trigger },
      );
      // Pi stops a compaction a hook blocks; Codex and OpenCode compact all the same.
      if (outcome.blocked && this.agent !== 'pi')
        this.io.status(
          t(
            `PreCompact フックは圧縮を止めようとしましたが、この CLI では止められません: ${outcome.blocked}`,
            `A PreCompact hook asked to stop the compaction, which this CLI cannot do: ${outcome.blocked}`,
          ),
        );
      // Its words are instructions for the summary, which only OpenCode takes.
      if (outcome.context.length && this.agent !== 'opencode')
        this.io.status(
          t(
            'PreCompact フックの要約への指示は、この CLI には渡せません。',
            "A PreCompact hook's instructions for the summary cannot be given to this CLI.",
          ),
        );
      return {
        ...(outcome.blocked && { block: outcome.blocked }),
        ...(outcome.context.length && { feedback: outcome.context.join('\n\n') }),
      };
    }
    if (event.event === 'SubagentStart') {
      const input = (event.input && typeof event.input === 'object' ? event.input : {}) as Record<
        string,
        unknown
      >;
      const type = String(input.agent_type ?? '');
      const outcome = await this.run(
        'SubagentStart',
        { agent_id: input.agent_id ?? '', agent_type: type },
        { value: type },
      );
      return outcome.context.length ? { feedback: outcome.context.join('\n\n') } : {};
    }
    if (event.event === 'SubagentStop') {
      const input = event.input && typeof event.input === 'object' ? event.input : {};
      const type = String((input as Record<string, unknown>).agent_type ?? '');
      const outcome = await this.run(
        'SubagentStop',
        { stop_hook_active: false, ...(input as Record<string, unknown>) },
        { value: type },
      );
      return outcome.blocked ? { block: outcome.blocked } : {};
    }
    const name = String(event.tool ?? '');
    const tool = hookTool(this.agent, name, event.input);
    const call = event.call ?? '';
    const match = { value: tool.name, also: [name, ...(tool.also ?? [])] };
    if (event.event === 'PreToolUse') {
      const outcome = await this.run(
        'PreToolUse',
        { tool_name: tool.name, tool_input: tool.input, tool_use_id: call },
        match,
      );
      // A sub-agent the CLI starts as a tool: SubagentStart hooks hear it, and
      // their context goes with its result.
      if (tool.name === 'Task' && !outcome.blocked && this.runner.has('SubagentStart')) {
        const type = String(tool.input.subagent_type ?? '');
        const started = await this.run(
          'SubagentStart',
          { agent_id: call, agent_type: type },
          { value: type },
        );
        outcome.context.push(...started.context);
      }
      if (outcome.halt) return { block: hookDenied(outcome.halt) };
      if (outcome.blocked) return { block: hookDenied(outcome.blocked) };
      if (
        outcome.ask &&
        !(await this.io.ask(
          t(
            `フックが ${tool.name} の実行に確認を求めています: ${outcome.ask}`,
            `A hook asks you about ${tool.name}: ${outcome.ask}`,
          ),
          { tool: tool.name, input: tool.input, reason: outcome.ask },
        ))
      )
        return { block: hookDenied(outcome.ask) };
      if (outcome.context.length && call) this.later.set(call, outcome.context);
      if (outcome.input) {
        const input = cliToolInput(this.agent, name, event.input, outcome.input);
        if (input) return { input };
        this.io.status(
          t(
            `PreToolUse フックの updatedInput は ${name} に当てはめられないため使いませんでした。`,
            `A PreToolUse hook's updatedInput does not map onto ${name}, so it was not used.`,
          ),
        );
      }
      return {};
    }
    const earlier = (call && this.later.get(call)) || [];
    if (call) this.later.delete(call);
    // A call that failed goes to PostToolUseFailure, one that ran to PostToolUse.
    const outcome =
      event.event === 'PostToolUseFailure'
        ? await this.run(
            'PostToolUseFailure',
            {
              tool_name: tool.name,
              tool_input: tool.input,
              tool_use_id: call,
              error: typeof event.output === 'string' ? event.output : JSON.stringify(event.output),
            },
            match,
          )
        : await this.run(
            'PostToolUse',
            {
              tool_name: tool.name,
              tool_input: tool.input,
              tool_response: event.output,
              tool_use_id: call,
            },
            match,
          );
    const words = [...earlier, ...outcome.context];
    // A sub-agent the CLI ran as a tool has finished: SubagentStop hooks hear it,
    // and what would keep it going goes back with its result.
    if (tool.name === 'Task' && this.runner.has('SubagentStop')) {
      const stopped = await this.run(
        'SubagentStop',
        {
          stop_hook_active: false,
          agent_type: String(tool.input.subagent_type ?? ''),
          last_assistant_message: typeof event.output === 'string' ? event.output : '',
        },
        { value: String(tool.input.subagent_type ?? '') },
      );
      if (stopped.blocked) words.push(stopped.blocked);
    }
    return {
      ...(words.length && {
        feedback: hookToolFeedback(
          event.event === 'PostToolUseFailure' ? 'PostToolUseFailure' : 'PostToolUse',
          words,
        ),
      }),
      ...(outcome.output !== undefined && {
        output:
          typeof outcome.output === 'string' ? outcome.output : JSON.stringify(outcome.output),
      }),
    };
  }
}
