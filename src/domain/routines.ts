import { z } from 'zod';
import type { AgentAccess, AgentId } from './types';

/**
 * Routines (ADR 016): jobs a person or an agent defines in a folder with
 * `routine.yaml`, and the person starts with a button. A routine belongs to the
 * irori agent's folder (`routines/<folder>/`) or to a hibachi
 * (`.irori/routines/<folder>/`).
 */

/** A routine's folder name: one path segment, not hidden. */
export const routineFolder = z
  .string()
  .min(1)
  .max(120)
  .refine((value) => !value.startsWith('.') && !/[\\/\0]/.test(value));
/** A routine is named by its owner (a hibachi's id or the irori agent's) and its folder. */
export const routineRef = z.object({ owner: z.uuid(), folder: routineFolder }).strict();
export type RoutineRef = z.infer<typeof routineRef>;

/** Runtimes a person adds on this device; `.py` waits for Python (ADR 016 stage 3). */
export const routineRuntimes = ['javascript'] as const;
export type RoutineRuntime = (typeof routineRuntimes)[number];

/** Names a secret cannot take: they would change how irori or the program starts. */
const reservedNames = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'SHELL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'NODE_OPTIONS',
  'ELECTRON_RUN_AS_NODE',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
];
/** A secret's name: the environment variable a `run` step receives it in (ADR 016 D5). */
export const secretName = z
  .string()
  .regex(/^[A-Z_][A-Z0-9_]{0,63}$/)
  .refine((value) => !value.startsWith('IRORI_') && !reservedNames.includes(value));
/**
 * A secret's value: one line, as an environment variable and a write-back line
 * hold it. Eight characters at least, since every copy of it in a record is hidden.
 */
export const secretValue = z
  .string()
  .min(8)
  .max(8192)
  .refine((value) => !/[\x00-\x1f\x7f]/.test(value));

/** The secrets kept on this device, by name; their values never leave the host. */
export interface SecretList {
  /** Whether the OS keeps the key that protects them (ADR 016 D5). */
  available: boolean;
  names: string[];
}

export type RoutineStep =
  | {
      kind: 'run';
      /** A file in the routine folder, or a command on PATH and its arguments. */
      run: string | string[];
      secrets?: string[];
    }
  | {
      kind: 'agent';
      agent: 'irori' | 'hibachi';
      /** The hibachis handed to the irori agent: their names, or all of the workspace's. */
      hibachis?: 'all' | string[];
      access: AgentAccess;
      cli?: AgentId;
      model?: string;
      prompt: string;
    };

export const routineRunStates = [
  'running',
  'succeeded',
  'nothing',
  'failed',
  'stopped',
  'unknown',
] as const;
export type RoutineRunState = (typeof routineRunStates)[number];
export const routineStepStates = [
  'pending',
  'waiting',
  'running',
  'succeeded',
  'failed',
  'stopped',
  'unknown',
] as const;
export type RoutineStepState = (typeof routineStepStates)[number];

export interface RoutineStepRun {
  kind: 'run' | 'agent';
  label: string;
  state: RoutineStepState;
  startedAt?: string;
  endedAt?: string;
  /** A program's exit code; null when a signal ended it. */
  exitCode?: number | null;
  /** The end of a program's output, or an agent's report. */
  output: string;
  truncated?: boolean;
  /** Why the step failed or waits, in one sentence. */
  detail?: string;
  /** An agent step's run and the conversation of its own it is kept in (ADR 017). */
  conversation?: { scopeId: string; agent: AgentId; runId: string; conversationId?: string };
}

/** One run of a routine, kept on this device (D8). */
export interface RoutineRun {
  id: string;
  routine: RoutineRef;
  name: string;
  startedAt: string;
  endedAt?: string;
  state: RoutineRunState;
  steps: RoutineStepRun[];
  /** Files each hibachi's Git status shows changed between the run's start and end. */
  changes: { scopeId: string; name: string; paths: string[] }[];
  /** Why the run could not go on, when no step says it. */
  detail?: string;
}

/** A routine's `routine.yaml` as the person edits it; `version` names the text read. */
export interface RoutineSource {
  text: string;
  version: string;
}

export interface Routine {
  ref: RoutineRef;
  owner: 'irori' | 'hibachi';
  /** The name in `routine.yaml`, or the folder's when it cannot be read. */
  name: string;
  /** The routine's folder on this device. */
  path: string;
  steps: RoutineStep[];
  /** Why `routine.yaml` or the folder cannot be used; such a routine never runs. */
  problem?: string;
  /** What this device or workspace lacks before the routine can run. */
  needs?: { text: string; runtime?: RoutineRuntime; secrets?: string[] };
  /** Whether the person confirmed its files as they are now on this device (D4). */
  review: 'unreviewed' | 'changed' | 'reviewed';
  /** The run in progress. */
  running?: string;
  last?: Pick<RoutineRun, 'id' | 'state' | 'startedAt' | 'endedAt'>;
}

export type DiffLine = { kind: ' ' | '+' | '-' | '…'; text: string };

export interface RoutineReviewFile {
  path: string;
  /** Against what the person confirmed before; everything is `added` the first time. */
  status: 'added' | 'changed' | 'removed' | 'same';
  size: number;
  /** The text as it is now, for an added text file. */
  text?: string;
  /** The changed lines of a changed text file. */
  diff?: DiffLine[];
  /** Not shown as text: binary, or too large. */
  opaque?: boolean;
}

export interface RoutineReview {
  ref: RoutineRef;
  name: string;
  path: string;
  /** What `runRoutine` is given to confirm these files. */
  digest: string;
  /** Confirmed before on this device, in some version. */
  confirmedBefore: boolean;
  files: RoutineReviewFile[];
  /** The secrets its `run` steps receive. */
  secrets: string[];
  problem?: string;
}

/** What `runRoutine` takes besides the routine. */
export interface RunRoutine {
  workspaceId: string;
  /** The digest of the files the person reviewed, when the review is asked for. */
  digest?: string;
  /** The CLI and model chosen in each agent's panel, by its scope. */
  agents: Record<string, { agent: AgentId; model?: string }>;
}

export function routineKey(ref: RoutineRef) {
  return `${ref.owner}/${ref.folder}`;
}

/** What a step is, in a few words. */
export function stepLabel(step: RoutineStep) {
  if (step.kind === 'run') return Array.isArray(step.run) ? step.run.join(' ') : step.run;
  return step.agent === 'irori' ? 'irori agent' : 'hibachi agent';
}

/**
 * The lines that differ between two texts, with `context` unchanged lines
 * around each change and `…` where unchanged lines are left out.
 */
export function lineDiff(before: string, after: string, context = 3): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const middle: DiffLine[] = [];
  if (midA.length * midB.length > 4_000_000) {
    middle.push(...midA.map((text) => ({ kind: '-' as const, text })));
    middle.push(...midB.map((text) => ({ kind: '+' as const, text })));
  } else {
    // The longest common subsequence of the changed middle, read back in order.
    const width = midB.length + 1;
    const table = new Uint32Array((midA.length + 1) * width);
    for (let i = midA.length - 1; i >= 0; i--)
      for (let j = midB.length - 1; j >= 0; j--)
        table[i * width + j] =
          midA[i] === midB[j]
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    let i = 0;
    let j = 0;
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
        middle.push({ kind: ' ', text: midA[i] });
        i++;
        j++;
      } else if (
        i < midA.length &&
        (j === midB.length || table[(i + 1) * width + j] >= table[i * width + j + 1])
      ) {
        // A removed line comes before the line that replaces it.
        middle.push({ kind: '-', text: midA[i] });
        i++;
      } else {
        middle.push({ kind: '+', text: midB[j] });
        j++;
      }
    }
  }
  const lines: DiffLine[] = [
    ...a.slice(0, start).map((text) => ({ kind: ' ' as const, text })),
    ...middle,
    ...a.slice(endA).map((text) => ({ kind: ' ' as const, text })),
  ];
  const near = lines.map(() => false);
  lines.forEach((line, index) => {
    if (line.kind === ' ') return;
    for (
      let k = Math.max(0, index - context);
      k <= Math.min(lines.length - 1, index + context);
      k++
    )
      near[k] = true;
  });
  const shown: DiffLine[] = [];
  lines.forEach((line, index) => {
    if (near[index]) shown.push(line);
    else if (shown.at(-1)?.kind !== '…') shown.push({ kind: '…', text: '' });
  });
  return shown;
}
