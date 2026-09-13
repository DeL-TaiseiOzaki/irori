import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Chromium and Node can spell Windows file URLs differently (including DOS short paths).
// Fragment navigation does not change the loaded document's authority.
export async function isAppDocument(candidate: string, canonicalEntry: string): Promise<boolean> {
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'file:' || url.hostname) return false;
    return (await realpath(fileURLToPath(url))) === canonicalEntry;
  } catch {
    return false;
  }
}
