import { isMap, isScalar, isSeq, parseDocument, Document, type YAMLMap, type YAMLSeq } from 'yaml';
import { z } from 'zod';
import { t } from './i18n';
import { agentAccessModes, agentIds, type AgentAccess, type AgentId } from './types';
import { agentModel, promptLimit } from './conversation';
import { requireAgentAccess } from './agent-access';
import { secretName, type Routine, type RoutineStep } from './routines';

/**
 * `routine.yaml` (ADR 016 D2): the strict reading the host runs by, shared with
 * the editor so it can say what still stops a routine as the person writes it,
 * and the form the editor shows in its place.
 */

const relativeFile = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      !/[\\\0:]/.test(value) &&
      value.split('/').every((part) => part && part !== '.' && part !== '..'),
  );
const commandName = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !/[\\/\0:]/.test(value) && !value.startsWith('-'));
const runStep = z
  .object({
    run: z.union([
      relativeFile,
      z
        .array(z.string().min(1).max(4000))
        .min(1)
        .max(64)
        .refine((argv) => commandName.safeParse(argv[0]).success),
    ]),
    secrets: z.array(secretName).min(1).max(20).optional(),
  })
  .strict();
const agentStep = z
  .object({
    agent: z.enum(['irori', 'vault']),
    vaults: z
      .union([z.literal('all'), z.array(z.string().min(1).max(120)).min(1).max(50)])
      .optional(),
    access: z.enum(agentAccessModes),
    cli: z.enum(agentIds).optional(),
    model: agentModel.optional(),
    prompt: z
      .string()
      .max(promptLimit)
      .refine((value) => !!value.trim()),
  })
  .strict();
const routineFile = z
  .object({
    name: z.string().trim().min(1).max(120),
    steps: z.array(z.unknown()).min(1).max(20),
  })
  .strict();

/** A validation failure as one sentence; `step` counts from 1. */
function issueText(issues: z.core.$ZodIssue[], step?: number) {
  // A misspelt key also leaves the real one missing; naming the unknown one says why.
  const issue = issues.find((item) => item.code === 'unrecognized_keys') ?? issues[0];
  const key = issue.path.map(String).join('.');
  const where =
    step === undefined
      ? key
      : key
        ? t(`ステップ ${step} の ${key}`, `step ${step}'s ${key}`)
        : t(`ステップ ${step}`, `step ${step}`);
  if (issue.code === 'unrecognized_keys') {
    const keys = issue.keys.join(', ');
    return step === undefined
      ? t(
          `routine.yaml に不明なキーがあります: ${keys}`,
          `routine.yaml has an unknown key: ${keys}`,
        )
      : t(
          `ステップ ${step} に不明なキーがあります: ${keys}`,
          `Step ${step} has an unknown key: ${keys}`,
        );
  }
  // A key left blank, as the editor's empty field writes it, is missing too.
  const blank = typeof issue.input === 'string' && !issue.input.trim();
  if (
    blank ||
    ((issue.code === 'invalid_type' || issue.code === 'invalid_value') && issue.input === undefined)
  )
    return t(`${where} がありません。`, `${where} is missing.`);
  if (issue.code === 'invalid_value')
    return t(
      `${where} は ${issue.values.join(' / ')} のどれかです。`,
      `${where} must be ${issue.values.join(' / ')}.`,
    );
  return t(`${where} が正しくありません。`, `${where} is not valid.`);
}

/**
 * Reads `routine.yaml` (ADR 016 D2). A routine in the irori agent's folder
 * instructs the irori agent; one in a vault instructs that vault's agent.
 */
export function parseRoutine(
  text: string,
  owner: Routine['owner'],
): { name: string; steps: RoutineStep[] } | { problem: string; name?: string } {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) {
    const line = document.errors[0].linePos?.[0].line;
    return {
      problem: line
        ? t(
            `routine.yaml を読めません（${line} 行目）。`,
            `routine.yaml cannot be read (line ${line}).`,
          )
        : t('routine.yaml を読めません。', 'routine.yaml cannot be read.'),
    };
  }
  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 50 });
  } catch {
    return { problem: t('routine.yaml を読めません。', 'routine.yaml cannot be read.') };
  }
  const top = routineFile.safeParse(value, { reportInput: true });
  if (!top.success) return { problem: issueText(top.error.issues) };
  const { name } = top.data;
  const steps: RoutineStep[] = [];
  for (const [index, raw] of top.data.steps.entries()) {
    const n = index + 1;
    const fields = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : undefined;
    if (!fields || Object.hasOwn(fields, 'run') === Object.hasOwn(fields, 'agent'))
      return {
        name,
        problem: t(
          `ステップ ${n} には run か agent のどちらかを書きます。`,
          `Step ${n} needs either run or agent.`,
        ),
      };
    if (Object.hasOwn(fields, 'run')) {
      const step = runStep.safeParse(fields, { reportInput: true });
      if (!step.success) return { name, problem: issueText(step.error.issues, n) };
      steps.push({ kind: 'run', ...step.data });
      continue;
    }
    const step = agentStep.safeParse(fields, { reportInput: true });
    if (!step.success) return { name, problem: issueText(step.error.issues, n) };
    const { agent, vaults, access, cli } = step.data;
    if (agent !== (owner === 'irori' ? 'irori' : 'vault'))
      return {
        name,
        problem:
          owner === 'irori'
            ? t(
                `ステップ ${n}: irori agent のルーティンでは agent: irori を使います。`,
                `Step ${n}: an irori agent routine uses agent: irori.`,
              )
            : t(
                `ステップ ${n}: vault のルーティンでは agent: vault を使います。`,
                `Step ${n}: a vault's routine uses agent: vault.`,
              ),
      };
    if (vaults && agent !== 'irori')
      return {
        name,
        problem: t(
          `ステップ ${n}: vaults は agent: irori に書きます。`,
          `Step ${n}: vaults belongs to agent: irori.`,
        ),
      };
    if (cli)
      try {
        requireAgentAccess(cli, access);
      } catch (error) {
        return { name, problem: t(`ステップ ${n}: `, `Step ${n}: `) + (error as Error).message };
      }
    steps.push({ kind: 'agent', ...step.data });
  }
  return { name, steps };
}

/** A `run` step as the editor holds it: a file of the folder, or a command line. */
export type RunDraft = {
  kind: 'run';
  file?: string;
  /** A command on PATH and its arguments, written as a terminal takes them. */
  command?: string;
  secrets: string[];
  /** The step's place in the text the draft was read from, so its comments stay. */
  origin?: number;
};
export type AgentDraft = {
  kind: 'agent';
  vaults?: 'all' | string[];
  access: AgentAccess;
  cli?: AgentId;
  model?: string;
  prompt: string;
  origin?: number;
};
export type StepDraft = RunDraft | AgentDraft;
/** A routine as the editor's form holds it; it may still be unfinished. */
export interface RoutineDraft {
  name: string;
  steps: StepDraft[];
}

export const agentDraft = (): AgentDraft => ({ kind: 'agent', access: 'default', prompt: '' });
export const runDraft = (): RunDraft => ({ kind: 'run', command: '', secrets: [] });
export const routineSteps = 20;

/** A command line as argv: spaces separate, quotes and `\` keep them. */
export function splitCommand(text: string) {
  const argv: string[] = [];
  let current = '';
  let started = false;
  let quote: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === "'") {
      if (c === "'") quote = undefined;
      else current += c;
    } else if (quote === '"') {
      if (c === '"') quote = undefined;
      else if (c === '\\' && (text[i + 1] === '"' || text[i + 1] === '\\')) current += text[++i];
      else current += c;
    } else if (/\s/.test(c)) {
      if (started) argv.push(current);
      current = '';
      started = false;
    } else {
      started = true;
      if (c === "'" || c === '"') quote = c;
      else if (c === '\\' && i + 1 < text.length) current += text[++i];
      else current += c;
    }
  }
  if (started) argv.push(current);
  return argv;
}

/** argv as a command line that `splitCommand` reads back. */
export function joinCommand(argv: string[]) {
  return argv
    .map((arg) => (arg && !/[\s'"\\]/.test(arg) ? arg : `"${arg.replace(/["\\]/g, '\\$&')}"`))
    .join(' ');
}

const runKeys = new Set(['run', 'secrets']);
const agentKeys = new Set(['agent', 'vaults', 'access', 'cli', 'model', 'prompt']);
const words = (value: unknown) =>
  Array.isArray(value) && value.every((item) => ['string', 'number'].includes(typeof item))
    ? value.map(String)
    : undefined;

/** The steps of a parsed `routine.yaml` as the form shows them, or undefined when one does not fit. */
function stepDrafts(steps: unknown[]): StepDraft[] | undefined {
  const drafts: StepDraft[] = [];
  for (const [origin, raw] of steps.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const fields = raw as Record<string, unknown>;
    const keys = Object.keys(fields);
    if (Object.hasOwn(fields, 'run') === Object.hasOwn(fields, 'agent')) return;
    if (Object.hasOwn(fields, 'run')) {
      if (keys.some((key) => !runKeys.has(key))) return;
      const secrets = fields.secrets === undefined ? [] : words(fields.secrets);
      const argv = words(fields.run);
      if (!secrets || (typeof fields.run !== 'string' && !argv)) return;
      drafts.push({
        kind: 'run',
        ...(typeof fields.run === 'string'
          ? { file: fields.run }
          : { command: joinCommand(argv!) }),
        secrets,
        origin,
      });
      continue;
    }
    if (keys.some((key) => !agentKeys.has(key))) return;
    const { vaults, access, cli, model, prompt } = fields;
    const named = vaults === undefined || vaults === 'all' ? vaults : words(vaults);
    if (
      named === null ||
      (vaults !== undefined && named === undefined) ||
      (access !== undefined && !agentAccessModes.includes(access as AgentAccess)) ||
      (cli !== undefined && !agentIds.includes(cli as AgentId)) ||
      (model !== undefined && typeof model !== 'string') ||
      (prompt !== undefined && prompt !== null && typeof prompt !== 'string')
    )
      return;
    drafts.push({
      kind: 'agent',
      vaults: named as AgentDraft['vaults'],
      access: (access as AgentAccess | undefined) ?? 'default',
      cli: cli as AgentId | undefined,
      model: (model as string | undefined) || undefined,
      prompt: (prompt as string | null | undefined) ?? '',
      origin,
    });
  }
  return drafts;
}

/**
 * `routine.yaml` as the editor's form, accepting what is unfinished (an empty
 * prompt, a missing access). Text the form cannot show, such as an unknown key,
 * gives the reason instead, and the person edits the text itself.
 */
export function draftFromYaml(text: string): { draft: RoutineDraft } | { problem: string } {
  const unfit = () => ({
    problem:
      ('problem' in (strict = parseRoutine(text, 'vault')) && strict.problem) ||
      t('フォームでは開けません。', 'The form cannot show it.'),
  });
  let strict: ReturnType<typeof parseRoutine>;
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) return unfit();
  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 50 }) ?? {};
  } catch {
    return unfit();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unfit();
  const top = value as Record<string, unknown>;
  if (Object.keys(top).some((key) => key !== 'name' && key !== 'steps')) return unfit();
  const name =
    typeof top.name === 'string' || typeof top.name === 'number' ? String(top.name) : undefined;
  if (top.name !== undefined && top.name !== null && name === undefined) return unfit();
  if (top.steps !== undefined && top.steps !== null && !Array.isArray(top.steps)) return unfit();
  const steps = stepDrafts((top.steps as unknown[] | undefined) ?? []);
  if (!steps) return unfit();
  return { draft: { name: name ?? '', steps } };
}

/** Sets a key unless it already holds the value, so its comments and style stay. */
function put(document: Document, map: YAMLMap, key: string, value: unknown, flow = false) {
  if (value === undefined) {
    map.delete(key);
    return;
  }
  const old = map.get(key, true) as { toJSON?: () => unknown } | undefined;
  const before = old && typeof old.toJSON === 'function' ? old.toJSON() : old;
  if (JSON.stringify(before) === JSON.stringify(value)) return;
  const node = document.createNode(value);
  if (flow && isSeq(node)) node.flow = true;
  if (isScalar(node) && typeof value === 'string' && value.includes('\n'))
    node.type = 'BLOCK_LITERAL';
  map.set(key, node);
}

/**
 * The form as `routine.yaml`. With the text it was read from, steps the person
 * kept are changed in place, so comments and the order of keys stay.
 */
export function yamlFromDraft(draft: RoutineDraft, owner: Routine['owner'], previous?: string) {
  const read = previous === undefined ? undefined : parseDocument(previous, { uniqueKeys: true });
  const document: Document =
    read && !read.errors.length && isMap(read.contents) ? read : new Document({});
  const top = document.contents as YAMLMap;
  put(document, top, 'name', draft.name);
  const old = top.get('steps', true);
  const kept = isSeq(old) ? old.items : [];
  const items = draft.steps.map((step) => {
    const reused = step.origin === undefined ? undefined : kept[step.origin];
    const map =
      isMap(reused) && reused.has(step.kind) ? reused : (document.createNode({}) as YAMLMap);
    if (step.kind === 'run') {
      put(
        document,
        map,
        'run',
        step.file !== undefined ? step.file : splitCommand(step.command ?? ''),
        true,
      );
      put(document, map, 'secrets', step.secrets.length ? step.secrets : undefined, true);
      return map;
    }
    put(document, map, 'agent', owner);
    put(document, map, 'vaults', owner === 'irori' ? step.vaults : undefined, true);
    put(document, map, 'access', step.access);
    put(document, map, 'cli', step.cli);
    put(document, map, 'model', step.model || undefined);
    put(document, map, 'prompt', step.prompt);
    return map;
  });
  if (isSeq(old)) old.items = items;
  else {
    const steps = document.createNode([]) as YAMLSeq;
    steps.items = items;
    top.set('steps', steps);
  }
  return document.toString({ lineWidth: 0, flowCollectionPadding: false });
}
