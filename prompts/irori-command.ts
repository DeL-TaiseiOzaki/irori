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
  "irori: the `irori` command is on your PATH for this request. With it you do what the person does in irori's dialogs to set hibachis up: `irori list` shows the hibachis, their layers, connected folders and the workspaces; `irori clone`, `irori create` and `irori add` register hibachis in the workspace this request came from; `irori connect` and `irori disconnect` link a folder into a hibachi's contents and take it out; `irori set` names a hibachi, its category and its layers; `irori layer` chooses its knowledge and contents folders; `irori workspace` makes or changes a workspace; `irori remove` takes a hibachi off this computer. `irori routines` checks the routines as irori reads them, and `irori run <routine>` starts one the person has asked you to run. Run `irori help` for the options.",
  "Use it when the person asks you to set up, move in from another tool, or reorganize their hibachis, or to write a routine; your folder's .agents/skills holds procedures for that work, and irori-guide says what irori can do. A hibachi you register is handed to you from the next request.",
  "A routine's secrets go only to its programs, inside irori; you never see them. Never ask the person for a secret's value: they enter it on the routines page.",
].join('\n');

/** `irori help`: every form of the command, with where new hibachis go by default. */
export function iroriCommandHelp(defaultParent: string) {
  return `irori — set up hibachis for the person. No command deletes a file; only
remove --trash moves a hibachi's folder, to the system trash.

irori list
  The hibachis on this computer: name, folder, GitHub repository, category,
  knowledge and contents folders, connected folders, and whether they are in
  this workspace. Then the workspaces, and where new hibachis go.

irori clone <GitHub URL or owner/name> [--folder <name>] [--parent <folder>] [--name <hibachi name>] [--category <category>]
  Clones the repository into a new folder and registers it as a hibachi in
  this workspace. A repository already registered here joins the workspace
  instead. The folder is the repository's name unless --folder says otherwise.
  --category is personal, team, organization or a name of your own, one line
  of at most 40 characters.

irori create <folder name> [--parent <folder>] [--name <hibachi name>] [--category ...]
  Makes a new hibachi: an empty folder, a Git repository on main, and a first
  commit of what irori writes there. It has no GitHub repository yet.

irori add <folder> [--name <hibachi name>] [--category ...]
  Registers a folder already on this computer, a Git checkout or a plain
  folder, and adds it to this workspace. One already registered just joins.

irori routines
  The routines of your folder (routines/) and of this workspace's hibachis
  (.irori/routines/), as irori reads them: whether each can run, and if not,
  why, and how its last run ended. Run it after writing or changing a routine.

irori run <routine> [--hibachi <hibachi>]
  Starts a routine, named as in \`irori routines\` or by its folder, when the
  person asks you to. It runs in irori; this command does not wait for it.
  Only a routine the person has reviewed on the routines page runs, and a
  change to its files needs their review again. Its secrets go only to its
  programs and never to you. Your own routine of that name comes first;
  --hibachi names a hibachi's. A routine's agent steps cannot start routines.

irori connect <hibachi> <folder> [--name <name in contents>] [--read-only]
  Connects a folder on this computer, such as one Google Drive for desktop,
  OneDrive or Dropbox syncs, into the hibachi's contents. The hibachi is named
  as in \`irori list\` or by its folder.

irori disconnect <hibachi> <name in contents>
  Takes a connected folder out of the hibachi's contents. The folder itself
  is not touched.

irori set <hibachi> [--name <name>] [--category ...] [--knowledge-label <label>] [--contents-label <label>]
  Changes the hibachi's name, its category, or the names its Knowledge and
  Contents layers are shown under (one line, at most 40 characters).

irori layer <hibachi> knowledge <folder>
irori layer <hibachi> contents <folder> [--also]
  Chooses the hibachi's knowledge folder, where new notes go, or its contents
  folder, where folders are connected. A folder that exists already is taken
  as it is and nothing moves; otherwise the current one is renamed and links
  into it are rewritten. Everything outside Schema and contents is knowledge.
  With --also, an existing folder becomes contents beside the contents
  folder; it stays where it is and Git keeps tracking it.

irori workspace <workspace name> [<hibachi>...] [--leave]
  Makes the workspace if there is none of that name, and adds the hibachis to
  it, or with --leave takes them out of it.

irori remove <hibachi> [--trash]
  Takes the hibachi off this computer and out of every workspace. Its folder
  stays and can be added again, unless --trash moves it to the system trash.
  Only after the person said yes to removing that hibachi.

New hibachis go in ${JSON.stringify(defaultParent)} unless --parent names another folder.
A relative --parent or folder is taken from your working folder.`;
}

/** One hibachi in `irori list`. */
export interface ListedHibachi {
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
export function hibachiList(
  hibachis: ListedHibachi[],
  defaultParent: string,
  workspace: string | undefined,
  workspaces: { name: string; hibachis: string[] }[] = [],
) {
  const lines = hibachis.map((item) => {
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
  });
  return [
    hibachis.length ? 'Hibachis on this computer:' : 'No hibachis on this computer yet.',
    ...lines,
    ...(workspaces.length
      ? [
          'Workspaces:',
          ...workspaces.map(
            (item) =>
              `- ${item.name}: ${item.hibachis.length ? item.hibachis.join(', ') : 'no hibachis'}`,
          ),
        ]
      : []),
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

/** `irori disconnect`. */
export function folderDisconnected(
  hibachi: string,
  connection: { name: string; contentsRoot: string },
) {
  return `Took ${connection.contentsRoot}/${connection.name} out of the hibachi "${hibachi}". The folder itself is as it was.`;
}

/** `irori set`: the hibachi as it is now. */
export function hibachiChanged(hibachi: {
  name: string;
  category?: string;
  labels?: { knowledge: string; contents: string };
}) {
  return `The hibachi is now "${hibachi.name}"${hibachi.category ? `, category ${hibachi.category}` : ''}${hibachi.labels ? `, with its layers shown as ${JSON.stringify(hibachi.labels.knowledge)} and ${JSON.stringify(hibachi.labels.contents)}` : ''}.`;
}

/** `irori layer`: the folder a layer now has, and what could not be carried over. */
export function layerChosen(
  hibachi: string,
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
  const head = change.also
    ? `"${change.folder}" is contents of the hibachi "${hibachi}" too. It stays where it is and Git still tracks it; add it to .gitignore if it should stay out of the repository.`
    : change.previous === change.folder
      ? `The ${layer} folder of the hibachi "${hibachi}" is "${change.folder}" already.`
      : change.moved
        ? `Renamed the ${layer} folder of the hibachi "${hibachi}" from "${change.previous}" to "${change.folder}"${change.links ? `, and rewrote ${change.links} links in ${change.notes} files` : ''}.`
        : `The ${layer} folder of the hibachi "${hibachi}" is now "${change.folder}"; nothing was moved.`;
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
  workspace: { name: string; hibachis: string[] },
  outcome: { created: boolean; current: boolean },
) {
  return [
    `${outcome.created ? 'Made the workspace' : 'The workspace'} "${workspace.name}" ${workspace.hibachis.length ? `holds ${workspace.hibachis.join(', ')}` : 'holds no hibachis'}.`,
    outcome.current
      ? 'It is the workspace this request came from; the person sees the change now.'
      : 'The person opens it from the start screen.',
  ].join('\n');
}

/** `irori remove`. */
export function hibachiRemoved(hibachi: { name: string; root: string }, trash: boolean) {
  return trash
    ? `Removed the hibachi "${hibachi.name}" and moved ${JSON.stringify(hibachi.root)} to the system trash, where the person can restore it.`
    : `Removed the hibachi "${hibachi.name}" from this computer and its workspaces. ${JSON.stringify(hibachi.root)} is as it was; "irori add" brings it back.`;
}

/** One routine in `irori routines`. */
export interface ListedRoutine {
  name: string;
  owner: 'irori' | 'hibachi';
  /** The hibachi's name, for a hibachi's routine. */
  hibachi?: string;
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
    return `- ${JSON.stringify(routine.name)} (${routine.owner === 'irori' ? 'irori agent' : `hibachi ${routine.hibachi}`}) at ${JSON.stringify(routine.path)}: ${state}${lastRun(routine)}`;
  });
  return [
    routines.length ? 'Routines:' : 'No routines yet.',
    ...lines,
    workspace
      ? `Hibachi routines are those of the workspace "${workspace}".`
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
  ambiguous: (name: string, routines: { folder: string; hibachi?: string }[]) =>
    `More than one routine is named ${JSON.stringify(name)}: ${routines.map((routine) => `folder ${JSON.stringify(routine.folder)} (${routine.hibachi ? `hibachi ${routine.hibachi}` : 'yours'})`).join(', ')}. Name it by its folder, with --hibachi for a hibachi's.`,
  problem: (problem: string) => `The routine cannot run: ${problem}`,
  needs: (text: string) =>
    `The routine needs something on this device first: ${text} The person adds it on the routines page; a secret's value is entered only there.`,
  review: (review: 'unreviewed' | 'changed') =>
    review === 'changed'
      ? 'The routine changed since the person reviewed it. They review it again and press 実行 (Run) on the routines page; after that you can start it.'
      : 'The person has not reviewed this routine on this device. They review it and press 実行 (Run) on the routines page; after that you can start it.',
  running: 'The routine is already running.',
};
