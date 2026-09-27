import { skillFile, skillName, skillsRoot } from './skills';

/**
 * The Schema section as settings: the instructions agents always read, the skill
 * packages, Claude Code's rules and its hooks. They stay ordinary files in the KB;
 * this module says which paths they are and reads and writes their shapes, so the
 * person fills in a form instead of editing front matter or JSON by hand.
 */
export const instructionsFile = 'AGENTS.md';
export const rulesRoot = '.claude/rules';
export const claudeSettingsFile = '.claude/settings.json';
/** Claude Code's hook events, in the order its documentation lists them. */
export const hookEvents = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'Stop',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  'Notification',
  'PreCompact',
] as const;

/** What the host lists for the Schema section beside the skills it already reads. */
export interface SchemaSettings {
  /** `AGENTS.md` when the brain has one, then each folder's `AGENTS.md` in its knowledge. */
  instructions: string[];
  /** Knowledge folders that could take their own `AGENTS.md`. */
  folders: string[];
  /** `.claude/rules/*.md`. */
  rules: string[];
  /** `.claude/settings.json` exists; its `hooks` are the hooks. */
  claudeSettings: boolean;
  /** The other files of each skill package, relative to its folder. */
  attachments: Record<string, string[]>;
  /** A limit or an unreadable folder cut the knowledge walk short. */
  incomplete?: boolean;
}

export type SettingKind = 'instructions' | 'rule' | 'settings' | 'skill';

// A file or folder name the form may create: no control or reserved characters,
// not hidden, not ending in a dot or a space (which Windows drops).
const plainName = /^[^\u0000-\u001f\\/:*?"<>|.][^\u0000-\u001f\\/:*?"<>|]{0,119}$/;
const plain = (part: string) => plainName.test(part) && !/[. ]$/.test(part);

/** A rule's file name: a plain name ending in `.md`. */
export function ruleFileName(name: string) {
  return plain(name) && /\.md$/i.test(name) && name.length > 3;
}

/** A skill package's own file or folder name (not the package directory). */
export function attachmentPath(relative: string) {
  const parts = relative.split('/');
  return (
    parts.length <= 4 &&
    parts.every(plain) &&
    !(parts.length === 1 && [skillFile, 'RETIRED.md'].includes(parts[0]))
  );
}

/**
 * Which setting a KB-relative path is, or undefined when the Schema settings may
 * not write it. The host checks the layer and aliases again on disk.
 */
export function settingKind(relative: string): SettingKind | undefined {
  const parts = relative.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\')))
    return undefined;
  if (relative === instructionsFile) return 'instructions';
  if (relative === claudeSettingsFile) return 'settings';
  if (relative.startsWith(`${rulesRoot}/`) && parts.length === 3 && ruleFileName(parts[2]))
    return 'rule';
  if (relative.startsWith(`${skillsRoot}/`) && parts.length >= 4) {
    if (!skillName.safeParse(parts[2]).success) return undefined;
    const inside = parts.slice(3).join('/');
    return inside === skillFile || attachmentPath(inside) ? 'skill' : undefined;
  }
  if (parts.at(-1) === instructionsFile && parts.slice(0, -1).every(plain)) return 'instructions';
  return undefined;
}

// --- SKILL.md ---------------------------------------------------------------

const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;
const topKey = /^([A-Za-z0-9_-]+)[ \t]*:/;

/** Top-level keys of front matter, each with the lines that belong to it. */
function blocks(front: string) {
  const out: { key?: string; lines: string[] }[] = [];
  for (const line of front.split(/\r?\n/)) {
    const key = topKey.exec(line)?.[1];
    // A comment at the margin belongs to no key, so replacing a key keeps it.
    if (key || !out.length || line.startsWith('#')) out.push({ key, lines: [line] });
    else out.at(-1)!.lines.push(line);
  }
  return out;
}

/** A YAML scalar as written in front matter, read well enough to prefill a form. */
function scalar(lines: string[]) {
  const first = lines[0].replace(topKey, '').trim();
  const rest = lines
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean);
  if (/^[>|]/.test(first)) return rest.join(first.startsWith('>') ? ' ' : '\n');
  if (first.startsWith('"'))
    try {
      return JSON.parse([first, ...rest].join(' ')) as string;
    } catch {
      return first.slice(1, -1);
    }
  if (first.startsWith("'")) return [first, ...rest].join(' ').slice(1, -1).replaceAll("''", "'");
  return [first, ...rest].join(' ');
}

/** YAML for one line of text: plain when that reads back the same, double-quoted otherwise. */
export function yamlString(value: string) {
  return /^\p{L}[^:#\n"'\\]*$/u.test(value) &&
    value === value.trim() &&
    !/^(true|false|yes|no|on|off|null|y|n)$/i.test(value)
    ? value
    : JSON.stringify(value);
}

export type SkillForm = { name: string; description: string; body: string };

/** The form's fields from a SKILL.md, without interpreting its other metadata. */
export function readSkillText(text: string): SkillForm & { frontMatter: boolean } {
  const match = frontMatter.exec(text.replace(/^\uFEFF/, ''));
  if (!match) return { name: '', description: '', body: text.trim(), frontMatter: false };
  const found = Object.fromEntries(
    blocks(match[1])
      .filter((block) => block.key)
      .map((block) => [block.key!, scalar(block.lines)]),
  );
  return {
    name: found.name ?? '',
    description: found.description ?? '',
    body: (match[2] ?? '').trim(),
    frontMatter: true,
  };
}

/**
 * A SKILL.md with the form's name, description and instructions. Every other
 * front matter line — roles, projects, comments, a licence — stays as written.
 */
export function writeSkillText(previous: string | undefined, form: SkillForm) {
  const match = previous ? frontMatter.exec(previous.replace(/^\uFEFF/, '')) : null;
  const kept = match ? blocks(match[1]) : [];
  const set = {
    name: `name: ${yamlString(form.name)}`,
    description: `description: ${yamlString(form.description)}`,
  };
  const lines: string[] = [];
  const placed = new Set<string>();
  for (const block of kept) {
    if (block.key === 'name' || block.key === 'description') {
      if (!placed.has(block.key)) lines.push(set[block.key]);
      placed.add(block.key);
    } else lines.push(...block.lines);
  }
  const missing = (['name', 'description'] as const).filter((key) => !placed.has(key));
  const front = [...missing.map((key) => set[key]), ...lines];
  while (front.length && !front.at(-1)!.trim()) front.pop();
  return `---\n${front.join('\n')}\n---\n\n${form.body.trim()}\n`;
}

// --- Claude Code hooks ------------------------------------------------------

/** One hook as the form edits it; `type` and any other key of the hook object are kept. */
export interface HookEntry {
  event: string;
  matcher?: string;
  command: string;
  type: string;
  /** The hook object's keys besides `type` and `command`, such as `timeout`. */
  extra: Record<string, unknown>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function settingsObject(text: string | undefined) {
  if (text === undefined || !text.trim()) return {};
  const value: unknown = JSON.parse(text);
  if (!isObject(value)) throw Error(`${claudeSettingsFile} is not a JSON object`);
  return value;
}

/** Every hook in `.claude/settings.json`, in file order. A malformed `hooks` is refused, not guessed. */
export function readHooks(settingsText: string | undefined): HookEntry[] {
  const hooks = settingsObject(settingsText).hooks;
  if (hooks === undefined) return [];
  const invalid = () => Error(`The hooks in ${claudeSettingsFile} are not in Claude Code's shape`);
  if (!isObject(hooks)) throw invalid();
  const out: HookEntry[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) throw invalid();
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks)) throw invalid();
      if (group.matcher !== undefined && typeof group.matcher !== 'string') throw invalid();
      for (const hook of group.hooks) {
        if (!isObject(hook) || typeof hook.type !== 'string') throw invalid();
        const { type, command, ...extra } = hook;
        if (command !== undefined && typeof command !== 'string') throw invalid();
        out.push({
          event,
          ...(group.matcher ? { matcher: group.matcher } : {}),
          type,
          command: command ?? '',
          extra,
        });
      }
    }
  }
  return out;
}

/**
 * `.claude/settings.json` with `hooks` replaced by these entries and every other
 * key kept in place; no hooks removes the key. Hooks of one event with the same
 * matcher, one after another, share a group as Claude Code writes them.
 */
export function writeHooks(settingsText: string | undefined, entries: HookEntry[]) {
  const settings = settingsObject(settingsText);
  const hooks: Record<string, { matcher?: string; hooks: Record<string, unknown>[] }[]> = {};
  for (const entry of entries) {
    const groups = (hooks[entry.event] ??= []);
    const hook = {
      type: entry.type,
      ...(entry.type === 'command' || entry.command ? { command: entry.command } : {}),
      ...entry.extra,
    };
    const last = groups.at(-1);
    if (last && last.matcher === (entry.matcher || undefined)) last.hooks.push(hook);
    else groups.push({ ...(entry.matcher ? { matcher: entry.matcher } : {}), hooks: [hook] });
  }
  if (entries.length) settings.hooks = hooks;
  else delete settings.hooks;
  return `${JSON.stringify(settings, null, 2)}\n`;
}
