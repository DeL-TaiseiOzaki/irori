import path from 'node:path';
import { promises as fs } from 'node:fs';
import { onThisDevice, vaultOf, type Delegation } from './delegation';
import type { RemoteVaults } from './remote-vaults';
import { within } from '../domain/scopes';
import { onThisDeviceAlready, reachUsage } from '../../prompts';

/**
 * The forms of the `irori` command with which the irori agent reads a handed
 * vault that lives on an SSH host, and gives it a file (ADR 061). A vault on
 * this device is read where it is.
 */
export const reachForms = ['ls', 'read', 'search', 'send'] as const;
export type ReachForm = (typeof reachForms)[number];
export const isReachCommand = (word: unknown): word is ReachForm =>
  reachForms.includes(word as ReachForm);

/** The longest text `irori read` prints, in characters. */
export const readLimit = 400_000;
/** The largest file `irori send` takes. */
export const sendLimit = 20 * 1024 * 1024;
/** The most hits `irori search` prints. */
const hitLimit = 50;

/** A path inside a vault as its host takes it; one written from the vault's root there is cut to it. */
function inside(root: string, value: string) {
  const posix = value.replaceAll('\\', '/');
  const rel =
    posix === root ? '' : posix.startsWith(`${root}/`) ? posix.slice(root.length + 1) : posix;
  const parts = rel.split('/').filter((part) => part && part !== '.');
  if (rel.startsWith('/') || parts.includes('..'))
    throw Error(`${JSON.stringify(value)} is not a path inside the vault.`);
  return parts.join('/');
}

/**
 * Answers one of the forms for the irori agent's run. `argv` is the command's
 * arguments from the form on, and `cwd` the folder it ran in.
 */
export async function reachVault(
  argv: string[],
  cwd: string,
  delegation: Delegation,
  remote: RemoteVaults | undefined,
): Promise<string> {
  const [form, name, ...rest] = argv as [ReachForm, ...string[]];
  if (!name?.trim()) throw Error(reachUsage[form]);
  const brain = vaultOf(delegation, name.trim());
  if (!brain.host || !remote) throw Error(onThisDeviceAlready(brain));
  if (form === 'ls') {
    if (rest.length > 1) throw Error(reachUsage.ls);
    const entries = await remote.entries(brain.scopeId, inside(brain.root, rest[0] ?? ''));
    return entries.length
      ? entries.map((entry) => entry.path + (entry.directory ? '/' : '')).join('\n')
      : 'Nothing is there.';
  }
  if (form === 'read') {
    if (rest.length !== 1) throw Error(reachUsage.read);
    const doc = await remote.read(brain.scopeId, inside(brain.root, rest[0]));
    if (doc.viewer) throw Error(`${doc.path} is not a text file; irori read prints text only.`);
    if (doc.text.length > readLimit)
      throw Error(
        `${doc.path} is ${doc.text.length} characters, more than irori read prints (${readLimit}). Search it with irori search, or ask the vault's agent with irori call.`,
      );
    return doc.text;
  }
  if (form === 'search') {
    const query = rest.join(' ').trim();
    if (!query) throw Error(reachUsage.search);
    const found = await remote.search(brain.scopeId, query);
    if (!found.hits.length) return `Nothing in the ${brain.name} vault matches.`;
    return [
      ...found.hits.slice(0, hitLimit).map((hit) => `${hit.path}:${hit.line}: ${hit.preview}`),
      ...(found.hits.length > hitLimit ? [`(${found.hits.length - hitLimit} more matches)`] : []),
      ...(found.incomplete ? ['(The search did not read every file.)'] : []),
    ].join('\n');
  }
  // send <vault> <file> [--as <name>]
  const as = rest.indexOf('--as');
  const given = as >= 0 ? rest[as + 1] : undefined;
  const words = as >= 0 ? [...rest.slice(0, as), ...rest.slice(as + 2)] : rest;
  if (words.length !== 1 || (as >= 0 && !given)) throw Error(reachUsage.send);
  const file = await fs.realpath(path.resolve(cwd, words[0])).catch(() => {
    throw Error(`${JSON.stringify(words[0])} was not found.`);
  });
  // Only what the irori agent may already read: its folder and the handed vaults here.
  const readable = [delegation.you, ...onThisDevice(delegation).map((item) => item.root)];
  const roots = await Promise.all(readable.map((root) => fs.realpath(root).catch(() => root)));
  if (!roots.some((root) => within(root, file)))
    throw Error(
      'irori send takes a file from your folder or from a vault on this device handed to this request.',
    );
  const info = await fs.stat(file);
  if (!info.isFile()) throw Error(`${JSON.stringify(words[0])} is not a file.`);
  if (info.size > sendLimit)
    throw Error(`${JSON.stringify(words[0])} is larger than irori send takes (20 MiB).`);
  const sent = await remote.send(
    brain.scopeId,
    given ?? path.basename(file),
    new Uint8Array(await fs.readFile(file)),
  );
  return `Sent to the ${brain.name} vault on ${brain.host}: ${sent}`;
}
