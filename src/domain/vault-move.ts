import { internalLinks } from './note-links';
import { managedImage } from './note-operations';

/**
 * A file or folder of one vault's knowledge moved into another vault's. Links
 * never cross vaults, so the ones between what moved and what stayed break;
 * the managed images a moved note shows are copied with it (ADR 038).
 */

/** Whether `rel` is the moved entry or inside it. */
export function movedWith(moved: string, rel: string) {
  const at = rel.normalize('NFC'),
    from = moved.normalize('NFC');
  return at === from || at.startsWith(`${from}/`);
}

/** A managed image beside the note at `note`, copied with it into the other vault. */
export function carriedImage(note: string, target: string) {
  const folder = note.includes('/') ? note.slice(0, note.lastIndexOf('/') + 1) : '';
  return target.startsWith(folder) && managedImage.test(target.slice(folder.length));
}

/**
 * How many links break when `moved` leaves its vault: links from the notes that
 * stay into what moves, and from the moved notes to what stays.
 */
export function brokenLinks(notes: { path: string; text: string }[], moved: string) {
  let broken = 0;
  for (const note of notes) {
    const leaving = movedWith(moved, note.path);
    for (const target of internalLinks(note.text, note.path))
      if (
        leaving
          ? !movedWith(moved, target) && !carriedImage(note.path, target)
          : movedWith(moved, target)
      )
        broken++;
  }
  return broken;
}
