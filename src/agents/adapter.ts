import type { ChildProcess } from 'node:child_process';
import type { AgentEvent, AgentAnswers, Question } from '../domain/types';

export interface NativeContext {
  cwd: string;
  prompt: string;
  session?: string;
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
