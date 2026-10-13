/**
 * The `irori` command: how an agent asks irori to do what the person does in
 * irori — register and arrange vaults (the irori agent), and move notes,
 * comment, update indexes and set up its own vault (either agent, ADR 031).
 *
 * Sent: a preamble before the person's words when the command is on the
 * run's PATH, whole on a native session's first request and as one line
 * after it (ADR 038); the help and the reports as the command's output, read
 * by the agent in its shell.
 * Channel: the request text, and the command's standard output.
 */

import { brainColors, brainGlyphs } from '../src/domain/brains';

/**
 * The irori agent's `irori` command, said on a session's first request that has
 * it; later requests in that session get `iroriCommandPointer` (ADR 038).
 */
export const iroriCommandPreamble = [
  "irori: the `irori` command is on your PATH. With it you do what the person does in irori to set up vaults, workspaces and routines: `irori list` shows the vaults, their layers, connected folders and the workspaces, `irori routines` the routines as irori reads them, and `irori help` gives every form. Your folder's .agents/skills holds the procedures for that work, and irori-guide says what irori can do. A vault you register is handed to you from the next request.",
  "Inside a vault, `irori move` and `irori trash` keep links, comments and records in step where `mv` and `rm` break them; hand such work to the vault's agent, whose own `irori` command does the same.",
  "A routine's secrets go only to its programs, inside irori; you never see them. Never ask the person for a secret's value: they enter it on the routines page.",
].join('\n');

/** The line a session that already heard `iroriCommandPreamble` gets instead. */
export const iroriCommandPointer =
  'irori: the `irori` command given earlier in this session is still on your PATH; `irori help` gives every form.';

/**
 * A vault agent's `irori` command, the end of its introduction
 * (`vaultIntro`, ADR 031, ADR 038): what it must know before it moves or
 * removes anything. The rest is in `irori help`.
 */
export const vaultCommandPreamble =
  'The `irori` command is on your PATH and acts on this vault alone. Move or rename a note, file or folder with `irori move` and remove a note with `irori trash`: `mv` and `rm` break the links into it and its comments. Leave a comment for the person with `irori comment`. `irori help` lists the rest, and where irori keeps properties, notes and routines.';

/** Why `irori call` is refused: a vault agent's, or a run that hands work to sub-agents. */
export function callRefused(vaultAgent: boolean) {
  return vaultAgent
    ? '"irori call" is the irori agent\'s. Ask the person to ask the irori agent in irori mode.'
    : '"irori call" hands work over only on Pi or Hermes Agent, for vaults handed to this request. On this CLI, hand the work to the vault\'s sub-agent.';
}

/** `irori help`: every form of the command, with where new vaults go by default. */
export function iroriCommandHelp(defaultParent: string, vaultAgent = false) {
  return `irori — do in irori what the person does there. No command deletes a file;
remove --trash moves a vault's folder to the system trash, and trash moves a
note to irori's trash.${
    vaultAgent
      ? `

You are a vault agent: every form reaches your own vault alone, named by
its name or "." from its folder. clone, create, add, workspace, remove, run
and call are the irori agent's; the person asks it in irori mode. A secret's
value, a routine's first review, accounts, updates and agent permissions
stay with the person.

Through files, as the person does in irori: frontmatter is a page's
properties, with their types and fields declared in .property/property.json
when the knowledge folder is an OKF bundle; today's note and the new-note
folder are in .irori/notes.json; routines are
.irori/routines/<name>/routine.yaml; comments are
.irori/comments/<file>.json. Links irori follows are relative Markdown
links, not [[wiki links]].`
      : ''
  }

irori list
  The vaults on this computer: name, folder, GitHub repository, category,
  knowledge and contents folders, connected folders, and whether they are in
  this workspace. Then the workspaces, and where new vaults go.

irori clone <GitHub URL or owner/name> [--folder <name>] [--parent <folder>] [--name <vault name>] [--category <category>]
  Clones the repository into a new folder and registers it as a vault in
  this workspace. A repository already registered here joins the workspace
  instead. The folder is the repository's name unless --folder says otherwise.
  --category is personal, team, organization or a name of your own, one line
  of at most 40 characters.

irori create <folder name> [--parent <folder>] [--name <vault name>] [--category ...]
  Makes a new vault: an empty folder, a Git repository on main, and a first
  commit of what irori writes there. It has no GitHub repository yet.

irori add <folder> [--name <vault name>] [--category ...]
  Registers a folder already on this computer, a Git checkout or a plain
  folder, and adds it to this workspace. One already registered just joins.

irori move <path> <new path or folder>
  Moves or renames a note, file or folder in a vault's knowledge, as the
  explorer does: links into it are rewritten, and its comments, a note's
  images beside it and irori's records follow. Paths are taken from your
  working folder.

irori trash <note>
  Moves a knowledge note to irori's trash; the person restores it there.

irori comment <file> <text> [--quote <passage>] [--line <n>]
  Leaves a comment on a file for the person, signed as you, on the quoted
  passage (at line n) or on the whole file.

irori resolve <file> <comment id>
  Removes a comment, by the id in .irori/comments/<file>.json.

irori index [<vault>]
  Writes the vault's graph index and folder indexes, as 索引を更新 does,
  when its knowledge folder is an OKF bundle. Without a name, the vault of
  your working folder.

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

irori call <vault agent or vault name> "<task>"
  On Pi or Hermes Agent, which load no sub-agents from files, hands a task to
  the agent of a vault handed to this request, waits until it finishes and
  prints its report. The task may come on standard input instead. On another
  CLI, hand the work to the vault's sub-agent.

irori connect <vault> <folder> [--name <name in contents>] [--read-only]
  Connects a folder on this computer, such as one Google Drive for desktop,
  OneDrive or Dropbox syncs, into the vault's contents. The vault is named
  as in \`irori list\` or by its folder.

irori disconnect <vault> <name in contents>
  Takes a connected folder out of the vault's contents. The folder itself
  is not touched.

irori set <vault> [--name <name>] [--category ...] [--knowledge-label <label>] [--contents-label <label>] [--color <color>] [--icon <icon>]
  Changes the vault's name, its category, the names its Knowledge and
  Contents layers are shown under (one line, at most 40 characters), its
  color (${brainColors.join(', ')}) or its icon (${brainGlyphs.join(', ')},
  or one or two characters such as an emoji).

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
  Makes the workspace if there is none of that name, and adds the vaults to
  it, or with --leave takes them out of it.

irori remove <vault> [--trash]
  Takes the vault off this computer and out of every workspace. Its folder
  stays and can be added again, unless --trash moves it to the system trash.
  Only after the person said yes to removing that vault.

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

/** `irori index`. */
export function indexUpdated(
  vault: string,
  update: { declared: boolean; pages: number; written: string[] },
) {
  if (update.declared)
    return `The vault "${vault}" declares its own ontology in .irori/ontology.json, so irori does not generate its graph index.${update.written.length ? ` Wrote ${update.written.length} folder indexes.` : ''}`;
  return update.written.length
    ? `Wrote ${update.written.length} index files for ${update.pages} pages in the vault "${vault}": ${update.written.join(', ')}.`
    : `The indexes of the vault "${vault}" are current (${update.pages} pages).`;
}

/** One vault in `irori list`. */
export interface ListedVault {
  name: string;
  root: string;
  repository?: string;
  inWorkspace: boolean;
  category?: string;
  knowledge?: string;
  contents?: string[];
  connections?: { name: string; contentsRoot: string; state: string; readOnly: boolean }[];
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
  const lines = vaults.map(line(workspace));
  return [
    vaults.length ? 'Vaults on this computer:' : 'No vaults on this computer yet.',
    ...lines,
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
    item.knowledge && `knowledge ${JSON.stringify(item.knowledge)}`,
    item.contents?.length && `contents ${item.contents.map((c) => JSON.stringify(c)).join(', ')}`,
    item.connections?.length &&
      `connected ${item.connections
        .map((c) => `${c.contentsRoot}/${c.name} (${c.state}${c.readOnly ? ', read-only' : ''})`)
        .join(', ')}`,
  ].filter(Boolean);
  return `- ${item.name}: folder ${JSON.stringify(item.root)}${item.repository ? `, GitHub ${item.repository}` : ''}${workspace ? (item.inWorkspace ? ', in this workspace' : ', not in this workspace') : ''}${layers.length ? `; ${layers.join('; ')}` : ''}`;
};

/** What became of one vault a command registered or found registered. */
export function vaultRegistered(
  vault: { name: string; root: string; repository?: string },
  outcome: { already: boolean; joined: 'joined' | 'member' | 'no workspace'; notice?: string },
) {
  return [
    `${outcome.already ? 'Already a vault' : 'Registered the vault'} "${vault.name}" at ${JSON.stringify(vault.root)}${vault.repository ? ` (GitHub ${vault.repository})` : ''}.`,
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
  vault: string,
  connection: { name: string; contentsRoot: string; readOnly: boolean; folder: string },
) {
  return `Connected ${JSON.stringify(connection.folder)} to the vault "${vault}" as ${connection.contentsRoot}/${connection.name}${connection.readOnly ? ', read-only' : ''}. Agents see it through a link: name that path, or use rg -L.`;
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
  look?: { color?: string; icon?: string };
}) {
  const look = vault.look
    ? [
        vault.look.color && `color ${vault.look.color}`,
        vault.look.icon && `icon ${vault.look.icon}`,
      ].filter(Boolean)
    : [];
  return `The vault is now "${vault.name}"${vault.category ? `, category ${vault.category}` : ''}${vault.labels ? `, with its layers shown as ${JSON.stringify(vault.labels.knowledge)} and ${JSON.stringify(vault.labels.contents)}` : ''}${look.length ? `, ${look.join(', ')}` : ''}.`;
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

/** `irori remove`. */
export function vaultRemoved(vault: { name: string; root: string }, trash: boolean) {
  return trash
    ? `Removed the vault "${vault.name}" and moved ${JSON.stringify(vault.root)} to the system trash, where the person can restore it.`
    : `Removed the vault "${vault.name}" from this computer and its workspaces. ${JSON.stringify(vault.root)} is as it was; "irori add" brings it back.`;
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
