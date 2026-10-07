import { categoryText, categoryValue } from './brains';
import type { Category } from './types';

/**
 * What the irori agent asks of irori through the `irori` command on its run's
 * PATH. Each one only adds: a hibachi registered on this device and joined to
 * the workspace the request came from, or a folder connected to a hibachi's
 * contents. Nothing is removed or replaced. `list` and `routines` only read.
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
  | { kind: 'connect'; hibachi: string; folder: string; name?: string; readOnly: boolean };

/** The longest argument list and argument the command takes. */
export const iroriArgumentLimit = { count: 20, length: 4096 };

const options: Record<Exclude<IroriCommand['kind'], 'help' | 'list' | 'routines'>, string[]> = {
  clone: ['folder', 'parent', 'name', 'category'],
  create: ['parent', 'name', 'category'],
  add: ['name', 'category'],
  connect: ['name', 'read-only'],
};
const flags = new Set(['read-only']);
const positional = { clone: 1, create: 1, add: 1, connect: 2 } as const;

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
  if (words.length !== positional[kind])
    throw Error(
      positional[kind] === 2
        ? `"irori ${kind}" takes a hibachi and a folder. Run "irori help".`
        : `"irori ${kind}" takes one ${kind === 'clone' ? 'repository' : 'folder'}. Run "irori help".`,
    );
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
  }
}
