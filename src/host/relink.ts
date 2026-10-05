import { promises as fs } from 'node:fs';
import path from 'node:path';
import { samePath, type LinkUpdate } from '../domain/note-links';
import { noteReferenceCount, rewriteNoteReferences } from './note-references';
import { imagesForNoteMove } from '../domain/note-operations';
import type { Document } from '../domain/types';
import type { FileService } from './files';
import type { SearchService } from './search';
import { foldsCase } from './links';
import { layerRoots, renamedPath } from '../domain/layers';
import { owner } from '../domain/scopes';

/** The other notes whose links lead to `target`, as the backlink scan finds them. */
async function linking(search: SearchService, scopeId: string, target: string, foldCase?: boolean) {
  try {
    const found = await search.references(scopeId, target, foldCase);
    return { paths: [...new Set(found.hits.map((hit) => hit.path))], incomplete: found.incomplete };
  } catch {
    return { paths: [], incomplete: true };
  }
}

/** How many links, in how many other notes, a move of `target` would rewrite. */
export async function referringLinks(
  files: FileService,
  search: SearchService,
  scopeId: string,
  target: string,
): Promise<Pick<LinkUpdate, 'notes' | 'links' | 'incomplete'>> {
  const foldCase = await foldsCase(files, scopeId, target);
  const found = await linking(search, scopeId, target, foldCase);
  const result = { notes: 0, links: 0, incomplete: found.incomplete };
  for (const note of found.paths) {
    let links = 0;
    try {
      links = noteReferenceCount(
        (await files.read(scopeId, note)).text,
        note,
        target,
        foldCase,
        layerRoots(files.get(scopeId)),
      );
    } catch {
      result.incomplete = true;
    }
    if (links) {
      result.notes++;
      result.links += links;
    }
  }
  return result;
}

/**
 * After a move: rewrites the moved note's own links so they keep their targets
 * from its new path, then the links of the other notes that led to `previous`.
 * Each write is the ordinary hash-checked save, so a note changed meanwhile —
 * or holding unsaved text — is skipped rather than overwritten.
 */
export async function relink(
  files: FileService,
  search: SearchService,
  doc: Document,
  previous: string,
  onSaved?: (before: Document, after: Document) => Promise<void>,
): Promise<{ doc: Document; links: LinkUpdate }> {
  const from = path.posix.dirname(previous);
  const to = path.posix.dirname(doc.path);
  const wanted = previous.normalize('NFC');
  // The previous name is gone: observe the volume through the moved file instead.
  const foldCase = await foldsCase(files, doc.scopeId, doc.path);
  const key = (p: string) => (foldCase ? p.normalize('NFC').toLowerCase() : p.normalize('NFC'));
  // Managed images were copied beside the note, so their links keep their text.
  const beside = new Map(
    (from === to ? [] : imagesForNoteMove(doc.text, true)).map((image) => [
      key(path.posix.join(from, image)),
      path.posix.join(to, image),
    ]),
  );
  const result: LinkUpdate = { self: 0, notes: 0, links: 0, skipped: [], incomplete: false };
  const write = async (note: Document, at: string, moved: (path: string) => string | undefined) => {
    if (note.draft && note.draft.text !== note.text) throw Error('Unsaved text');
    const rewritten = rewriteNoteReferences(
      note.text,
      at,
      note.path,
      moved,
      layerRoots(files.get(note.scopeId)),
    );
    if (!rewritten.links) return { doc: note, links: 0 };
    const saved = await files.save({ ...note, text: rewritten.text });
    await onSaved?.(note, saved);
    return { doc: saved, links: rewritten.links };
  };
  try {
    const own = await write(doc, previous, (p) =>
      samePath(p, wanted, foldCase) ? doc.path : (beside.get(key(p)) ?? p),
    );
    doc = own.doc;
    result.self = own.links;
  } catch {
    result.skipped.push(doc.path);
  }
  const found = await linking(search, doc.scopeId, previous, foldCase);
  result.incomplete = found.incomplete;
  for (const note of found.paths) {
    if (note === doc.path) continue;
    try {
      const { links } = await write(await files.read(doc.scopeId, note), note, (p) =>
        samePath(p, wanted, foldCase) ? doc.path : undefined,
      );
      if (links) {
        result.notes++;
        result.links += links;
      }
    } catch {
      result.skipped.push(note);
    }
  }
  return { doc, links: result };
}

/**
 * After a layer folder rename (ADR 024): rewrites every link in the hibachi's
 * Markdown files that led into `from` so it leads to the same file under `to`,
 * including the links of the moved files themselves. Contents is not walked: its
 * files are the originals of other places. Each write is the ordinary
 * hash-checked save, so a file changed meanwhile or holding unsaved text is
 * skipped rather than overwritten.
 */
export async function relinkFolder(
  files: FileService,
  scopeId: string,
  from: string,
  to: string,
  onSaved?: (before: Document, after: Document) => Promise<void>,
) {
  const space = files.get(scopeId);
  const roots = [...layerRoots(space), from];
  const pages: string[] = [];
  const visit = async (directory: string, prefix: string) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const p = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (
          ['.git', 'node_modules'].includes(entry.name) ||
          space.contents.some((root) => p === root) ||
          owner(files.list(), path.join(space.root, p))?.scopeId !== scopeId
        )
          continue;
        await visit(path.join(directory, entry.name), p);
      } else if (entry.isFile() && /\.md$/i.test(entry.name)) pages.push(p);
    }
  };
  await visit(space.root, '');
  const result = { notes: 0, links: 0, skipped: [] as string[] };
  for (const page of pages) {
    try {
      const note = await files.read(scopeId, page);
      if (note.draft && note.draft.text !== note.text) throw Error('Unsaved text');
      const at = renamedPath(page, to, from) ?? page;
      const rewritten = rewriteNoteReferences(
        note.text,
        at,
        page,
        (p) => renamedPath(p, from, to),
        roots,
      );
      if (!rewritten.links) continue;
      const saved = await files.save({ ...note, text: rewritten.text });
      await onSaved?.(note, saved);
      result.notes++;
      result.links += rewritten.links;
    } catch {
      result.skipped.push(page);
    }
  }
  return result;
}
