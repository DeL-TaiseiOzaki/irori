/**
 * The irori agent's standard skills: procedures for setting up the person's
 * irori with the `irori` command, and for writing routines.
 *
 * Sent: written into the irori agent's folder as
 * `.agents/skills/<name>/SKILL.md` when the person creates the folder, and,
 * for a folder made before, when the person adds the standard skills on the
 * irori agent's screen. irori writes only a skill whose folder is absent and
 * never replaces one, so the person may edit or delete them.
 * Channel: files in the irori agent's folder.
 */

const skill = (name: string, description: string, body: string) =>
  `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body.trim()}\n`;

/** Each standard skill's `SKILL.md`, by skill name. */
export const iroriAgentSkills: Record<string, string> = {
  'irori-setup': skill(
    'irori-setup',
    "Sets up the person's irori: their GitHub repositories become hibachis, new hibachis are started, and synced cloud folders are connected. Use when the person starts with irori or asks to prepare their hibachis.",
    `
# Set up irori

The person's path is: install irori, keep a working folder on this computer,
keep their knowledge on GitHub and their materials in a synced cloud folder,
connect both to irori, and start working. Do the connecting for them.

1. Run \`irori list\`: the hibachis already here, the workspace this request
   came from, and where new hibachis go.
2. Ask once, together, only for what you cannot find out:
   - the GitHub repositories to use (URLs or owner/name);
   - whether they want a new hibachi, and its name;
   - which synced folders (Google Drive for desktop, OneDrive, Dropbox) hold
     materials, and for which hibachi.
   Use the folder \`irori list\` names unless the person names another.
3. Check the tools: \`git --version\`, and \`gh auth status\` when a repository
   is private or a new one goes to GitHub. If \`gh\` is missing or signed out,
   tell the person to install it or run \`gh auth login\`, and go on with what
   works.
4. Follow the add-hibachis skill for existing repositories, new-hibachi for
   new ones and connect-folder for folders. Read each SKILL.md in
   .agents/skills of this folder first.
5. Finish with \`irori list\`, and report each hibachi: its name, folder, GitHub
   repository and connected folders, and anything that failed and why.
`,
  ),
  'add-hibachis': skill(
    'add-hibachis',
    'Turns a list of GitHub repositories into hibachis in this workspace with irori clone. Use when the person gives repositories to work with.',
    `
# Add hibachis from GitHub

For each repository the person gave, one at a time:

1. \`irori clone <URL or owner/name>\`. Add \`--name <name>\` when the person
   named the hibachi, \`--folder <name>\` when the folder should differ from
   the repository's name, and \`--parent <folder>\` only when the person named
   where it goes.
2. A repository already registered joins the workspace instead of being
   cloned again; the command says which happened.
3. If a clone fails, keep its message and go on with the rest. A private
   repository needs \`gh auth status\` to show a signed-in account with access;
   a folder that exists already may be a checkout to register with
   \`irori add <folder>\`.

A repository the person keeps on this computer already: \`irori add <folder>\`.

Do not change files in the new hibachis in this request; they are handed to
you, with their hibachi agents, from the next request. Report what was added
and suggest a next step, such as reading each hibachi's AGENTS.md.
`,
  ),
  'new-hibachi': skill(
    'new-hibachi',
    'Starts a new hibachi with irori create, and puts it on GitHub when the person wants. Use when the person wants a knowledge base that does not exist yet.',
    `
# Start a new hibachi

Ask for its name and whether it should be on GitHub (private unless the
person says public), and whose account or organization owns it.

1. \`irori create <folder name> --name <hibachi name>\`. It makes the folder a
   Git repository on main with a first commit.
2. On GitHub too, when the person wants it:
   \`gh repo create <owner>/<name> --private --source <folder> --remote origin --push\`

Report the hibachi's folder and its GitHub repository, if any.
`,
  ),
  'write-routine': skill(
    'write-routine',
    "Writes a routine: a job in routine.yaml that runs programs and instructs agents in order when the person presses 実行 (Run) on irori's routines page. Use when the person wants something gathered or done again and again, such as mail or chat brought into hibachis.",
    `
# Write a routine

A routine is a folder holding \`routine.yaml\` and the files its steps use.
Only the person starts it, with 実行 on the routines page; nothing runs on a
schedule.

1. Find out what it gathers or does, from where, and which hibachis it
   concerns. Ask once, together, only for what you cannot find out.
2. Choose the folder. By default it is \`routines/<name>/\` in your own folder:
   its agent steps are \`agent: irori\`, with the hibachis to hand over in
   \`hibachis\`. A routine that concerns one hibachi alone may live in that
   hibachi's \`.irori/routines/<name>/\` with \`agent: hibachi\`; hand writing
   it to that hibachi's sub-agent.
3. Write \`routine.yaml\`. Keys are read strictly: an unknown or misspelt key
   makes the routine invalid.

   \`\`\`yaml
   name: Mail triage
   steps:
     - run: fetch.js # a file in the routine folder
     - run: [gh, api, notifications] # a command on PATH and its arguments
       secrets: [GH_TOKEN] # given to this step only, as environment variables
     - agent: irori
       hibachis: all # or a list of hibachi names
       access: default # or full-access; required
       prompt: |
         Read the mail in $IRORI_WORK/inbox and put each one into
         contents/mail of the hibachi it concerns. List any you cannot place.
   \`\`\`

   Each step has \`run\` or \`agent\`, never both; an agent step may also name
   \`cli\` and \`model\`. Up to 20 steps; the folder holds at most 100 files,
   5 MiB in all, and no links.
4. Programs. \`.js\`, \`.mjs\` and \`.cjs\` run with irori's own Node; prefer
   them, since nothing needs installing. Any other file needs a \`#!\` line and
   the executable bit; Python is not available yet. Every step gets
   \`IRORI_WORK\` (this run's folder, shared by its steps), \`IRORI_STATE\`
   (kept between runs, for a cursor) and \`IRORI_ROUTINE\` (the routine's
   folder). A program that finds nothing to do prints \`{"continue": false}\`
   as its last line, and later steps do not run.
5. Tokens. Never write a token or password into a file. Name it in the step's
   \`secrets\` (capitals, digits and \`_\`) and read it from the environment;
   the person enters its value in irori. Agent steps never receive secrets.
6. Agent prompts say what to read from \`$IRORI_WORK\` and where results go.
   irori adds its own preamble to each step.
7. Run \`irori routines\` and fix the routine until it reports ready, or names
   only what the person adds on this device (JavaScript, a secret, a command).
   You may try a program step yourself with \`IRORI_WORK\` set to a scratch
   folder; do not start the agent steps.
8. Tell the person the routine's name, what each step does, any secret to
   enter, and to press 実行 on the routines page. The first run shows its
   files for them to review.
`,
  ),
  'connect-folder': skill(
    'connect-folder',
    "Connects a folder on this computer, such as one Google Drive for desktop, OneDrive or Dropbox syncs, into a hibachi's contents with irori connect. Use when the person's materials live in a cloud folder.",
    `
# Connect a cloud folder

irori reaches cloud storage through the provider's own sync app: the folder
is on this computer, and \`irori connect\` shows it in a hibachi's contents.

1. Find the folder. Google Drive for desktop keeps My Drive under
   ~/Library/CloudStorage/GoogleDrive-<account>/ on macOS and on a drive
   letter such as G:\\My Drive on Windows; OneDrive and Dropbox keep a folder
   in the home folder. List the candidates, and ask the person when more than
   one fits. If none exists, the sync app is not installed or not signed in:
   say so.
2. \`irori connect <hibachi> <folder>\`, with \`--name <name>\` for how it
   appears in contents and \`--read-only\` when the person only reads the
   materials there.
3. Report where it appears (contents/<name>). Searches skip the link it
   appears through: name that path or use \`rg -L\`. Google Docs and Sheets
   are .gdoc and .gsheet links whose content agents cannot read.
`,
  ),
};
