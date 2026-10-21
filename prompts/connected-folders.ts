/**
 * The folders connected in a vault's contents (ADR 019, ADR 023).
 *
 * Sent: in a vault agent's introduction (`vaultIntro`) while the vault has
 * connected folders; the irori agent hears them per handed vault.
 * Channel: the request text.
 */

/**
 * Google Docs, Sheets and Slides in a Drive for desktop folder hold no content,
 * only the document's ID; the agent reads it with its own Google tools.
 */
export const googleFiles =
  "Google Docs, Sheets and Slides there are .gdoc, .gsheet and .gslides files: small JSON holding the document's ID in `doc_id` (older ones have a `url`), not its content. The document is https://docs.google.com/document/d/<doc_id> for a .gdoc, spreadsheets/d/<doc_id> for a .gsheet and presentation/d/<doc_id> for a .gslides. Read its content with a Google Drive tool you have, such as a connector, an MCP server or the gws CLI; without one, say so and give the person the link.";

/** Why a connected folder needs naming: searches that walk a folder skip links. */
const linkedNote = (example: string) =>
  `Each is a link to a folder on this device, often one a sync app such as Google Drive for desktop keeps. Searches and file listings that walk the whole vault skip links, so name the folder's path to search or list it (for example \`rg PATTERN ${JSON.stringify(example)}\`), or follow links (\`rg -L\`). A file kept only in the cloud downloads when it is first read. ${googleFiles}`;

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
