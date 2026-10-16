/**
 * Paths an agent writes in its replies, as Claude Code and Codex do: a Markdown
 * link to a file (`[main.ts](src/main.ts#L42)`, `[x](/abs/x.md:7)`) or a path
 * in inline code (`wiki/topic.md:12`). Pure string work: a written path becomes
 * a file of a vault in the workspace, or nothing. Whether it exists, and the
 * space's own guards, stay the host's to answer when it is opened.
 */

/** A path as written, with the line and column it points at. */
export interface WrittenPath {
  path: string;
  line?: number;
  column?: number;
}
/**
 * A folder a written path may land in: a vault's, the irori agent's, or the
 * real place of a connected folder or a work folder, which `prefix` names
 * inside its vault (`contents/<name>`).
 */
export interface PathRoot {
  scopeId: string;
  root: string;
  prefix?: string;
}
/** A path from an agent's reply, to be found on this device (ADR 044). */
export interface AgentPathQuery {
  /** As written, line and column taken off. */
  path: string;
  /** Whose agent wrote it: a vault's, or the irori agent's id. */
  from?: string;
  /** The workspace whose folders it may be in. */
  workspaceId?: string;
}
/** A file of a vault, as `/` separated path inside it, and where in it. */
export interface PathTarget {
  scopeId: string;
  path: string;
  line?: number;
  column?: number;
}

const urlScheme = /^[a-z][a-z0-9+.-]*:/i;
// `AGENTS.md:12` reads as a scheme `agents.md:`; a file's name with a line is not one.
const namedLine = /^[^/:]+\.[a-z][a-z0-9_-]{0,9}:\d+(?::\d+)?(?:-\d+(?::\d+)?)?(?:#.*)?$/i;
const drive = /^[a-z]:\//i;
// `:42`, `:42:7`, `:42-51` (Codex, compilers) or `#L42`, `#L42C7`, `#L42-L51` (GitHub, VS Code).
const lineSuffix = /:(\d+)(?::(\d+))?(?:-\d+(?::\d+)?)?$/;
const lineFragment = /^L(\d+)(?:C(\d+))?(?:-L?\d+(?:C\d+)?)?$/;
// Inline code is a path only when it reads as one: what a file of a vault is
// named. Without a folder, its extension must be one a knowledge base holds,
// so `example.com` or `irori.app` stay code.
const pathCharacters = /^[^\s*?<>|"'`$={}]+$/;
const extension = /\.[a-z][a-z0-9_-]{0,9}$/i;
const knownExtension =
  /\.(md|markdown|mdx|txt|csv|tsv|jsonl?|ya?ml|toml|ini|xml|html?|css|scss|[cm]?[jt]sx?|py|ipynb|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|sh|ps1|sql|log|pdf|docx?|pptx?|xlsx?|png|jpe?g|gif|svg|webp)$/i;

function number(value: string | undefined) {
  const n = value === undefined ? NaN : Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/**
 * The path a link's destination or a piece of inline code names, or undefined
 * when it is something else: a web address, a command, a bare word. `href` is
 * a link's destination, percent-encoded as Markdown leaves it; inline code is
 * read as written and must also look like a file's path.
 */
export function writtenPath(value: string, kind: 'href' | 'code'): WrittenPath | undefined {
  let raw = value.trim();
  if (!raw || raw.length > 4096 || raw.includes('\0')) return undefined;
  let fragment = '';
  if (/^file:/i.test(raw)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      return undefined;
    }
    if (url.host && url.host !== 'localhost') return undefined;
    raw = url.pathname.replace(/^\/(?=[a-z]:)/i, '');
    fragment = url.hash.slice(1);
    kind = 'href';
  } else {
    raw = raw.replace(/\\/g, '/');
    if (urlScheme.test(raw) && !drive.test(raw) && !namedLine.test(raw)) return undefined;
    const hash = raw.indexOf('#');
    if (hash !== -1) {
      fragment = raw.slice(hash + 1);
      raw = raw.slice(0, hash);
    }
  }
  let line: number | undefined;
  let column: number | undefined;
  const fromFragment = lineFragment.exec(fragment);
  if (fromFragment) {
    line = number(fromFragment[1]);
    column = number(fromFragment[2]);
  }
  const suffix = lineSuffix.exec(raw);
  if (suffix) {
    raw = raw.slice(0, suffix.index);
    line ??= number(suffix[1]);
    column ??= number(suffix[2]);
  }
  if (kind === 'href') {
    try {
      raw = decodeURIComponent(raw);
    } catch {
      return undefined;
    }
  }
  raw = raw.replace(/\\/g, '/');
  // `//host/share` and `~/x` name places no vault root is written as.
  if (!raw || raw.endsWith('/') || raw.startsWith('//') || raw.startsWith('~')) return undefined;
  if (kind === 'code') {
    if (!pathCharacters.test(raw) || raw.startsWith('-')) return undefined;
    if (!(raw.includes('/') ? extension : knownExtension).test(raw)) return undefined;
  }
  return { path: raw, ...(line && { line }), ...(column && { column }) };
}

export function isAbsolute(path: string) {
  return path.startsWith('/') || drive.test(path);
}

/** `.` and `..` worked out; undefined when `..` climbs above the start. */
function normalized(path: string) {
  const parts: string[] = [];
  const [head, ...rest] = path.split('/');
  for (const part of rest) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  return [head, ...parts].join('/');
}

/**
 * The vault file a written path names. An absolute path lands in the vault
 * whose folder holds it; a relative one is read from `base`, the folder of the
 * vault whose agent wrote it, as that agent's working directory is.
 */
export function locatePath(
  written: WrittenPath,
  roots: PathRoot[],
  base?: string,
): PathTarget | undefined {
  const start = isAbsolute(written.path)
    ? ''
    : roots.find((root) => root.scopeId === base)?.root.replace(/\\/g, '/');
  if (start === undefined) return undefined;
  const whole = normalized(start ? `${start.replace(/\/+$/, '')}/${written.path}` : written.path);
  if (!whole) return undefined;
  let found: PathTarget | undefined;
  let longest = -1;
  for (const { scopeId, root, prefix } of roots) {
    const folder = root.replace(/\\/g, '/').replace(/\/+$/, '');
    // A Windows path names the same file in either case.
    const fold = drive.test(folder) ? (s: string) => s.toLowerCase() : (s: string) => s;
    if (folder.length <= longest) continue;
    // macOS may give a folder's name decomposed (ド as ト and ゛) where a reply has
    // it composed; then both are read composed, which its file system takes as well.
    const [as, under] = fold(whole).startsWith(`${fold(folder)}/`)
      ? [whole, folder]
      : [whole.normalize('NFC'), folder.normalize('NFC')];
    if (!fold(as).startsWith(`${fold(under)}/`)) continue;
    longest = folder.length;
    const inside = as.slice(under.length + 1);
    found = { scopeId, path: prefix ? `${prefix}/${inside}` : inside };
  }
  if (!found) return undefined;
  return {
    ...found,
    ...(written.line && { line: written.line }),
    ...(written.column && { column: written.column }),
  };
}

/**
 * Where a written path may be, most likely first (ADR 044): an absolute path in
 * the folder that holds it; a relative one from its writer's folder, then from
 * every other folder of the workspace, then without the `a/` or `b/` a diff
 * puts before it. Whether a file is there is the host's to check.
 */
export function pathCandidates(path: string, roots: PathRoot[], from?: string): PathTarget[] {
  if (isAbsolute(path)) {
    const found = locatePath({ path }, roots);
    return found ? [found] : [];
  }
  // A connected folder's real place is reached through its vault, not as a start.
  const starts = roots.filter((root) => !root.prefix);
  const order = [
    ...starts.filter((root) => root.scopeId === from),
    ...starts.filter((root) => root.scopeId !== from),
  ];
  const written = [path, ...(/^[ab]\/./.test(path) ? [path.slice(2)] : [])];
  const seen = new Set<string>();
  const found: PathTarget[] = [];
  for (const each of written)
    for (const root of order) {
      const target = locatePath({ path: each }, starts, root.scopeId);
      const key = target && `${target.scopeId}\0${target.path}`;
      if (!target || seen.has(key!)) continue;
      seen.add(key!);
      found.push(target);
    }
  return found;
}

/**
 * Whether a file's path inside its folder ends with what was written, as a
 * bare name or the tail of a path (`topic.md`, `wiki/topic.md`), for a reply
 * that named a file without its whole path.
 */
export function endsWithWritten(path: string, written: string) {
  const tail = written.replace(/^(?:\.\/)+/, '');
  if (!tail || tail.split('/').some((part) => part === '..' || part === '.')) return false;
  return path === tail || path.endsWith(`/${tail}`);
}
