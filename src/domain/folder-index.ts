import { compareCodePoints } from './graph-index';
import type { PropertyDeclaration } from './properties';

/**
 * The folder indexes of an Open Knowledge Format bundle (ADR 028), generated
 * from its pages as the graph index is: every folder with a page in it or below
 * it gets an `index.md` that lists its subfolders and its pages, one line each.
 * The rule is the one irori-templete states for its `lint`, so a person pressing
 * the button and an agent applying the rule write the same bytes.
 *
 * Paths here are the checkout's own spelling, so a decomposed name is written to
 * where it is; what goes into an index is NFC, so the bytes are the same on any
 * device and OS.
 */

/** The heading of the pages whose `type` is missing or not declared. */
export const otherPagesHeading = '# Other pages';
/** The heading of the subfolders. */
export const foldersHeading = '# Folders';

/** One page of a folder, as the walk read it. */
export interface IndexedPage {
  /** Its path in the hibachi, as on disk. */
  path: string;
  type?: string;
  title?: string;
  description?: string;
}

/** An `index.md` already in a folder: where it is, and its text when it could be read. */
export interface ExistingIndex {
  path: string;
  text?: string;
}

/** An index the pages give: where it goes and its bytes. */
export interface PlannedIndex {
  path: string;
  text: string;
}

/** A value as one line: NFC, any run of whitespace one space, no space at either end. */
export const oneLine = (value: string | undefined) =>
  (value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

/** Link text that a reader shows as written: `\`, `[` and `]` escaped. */
export const escapeLinkText = (text: string) => text.replace(/[\\[\]]/g, '\\$&');

/**
 * One path segment as a link destination irori's own reader resolves to it
 * (`resolveNoteLink`): NFC, with every character the reader or a Markdown
 * destination treats specially percent-encoded — whitespace, `%`, parentheses,
 * angle brackets, `#` (a fragment), `:` (a scheme), `\`, a backtick and
 * control characters. Other characters, Japanese included, stay as they are.
 */
export function linkDestination(segment: string) {
  return segment
    .normalize('NFC')
    .replace(/[\s%()<>#:\\`\u0000-\u001f\u007f]/gu, (character) =>
      [...new TextEncoder().encode(character)]
        .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
        .join(''),
    );
}

const fileName = (relative: string) => relative.slice(relative.lastIndexOf('/') + 1);
const parentOf = (relative: string) => relative.slice(0, Math.max(0, relative.lastIndexOf('/')));
const stem = (name: string) => name.replace(/\.md$/i, '');

// A list item that opens with a link: `* [text](destination) rest`. Each
// alternative starts on a different character, so a crafted line costs its
// length and no more.
const listedLink =
  /^[ \t]*[*+-][ \t]+\[(?:\\.|[^\\\]\n])*\]\([ \t]*(?:<([^<>\n]*)>|([^\s()<>]*))[ \t]*\)(.*)$/;

/**
 * The description each subfolder line of an index carries, by the folder's NFC
 * name: the text after the link of a list item whose destination is `name/` or
 * `name/index.md`, a leading `-`, `–`, `—` or `:` dropped. The person writes a
 * folder's description once; regenerating keeps it.
 */
export function folderDescriptions(text: string | undefined) {
  const out = new Map<string, string>();
  if (!text) return out;
  for (const line of text.split(/\r?\n/)) {
    const found = listedLink.exec(line);
    if (!found) continue;
    let target = (found[1] ?? found[2] ?? '').replace(/\\([!-/:-@[-`{-~])/g, '$1');
    try {
      target = decodeURIComponent(target);
    } catch {
      continue;
    }
    target = target.replace(/^(\.\/)+/, '');
    const folder = /^([^/]+)\/(?:index\.md)?$/i.exec(target)?.[1];
    if (!folder || folder === '.' || folder === '..') continue;
    const description = oneLine(found[3].replace(/^\s*[-–—:]/, ''));
    const name = folder.normalize('NFC');
    if (description && !out.has(name)) out.set(name, description);
  }
  return out;
}

/** The heading a declared type's pages are listed under. */
function typeHeading(type: string, heading: string | undefined) {
  const line = oneLine(heading);
  if (!line) return `# ${oneLine(type)}`;
  return line.startsWith('#') ? line : `# ${line}`;
}

const line = (title: string, destination: string, description: string) =>
  `* [${escapeLinkText(title)}](${destination})${description ? ` - ${description}` : ''}`;

/**
 * The text of one folder's index. The root's frontmatter is kept byte for byte;
 * no other index has any. Sections are `# Folders`, then each declared type in
 * the declaration's order, then `# Other pages`, each only when it lists
 * something, separated by one blank line. Nothing else is kept: an index is a
 * listing.
 */
export function renderFolderIndex(input: {
  frontmatter?: string;
  folders: { name: string; description?: string }[];
  pages: (Omit<IndexedPage, 'path'> & { file: string })[];
  declaration: Pick<PropertyDeclaration, 'types'>;
}) {
  const sections: string[] = [];
  const section = (heading: string, lines: string[]) => {
    if (lines.length) sections.push(`${heading}\n\n${lines.join('\n')}`);
  };
  const folders = input.folders
    .map((folder) => ({ ...folder, name: folder.name.normalize('NFC') }))
    .sort((a, b) => compareCodePoints(a.name, b.name));
  section(
    foldersHeading,
    folders.map((folder) =>
      line(folder.name, `${linkDestination(folder.name)}/`, oneLine(folder.description)),
    ),
  );
  const pages = input.pages
    .map((page) => ({ ...page, file: page.file.normalize('NFC') }))
    .sort((a, b) => compareCodePoints(a.file, b.file));
  const pageLine = (page: (typeof pages)[number]) =>
    line(
      oneLine(page.title) || stem(page.file),
      linkDestination(page.file),
      oneLine(page.description),
    );
  const types = input.declaration.types;
  const declared = (type: string | undefined): type is string =>
    !!type && Object.prototype.hasOwnProperty.call(types, type);
  for (const [type, entry] of Object.entries(types))
    section(
      typeHeading(type, entry.heading),
      pages.filter((page) => page.type === type).map(pageLine),
    );
  section(otherPagesHeading, pages.filter((page) => !declared(page.type)).map(pageLine));
  const body = sections.join('\n\n').normalize('NFC') + '\n';
  if (input.frontmatter === undefined) return body;
  const head = input.frontmatter.endsWith('\n') ? input.frontmatter : `${input.frontmatter}\n`;
  return `${head}\n${body}`;
}

/**
 * The indexes a bundle's pages give. `root` is the knowledge folder; `pages`
 * and `indexes` hold only what the walk may index (subfolders that are hidden,
 * aliases, submodules or another hibachi are already left out). A folder gets an
 * index when a page is in it or below it, and it lists a subfolder that gets
 * one or already has an `index.md`, so a folder a person described keeps its
 * line before its first page arrives. An `index.md` in a folder with no page in
 * or below it is not touched.
 */
export function planFolderIndexes(input: {
  root: string;
  pages: IndexedPage[];
  indexes: Map<string, ExistingIndex>;
  declaration: Pick<PropertyDeclaration, 'types'>;
  /** The root index's frontmatter block, `---` lines included. */
  frontmatter: string;
}): PlannedIndex[] {
  const { root } = input;
  const inside = (folder: string) => folder === root || folder.startsWith(`${root}/`);
  const withPages = new Set<string>();
  for (const page of input.pages)
    for (let folder = parentOf(page.path); inside(folder); folder = parentOf(folder)) {
      if (withPages.has(folder)) break;
      withPages.add(folder);
    }
  const children = new Map<string, Set<string>>();
  for (const folder of [...withPages, ...input.indexes.keys()]) {
    if (folder === root || !inside(folder)) continue;
    const parent = parentOf(folder);
    const set = children.get(parent) ?? new Set<string>();
    set.add(folder);
    children.set(parent, set);
  }
  const pagesIn = new Map<string, IndexedPage[]>();
  for (const page of input.pages) {
    const folder = parentOf(page.path);
    const list = pagesIn.get(folder);
    if (list) list.push(page);
    else pagesIn.set(folder, [page]);
  }
  const planned: PlannedIndex[] = [];
  for (const folder of withPages) {
    const existing = input.indexes.get(folder);
    const descriptions = folderDescriptions(existing?.text);
    const text = renderFolderIndex({
      frontmatter: folder === root ? input.frontmatter : undefined,
      folders: [...(children.get(folder) ?? [])].map((child) => {
        const name = fileName(child).normalize('NFC');
        return { name, description: descriptions.get(name) };
      }),
      pages: (pagesIn.get(folder) ?? []).map((page) => ({ ...page, file: fileName(page.path) })),
      declaration: input.declaration,
    });
    planned.push({ path: existing?.path ?? `${folder}/index.md`, text });
  }
  return planned.sort((a, b) => compareCodePoints(a.path, b.path));
}
