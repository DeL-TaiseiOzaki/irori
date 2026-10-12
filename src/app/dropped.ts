/**
 * Files and folders the person brings into a vault: dropped from the file
 * manager, or chosen in the system's file dialog.
 */
export type Brought = { name: string; file: File } | { name: string; entries: Brought[] };

/** At most this many files come in with one drop; a larger tree is refused whole. */
export const broughtFileLimit = 2000;

/** The part of the browser's FileSystemEntry a drop is read through. */
interface DroppedEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}
interface DroppedFile extends DroppedEntry {
  file(success: (file: File) => void, failure: (error: unknown) => void): void;
}
interface DroppedFolder extends DroppedEntry {
  createReader(): {
    readEntries(
      success: (entries: DroppedEntry[]) => void,
      failure: (error: unknown) => void,
    ): void;
  };
}

/** Why a drop is not brought in whole. */
export class TooManyFiles extends Error {}

/**
 * Reads what was dropped, folders with everything inside them. Hidden entries
 * (`.DS_Store`, `.git`) stay behind, as they would be Schema in knowledge.
 * Read the entries during the drop event; reading them may finish after it.
 */
export async function readDropped(entries: (DroppedEntry | File)[]): Promise<Brought[]> {
  let files = 0;
  const read = async (entry: DroppedEntry | File): Promise<Brought | undefined> => {
    if (entry.name.startsWith('.')) return undefined;
    // A drop that offers no entry for an item still offers its file.
    if (!('isFile' in entry)) {
      if (++files > broughtFileLimit) throw new TooManyFiles();
      return { name: entry.name, file: entry };
    }
    if (entry.isFile) {
      if (++files > broughtFileLimit) throw new TooManyFiles();
      const file = await new Promise<File>((resolve, reject) =>
        (entry as DroppedFile).file(resolve, reject),
      );
      return { name: entry.name, file };
    }
    if (!entry.isDirectory) return undefined;
    const reader = (entry as DroppedFolder).createReader();
    const children: DroppedEntry[] = [];
    // A reader hands its entries over in batches, and an empty one when it is done.
    for (;;) {
      const batch = await new Promise<DroppedEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (!batch.length) break;
      children.push(...batch);
    }
    return { name: entry.name, entries: await readAll(children) };
  };
  const readAll = async (list: (DroppedEntry | File)[]) => {
    const out: Brought[] = [];
    for (const entry of list) {
      const item = await read(entry);
      if (item) out.push(item);
    }
    return out;
  };
  return readAll(entries);
}

/** How many files a brought tree holds. */
export function broughtFiles(items: Brought[]): number {
  return items.reduce((sum, item) => sum + ('file' in item ? 1 : broughtFiles(item.entries)), 0);
}
