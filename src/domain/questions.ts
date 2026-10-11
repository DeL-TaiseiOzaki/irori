import type { AgentAnswers, Question } from './types';
import { t } from './i18n';

/** The answers given to one question, as a list. */
export function answerValues(answers: AgentAnswers, id: string) {
  const value = answers[id];
  return (Array.isArray(value) ? value : value === undefined ? [] : [value]).filter(
    (item) => item.trim() !== '',
  );
}

/** Every question that needs an answer has one. */
export function questionsAnswered(questions: Question[], answers: AgentAnswers) {
  return questions.every((q) => q.optional || answerValues(answers, q.id).length > 0);
}

type Schema = Record<string, unknown>;
const record = (value: unknown): Schema =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Schema) : {};
const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

/** The choices of an enum field as `[value, label]`, in any of MCP's spellings. */
function choices(field: Schema): [string, string][] | undefined {
  if (Array.isArray(field.oneOf))
    return field.oneOf.map((option) => {
      const { const: value, title } = record(option);
      return [String(value), text(title) ?? String(value)];
    });
  if (Array.isArray(field.anyOf))
    return field.anyOf.map((option) => {
      const { const: value, title } = record(option);
      return [String(value), text(title) ?? String(value)];
    });
  if (Array.isArray(field.enum)) {
    const names = Array.isArray(field.enumNames) ? field.enumNames : [];
    return field.enum.map((value, i) => [String(value), text(names[i]) ?? String(value)]);
  }
  return undefined;
}
const yes = () => t('はい', 'Yes');
const no = () => t('いいえ', 'No');

/**
 * The questions of an MCP elicitation form (MCP 2025-11-25 `requestedSchema`):
 * a field with fixed values offers them, a boolean offers yes and no, and any
 * other field takes the person's words.
 */
export function elicitationQuestions(requested: unknown): Question[] {
  const schema = record(requested);
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  return Object.entries(record(schema.properties)).map(([id, value]) => {
    const field = record(value);
    const title = text(field.title) ?? id;
    const description = text(field.description);
    const common: Question = {
      id,
      title: description && description !== title ? `${title} — ${description}` : title,
      ...(!required.has(id) && { optional: true }),
    };
    if (field.type === 'boolean')
      return { ...common, options: [{ label: yes() }, { label: no() }] };
    if (field.type === 'array') {
      const options = choices(record(field.items));
      return {
        ...common,
        multiple: true,
        ...(options
          ? { options: options.map(([, label]) => ({ label })) }
          : { multiline: true, other: true }),
      };
    }
    const options = choices(field);
    if (options) return { ...common, options: options.map(([, label]) => ({ label })) };
    return { ...common, other: true };
  });
}

/** The content an accepted elicitation sends back, typed as its schema asks. */
export function elicitationContent(requested: unknown, answers: AgentAnswers) {
  const schema = record(requested);
  const content: Record<string, string | number | boolean | string[]> = {};
  for (const [id, value] of Object.entries(record(schema.properties))) {
    const field = record(value);
    const given = answerValues(answers, id);
    if (!given.length) continue;
    const valueOf = (label: string, from: Schema) =>
      choices(from)?.find(([, name]) => name === label)?.[0] ?? label;
    if (field.type === 'boolean') content[id] = given[0] === yes();
    else if (field.type === 'number' || field.type === 'integer') {
      const number = Number(given[0]);
      if (Number.isFinite(number)) content[id] = number;
    } else if (field.type === 'array')
      content[id] = given.map((label) => valueOf(label, record(field.items)));
    else content[id] = valueOf(given[0], field);
  }
  return content;
}
