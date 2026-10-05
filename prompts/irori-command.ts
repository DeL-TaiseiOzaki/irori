/**
 * The `irori` command: how the irori agent asks irori to register hibachis and
 * connect folders.
 *
 * Sent: the preamble before the person's words on every irori agent request
 * when the command is on the run's PATH; the help and the reports as the
 * command's output, read by the agent in its shell.
 * Channel: the request text, and the command's standard output.
 */

/** Said on every irori agent request that has the command. */
export const iroriCommandPreamble = [
  'irori: the `irori` command is on your PATH for this request. It registers hibachis on this computer and adds them to the workspace this request came from: `irori list`, `irori clone <GitHub URL or owner/name>`, `irori create <folder>`, `irori add <folder>`, `irori connect <hibachi> <folder>`. Run `irori help` for the options.',
  "Use it when the person asks you to set up or add hibachis; your folder's .agents/skills holds procedures for that work. A hibachi you register is handed to you from the next request.",
].join('\n');

/** `irori help`: every form of the command, with where new hibachis go by default. */
export function iroriCommandHelp(defaultParent: string) {
  return `irori — set up hibachis for the person. Each command only adds; nothing is removed.

irori list
  The hibachis on this computer: name, folder, GitHub repository, and whether
  they are in this workspace. Also where new hibachis go.

irori clone <GitHub URL or owner/name> [--folder <name>] [--parent <folder>] [--name <hibachi name>] [--category personal|team|organization]
  Clones the repository into a new folder and registers it as a hibachi in
  this workspace. A repository already registered here joins the workspace
  instead. The folder is the repository's name unless --folder says otherwise.

irori create <folder name> [--parent <folder>] [--name <hibachi name>] [--category ...]
  Makes a new hibachi: an empty folder, a Git repository on main, and a first
  commit of what irori writes there. It has no GitHub repository yet.

irori add <folder> [--name <hibachi name>] [--category ...]
  Registers a folder already on this computer, a Git checkout or a plain
  folder, and adds it to this workspace. One already registered just joins.

irori connect <hibachi> <folder> [--name <name in contents>] [--read-only]
  Connects a folder on this computer, such as one Google Drive for desktop,
  OneDrive or Dropbox syncs, into the hibachi's contents. The hibachi is named
  as in \`irori list\` or by its folder.

New hibachis go in ${JSON.stringify(defaultParent)} unless --parent names another folder.
A relative --parent or folder is taken from your working folder.`;
}

/** One hibachi in `irori list`. */
export interface ListedHibachi {
  name: string;
  root: string;
  repository?: string;
  inWorkspace: boolean;
}

/** `irori list`. */
export function hibachiList(
  hibachis: ListedHibachi[],
  defaultParent: string,
  workspace: string | undefined,
) {
  const lines = hibachis.map(
    (item) =>
      `- ${item.name}: folder ${JSON.stringify(item.root)}${item.repository ? `, GitHub ${item.repository}` : ''}${workspace ? (item.inWorkspace ? ', in this workspace' : ', not in this workspace') : ''}`,
  );
  return [
    hibachis.length ? 'Hibachis on this computer:' : 'No hibachis on this computer yet.',
    ...lines,
    workspace
      ? `This request came from the workspace "${workspace}".`
      : 'This request came from no workspace: new hibachis are registered but join none.',
    `New hibachis go in ${JSON.stringify(defaultParent)} unless --parent names another folder.`,
  ].join('\n');
}

/** What became of one hibachi a command registered or found registered. */
export function hibachiRegistered(
  hibachi: { name: string; root: string; repository?: string },
  outcome: { already: boolean; joined: 'joined' | 'member' | 'no workspace'; notice?: string },
) {
  return [
    `${outcome.already ? 'Already a hibachi' : 'Registered the hibachi'} "${hibachi.name}" at ${JSON.stringify(hibachi.root)}${hibachi.repository ? ` (GitHub ${hibachi.repository})` : ''}.`,
    outcome.joined === 'joined'
      ? 'Added it to this workspace; it is handed to you from the next request.'
      : outcome.joined === 'member'
        ? 'It is already in this workspace.'
        : 'No workspace sent this request, so it joined none; the person can add it on the start screen.',
    ...(outcome.notice ? [`Note: ${outcome.notice}`] : []),
  ].join('\n');
}

/** `irori connect`. */
export function folderConnected(
  hibachi: string,
  connection: { name: string; contentsRoot: string; readOnly: boolean; folder: string },
) {
  return `Connected ${JSON.stringify(connection.folder)} to the hibachi "${hibachi}" as ${connection.contentsRoot}/${connection.name}${connection.readOnly ? ', read-only' : ''}. Agents see it through a link: name that path, or use rg -L.`;
}
