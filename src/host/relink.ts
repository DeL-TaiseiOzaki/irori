import path from 'node:path';
import { linkCount, rewriteLinks, type LinkUpdate } from '../domain/note-links';
import { imagesForNoteMove } from '../domain/note-operations';
import type { Document } from '../domain/types';
import type { FileService } from './files';
import type { SearchService } from './search';

/** The other notes whose links lead to `target`, as the backlink scan finds them. */
async function linking(search: SearchService, scopeId: string, target: string) {
  try {
    const found = await search.backlinks(scopeId, target);
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
  const found = await linking(search, scopeId, target);
  const result = { notes: 0, links: 0, incomplete: found.incomplete };
  for (const note of found.paths) {
    let links = 0;
    try {
      links = linkCount((await files.read(scopeId, note)).text, note, target);
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
): Promise<{ doc: Document; links: LinkUpdate }> {
  const from = path.posix.dirname(previous);
  const to = path.posix.dirname(doc.path);
  const wanted = previous.normalize('NFC');
  // Managed images were copied beside the note, so their links keep their text.
  const beside = new Map(
    (from === to ? [] : imagesForNoteMove(doc.text, true)).map((image) => [
      path.posix.join(from, image).normalize('NFC'),
      path.posix.join(to, image),
    ]),
  );
  const result: LinkUpdate = { self: 0, notes: 0, links: 0, skipped: [], incomplete: false };
  const write = async (note: Document, at: string, moved: (path: string) => string | undefined) => {
    if (note.draft && note.draft.text !== note.text) throw Error('Unsaved text');
    const rewritten = rewriteLinks(note.text, at, note.path, moved);
    if (!rewritten.links) return { doc: note, links: 0 };
    return { doc: await files.save({ ...note, text: rewritten.text }), links: rewritten.links };
  };
  try {
    const own = await write(doc, previous, (p) => (p === wanted ? doc.path : (beside.get(p) ?? p)));
    doc = own.doc;
    result.self = own.links;
  } catch {
    result.skipped.push(doc.path);
  }
  const found = await linking(search, doc.scopeId, previous);
  result.incomplete = found.incomplete;
  for (const note of found.paths) {
    if (note === doc.path) continue;
    try {
      const { links } = await write(await files.read(doc.scopeId, note), note, (p) =>
        p === wanted ? doc.path : undefined,
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
