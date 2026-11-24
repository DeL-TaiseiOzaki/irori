/**
 * The `irori` command: how an agent asks irori to do what the person does in
 * irori — register and arrange vaults (the irori agent), and move notes,
 * comment, update indexes, check pages against the vault's ontology and set up
 * its own vault (either agent, ADR 031 and 060).
 *
 * Sent: a preamble before the person's words when the command is on the
 * run's PATH, whole on a native session's first request and as one line
 * after it (ADR 039); the help and the reports as the command's output, read
 * by the agent in its shell.
 * Channel: the request text, and the command's standard output.
 */

import { brainColors, brainGlyphs } from '../src/domain/brains';
import type { Ontology, OntologyFinding } from '../src/domain/ontology';

/**
 * The irori agent's `irori` command, said on a session's first request that has
 * it; later requests in that session get `iroriCommandPointer` (ADR 039).
 */
export const iroriCommandPreamble = [
  "irori: the `irori` command is on your PATH. With it you do what the person does in irori to set up vaults, workspaces and routines: `irori list` shows the vaults, their layers, connected folders, the workspaces and the SSH hosts, `irori routines` the routines as irori reads them, and `irori help` gives every form. `irori create`, `clone` and `add` make a vault on this computer, or with `--host` on one of the person's SSH hosts. Your folder's .agents/skills holds the procedures for that work, and irori-guide says what irori can do. A vault you register is handed to you from the next request.",
  "Inside a vault, `irori move` and `irori trash` keep links, comments and records in step where `mv` and `rm` break them; hand such work to the vault's agent, whose own `irori` command does the same.",
  "A routine's secrets go only to its programs, inside irori; you never see them. Never ask the person for a secret's value: they enter it on the routines page.",
].join('\n');

/** The line a session that already heard `iroriCommandPreamble` gets instead. */
export const iroriCommandPointer =
  'irori: the `irori` command given earlier in this session is still on your PATH; `irori help` gives every form.';

/**
 * A vault agent's `irori` command, the end of its introduction
 * (`vaultIntro`, ADR 031, ADR 039): what it must know before it moves or
 * removes anything. The rest is in `irori help`.
 */
export const vaultCommandPreamble =
  'The `irori` command is on your PATH and acts on this vault alone. Move or rename a note, file or folder with `irori move` and remove a note with `irori trash`: `mv` and `rm` break the links into it and its comments. Leave a comment for the person with `irori comment`. `irori help` lists the rest, and where irori keeps properties, notes and routines.';

/** Why `irori call` is refused: a vault agent's, or an irori agent's request that hands no vault. */
export function callRefused(vaultAgent: boolean) {
  return vaultAgent
    ? '"irori call" is the irori agent\'s. Ask the person to ask the irori agent in irori mode.'
    : '"irori call" hands work only to a vault handed to this request, and this request hands none: they are the vaults of the workspace it was sent in. Do the work here, or ask the person to send the request from a workspace that has the vault.';
}

/** `irori help`: every form of the command, with where new vaults go by default. */
export function iroriCommandHelp(defaultParent: string, vaultAgent = false) {
  return `irori — do in irori what the person does there. No command deletes a file;
remove --trash moves a vault's folder to the system trash, and trash moves a
note to irori's trash.${
    vaultAgent
      ? `

You are a vault agent: every form reaches your own vault alone, named by
its name or "." from its folder. clone, create, add, hosts, workspace, remove,
run, stop, skills, install, call, ls, read, search and send are the irori
agent's; the person asks it in
irori mode. A secret's
value, a routine's first review, accounts, updates and agent permissions
stay with the person.

Through files, as the person does in irori: frontmatter is a page's
properties, with their types and fields declared in .property/property.json
when the knowledge folder is an OKF bundle. That file is the vault's
ontology: write only the page types and relation names it declares, and
run "irori check" after writing pages; today's note and the new-note
folder are in .irori/notes.json; routines are
.irori/routines/<name>/routine.yaml; comments are
.irori/comments/<file>.json. Links irori follows are relative Markdown
links, not [[wiki links]].`
      : ''
  }

irori list
  The vaults on this computer: name, folder, GitHub repository, category,
  knowledge and contents folders, connected folders, the folder their agents
  work in, and whether they are in this workspace. Then the vaults on SSH
  hosts, the workspaces, and where new vaults go.

irori clone <GitHub URL or owner/name> [--folder <name>] [--parent <folder>] [--name <vault name>] [--category <category>] [--layers <layers>]
  Clones the repository into a new folder and registers it as a vault in
  this workspace. A repository already registered here joins the workspace
  instead. The folder is the repository's name unless --folder says otherwise.
  --category is optional: personal, team, organization or a name of your
  own, one line of at most 40 characters. A vault has none unless given one.
  --layers says which layers the vault has, as for "irori set": a repository
  of code is schema,contents. It counts for a vault irori declares for the
  first time; a folder that already holds a vault's declaration keeps its own.

irori create <folder name> [--parent <folder>] [--name <vault name>] [--category ...] [--layers <layers>]
  Makes a new vault: an empty folder, a Git repository on main, and a first
  commit of what irori writes there. It has no GitHub repository yet.

irori add <folder> [--name <vault name>] [--category ...] [--layers <layers>]
  Registers a folder already on this computer, a Git checkout or a plain
  folder, and adds it to this workspace. One already registered just joins.

clone, create and add take --host <SSH host> to make the vault on one of the
person's SSH hosts instead, named as in "irori hosts". The folders are then
the host's: absolute, or taken from its home folder (~), where new vaults go
unless --parent names another. The vault lives and its agent runs there; once
it is handed to you, it is read as the other vaults on SSH hosts are. A clone
there uses the host's own Git sign-in.

irori hosts [<SSH host> [<folder>]]
  The SSH hosts the person added in irori's settings (SSH ホスト), with their
  vaults, and the hosts of their ssh configuration not added yet. With a host,
  the folders in a folder of it (its home folder unless one is named), those
  that are vaults marked: how to find a folder to add. irori connects to the
  host when it has not; a host that asks for a password asks the person in
  irori's window.

irori hosts --add <destination> [--name <name>] [--port <port>]
  Adds an SSH host: the destination is what follows ssh, user@host or a Host
  of the person's ssh configuration. Only when the person asked for it.

irori move <path> <new path or folder>
  Moves or renames a note, file or folder in a vault's knowledge, as the
  explorer does: links into it are rewritten, and its comments, a note's
  images beside it and irori's records follow. Paths are taken from your
  working folder. Into a folder of another vault's knowledge it keeps its
  name and its comments and images go with it, but links to and from it
  break: links never cross vaults. The command says how many.

irori copy <path> <folder>
  Copies a file or folder of a vault's knowledge or contents into a folder of
  any vault's knowledge or editable contents, under its name or the first free
  one, never over an entry. A copy within knowledge keeps its links leading
  where the original's did.

irori trash <note>
  Moves a knowledge note to irori's trash; the person restores it there.

irori comment <file> <text> [--quote <passage>] [--line <n>]
  Leaves a comment on a file for the person, signed as you, on the quoted
  passage (at line n) or on the whole file.

irori resolve <file> <comment id>
  Removes a comment, by the id in .irori/comments/<file>.json.

irori index [<vault>]
  Writes the vault's folder indexes (each folder's index.md), as 索引を更新
  does, when its knowledge folder is an OKF bundle. Without a name, the vault
  of your working folder.

irori check [<vault>]
  Applies the vault's ontology, the page types and relations declared in
  .property/property.json, to its pages, and lists where a page differs: an
  undeclared type or relation name, a required property missing, a relation
  from or to the wrong type of page. Writes nothing. Run it after writing
  pages.

irori routines
  The routines of your folder (routines/) and of this workspace's vaults
  (.irori/routines/), as irori reads them: whether each can run, and if not,
  why, and how its last run ended. Run it after writing or changing a routine.

irori run <routine> [--vault <vault>]
  Starts a routine, named as in \`irori routines\` or by its folder, when the
  person asks you to. It runs in irori; this command does not wait for it.
  Only a routine the person has reviewed on the routines page runs, and a
  change to its files needs their review again. Its secrets go only to its
  programs and never to you. Your own routine of that name comes first;
  --vault names a vault's. A routine's agent steps cannot start routines.

irori stop <routine> [--vault <vault>]
  Ends the routine's run in progress, as 停止 on the routines page does;
  later steps do not run.

irori install python
  Downloads uv into irori's data, for the Python steps of routines, as the
  routines page does. Only when the person asked for it, or agreed when a
  routine needs it.

irori skills [--update]
  Adds the standard skills your folder lacks, and names those that differ from
  this irori's version, edited by the person or written by an older irori.
  --update writes this irori's version over them; ask the person first if they
  may have edited one.

irori call <vault agent or vault name> "<task>"
  Hands a task to the agent of a vault handed to this request, on any CLI:
  it runs inside the vault with the vault's own Schema. Waits until it
  finishes and prints its report. The task may come on standard input
  instead.

irori ls <vault> [<folder>]
irori read <vault> <file>
irori search <vault> <words>
irori send <vault> <file> [--as <name>]
  For a vault on an SSH host handed to this request, which has no folder on
  this computer: list a folder of it, print a text file, search its notes,
  and put a file of your folder or of a handed vault on this computer into
  its work folder (the command prints where). Paths are those inside the
  vault. A vault on this computer is read where it is.

irori connect <vault> <folder> [--name <name in contents>] [--read-only]
  Connects a folder on this computer, such as one Google Drive for desktop,
  OneDrive or Dropbox syncs, into the vault's contents. The vault is named
  as in \`irori list\` or by its folder.

irori connect <vault> <GitHub URL> --into <folder> [--branch <branch>]
irori connect <vault> <GitHub URL> --existing <clone>
    [--name <name in contents>] [--editable]
  Shows a GitHub repository in the vault's contents, read-only unless
  --editable. --into clones it into a new folder inside that folder;
  --existing uses a clone already on this computer. Ask the person where the
  clone goes. The vault records the URL, so on another computer the same
  command clones it for that record. To bring it up to date, run git pull in
  the clone.

irori disconnect <vault> <name in contents>
  Takes a connected folder out of the vault's contents. The folder itself
  is not touched.

irori connection <vault> <name in contents> [--name <new name>] [--read-only | --editable]
  Renames a connected folder in the vault's contents, or chooses whether
  agents may change it. A GitHub repository keeps the access it was connected
  with.

irori strays <vault> [--adopt <name> [--folder <folder>] | --remove <name>]
  What the vault's contents folders hold that no connection names: a link
  made by hand, or a folder or file put there. --adopt registers a link as a
  connected folder (--folder names its folder when the link leads nowhere);
  --remove deletes a link, or moves anything else to the system trash, only
  when the person asked for it.

irori work <vault> <folder>
irori work <vault> --default
  Chooses the folder where the vault's agents keep scratch files,
  intermediate results, downloads and trial scripts, on this computer: an
  existing folder, not another vault's. --default goes back to work in the
  vault's contents, which Git ignores.

irori set <vault> [--name <name>] [--category ...] [--knowledge-label <label>] [--contents-label <label>] [--layers <layers>] [--own knowledge|contents] [--color <color>] [--icon <icon> | --icon-image <file>]
  Changes the vault's name, its category, the names its Knowledge and
  Contents layers are shown under (one line, at most 40 characters), its
  color (${brainColors.join(', ')}) or its icon (${brainGlyphs.join(', ')},
  or one or two characters such as an emoji; --icon-image takes a PNG, JPEG,
  GIF or WebP file of at most 2 MiB).
  --layers chooses which layers the vault has, separated by commas: a
  knowledge base with connected material is schema,knowledge,contents (what
  a vault starts with), notes alone are schema,knowledge, and a workspace
  for code is schema,contents. Schema is always one of them. Nothing on disk
  moves. A layer left out is not shown, takes no new notes or connections,
  and is not told to the vault's agent. Disconnect the vault's folders before
  leaving Contents out. Naming the layer again brings it back as it was.
  The vault's own files, those outside Schema and its contents folders, are
  Knowledge when it has that layer, otherwise Contents (a repository of code
  is a vault as it is), and Schema when it has neither. --own contents puts
  them in Contents in a vault with both; Knowledge is then its named folder
  alone, so name that folder first if it is the root. --own knowledge puts
  them back. Own files in Contents are changed in place and stay in Git.

irori layer <vault> knowledge <folder>
irori layer <vault> contents <folder> [--also]
  Chooses the vault's knowledge folder, where new notes go, or its contents
  folder, where folders are connected. A folder that exists already is taken
  as it is and nothing moves; otherwise the current one is renamed and links
  into it are rewritten. Everything outside Schema and contents is knowledge.
  Knowledge folder "." is the vault's root: what the current one holds moves
  up beside Schema and contents, and links follow; a name already at the root
  stops the move.
  With --also, an existing folder becomes contents beside the contents
  folder; it stays where it is and Git keeps tracking it.

irori workspace <workspace name> [<vault>...] [--leave]
irori workspace <workspace name> --rename <new name>
irori workspace <workspace name> --delete
irori workspace <workspace name> <vault>... --group <group name> | --ungroup
  Makes the workspace if there is none of that name, and adds the vaults to
  it, or with --leave takes them out of it. --rename renames it; --delete
  deletes it, leaving its vaults as they are, only when the person asked for
  it. --group puts vaults of the workspace into a group of that name (made if
  there is none), and --ungroup takes them out of theirs. Vaults on SSH hosts
  are named as the others are.

irori remove <vault> [--trash]
  Takes the vault off this computer and out of every workspace. Its folder
  stays and can be added again, unless --trash moves it to the system trash.
  A vault on an SSH host is taken off the list only. Only after the person
  said yes to removing that vault.

New vaults go in ${JSON.stringify(defaultParent)} unless --parent names another folder.
A relative --parent or folder is taken from your working folder.`;
}

/** `irori move`. */
export function noteMoved(
  vault: string,
  from: string,
  moved: {
    path: string;
    links?: { notes: number; links: number; skipped: string[] };
    notice?: string;
  },
) {
  return [
    moved.path === from
      ? `${from} is where it should be already.`
      : `Moved ${from} to ${moved.path} in the vault "${vault}"${moved.links?.links ? `, and rewrote ${moved.links.links} links in ${moved.links.notes} notes` : ''}.`,
    ...(moved.links?.skipped.length
      ? [`Links not rewritten (changed, unsaved or unreadable): ${moved.links.skipped.join(', ')}.`]
      : []),
    ...(moved.notice ? [`Note: ${moved.notice}`] : []),
  ].join('\n');
}

/** `irori move` into another vault. */
export function noteMovedAcross(
  from: string,
  path: string,
  to: string,
  moved: string,
  outcome: { links?: number; notice?: string },
) {
  return [
    `Moved ${path} from the vault "${from}" to ${moved} in the vault "${to}".`,
    outcome.links
      ? `${outcome.links} links to or from it broke, as links never cross vaults.`
      : 'No links to or from it broke.',
    ...(outcome.notice ? [`Note: ${outcome.notice}`] : []),
  ].join('\n');
}

/** `irori copy`. */
export function entryCopied(from: string, path: string, to: string, copied: string) {
  return `Copied ${path} of the vault "${from}" to ${copied} in the vault "${to}".`;
}

/** `irori trash`. */
export function noteTrashed(vault: string, note: string) {
  return `Moved ${note} to irori's trash for the vault "${vault}". The person can restore it there. Links to it are left as they were.`;
}

/** `irori comment`. */
export function commentAdded(file: string, id: string, count: number) {
  return `Left comment ${id} on ${file}; it has ${count} comment${count === 1 ? '' : 's'} now.`;
}

/** `irori resolve`. */
export function commentResolved(file: string, id: string, left: number) {
  return `Removed comment ${id} from ${file}; ${left} left.`;
}

/** One difference between a page and the declaration, as `irori check` prints it. */
function difference(finding: OntologyFinding) {
  const instead = (use: string | undefined) => (use ? `; use ${JSON.stringify(use)} instead` : '');
  switch (finding.kind) {
    case 'unreadable':
      return 'its frontmatter cannot be read';
    case 'type-missing':
      return 'it has no type';
    case 'type-undeclared':
      return `its type ${JSON.stringify(finding.name)} is not declared${instead(finding.use)}`;
    case 'key-missing':
      return `the required property ${JSON.stringify(finding.name)} is missing or empty`;
    case 'relation-incomplete':
      return 'a relation has no rel or no target';
    case 'relation-undeclared':
      return `the relation ${JSON.stringify(finding.name)} is not declared${instead(finding.use)}`;
    case 'relation-from':
      return `the relation ${JSON.stringify(finding.name)} does not go from a page of type ${JSON.stringify(finding.type)}`;
    case 'relation-not-url':
      return `the relation ${JSON.stringify(finding.name)} points at a URL, and ${JSON.stringify(finding.target)} is not one`;
    case 'relation-not-page':
      return `the relation ${JSON.stringify(finding.name)} points at a page, and ${JSON.stringify(finding.target)} is no page of this vault`;
    case 'relation-target-type':
      return `the relation ${JSON.stringify(finding.name)} points at ${JSON.stringify(finding.target)}, a page of ${finding.type ? `type ${JSON.stringify(finding.type)}` : 'no type'}, which it may not point at`;
    case 'relation-repeated':
      return `the relation ${JSON.stringify(finding.name)} to ${JSON.stringify(finding.target)} is stated twice`;
  }
}

/** How many differences `irori check` prints. */
const checkLines = 100;

/** `irori check`. */
export function ontologyChecked(vault: string, ontology: Ontology) {
  const { report } = ontology;
  if (!report)
    return ontology.problem
      ? `The vault "${vault}" declares an ontology that cannot be read, so nothing was checked: ${ontology.problem}`
      : `The vault "${vault}" declares no ontology (it has no .property/property.json), so there is nothing to check its pages against.`;
  const summary = `Checked ${report.pages} pages of the vault "${vault}" against .property/property.json (${report.types.length} types, ${report.relations.length} relations).`;
  if (!report.findingCount) return `${summary} Every page follows the declaration.`;
  const shown = report.findings.slice(0, checkLines);
  return [
    `${summary} ${report.findingCount} differ:`,
    ...shown.map((finding) => `- ${finding.path}: ${difference(finding)}.`),
    ...(report.findingCount > shown.length
      ? [`...and ${report.findingCount - shown.length} more.`]
      : []),
    'Change the page, not the declaration: .property/property.json changes only when the person agrees.',
  ].join('\n');
}

/** `irori index`. */
export function indexUpdated(
  vault: string,
  update: { bundle: boolean; pages: number; written: string[] },
) {
  if (!update.bundle)
    return `The vault "${vault}" is not an OKF bundle (the index.md of its knowledge folder names no okf_version, or .property/property.json does not read), so irori writes no indexes for it.`;
  return update.written.length
    ? `Wrote ${update.written.length} index files for ${update.pages} pages in the vault "${vault}": ${update.written.join(', ')}.`
    : `The indexes of the vault "${vault}" are current (${update.pages} pages).`;
}

/** One vault in `irori list`. */
export interface ListedVault {
  name: string;
  root: string;
  /** The SSH host it lives on; `root` is then its folder there (ADR 061). */
  host?: string;
  repository?: string;
  inWorkspace: boolean;
  category?: string;
  /** Its knowledge and contents folders; a layer the vault left out has none (ADR 070). */
  knowledge?: string;
  contents?: string[];
  /** The layers the vault left out, by irori's names. */
  without?: string[];
  /** The layer of the vault's own files when it is not Knowledge (ADR 071). */
  own?: string;
  connections?: {
    name: string;
    contentsRoot: string;
    state: string;
    readOnly: boolean;
    /** A GitHub repository's owner/name (ADR 046). */
    repository?: string;
  }[];
  /** The folder its agents work in. */
  work?: string;
}

/** `irori list`. */
export function vaultList(
  vaults: ListedVault[],
  defaultParent: string,
  workspace: string | undefined,
  workspaces: { name: string; vaults: string[] }[] = [],
  /** For a vault agent: its own vault, with nothing about the others. */
  own = false,
) {
  if (own) return ['Your vault:', ...vaults.map(line(undefined))].join('\n');
  const here = vaults.filter((item) => !item.host);
  const far = vaults.filter((item) => item.host);
  return [
    here.length ? 'Vaults on this computer:' : 'No vaults on this computer yet.',
    ...here.map(line(workspace)),
    ...(far.length ? ['Vaults on SSH hosts:', ...far.map(line(workspace))] : []),
    ...(workspaces.length
      ? [
          'Workspaces:',
          ...workspaces.map(
            (item) =>
              `- ${item.name}: ${item.vaults.length ? item.vaults.join(', ') : 'no vaults'}`,
          ),
        ]
      : []),
    workspace
      ? `This request came from the workspace "${workspace}".`
      : 'This request came from no workspace: new vaults are registered but join none.',
    `New vaults go in ${JSON.stringify(defaultParent)} unless --parent names another folder.`,
  ].join('\n');
}

/** One vault's line in `irori list`. */
const line = (workspace: string | undefined) => (item: ListedVault) => {
  const layers = [
    item.category && `category ${item.category}`,
    item.without?.length && `no ${item.without.join(' or ')} layer`,
    item.own && `own files in ${item.own}`,
    item.knowledge && `knowledge ${JSON.stringify(item.knowledge)}`,
    item.contents?.length && `contents ${item.contents.map((c) => JSON.stringify(c)).join(', ')}`,
    item.connections?.length &&
      `connected ${item.connections
        .map(
          (c) =>
            `${c.contentsRoot}/${c.name} (${c.repository ? `GitHub ${c.repository}, ` : ''}${c.state === 'waiting' ? 'waiting for its folder' : c.repository && c.state === 'unconfigured' ? 'not cloned on this computer' : c.state}${c.readOnly ? ', read-only' : ''})`,
        )
        .join(', ')}`,
    item.work && `work folder ${JSON.stringify(item.work)}`,
  ].filter(Boolean);
  return `- ${item.name}: folder ${JSON.stringify(item.root)}${item.host ? ` on the SSH host ${JSON.stringify(item.host)}` : ''}${item.repository ? `, GitHub ${item.repository}` : ''}${workspace ? (item.inWorkspace ? ', in this workspace' : ', not in this workspace') : ''}${layers.length ? `; ${layers.join('; ')}` : ''}`;
};

/** What became of one vault a command registered or found registered. */
export function vaultRegistered(
  vault: { name: string; root: string; repository?: string; host?: string },
  outcome: { already: boolean; joined: 'joined' | 'member' | 'no workspace'; notice?: string },
) {
  return [
    `${outcome.already ? 'Already a vault' : 'Registered the vault'} "${vault.name}" at ${JSON.stringify(vault.root)}${vault.host ? ` on the SSH host ${JSON.stringify(vault.host)}` : ''}${vault.repository ? ` (GitHub ${vault.repository})` : ''}.`,
    outcome.joined === 'joined'
      ? 'Added it to this workspace; it is handed to you from the next request.'
      : outcome.joined === 'member'
        ? 'It is already in this workspace.'
        : 'No workspace sent this request, so it joined none; the person can add it on the start screen.',
    ...(outcome.notice ? [`Note: ${outcome.notice}`] : []),
  ].join('\n');
}

/** `irori hosts`: the SSH hosts irori has, with their vaults, and those of the ssh configuration. */
export function sshHostList(
  hosts: { name: string; destination: string; state: string; vaults: string[] }[],
  configured: string[] = [],
) {
  const offered = configured.length
    ? [
        `Hosts in the person's ssh configuration, not added: ${configured.join(', ')}. "irori hosts --add <name>" adds one when the person asks.`,
      ]
    : [];
  if (!hosts.length)
    return [
      'irori has no SSH hosts. The person adds one in irori\'s settings, under SSH ホスト (SSH hosts), or asks you to with "irori hosts --add"; then "irori add --host" and "irori create --host" make vaults there.',
      ...offered,
    ].join('\n');
  return [
    'SSH hosts:',
    ...hosts.map(
      (host) =>
        `- ${host.name}: ${host.destination}, ${host.state}${host.vaults.length ? `; vaults ${host.vaults.join(', ')}` : '; no vaults yet'}`,
    ),
    ...offered,
    'Name a host to list the folders in its home folder: irori hosts <host> [<folder>].',
  ].join('\n');
}

/** `irori hosts --add`. */
export function hostAdded(name: string, destination: string, already: boolean) {
  return already
    ? `irori has the SSH host "${name}" for ${destination} already.`
    : `Added the SSH host "${name}" for ${destination}. irori connects when a command needs it; "irori hosts ${name}" lists its folders.`;
}

/** `irori hosts <host> [<folder>]`: the folders in a folder of an SSH host. */
export function hostFolders(
  host: string,
  listing: {
    path: string;
    parent?: string;
    folders: { name: string; vault?: boolean }[];
    more?: boolean;
  },
) {
  return [
    `Folders in ${JSON.stringify(listing.path)} on the SSH host ${JSON.stringify(host)}${listing.parent ? ` (the folder above is ${JSON.stringify(listing.parent)})` : ''}:`,
    ...(listing.folders.length
      ? listing.folders.map((folder) => `- ${folder.name}${folder.vault ? ' (a vault)' : ''}`)
      : ['(none)']),
    ...(listing.more ? ['...and more, not listed.'] : []),
    'Hidden folders are not listed. Make one a vault with irori add <folder> --host <host>.',
  ].join('\n');
}

/** `irori connect`. */
export function folderConnected(
  vault: string,
  connection: { name: string; contentsRoot: string; readOnly: boolean; folder: string },
) {
  return `Connected ${JSON.stringify(connection.folder)} to the vault "${vault}" as ${connection.contentsRoot}/${connection.name}${connection.readOnly ? ', read-only' : ''}. Agents see it through a link: name that path, or use rg -L.`;
}

/** `irori connect` with a GitHub repository. */
export function repositoryConnected(
  vault: string,
  connection: {
    name: string;
    contentsRoot: string;
    readOnly: boolean;
    repository: string;
    folder: string;
    cloned: boolean;
  },
) {
  return `${connection.cloned ? 'Cloned' : 'Connected the clone of'} GitHub ${connection.repository} ${connection.cloned ? 'into' : 'at'} ${JSON.stringify(connection.folder)} and showed it in the vault "${vault}" as ${connection.contentsRoot}/${connection.name}${connection.readOnly ? ', read-only' : ''}. Agents see it through a link: name that path, or use rg -L.`;
}

/** `irori disconnect`. */
export function folderDisconnected(
  vault: string,
  connection: { name: string; contentsRoot: string },
) {
  return `Took ${connection.contentsRoot}/${connection.name} out of the vault "${vault}". The folder itself is as it was.`;
}

/** `irori set`: the vault as it is now. */
export function vaultChanged(vault: {
  name: string;
  category?: string;
  labels?: { knowledge: string; contents: string };
  /** The layers it has now, Schema first, when the command chose them. */
  layers?: string[];
  /** The layer its own files are in now, when the command chose its layers or that. */
  own?: string;
  look?: { color?: string; icon?: string };
}) {
  const look = vault.look
    ? [
        vault.look.color && `color ${vault.look.color}`,
        vault.look.icon && `icon ${vault.look.icon}`,
      ].filter(Boolean)
    : [];
  return `The vault is now "${vault.name}"${vault.category ? `, category ${vault.category}` : ''}${vault.labels ? `, with its layers shown as ${JSON.stringify(vault.labels.knowledge)} and ${JSON.stringify(vault.labels.contents)}` : ''}${vault.layers ? `, with the layers ${vault.layers.join(', ')}` : ''}${vault.own ? `, its own files in ${vault.own}` : ''}${look.length ? `, ${look.join(', ')}` : ''}.`;
}

/** `irori work`: where the vault's agents work now. */
export function workFolderChosen(
  vault: string,
  folder: { path: string; chosen: boolean; missing?: string },
) {
  return folder.chosen
    ? `The agents of the vault "${vault}" work in ${JSON.stringify(folder.path)} on this computer.`
    : `The agents of the vault "${vault}" work in ${JSON.stringify(folder.path)}, the work folder in the vault's contents, which Git ignores.`;
}

/** `irori layer`: the folder a layer now has, and what could not be carried over. */
export function layerChosen(
  vault: string,
  layer: 'knowledge' | 'contents',
  change: {
    folder: string;
    previous?: string;
    moved?: boolean;
    also?: boolean;
    links?: number;
    notes?: number;
    skipped?: string[];
    notice?: string;
  },
) {
  // `.` is the vault's root (ADR 035).
  const place = (folder?: string) => (folder === '.' ? "the vault's root" : `"${folder}"`);
  const root = change.folder === '.' || change.previous === '.';
  const head = change.also
    ? `"${change.folder}" is contents of the vault "${vault}" too. It stays where it is and Git still tracks it; add it to .gitignore if it should stay out of the repository.`
    : change.previous === change.folder
      ? `The ${layer} folder of the vault "${vault}" is ${place(change.folder)} already.`
      : change.moved
        ? `${root ? 'Moved' : 'Renamed'} the ${layer} folder of the vault "${vault}" from ${place(change.previous)} to ${place(change.folder)}${change.links ? `, and rewrote ${change.links} links in ${change.notes} files` : ''}.`
        : `The ${layer} folder of the vault "${vault}" is now ${place(change.folder)}; nothing was moved.`;
  return [
    head,
    ...(change.skipped?.length
      ? [`Links not rewritten (changed, unsaved or unreadable): ${change.skipped.join(', ')}.`]
      : []),
    ...(change.notice ? [`Note: ${change.notice}`] : []),
  ].join('\n');
}

/** `irori workspace`: the workspace after the change. */
export function workspaceSaved(
  workspace: { name: string; vaults: string[] },
  outcome: { created: boolean; current: boolean },
) {
  return [
    `${outcome.created ? 'Made the workspace' : 'The workspace'} "${workspace.name}" ${workspace.vaults.length ? `holds ${workspace.vaults.join(', ')}` : 'holds no vaults'}.`,
    outcome.current
      ? 'It is the workspace this request came from; the person sees the change now.'
      : 'The person opens it from the start screen.',
  ].join('\n');
}

/** `irori workspace --rename`. */
export function workspaceRenamed(from: string, to: string) {
  return `Renamed the workspace "${from}" to "${to}".`;
}

/** `irori workspace --delete`. */
export function workspaceDeleted(name: string, vaults: string[]) {
  return `Deleted the workspace "${name}".${vaults.length ? ` Its vaults (${vaults.join(', ')}) are as they were and stay on this computer.` : ''}`;
}

/** `irori workspace --group` or `--ungroup`: the workspace's groups now. */
export function workspaceGrouped(name: string, groups: { name: string; vaults: string[] }[]) {
  return groups.length
    ? `The workspace "${name}" groups its vaults as: ${groups.map((group) => `${group.name} (${group.vaults.join(', ')})`).join('; ')}.`
    : `The workspace "${name}" has no groups now.`;
}

/** `irori remove`. */
export function vaultRemoved(vault: { name: string; root: string }, trash: boolean, host?: string) {
  if (host)
    return `Took the vault "${vault.name}" off this computer's list and out of its workspaces. ${JSON.stringify(vault.root)} on the SSH host "${host}" is as it was; "irori add --host" brings it back.`;
  return trash
    ? `Removed the vault "${vault.name}" and moved ${JSON.stringify(vault.root)} to the system trash, where the person can restore it.`
    : `Removed the vault "${vault.name}" from this computer and its workspaces. ${JSON.stringify(vault.root)} is as it was; "irori add" brings it back.`;
}

/** `irori stop`. */
export function routineStopped(name: string, stopped: boolean) {
  return stopped
    ? `Stopped the routine "${name}": its step in progress ended, and later steps do not run.`
    : `The routine "${name}" is not running.`;
}

/** `irori install python`. */
export function pythonInstalled() {
  return "uv is ready in irori's data for the Python steps of routines.";
}

/** `irori skills`. */
export function standardSkills(outcome: { added: string[]; updated: string[]; differ: string[] }) {
  const lines = [
    ...(outcome.added.length ? [`Added the standard skills ${outcome.added.join(', ')}.`] : []),
    ...(outcome.updated.length
      ? [`Wrote this irori's version of ${outcome.updated.join(', ')}.`]
      : []),
    ...(outcome.differ.length
      ? [
          `${outcome.differ.join(', ')} differ from this irori's version, edited by the person or written by an older irori. "irori skills --update" writes this irori's version over them.`,
        ]
      : []),
  ];
  return lines.length ? lines.join('\n') : 'Your standard skills are those of this irori.';
}

/** `irori connection`. */
export function connectionChanged(
  vault: string,
  connection: { contentsRoot: string; name: string; readOnly: boolean },
) {
  return `The vault "${vault}" shows it as ${connection.contentsRoot}/${connection.name}, ${connection.readOnly ? 'read-only' : 'editable'}.`;
}

/** One stray in a vault's contents, as `irori strays` names it. */
const strayLine = (stray: {
  contentsRoot: string;
  name: string;
  kind: string;
  target?: string;
  missing?: boolean;
}) =>
  `${stray.contentsRoot}/${stray.name} (${stray.kind === 'link' ? `a link${stray.target ? ` to ${JSON.stringify(stray.target)}` : ''}${stray.missing ? ', leading nowhere' : ''}` : `a ${stray.kind}`})`;

/** `irori strays`. */
export function strayList(
  vault: string,
  strays: {
    contentsRoot: string;
    name: string;
    kind: string;
    target?: string;
    missing?: boolean;
  }[],
) {
  return strays.length
    ? [
        `In the contents of the vault "${vault}", no connection names:`,
        ...strays.map((stray) => `- ${strayLine(stray)}`),
        'A link becomes a connected folder with --adopt <name>; --remove <name> deletes a link or moves anything else to the system trash.',
      ].join('\n')
    : `The contents of the vault "${vault}" holds only its connections.`;
}

/** `irori strays --adopt`. */
export function strayAdopted(
  vault: string,
  stray: { contentsRoot: string; name: string },
  state: string,
) {
  return `${stray.contentsRoot}/${stray.name} is a connected folder of the vault "${vault}" now (${state}).`;
}

/** `irori strays --remove`. */
export function strayRemoved(
  vault: string,
  stray: { contentsRoot: string; name: string; kind: string },
) {
  return stray.kind === 'link'
    ? `Removed the link ${stray.contentsRoot}/${stray.name} from the vault "${vault}"; what it led to is as it was.`
    : `Moved ${stray.contentsRoot}/${stray.name} of the vault "${vault}" to the system trash, where the person can restore it.`;
}

/** One routine in `irori routines`. */
export interface ListedRoutine {
  name: string;
  owner: 'irori' | 'vault';
  /** The vault's name, for a vault's routine. */
  vault?: string;
  path: string;
  problem?: string;
  needs?: { text: string };
  review: 'unreviewed' | 'changed' | 'reviewed';
  /** A run in progress. */
  running?: string;
  last?: { state: string; endedAt?: string };
}

const lastRun = (routine: ListedRoutine) =>
  routine.running
    ? '; running now'
    : routine.last?.endedAt
      ? `; last run ${routine.last.state === 'nothing' ? 'found nothing to do' : routine.last.state} at ${routine.last.endedAt}`
      : '';

/** `irori routines`: each routine, whether it can run, and what the person does next. */
export function routineList(routines: ListedRoutine[], workspace: string | undefined) {
  const lines = routines.map((routine) => {
    const state = routine.problem
      ? `cannot run: ${routine.problem}`
      : routine.needs
        ? `needs on this device: ${routine.needs.text}`
        : routine.review === 'reviewed'
          ? 'ready'
          : 'ready; the person reviews its files before the next run';
    return `- ${JSON.stringify(routine.name)} (${routine.owner === 'irori' ? 'irori agent' : `vault ${routine.vault}`}) at ${JSON.stringify(routine.path)}: ${state}${lastRun(routine)}`;
  });
  return [
    routines.length ? 'Routines:' : 'No routines yet.',
    ...lines,
    workspace
      ? `Vault routines are those of the workspace "${workspace}".`
      : 'This request came from no workspace: only your own routines are listed.',
    'The person starts a routine with 実行 (Run) on the routines page. When they ask you to, `irori run <routine>` starts one that is ready and reviewed.',
  ].join('\n');
}

/** `irori run`: the routine started; nothing of what it handles comes back. */
export function routineStarted(name: string, agentSteps: boolean) {
  return [
    `Started the routine ${JSON.stringify(name)}. It runs in irori; the person follows it on the routines page.`,
    ...(agentSteps
      ? ['Its agent steps wait while an agent they need, such as you in this request, is running.']
      : []),
    'Run `irori routines` later to see how it ended.',
  ].join('\n');
}

/** Why `irori run` did not start a routine, and what the person does instead. */
export const routineRunRefused = {
  inRoutine: 'A routine step cannot start routines.',
  noWorkspace:
    'This request came from no workspace, so no routine can run from it. The person starts routines on the routines page of a workspace.',
  notFound: (name: string) =>
    `No routine is named ${JSON.stringify(name)}. Run "irori routines" for their names.`,
  ambiguous: (name: string, routines: { folder: string; vault?: string }[]) =>
    `More than one routine is named ${JSON.stringify(name)}: ${routines.map((routine) => `folder ${JSON.stringify(routine.folder)} (${routine.vault ? `vault ${routine.vault}` : 'yours'})`).join(', ')}. Name it by its folder, with --vault for a vault's.`,
  problem: (problem: string) => `The routine cannot run: ${problem}`,
  needs: (text: string) =>
    `The routine needs something on this device first: ${text} The person adds it on the routines page; a secret's value is entered only there.`,
  review: (review: 'unreviewed' | 'changed') =>
    review === 'changed'
      ? 'The routine changed since the person reviewed it. They review it again and press 実行 (Run) on the routines page; after that you can start it.'
      : 'The person has not reviewed this routine on this device. They review it and press 実行 (Run) on the routines page; after that you can start it.',
  running: 'The routine is already running.',
};
