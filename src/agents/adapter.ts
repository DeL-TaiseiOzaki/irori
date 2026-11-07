import type { ChildProcess } from 'node:child_process';
import type { AgentAccess, AgentEvent, AgentAnswers, Question } from '../domain/types';

export interface NativeContext {
  cwd: string;
  prompt: string;
  session?: string;
  access?: AgentAccess;
  /** The model chosen for this instruction; the CLI's own default when absent. */
  model?: string;
  /** How much the CLI thinks for this instruction; its own default when absent. */
  effort?: string;
  /** Files the person attached: every one is named in the prompt, images go as pictures too. */
  attached?: { name: string; path: string; image?: string }[];
  /** The environment and extra arguments the CLI starts with; its own defaults when absent. */
  env?: NodeJS.ProcessEnv;
  args?: string[];
  signal: AbortSignal;
  child(child: ChildProcess): void;
  event(type: AgentEvent['type'], text: string, extra?: Partial<AgentEvent>): void;
  ask(
    text: string,
    details: unknown,
    questions?: Question[],
    /** A permission for a tool call: PermissionRequest hooks may answer it first (ADR 058). */
    tool?: { name: string; input: unknown },
  ): Promise<{
    allow: boolean;
    answers?: AgentAnswers;
  }>;
  saveSession(handle: string): Promise<void>;
  /**
   * The CLI compacted the session: what it heard may be gone, so the next request
   * gives the Schema and irori's words whole again (ADR 058).
   */
  compacted?(): void;
  /** Folders irori adds to the CLI's workspace for this run, such as its folder of hooks (ADR 058). */
  folders?: string[];
  /**
   * A tool call starts, as the CLI's output says. A reason given back stops the
   * run before it goes on: the Schema's hooks could not see the call (ADR 058).
   */
  toolStarted?(call: { tool: string; id?: string }): string | undefined;
  /** A tool call finished, as the CLI's output records it, for hooks irori runs after it (ADR 058). */
  toolFinished?(call: {
    tool: string;
    id?: string;
    input?: unknown;
    output?: unknown;
    error?: boolean;
  }): void;
}
