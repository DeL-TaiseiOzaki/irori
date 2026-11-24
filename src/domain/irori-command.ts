import {
  brainColors,
  brainGlyphs,
  brainLook,
  categoryText,
  categoryValue,
  type BrainLook,
} from './brains';
import { commentBodyLimit, commentQuoteLimit } from './comments';
import type { Category } from './types';
import { githubCloneURL, isBranchName } from './git';
import { namedLayers, type NamedLayer } from './layers';

/**
 * What the irori agent asks of irori through the `irori` command on its run's
 * PATH: what the person does in irori's own dialogs to set vaults up
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
  /** The SSH hosts irori has, the folders in a folder of one, or a host added (ADR 074). */
  | {
      kind: 'hosts';
      host?: string;
      folder?: string;
      add?: { destination: string; name?: string; port?: number };
    }
  | {
      kind: 'clone';
      url: string;
      folder?: string;
      parent?: string;
      name?: string;
      category?: Category;
      layers?: NamedLayer[];
      /** The SSH host the vault goes on, by its name or destination (ADR 074). */
      host?: string;
    }
  | {
      kind: 'create';
      folder: string;
      parent?: string;
      name?: string;
      category?: Category;
      /** The layers a vault irori declares for the first time has (ADR 072). */
      layers?: NamedLayer[];
      host?: string;
    }
  | {
      kind: 'add';
      folder: string;
      name?: string;
      category?: Category;
      layers?: NamedLayer[];
      host?: string;
    }
  | {
      kind: 'connect';
      vault: string;
      folder: string;
      name?: string;
      readOnly: boolean;
      /** `folder` is a GitHub repository's URL (ADR 046). */
      repository?: { into?: string; existing?: string; branch?: string };
    }
  | { kind: 'disconnect'; vault: string; name: string }
  | {
      kind: 'set';
      vault: string;
      name?: string;
      category?: Category;
      labels?: Partial<Record<NamedLayer, string>>;
      /** The Knowledge and Contents layers the vault has from now on (ADR 070). */
      layers?: NamedLayer[];
      /** The layer of the vault's own files beside its Knowledge folder (ADR 071). */
      own?: NamedLayer;
      look?: { color?: BrainLook['color']; icon?: BrainLook['icon'] };
      /** An image file to show as the vault's icon. */
      iconImage?: string;
    }
  | { kind: 'layer'; vault: string; layer: NamedLayer; folder: string; also: boolean }
  | { kind: 'work'; vault: string; folder?: string }
  | {
      kind: 'workspace';
      name: string;
      vaults: string[];
      leave: boolean;
      rename?: string;
      delete?: boolean;
      /** The group the named vaults go into, or `null` to take them out of theirs. */
      group?: string | null;
    }
  | { kind: 'remove'; vault: string; trash: boolean }
  | { kind: 'run'; routine: string; vault?: string }
  | { kind: 'stop'; routine: string; vault?: string }
  | { kind: 'copy'; source: string; destination: string }
  | {
      kind: 'connection';
      vault: string;
      name: string;
      rename?: string;
      access?: 'read-only' | 'read-write';
    }
  | { kind: 'strays'; vault: string; adopt?: string; folder?: string; remove?: string }
  | { kind: 'skills'; update: boolean }
  | { kind: 'install'; what: 'python' }
  | { kind: 'move'; note: string; destination: string }
  | { kind: 'trash'; note: string }
  | { kind: 'comment'; file: string; body: string; quote?: string; line?: number }
  | { kind: 'resolve'; file: string; id: string }
  | { kind: 'index'; vault?: string }
  | { kind: 'check'; vault?: string };

/** The longest argument list and argument the command takes. */
export const iroriArgumentLimit = { count: 20, length: 4096 };

const options: Record<Exclude<IroriCommand['kind'], 'help' | 'list' | 'routines'>, string[]> = {
  hosts: ['add', 'name', 'port'],
  clone: ['folder', 'parent', 'name', 'category', 'layers', 'host'],
  create: ['parent', 'name', 'category', 'layers', 'host'],
  add: ['name', 'category', 'layers', 'host'],
  connect: ['name', 'read-only', 'into', 'existing', 'branch', 'editable'],
  disconnect: [],
  set: [
    'name',
    'category',
    'knowledge-label',
    'contents-label',
    'layers',
    'own',
    'color',
    'icon',
    'icon-image',
  ],
  layer: ['also'],
  work: ['default'],
  workspace: ['leave', 'rename', 'delete', 'group', 'ungroup'],
  remove: ['trash'],
  run: ['vault'],
  stop: ['vault'],
  copy: [],
  connection: ['name', 'read-only', 'editable'],
  strays: ['adopt', 'folder', 'remove'],
  skills: ['update'],
  install: [],
  move: [],
  trash: [],
  comment: ['quote', 'line'],
  resolve: [],
  index: [],
  check: [],
};
const flags = new Set([
  'read-only',
  'also',
  'leave',
  'trash',
  'default',
  'editable',
  'delete',
  'ungroup',
  'update',
]);
/** The words each form takes, and how a wrong count is explained; a workspace takes one or more. */
const positional: Record<keyof typeof options, [count: number, words: string]> = {
  hosts: [2, 'at most an SSH host and a folder on it'],
  clone: [1, 'one repository'],
  create: [1, 'one folder'],
  add: [1, 'one folder'],
  connect: [2, 'a vault and a folder'],
  disconnect: [2, 'a vault and the name of a connected folder'],
  set: [1, 'one vault'],
  layer: [3, 'a vault, knowledge or contents, and a folder'],
  work: [2, 'a vault and a folder, or a vault and --default'],
  workspace: [1, 'a workspace name and then vaults'],
  remove: [1, 'one vault'],
  run: [1, 'one routine'],
  stop: [1, 'one routine'],
  copy: [2, 'a file or folder and the folder it is copied into'],
  connection: [2, 'a vault and the name of a connected folder'],
  strays: [1, 'one vault'],
  skills: [0, 'no words'],
  install: [1, 'what to install: python'],
  move: [2, 'a note, file or folder and where it goes'],
  trash: [1, 'one note'],
  comment: [2, 'a file and the comment'],
  resolve: [2, "a file and the comment's id"],
  index: [1, 'at most one vault'],
  check: [1, 'at most one vault'],
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
  if (!Object.hasOwn(options, head)) throw Error(`Unknown command "${head}". Run "irori help".`);
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
    if (Object.hasOwn(values, key)) throw Error(`--${key} is given twice.`);
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
  if (
    kind === 'workspace'
      ? !words.length
      : kind === 'index' || kind === 'check' || kind === 'hosts'
        ? words.length > (kind === 'hosts' && values.add ? 0 : count)
        : kind === 'work'
          ? words.length !== (values.default === true ? 1 : 2)
          : words.length !== count
  )
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
  // Schema is always there; naming it is how a vault of Schema alone is asked for.
  let layers: NamedLayer[] | undefined;
  if (text('layers') !== undefined) {
    const named: Record<string, NamedLayer | undefined> = {
      schema: undefined,
      knowledge: 'Knowledge_Base',
      contents: 'contents',
    };
    const chosen = text('layers')!
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((word) => word.toLowerCase());
    if (!chosen.length || chosen.some((word) => !Object.hasOwn(named, word)))
      throw Error(
        '--layers lists the layers the vault has, separated by commas: schema, knowledge, contents. Schema is always one of them.',
      );
    layers = namedLayers.filter((layer) => chosen.some((word) => named[word] === layer));
  }
  // A vault irori declares for the first time takes its layers with it (ADR 072).
  const starting = {
    ...common,
    ...(layers && { layers }),
    ...(text('host') && { host: text('host')!.trim() }),
  };
  switch (kind) {
    case 'hosts': {
      const port = text('port');
      if (!text('add')) {
        if (text('name') || port) throw Error('--name and --port go with --add.');
        return {
          kind,
          ...(words[0] && { host: words[0] }),
          ...(words[1] && { folder: words[1] }),
        };
      }
      if (port !== undefined && !/^[1-9]\d{0,4}$/.test(port)) throw Error('--port is a number.');
      return {
        kind,
        add: {
          destination: text('add')!.trim(),
          ...(common.name && { name: common.name }),
          ...(port && { port: Number(port) }),
        },
      };
    }
    case 'clone': {
      return {
        kind,
        url: githubRepositoryURL(words[0]),
        ...(text('folder') && { folder: text('folder') }),
        ...(text('parent') && { parent: text('parent') }),
        ...starting,
      };
    }
    case 'create':
      return {
        kind,
        folder: words[0],
        ...(text('parent') && { parent: text('parent') }),
        ...starting,
      };
    case 'add':
      return { kind, folder: words[0], ...starting };
    case 'connect': {
      const name = text('name') && { name: text('name')!.trim() };
      if (!githubCloneURL(words[1])) {
        const stray = ['into', 'existing', 'branch', 'editable'].find((key) => key in values);
        if (stray) throw Error(`--${stray} is for a GitHub repository's URL. Run "irori help".`);
        return {
          kind,
          vault: words[0],
          folder: words[1],
          ...name,
          readOnly: values['read-only'] === true,
        };
      }
      if (values['read-only'])
        throw Error('A repository connects read-only unless --editable is given.');
      if ('into' in values && 'existing' in values)
        throw Error('Give --into or --existing, not both.');
      if ('existing' in values && 'branch' in values)
        throw Error('--branch is for a clone irori makes with --into.');
      if (text('branch') && !isBranchName(text('branch')!))
        throw Error('--branch is not a branch name.');
      return {
        kind,
        vault: words[0],
        folder: words[1],
        ...name,
        readOnly: values.editable !== true,
        repository: {
          ...(text('into') && { into: text('into') }),
          ...(text('existing') && { existing: text('existing') }),
          ...(text('branch') && { branch: text('branch') }),
        },
      };
    }
    case 'disconnect':
      return { kind, vault: words[0], name: words[1] };
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
      let own: NamedLayer | undefined;
      if (text('own') !== undefined) {
        own = { knowledge: 'Knowledge_Base' as const, contents: 'contents' as const }[
          text('own')!.trim().toLowerCase()
        ];
        if (!own)
          throw Error(
            "--own is knowledge or contents: the layer of the vault's own files outside its Knowledge folder.",
          );
      }
      const look: NonNullable<Extract<IroriCommand, { kind: 'set' }>['look']> = {};
      const color = text('color')?.trim();
      if (color !== undefined) {
        if (!(brainColors as readonly string[]).includes(color))
          throw Error(`--color is one of ${brainColors.join(', ')}.`);
        look.color = color as BrainLook['color'];
      }
      const icon = text('icon')?.trim();
      if (icon !== undefined) {
        const mark = (brainGlyphs as readonly string[]).includes(icon)
          ? { kind: 'glyph', glyph: icon }
          : { kind: 'text', text: icon };
        const parsed = brainLook.safeParse({ icon: mark });
        if (!parsed.success)
          throw Error(
            `--icon is one of ${brainGlyphs.join(', ')}, or one or two characters such as an emoji.`,
          );
        look.icon = parsed.data.icon;
      }
      const iconImage = text('icon-image');
      if (iconImage && look.icon) throw Error('Give --icon or --icon-image, not both.');
      if (
        !common.name &&
        !common.category &&
        !Object.keys(labels).length &&
        !layers &&
        !own &&
        !Object.keys(look).length &&
        !iconImage
      )
        throw Error(
          '"irori set" needs --name, --category, --knowledge-label, --contents-label, --layers, --own, --color, --icon or --icon-image.',
        );
      return {
        kind,
        vault: words[0],
        ...common,
        ...(Object.keys(labels).length ? { labels } : {}),
        ...(layers && { layers }),
        ...(own && { own }),
        ...(Object.keys(look).length ? { look } : {}),
        ...(iconImage && { iconImage }),
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
      return { kind, vault: words[0], layer, folder: words[2], also };
    }
    case 'work':
      return { kind, vault: words[0], ...(words[1] !== undefined && { folder: words[1] }) };
    case 'workspace': {
      const chosen = ['leave', 'rename', 'delete', 'group', 'ungroup'].filter(
        (key) => key in values,
      );
      if (chosen.length > 1) throw Error(`Give one of --${chosen.join(', --')}, not several.`);
      const vaults = words.slice(1);
      if ((values.rename || values.delete) && vaults.length)
        throw Error(`--${values.rename ? 'rename' : 'delete'} names no vaults.`);
      if ((values.group || values.ungroup) && !vaults.length)
        throw Error(`--${values.group ? 'group' : 'ungroup'} needs the vaults it moves.`);
      const rename = text('rename')?.trim();
      const group = text('group')?.trim();
      if (group !== undefined && (group.length > 60 || /[\r\n]/.test(group)))
        throw Error('--group is one line of at most 60 characters.');
      return {
        kind,
        name: words[0].trim(),
        vaults,
        leave: values.leave === true,
        ...(rename && { rename }),
        ...(values.delete === true && { delete: true }),
        ...(group ? { group } : values.ungroup === true ? { group: null } : {}),
      };
    }
    case 'remove':
      return { kind, vault: words[0], trash: values.trash === true };
    case 'run':
    case 'stop':
      return { kind, routine: words[0], ...(text('vault') && { vault: text('vault') }) };
    case 'copy':
      return { kind, source: words[0], destination: words[1] };
    case 'connection': {
      if (values['read-only'] && values.editable)
        throw Error('Give --read-only or --editable, not both.');
      const access = values['read-only']
        ? ('read-only' as const)
        : values.editable
          ? ('read-write' as const)
          : undefined;
      if (!common.name && !access)
        throw Error('"irori connection" needs --name, --read-only or --editable.');
      return {
        kind,
        vault: words[0],
        name: words[1],
        ...(common.name && { rename: common.name }),
        ...(access && { access }),
      };
    }
    case 'strays': {
      if (text('adopt') && text('remove')) throw Error('Give --adopt or --remove, not both.');
      if (text('folder') && !text('adopt')) throw Error('--folder goes with --adopt.');
      return {
        kind,
        vault: words[0],
        ...(text('adopt') && { adopt: text('adopt') }),
        ...(text('folder') && { folder: text('folder') }),
        ...(text('remove') && { remove: text('remove') }),
      };
    }
    case 'skills':
      return { kind, update: values.update === true };
    case 'install':
      if (words[0].trim().toLowerCase() !== 'python')
        throw Error('"irori install" installs python: uv, for the Python steps of routines.');
      return { kind, what: 'python' };
    case 'move':
      return { kind, note: words[0], destination: words[1] };
    case 'trash':
      return { kind, note: words[0] };
    case 'comment': {
      const body = words[1].trim();
      if (!body || body.length > commentBodyLimit)
        throw Error(`The comment is 1 to ${commentBodyLimit} characters.`);
      const quote = text('quote');
      if (quote !== undefined && quote.length > commentQuoteLimit)
        throw Error(`--quote is at most ${commentQuoteLimit} characters.`);
      const line = text('line');
      if (line !== undefined && !/^[1-9]\d{0,6}$/.test(line))
        throw Error('--line is a line number.');
      if (line !== undefined && quote === undefined) throw Error('--line goes with --quote.');
      return {
        kind,
        file: words[0],
        body,
        ...(quote !== undefined && { quote }),
        ...(line !== undefined && { line: Number(line) }),
      };
    }
    case 'resolve':
      return { kind, file: words[0], id: words[1].trim() };
    case 'index':
    case 'check':
      return { kind, ...(words[0] && { vault: words[0] }) };
  }
}
