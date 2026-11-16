import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { sshDestination, type SshConfigHost } from '../domain/remote-hosts';

/*
 * The hosts the person's own ssh configuration names (ADR 061, amended): the
 * `Host` entries of `~/.ssh/config`, of the files it includes, and of the
 * system's file, as `ssh` itself would find them. irori reads these only to
 * offer their names; connecting gives `ssh` the name and lets it apply the
 * configuration, so nothing here decides how a connection is made. Nothing is
 * ever written to these files.
 *
 * What is read follows `ssh` (checked against OpenSSH 9.6 with `ssh -G`): the
 * first value obtained for a host is used, a `Host` line applies to the names
 * its patterns match, and an `Include` inside a block is read for that block's
 * hosts alone.
 */

/** The most files read, files gone through in one pass, bytes of one file and hosts listed. */
const limits = { files: 64, visits: 512, bytes: 1024 * 1024, hosts: 20_000 };

/** One line's words: split at spaces, with quotes kept together and a trailing comment dropped. */
function words(line: string) {
  const found: string[] = [];
  let word = '';
  let quote = '';
  let open = false;
  for (const char of line) {
    if (quote) {
      if (char === quote) quote = '';
      else word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      open = true;
    } else if (/\s/.test(char)) {
      if (word || open) found.push(word);
      word = '';
      open = false;
    } else if (char === '#' && !word && !open) break;
    else word += char;
  }
  if (word || open) found.push(word);
  return found;
}

/** A line as its keyword, in lower case, and its arguments: `keyword args` or `keyword=args`. */
function declaration(line: string): [string, string[]] | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return undefined;
  const match = /^([A-Za-z][A-Za-z0-9]*)(?:\s*=\s*|\s+)(.*)$/.exec(trimmed);
  return match ? [match[1].toLowerCase(), words(match[2])] : undefined;
}

/** One word of a `Host` line. `name` is set when it is a host's name and not a pattern. */
interface Pattern {
  negated: boolean;
  name?: string;
  test(name: string): boolean;
}

function pattern(word: string): Pattern {
  const negated = word.startsWith('!');
  const body = negated ? word.slice(1) : word;
  if (!/[*?]/.test(body))
    return { negated, name: negated ? undefined : body, test: (name) => name === body };
  const source = body
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const matches = new RegExp(`^${source}$`, 's');
  return { negated, test: (name) => matches.test(name) };
}

/** Whether a `Host` line applies to a name: one of its patterns matches, and none of its negated ones. */
function applies(name: string, patterns: Pattern[]) {
  let found = false;
  for (const item of patterns) {
    if (!item.test(name)) continue;
    if (item.negated) return false;
    found = true;
  }
  return found;
}

type Line =
  | { kind: 'host'; patterns: Pattern[] }
  /** `all`: a `Match` that holds for every host. Any other one cannot be told from here. */
  | { kind: 'match'; all: boolean }
  | { kind: 'include'; files: string[] }
  | { kind: 'value'; key: 'hostName' | 'user'; value: string }
  | { kind: 'value'; key: 'port'; value: number };

/** Whether a name in a folder matches one part of an `Include` path with `*`, `?` or `[…]` in it. */
function matcher(part: string) {
  let source = '';
  for (let at = 0; at < part.length; at++) {
    const char = part[at];
    const close = char === '[' ? part.indexOf(']', at + 2) : -1;
    if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else if (close > 0) {
      const inner = part.slice(at + 1, close).replace(/\\/g, '\\\\');
      source += `[${inner.startsWith('!') ? `^${inner.slice(1)}` : inner}]`;
      at = close;
    } else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  try {
    return new RegExp(`^${source}$`);
  } catch {
    return undefined;
  }
}

/** The files an `Include` path names, in lexical order; a path that names none gives none. */
async function included(given: string, base: string, home: string): Promise<string[]> {
  const expanded = given === '~' || /^~[\\/]/.test(given) ? path.join(home, given.slice(1)) : given;
  const absolute = path.isAbsolute(expanded) ? expanded : path.join(base, expanded);
  const { root } = path.parse(absolute);
  let found = [root];
  for (const part of absolute
    .slice(root.length)
    .split(/[\\/]+/)
    .filter(Boolean)) {
    if (!/[*?[]/.test(part)) {
      found = found.map((folder) => path.join(folder, part));
      continue;
    }
    const matches = matcher(part);
    const next: string[] = [];
    for (const folder of found) {
      const names = await fs.readdir(folder).catch(() => [] as string[]);
      // As a shell does, a name that starts with a dot is found only when the part says so.
      for (const name of names.sort())
        if (matches?.test(name) && (part.startsWith('.') || !name.startsWith('.')))
          next.push(path.join(folder, name));
    }
    found = next.slice(0, limits.files);
  }
  return found;
}

/** One file's text, without a byte-order mark; nothing when it is missing, too large or not a file. */
async function text(file: string) {
  try {
    const info = await fs.stat(file);
    if (!info.isFile() || info.size > limits.bytes) return undefined;
    return (await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '');
  } catch {
    return undefined;
  }
}

export interface SshConfigPlaces {
  /** The person's home folder; their configuration is `.ssh/config` in it. */
  home?: string;
  /** The system's configuration file, read after the person's; none with `null`. */
  system?: string | null;
}

/** The system's ssh configuration on this kind of computer. */
export function systemSshConfig(platform = process.platform, env = process.env) {
  return platform === 'win32'
    ? path.join(env.ProgramData ?? env.PROGRAMDATA ?? 'C:\\ProgramData', 'ssh', 'ssh_config')
    : '/etc/ssh/ssh_config';
}

/**
 * The hosts the ssh configuration names, in the order `ssh` reads them. A `Host`
 * line gives one for each of its words that is a name and not a pattern: `*`,
 * `?` and a leading `!` mark patterns, which say how to connect and not where.
 * With each comes what `ssh` would obtain for it from the `Host` blocks (the
 * address, the user, the port), patterns such as `Host *` included, for showing
 * only. A name `ssh` could not be given as one plain argument is left out.
 *
 * Left to `ssh`: a `Match` block other than `Match all` depends on what cannot
 * be told here. The hosts it names are not listed, while those of a file it
 * includes are; and what it sets is shown for no host it might hold for, since
 * the value could be its own or a later block's.
 */
export async function readSshConfigHosts(places: SshConfigPlaces = {}): Promise<SshConfigHost[]> {
  const home = places.home ?? os.homedir();
  const files = new Map<string, Line[] | undefined>();

  /** Reads a file and all it includes, each once. A relative `Include` is in `base`, however deep. */
  async function load(file: string, base: string) {
    if (files.has(file) || files.size >= limits.files) return;
    files.set(file, undefined);
    const content = await text(file);
    if (content === undefined) return;
    const lines: Line[] = [];
    files.set(file, lines);
    for (const raw of content.split(/\r?\n/)) {
      const [keyword, args] = declaration(raw) ?? [];
      if (!keyword || !args?.length) continue;
      if (keyword === 'host') lines.push({ kind: 'host', patterns: args.map(pattern) });
      else if (keyword === 'match') {
        const said = args.map((word) => word.toLowerCase()).join(' ');
        lines.push({ kind: 'match', all: said === 'all' || said === 'final all' });
      } else if (keyword === 'include') {
        const found: string[] = [];
        for (const given of args) found.push(...(await included(given, base, home)));
        lines.push({ kind: 'include', files: found });
        for (const next of found) await load(next, base);
      } else if (keyword === 'port') {
        const port = /^\d{1,5}$/.test(args[0]) ? Number(args[0]) : 0;
        if (port >= 1 && port <= 65535) lines.push({ kind: 'value', key: 'port', value: port });
      } else if ((keyword === 'hostname' || keyword === 'user') && args[0])
        lines.push({
          kind: 'value',
          key: keyword === 'user' ? 'user' : 'hostName',
          value: args[0],
        });
    }
  }

  const hosts = new Map<string, SshConfigHost>();
  // A file that includes itself is not gone into again, and a pass ends after a set number of files.
  const trail = new Set<string>();
  let visits = 0;
  const entered = (file: string) => {
    if (!files.get(file) || trail.has(file) || visits >= limits.visits) return undefined;
    visits++;
    trail.add(file);
    return files.get(file);
  };

  /**
   * First pass: the names. `within` holds the `Host` lines whose blocks include
   * this file: `ssh` reads it for their hosts alone, so a name in it that they
   * do not match is never reached.
   */
  function names(file: string, within: Pattern[][]) {
    const lines = entered(file);
    if (!lines) return;
    let block: Pattern[] | undefined;
    for (const line of lines) {
      if (line.kind === 'match') block = undefined;
      else if (line.kind === 'include')
        for (const next of line.files) names(next, block ? [...within, block] : within);
      else if (line.kind === 'host') {
        block = line.patterns;
        for (const { name } of line.patterns) {
          if (name === undefined || hosts.has(name) || hosts.size >= limits.hosts) continue;
          if (!sshDestination.safeParse(name).success) continue;
          if (applies(name, block) && within.every((outer) => applies(name, outer)))
            hosts.set(name, { alias: name });
        }
      }
    }
    trail.delete(file);
  }

  /** The hosts among `among` that a `Host` line applies to. */
  function chosen(patterns: Pattern[], among: Set<SshConfigHost>) {
    const found = new Set<SshConfigHost>();
    if (patterns.every((item) => item.name !== undefined)) {
      // Names alone, the usual line: looked up, so that a long configuration stays quick.
      for (const item of patterns) {
        const host = hosts.get(item.name!);
        if (host && among.has(host)) found.add(host);
      }
    } else for (const host of among) if (applies(host.alias, patterns)) found.add(host);
    return found;
  }

  /**
   * Second pass: what each host is given, in the order `ssh` obtains it. `among`
   * are the hosts this file is read for, and `first` those its lines speak of
   * before its own first `Host` or `Match`. `sure` is false under a `Match` that
   * cannot be told from here: what is set there is held as unknown (an empty
   * value), so that no later block's value is shown in its place.
   */
  function values(
    file: string,
    among: Set<SshConfigHost>,
    first: Set<SshConfigHost>,
    sure: boolean,
  ) {
    const lines = entered(file);
    if (!lines) return;
    // `block`: the hosts the lines here speak of, and those a file included here is read for.
    let block = first;
    let known = sure;
    for (const line of lines) {
      if (line.kind === 'host') {
        block = chosen(line.patterns, among);
        known = sure;
      } else if (line.kind === 'match') {
        block = among;
        known = sure && line.all;
      } else if (line.kind === 'include')
        for (const next of line.files) values(next, block, block, known);
      else if (line.key === 'port') for (const host of block) host.port ??= known ? line.value : 0;
      else if (line.key === 'user') for (const host of block) host.user ??= known ? line.value : '';
      else
        for (const host of block)
          host.hostName ??= known
            ? line.value.replace(/%([%h])/g, (_, token: string) =>
                token === 'h' ? host.alias : '%',
              )
            : '';
    }
    trail.delete(file);
  }

  const person = path.join(home, '.ssh', 'config');
  const system = places.system === undefined ? systemSshConfig() : places.system;
  await load(person, path.dirname(person));
  if (system) await load(system, path.dirname(system));
  const top = system ? [person, system] : [person];
  for (const file of top) names(file, []);
  const all = new Set(hosts.values());
  visits = 0;
  for (const file of top) values(file, all, all, true);
  for (const host of all) {
    // What a `Match` may or may not have set is not shown.
    if (!host.hostName) delete host.hostName;
    if (!host.user) delete host.user;
    if (!host.port) delete host.port;
  }
  return [...all];
}
