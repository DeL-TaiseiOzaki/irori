# irori agent (formerly "your AI")

Names, as the owner set them on 2026-09-27. They apply to user-visible copy and
to the text irori writes for agents; code identifiers (`brain`, `you`,
`YourAiPanel`, `your-ai.json`, IPC names) are unchanged.

| Name | Formerly | What it is |
| --- | --- | --- |
| **vault** (plural vaults) | brain / Brain | One knowledge base in a workspace. |
| **vault agent** | Brain の AI, then Vault Agent | The AI of one vault, started inside it with its Schema. |
| **irori agent** | your AI / あなたの AI | The person's own agent, run from its own folder, working across the vaults. |
| **irori mode** | Overview / 全体 | The workspace-wide level: the map, the columns and the irori agent. |

"irori" alone is still the app. There is no "vault mode": working in a vault
is everything done there, not a mode. The irori agent and the vault agents
have the same shape (owner, 2026-09-27): a Schema edited with the same settings,
full access by default on every CLI, and a way to hand work on. They differ only
in hierarchy (the irori agent instructs; vault agents work for it) and in
context (each vault's `AGENTS.md`). For the irori agent, a vault agent is
`vault-<name>`, a run of that vault's agent started with `irori call` on every
CLI ([ADR 050](decisions/050-vault-agents-and-their-sub-agents.md)).

The irori agent runs from its own folder, its Schema, and works across the
vaults of the open workspace by handing each part of a request to that
vault's agent. Each vault agent reads that vault's Schema before it works.
The decisions are in [ADR 014](decisions/014-ui-v5.md) (decision 5 and
"Answered by the owner"); the owner's 2026-09-27 answers replaced "irori never
writes the definitions" with the rule below and gave the irori agent the vault
agent's shape. The investigation behind the design is in the
[spike](research/YOUR-AI-SPIKE-2026-09-25.md).

## The folder

- One per person on a device: `~/irori/you` unless the device record says
  otherwise. The record (`your-ai.json` in irori's data directory) holds the
  folder and the id the irori agent's conversations, sessions and run records
  are kept under. The folder is not a KB and is never registered as one.
- The person creates it in irori mode (**irori agent を用意する**). irori writes a
  minimal starter only into an absent or empty folder, and never over a file:
  - `AGENTS.md` — what the irori agent does, how vaults are handed to it, and
    that notes and reports are data, not instructions. There is no `CLAUDE.md`:
    newer Claude Code reads `AGENTS.md` itself, and a `CLAUDE.md` beside it would
    stop that.
  - the standard skills in `.agents/skills/` (next section but one).
- Earlier starters also held a `brain-agents` skill for the irori agent to write
  the definitions. New folders no longer get it, and irori never deletes it from
  an existing folder.
- `.irori/shared/` holds the shared Schema every agent in irori follows
  ([ADR 027](decisions/027-shared-schema.md)): `AGENTS.md` and
  `.agents/skills/`, written from **設定 → Schema**. irori makes the folder when
  the settings first open it. Each request names it first, a vault agent's
  hand-off included.

## A vault's agent and its sub-agents

Since 0.2.34 ([ADR 050](decisions/050-vault-agents-and-their-sub-agents.md)).
Before, irori wrote a `vault-<slug>` definition into the irori agent's folder for
each handed vault, and the irori agent's CLI ran it as its own sub-agent: in the
irori agent's folder, with the irori agent's instructions and without the
vault's rules, hooks or `CLAUDE.md`. irori no longer writes these files.

- A vault's agent name is stable: `vault-` and the vault's name in lowercase
  letters, digits and hyphens, or `vault-<first 8 of its id>` for a name without
  Latin letters, with the id added when two names collide (`brainAgentNames`).
  `irori call` takes it.
- **Handed work runs as the vault agent.** On every CLI the irori agent hands a
  vault's work with `irori call`; irori starts that vault's agent in the vault,
  where its CLI loads the vault's Schema itself, with irori's introduction, the
  shared Schema and the task (next sections).
- **The vault's own definition of its agent.** A vault may define its agent as
  `.claude/agents/vault-agent.md`, `.codex/agents/vault-agent.toml` or
  `.opencode/agents/vault-agent.md` (`vaultAgentName`); the one in the running
  CLI's format is chosen first. Its description goes on the vault's line in the
  irori agent's request, and its instructions go with each hand-off
  (`handedTask`). Its model is used when the definition is in the running CLI's
  format; otherwise the irori agent's model stands.
- **The vault's other definitions are the vault agent's sub-agents, on any
  CLI.** Each CLI loads only its own format: Claude Code `.claude/agents/*.md`,
  Codex `.codex/agents/*.toml`, OpenCode `.opencode/agents/*.md`. irori reads
  all three (`readAgentDefinitions`) and gives a CLI the ones in other formats
  (`foreignDefinitions`), without writing into the vault:

| CLI | How irori gives it the other formats |
| --- | --- |
| Claude Code | the Agent SDK's `agents` option (description and prompt) |
| Codex | roles in the thread's configuration, `agents.<name>.description` and `agents.<name>.config_file`, the file in `<irori data>/codex-agents/<run>/` holding `developer_instructions`, removed when the run ends |
| OpenCode | `agent.<name>` (`description`, `prompt`, `mode: subagent`) in `OPENCODE_CONFIG_CONTENT` |
| Pi, Hermes Agent, Antigravity CLI | none: irori gives them no sub-agents |

- A name the CLI has in its own format wins; among the others the first in the
  order Claude Code, Codex, OpenCode. A translated definition carries its
  description and instructions, not its model or tools. `vault-agent` is never
  one of the vault agent's own sub-agents: Claude Code is refused
  `Agent(vault-agent)`. A definition that does not parse is named in the run's
  log.
- The irori agent's folder works the same way for the irori agent's own
  sub-agents, apart from the `vault-*` definitions earlier versions wrote there:
  they are not given to another CLI, and Claude Code is refused them.

## A request

- The irori agent runs on the CLI chosen in its column (Claude Code unless the
  person chose another), with the model chosen for that CLI. Both are kept on
  the device (`yourAi` in the device settings).
- It starts in **full access** wherever the CLI offers it, on every CLI
  including Claude Code (`defaultAgentAccess`, as for a vault agent). Each
  column has the same access pill as a vault agent's composer; a choice holds
  for the chosen CLI until the CLI changes, like the composer's. Pi offers only
  its own settings. The owner accepts that the irori agent may read any vault.
- irori mode sends each request with the workspace's vaults, busy or not
  ([ADR 020](decisions/020-parallel-conversations.md)). The host resolves their
  folders and puts a preamble before the request (`brainsCommandPreamble`): each
  vault with its folder, its vault agent name, its own definition's description,
  its layers, connected folders, work folder and comment count, then how to
  hand it work with `irori call` and not with the CLI's own sub-agents. On
  Claude Code the folders are also `additionalDirectories`, for reading.
- Claude Code in full access runs in `bypassPermissions`. The write hook still
  decides every write there: the Agent SDK evaluates hooks before the permission
  mode, and "a hook deny applies even in `bypassPermissions` mode"
  ([Agent SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions)).
- Codex and OpenCode have no irori write hook: the preamble tells the irori
  agent not to change a vault's files itself, but nothing enforces it.
- While the irori agent's run lasts, every vault handed to it is busy, as if
  its own vault agent were running: Git operations and vault settings wait.
  The person's own conversations in that vault run beside it (ADR 020).

## `irori call`

- An irori agent run with vaults handed to it, on any CLI, hands work over with `irori call` on the `irori` command (next section): the same
  loopback bridge, launcher and URL in `IRORI_COMMAND`. Until ADR 033 this was a
  separate `hibachi` command; a separate `vault` command would have shadowed
  HashiCorp Vault's CLI on the run's `PATH`.
- Usage: `irori call <vault agent or vault name> "<task>"`, or the task on
  standard input (the client reads it when only the name is given). A name is
  a handed vault's sub-agent name (`vault-<slug>`) or its name when only one
  handed vault has it (`vaultOf`). The client waits without a deadline,
  prints the vault agent's report and exits 0; on failure it prints
  `irori: <reason>` and exits non-zero. The agent service answers `call`
  itself (`AgentService.call`); a vault agent's `irori call` is refused with
  the reason (`callRefused`). Claude Code ends a shell command after two
  minutes by default, so the irori agent's Claude Code runs with
  `BASH_DEFAULT_TIMEOUT_MS` and `BASH_MAX_TIMEOUT_MS` set to a day.
- The host starts a run in that vault (`AgentService.handOff`) on the irori
  agent's CLI, in the irori agent's access mode, with the model of the vault's
  own definition when it is in that CLI's format and the irori agent's model
  otherwise. The task follows a line asking for a short report and the vault's
  own definition, when it has one. Its permission requests and questions also
  show with the irori agent, labelled with the vault, and an answer in either
  place reaches it. The vault is held by the irori agent's run; that
  run, and only it, may start hand-offs there. One hand-off at a time per
  irori-agent run and vault; a second is refused until the first reports.
  Stopping the hand-off stops only it. The run is an ordinary
  run of that vault, in a conversation of the vault's own for this irori
  agent conversation (`handedBy`, [CONVERSATIONS](CONVERSATIONS.md)): the first
  hand-off makes it, titled with the task, and later hand-offs from the same
  irori agent conversation continue it and its native session. The person's own
  conversations with that vault are not touched. A vault with queued
  instructions refuses the hand-off.
- The hand-off's text events are its report. The irori agent's log gets
  `delegate` events like Claude Code's: started (the task's first line), working
  (the vault agent's tool steps), and reported or failed.
- Stopping the irori agent's run stops its hand-offs, and so does the command's
  process going away. When the irori agent's run ends, any hand-off still
  running is stopped.

## The `irori` command and the standard skills

Added 2026-10-05 ([ADR 025](decisions/025-irori-agent-setup.md)): the irori
agent sets up the person's vaults.

- Every irori agent run, on every CLI, has an `irori` command on its PATH,
  served by `src/agents/irori-bridge.ts` over
  `command-bridge.ts` ( the URL in `IRORI_COMMAND`; files in
  `<irori data>/agents/irori/`). The request says so first
  (`iroriCommandPreamble`, after the handed vaults).
- `irori list`, `irori clone <GitHub URL or owner/name>`, `irori create
  <folder>`, `irori add <folder>`, `irori connect <vault> <folder>`, with
  `--parent`, `--folder`, `--name`, `--category` and `--read-only` where they
  apply (`parseIroriCommand`, `irori help`). The host carries them out in
  `AgentSetup` (`src/host/agent-setup.ts`).
- Since 0.1.91 ([ADR 030](decisions/030-moving-in-with-the-irori-agent.md)) also
  what the person does in a vault's settings and the start screen:
  `irori disconnect <vault> <name>`, `irori set <vault>` (`--name`,
  `--category`, `--knowledge-label`, `--contents-label`), `irori layer <vault>
  knowledge|contents <folder> [--also]`, `irori workspace <name> [<vault>...]
  [--leave]` and `irori remove <vault> [--trash]`. `irori list` also shows each
  vault's category, layer folders and connected folders, and the workspaces.
- Since 0.2.24 ([ADR 046](decisions/046-github-repositories-in-contents.md))
  `irori connect <vault> <GitHub URL> --into <folder>` (or `--existing
  <clone>`, with `--branch` and `--editable`) shows a GitHub repository in
  contents, cloning it for a record this device has not cloned yet.
- Since 0.1.95 ([ADR 031](decisions/031-agents-use-what-irori-does.md)) the
  note forms `irori move <note> <path or folder>`, `irori trash <note>`,
  `irori comment <file> <text> [--quote] [--line]`, `irori resolve <file> <id>`
  and `irori index [<vault>]`, and `--color`/`--icon` on `set`. Every vault
  agent run also has the command (`vaultCommandPreamble`), limited to its own
  vault (`SetupContext.vault`): `clone`, `create`, `add`, `workspace`,
  `remove` and `run` are refused, another vault is refused by name or path,
  and its own changes go ahead during its own run. Comments it leaves are signed
  `<CLI> (vault agent)` or `<CLI> (irori agent)`.
- A vault is registered on this device and added to the workspace the
  request came from (`StartRun.workspace`); a folder is linked into a vault's
  first contents folder. A repository or folder already registered just joins
  the workspace. New vaults go beside the irori agent's folder unless
  `--parent` names another. No form deletes a file: `remove --trash` moves the
  folder to the system trash, as the settings' removal does.
- Clones, new vaults and their first commit go ahead while runs are in
  progress, since their folders are new. `connect`, `disconnect`, `set`,
  `layer` and `remove` wait only for the vault's own agent, not for the
  irori agent's hold on it, and refuse while a Git operation, connection setup
  or (for `remove`) a routine is in progress.
- The window refreshes its vaults and takes in the saved workspace when the
  host announces a registration (`vaults` event).
- Standard skills (`prompts/irori-agent-skills.ts`): `irori-guide` (what irori
  can do and who does each part), `irori-setup`, `move-to-irori` (moving in
  from another tool by asking first), `add-vaults`, `new-vault`,
  `connect-folder` and `write-routine`. Written with the starter;
  for a folder set up earlier, the + beside Schema on the irori agent's screen
  (**標準スキルを追加**, shown only while one is missing) writes the missing
  ones. A present skill folder is never replaced.

## Boundaries irori keeps

- **Writes (Claude Code).** A `PreToolUse` hook decides each `Write`, `Edit`,
  `MultiEdit` and `NotebookEdit` (`src/agents/delegation.ts`): the irori agent
  and any sub-agent of its own write only in its own folder and the vaults' work
  folders. A refused write in a vault says to hand the work with `irori call`.
  `Bash` is not bounded by path. Claude Code asks the person for it as usual.
- **Attribution.** Each hand-off becomes events of the irori agent's run that
  carry `delegate` (vault, hand-off and state): its start, the vault agent's
  steps and requests, and its report. The vault agent's own words stay with its
  hand-off; the reply shown is the irori agent's.
- **Request ends.** The host sends an event naming a request when it is
  answered, declined or cancelled. Every view stops offering it then, and not
  merely because some later event of the run arrived. Sub-agents of other vaults
  keep working meanwhile, and a tool call's message can arrive after the request
  it raised.

## Where it shows

- **irori mode, beside the map:** **irori agent** (the default) or **vault
  agent**. The irori agent shows in up to four columns, each a thread with its
  own tabs, 履歴 and composer, kept per workspace
  ([ADR 034](decisions/034-irori-mode-threads.md)). Its log shows each run's hand-offs as a task list
  (vault, what it was asked, working / needs approval / done), each vault's
  report, and the vault agents' requests labelled with their vault.
- **Map:** the irori agent's orb at the hearth. A line runs to each vault with
  a hand-off under way from any thread on show or running, with a spark moving along it unless less motion is asked
  for. The vault glows.
- **The irori agent's columns:** the access pill (full access by default) beside
  the model pill, and the CLI select in the header.
- **The irori agent's screen** (the orb, or the mark at the start of an irori
  mode column): its
  Schema as the same settings a vault has ([SKILLS](SKILLS.md#schema-settings)):
  指示 (its root `AGENTS.md` only; the irori agent's folder has no knowledge
  folders, and its `AGENTS.md` cannot be deleted, since it marks the folder as
  set up), スキル (`.agents/skills`, listed as the host lists a vault's
  skills), ルール and フック, with the same forms, add and delete. The settings
  go through the same four `HostAPI` methods with the irori agent's id as the
  scope; they wait while the irori agent runs. The folder icon shows the folder
  as files, read-only. On the right, each vault's agent with its name, the one
  `irori call` takes.

## Verification

- `tests/your-ai.test.ts`: naming (`vault-<slug>`), the write rule, the folder
  record and starter (no `brain-agents` skill, no agents folder, `irori call` in
  its `AGENTS.md`), reading only inside the folder, and the Schema settings
  service on the irori agent's folder: only the root `AGENTS.md` as instructions
  (never deleted), a rule, hooks and a skill written and listed from its
  `.agents/skills`, hash conflicts, a definition file refused as a setting, and
  a linked `.claude/rules` not followed out.
- The same file runs hand-offs through a Claude Code protocol fixture
  (`tests/fixtures/claude-your-ai.mjs`) that plays both sides: as the irori agent
  it runs `irori call` as its Bash tool would, and as the vault agent it writes
  in its vault. It checks that the vaults are held, that the vault agent runs in
  its vault with the vault's introduction and the task, in the irori agent's
  mode, the attribution of its steps, its request (forwarded to the irori agent
  and resolved there) and its report, and that the irori agent's own write in a
  vault is refused with `irori call` as the way. In full access both sides run
  in `bypassPermissions` and nothing is asked. With a vault defining its agent
  in Codex's format and sub-agents in Codex's and OpenCode's, the irori agent
  hears the description, the vault agent the instructions (not Codex's model),
  and Claude Code gets the two sub-agents; an earlier irori's `vault-*`
  definition in the irori agent's folder is refused to it.
- It also runs the irori agent through protocol fixtures on Pi and OpenCode: the
  same `irori call` preamble, and no definition written.
- `tests/agent-definitions.test.ts`: the three formats parsed, names, problems,
  `foreignDefinitions`, the vault's own definition and its model, and the Codex
  role files.
- `tests/vault-command.test.ts`: name resolution (vault agent name, name,
  ambiguous, not handed), the command preamble, launcher quoting, and the
  bridge through the real launcher (the test's Node as the runtime): the report
  on stdout, the task on stdin, a refused hand-off's exit status and reason, no
  URL or a forged token refused. Then the irori agent on Pi's fixture runs
  `irori call vault-product "..."` in its shell: the vault's own Pi fixture run
  happens in that vault, is kept in its conversation, and its words come back
  as the command's output and the `reported` event; a vault not handed is
  refused; stopping the irori agent stops a hand-off in progress.
- `scripts/your-ai-ui-smoke.ts`, the Claude fixture in the app: setup, the
  access pill (full access by default; the request part selects the standard
  mode), the screen with each vault's agent, the Schema settings there (the
  instructions form first, a rule and a skill added in the irori agent's folder,
  the folder as files), a hand-off through `irori call` answered in irori mode
  with the settings locked meanwhile, the report, the map's line, the held
  vault's panel, and the irori agent's own write refused. Then on Pi a hand-off
  through `irori call`, run by the app's own Electron as Node: its task in the
  irori agent's list as done, and the run in Product's conversation.
- `npm run test:your-ai` (`scripts/your-ai-acceptance.ts`) runs real CLIs
  (`IRORI_ACCEPT_CLIS`, Claude Code and Codex by default) through irori's
  AgentService. It uses the person's allowance. The irori agent hands two vaults
  their tasks with `irori call`; it checks that Alpha's agent follows Alpha's
  `AGENTS.md`, that Beta's agent follows Beta's own `vault-agent` definition
  (written in Codex's format) and uses a sub-agent defined in the other CLI's
  format, and that nothing is written into the irori agent's folder.
- `tests/irori-command.test.ts`: the command's forms and refusals; the
  standard skills as valid packages, written with the starter, added when
  missing without replacing an edited one, and not through a linked folder;
  `clone` (through a local remote standing in for GitHub), `create` and `add`
  registering vaults into the request's workspace while Git refuses other
  work, a repeated clone or add only joining, a taken folder refused; `connect`
  linking a folder and waiting for the vault's own run; the launcher passing
  its arguments and folder; and the irori agent on Pi's protocol fixture running
  `irori add` into its workspace.
- `scripts/your-ai-ui-smoke.ts` also checks the standard skills in a new folder,
  the + offering a deleted one again while an edited one is kept, and an irori
  agent request on Pi running `irori add`, after which the rail and the map show
  the new vault in the workspace.

## Limits

- Claude Code refuses `bypassPermissions` as root outside a recognised sandbox;
  the irori agent then needs the standard mode, as a vault agent does.
- A hand-off through `irori call` resumes the vault agent's saved session for
  that CLI, and is refused while that vault has queued instructions of its own.
- **Long hand-offs on other CLIs.** Claude Code's shell timeout is raised for the
  irori agent. Whether OpenCode's, Pi's or Hermes Agent's shell tool ends a long
  `irori call` is unverified.
- **No enforced write boundary outside Claude Code.** On Codex, OpenCode, Pi and
  Hermes Agent the vaults' boundaries are instructions in the preamble, not a
  hook: in full access the CLI can write anywhere its own rules allow. Since
  ADR 020 the busy hold no longer keeps other runs out of a handed vault; it
  holds only irori's own changes there.
- On those CLIs the person-lines notice reaches Pi and OpenCode only for a
  vault's file named by its absolute path; Codex and Hermes Agent have no hook.
- `vault-*` definitions an earlier irori wrote into the irori agent's folder stay
  there. Claude Code is refused them; Codex and OpenCode still load them from
  that folder, and only the preamble tells the irori agent not to use them.
- A sub-agent definition translated for another CLI loses its model and tool
  limits; only its description and instructions carry over.
- OpenCode's agents through `OPENCODE_CONFIG_CONTENT` are taken from OpenCode's
  configuration documentation and a protocol fixture; no real OpenCode ran.
- Every vault of the workspace is held for the whole run. Holding only the
  vaults a hand-off reaches is later work.
