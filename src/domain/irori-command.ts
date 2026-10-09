import { categoryText, categoryValue } from './brains';
import type { Category } from './types';
import type { NamedLayer } from './layers';

/**
 * What the irori agent asks of irori through the `irori` command on its run's
 * PATH: what the person does in irori's own dialogs to set hibachis up
 * (ADR 025, ADR 030). Registering, cloning, creating and connecting add;
 * `set`, `layer`, `workspace`, `disconnect` and `remove` change or take back
 * what irori holds, and only `remove --trash` moves a folder, to the system
 * trash. `list` and `routines` only read; `run` starts a routine the
 * person has reviewed, when they ask for it.
 */
export type IroriCommand =
  | { kind: 'help' }
  | { kind: 'list' }
  | { kind: 'routines' }
  | {
      kind: 'clone';
      url: string;
      folder?: string;
      parent?: string;
      name?: string;
      category?: Category;
    }
  | { kind: 'create'; folder: string; parent?: string; name?: string; category?: Category }
  | { kind: 'add'; folder: string; name?: string; category?: Category }
  | { kind: 'connect'; hibachi: string; folder: string; name?: string; readOnly: boolean }
  | { kind: 'disconnect'; hibachi: string; name: string }
  | {
      kind: 'set';
      hibachi: string;
      name?: string;
      category?: Category;
      labels?: Partial<Record<NamedLayer, string>>;
    }
  | { kind: 'layer'; hibachi: string; layer: NamedLayer; folder: string; also: boolean }
  | { kind: 'workspace'; name: string; hibachis: string[]; leave: boolean }
  | { kind: 'remove'; hibachi: string; trash: boolean }
  | { kind: 'run'; routine: string; hibachi?: string };

/** The longest argument list and argument the command takes. */
export const iroriArgumentLimit = { count: 20, length: 4096 };

const options: Record<Exclude<IroriCommand['kind'], 'help' | 'list' | 'routines'>, string[]> = {
  clone: ['folder', 'parent', 'name', 'category'],
  create: ['parent', 'name', 'category'],
  add: ['name', 'category'],
  connect: ['name', 'read-only'],
  disconnect: [],
  set: ['name', 'category', 'knowledge-label', 'contents-label'],
  layer: ['also'],
  workspace: ['leave'],
  remove: ['trash'],
  run: ['hibachi'],
};
const flags = new Set(['read-only', 'also', 'leave', 'trash']);
/** The words each form takes, and how a wrong count is explained; a workspace takes one or more. */
const positional: Record<keyof typeof options, [count: number, words: string]> = {
  clone: [1, 'one repository'],
  create: [1, 'one folder'],
  add: [1, 'one folder'],
  connect: [2, 'a hibachi and a folder'],
  disconnect: [2, 'a hibachi and the name of a connected folder'],
  set: [1, 'one hibachi'],
  layer: [3, 'a hibachi, knowledge or contents, and a folder'],
  workspace: [1, 'a workspace name and then hibachis'],
  remove: [1, 'one hibachi'],
  run: [1, 'one routine'],
};

/**
 * A GitHub repository as the person may write it: `owner/name` becomes its
 * HTTPS URL, and anything else is passed on for the host to check.
 */
export function githubRepositoryURL(value: string) {
  const short = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?$/.exec(
    value,
  );
  return short ? `https://github.com/${short[1]}/${short[2]}.git` : value;
}

/** The command's arguments as one command; an error says what is wrong and how to ask. */
export function parseIroriCommand(argv: unknown): IroriCommand {
  if (
    !Array.isArray(argv) ||
    argv.length > iroriArgumentLimit.count ||
    argv.some((item) => typeof item !== 'string' || item.length > iroriArgumentLimit.length)
  )
    throw Error('The arguments could not be read. Run "irori help".');
  const [head, ...rest] = argv as string[];
  if (!head || ['help', '-h', '--help'].includes(head)) return { kind: 'help' };
  if (head === 'list' || head === 'routines') {
    if (rest.length) throw Error(`"irori ${head}" takes no arguments.`);
    return { kind: head };
  }
  if (!(head in options)) throw Error(`Unknown command "${head}". Run "irori help".`);
  const kind = head as keyof typeof options;
  const values: Record<string, string | true> = {};
  const words: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    const item = rest[index];
    if (!item.startsWith('--')) {
      words.push(item);
      continue;
    }
    const [key, inline] = item.slice(2).split(/=(.*)/s, 2);
    if (!options[kind].includes(key))
      throw Error(`"irori ${kind}" has no --${key}. Run "irori help".`);
    if (key in values) throw Error(`--${key} is given twice.`);
    if (flags.has(key)) {
      if (inline !== undefined) throw Error(`--${key} takes no value.`);
      values[key] = true;
      continue;
    }
    const value = inline ?? rest[++index];
    if (value === undefined || (inline === undefined && value.startsWith('--')) || !value.trim())
      throw Error(`--${key} needs a value.`);
    values[key] = value;
  }
  const [count, wanted] = positional[kind];
  if (kind === 'workspace' ? !words.length : words.length !== count)
    throw Error(`"irori ${kind}" takes ${wanted}. Run "irori help".`);
  const text = (key: string) => values[key] as string | undefined;
  // A preset's name in either language is the preset; any other name is the KB's own.
  const category = text('category') === undefined ? undefined : categoryValue(text('category')!);
  if (category !== undefined && !categoryText.safeParse(category).success)
    throw Error('--category is one line of at most 40 characters.');
  const common = {
    ...(text('name') && { name: text('name')!.trim() }),
    ...(category && { category }),
  };
  switch (kind) {
    case 'clone': {
      return {
        kind,
        url: githubRepositoryURL(words[0]),
        ...(text('folder') && { folder: text('folder') }),
        ...(text('parent') && { parent: text('parent') }),
        ...common,
      };
    }
    case 'create':
      return {
        kind,
        folder: words[0],
        ...(text('parent') && { parent: text('parent') }),
        ...common,
      };
    case 'add':
      return { kind, folder: words[0], ...common };
    case 'connect':
      return {
        kind,
        hibachi: words[0],
        folder: words[1],
        ...(text('name') && { name: text('name')!.trim() }),
        readOnly: values['read-only'] === true,
      };
    case 'disconnect':
      return { kind, hibachi: words[0], name: words[1] };
    case 'set': {
      const labels: Partial<Record<NamedLayer, string>> = {};
      for (const [key, layer] of [
        ['knowledge-label', 'Knowledge_Base'],
        ['contents-label', 'contents'],
      ] as const) {
        const label = text(key)?.trim();
        if (label === undefined) continue;
        if (label.length > 40 || /[\r\n]/.test(label))
          throw Error(`--${key} is one line of at most 40 characters.`);
        labels[layer] = label;
      }
      if (!common.name && !common.category && !Object.keys(labels).length)
        throw Error('"irori set" needs --name, --category, --knowledge-label or --contents-label.');
      return {
        kind,
        hibachi: words[0],
        ...common,
        ...(Object.keys(labels).length ? { labels } : {}),
      };
    }
    case 'layer': {
      const layers: Record<string, NamedLayer> = {
        knowledge: 'Knowledge_Base',
        contents: 'contents',
      };
      const layer = Object.hasOwn(layers, words[1]) ? layers[words[1]] : undefined;
      if (!layer) throw Error('"irori layer" names knowledge or contents. Run "irori help".');
      const also = values.also === true;
      if (also && layer !== 'contents') throw Error('--also is for contents only.');
      return { kind, hibachi: words[0], layer, folder: words[2], also };
    }
    case 'workspace':
      return {
        kind,
        name: words[0].trim(),
        hibachis: words.slice(1),
        leave: values.leave === true,
      };
    case 'remove':
      return { kind, hibachi: words[0], trash: values.trash === true };
    case 'run':
      return { kind, routine: words[0], ...(text('hibachi') && { hibachi: text('hibachi') }) };
  }
}
