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
  ): Promise<{
    allow: boolean;
    answers?: AgentAnswers;
  }>;
  saveSession(handle: string): Promise<void>;
}
