/**
 * The folders connected in a vault's contents (ADR 019, ADR 023).
 *
 * Sent: in a vault agent's introduction (`vaultIntro`) while the vault has
 * connected folders; the irori agent hears them per handed vault.
 * Channel: the request text.
 */

/** Why a connected folder needs naming: searches that walk a folder skip links. */
const linkedNote = (example: string) =>
  `Each is a link to a folder on this device, often one a sync app such as Google Drive for desktop keeps. Searches and file listings that walk the whole vault skip links, so name the folder's path to search or list it (for example \`rg PATTERN ${JSON.stringify(example)}\`), or follow links (\`rg -L\`). A file kept only in the cloud downloads when it is first read.`;

/** A vault agent's connected folders, as paths inside its vault. */
export function connectedFolders(paths: string[]) {
  return [
    `Connected folders in Contents: ${paths.map((item) => JSON.stringify(item)).join(', ')}.`,
    linkedNote(paths[0]),
  ].join(' ');
}

/** The same, for the irori agent: said once when any handed vault has connected folders. */
export function handedConnectedFolders(example: string) {
  return `The connected folders listed above are inside each vault's contents. ${linkedNote(example)} Tell a sub-agent or vault agent the folder's path when its task involves one.`;
}
