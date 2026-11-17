// One vault host per folder on an SSH host (ADR 061): the folder's pid file is its
// place. A host takes it to serve and lets it go as it ends.
import net from 'node:net';
import path from 'node:path';
import { promises as fs } from 'node:fs';

/** A host started this recently may not listen yet; it is not taken for a dead one. */
const startingFor = 15_000;

export const connect = (socketPath: string) =>
  new Promise<net.Socket>((resolve, reject) => {
    const socket = net.connect(socketPath);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });

/**
 * Takes the folder's pid file, unless a host there lives or is starting. A file no
 * host answers for and that is older than a start takes is left behind and taken over.
 */
export async function takePlace(dataDir: string, socketPath: string) {
  const file = path.join(dataDir, 'host.pid');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await fs.writeFile(file, String(process.pid), { flag: 'wx', mode: 0o600 });
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const answering = await connect(socketPath).then(
      (socket) => (socket.destroy(), true),
      () => false,
    );
    if (answering) return undefined;
    const written = await fs.stat(file).then(
      (info) => info.mtimeMs,
      () => 0,
    );
    if (Date.now() - written < startingFor) return undefined;
    // Left by a host that ended without tidying up.
    await fs.rm(file, { force: true });
  }
  return undefined;
}

/**
 * Lets the place go as a host ends: its pid file is removed only while it still names
 * this host. A host that stops listening and then takes a while to close looks left
 * behind, so another may have taken the place by then, and its file stays.
 */
export async function releasePlace(file: string, pid = process.pid) {
  const named = await fs.readFile(file, 'utf8').catch(() => undefined);
  if (named?.trim() === String(pid)) await fs.rm(file, { force: true }).catch(() => {});
}
