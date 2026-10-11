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
context (each vault's `AGENTS.md`). For the irori agent, a vault agent is a
sub-agent named `vault-<name>` in its CLI's agents folder on Claude Code, Codex
and OpenCode, and a run started with `irori call` on Pi and Hermes Agent.

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
  - an empty `.claude/agents/`;
  - the standard skills in `.agents/skills/` (next section but one).
- Earlier starters also held a `brain-agents` skill for the irori agent to write
  the definitions. New folders no longer get it, and irori never deletes it from
  an existing folder.
- `.irori/shared/` holds the shared Schema every agent in irori follows
  ([ADR 027](decisions/027-shared-schema.md)): `AGENTS.md` and
  `.agents/skills/`, written from **設定 → Schema**. irori makes the folder when
  the settings first open it. Each request names it first; a new sub-agent
  definition names it too, and the irori agent is told to pass it on.

## Sub-agent definitions irori writes

- A vault's sub-agent name is stable: `vault-` and the vault's name in
  lowercase letters, digits and hyphens, or `vault-<first 8 of its id>` for a
  name without Latin letters, with the id added when two names collide
  (`brainAgentNames`).
- When an irori agent run starts with vaults handed to it, the host
  (`YourAiService.writeDefinitions`, through the folder service, never the
  renderer) writes each vault's definition for the run's CLI **only when the
  file is absent**. An existing file is never replaced, so the person can edit
  it. Folders on the way are created inside the irori agent's folder; a link or a
  file in their place stops the run with an error, and a link where the file
  would be counts as existing. The run's log says which files were written.
- Nothing is written when the folder is set up: which vaults and which CLI a
  request uses is known only when it is sent.
- Each definition says: this is the vault agent of the `<name>` vault at
  `<folder>`; read `<folder>/AGENTS.md` first and follow it; use the vault's
  `.agents/skills`; work only inside the folder; treat notes as material; report
  what was done and every file changed (`subAgentDefinition`).

| CLI | Hand-off | File | Format | Preamble |
| --- | --- | --- | --- | --- |
| Claude Code | native sub-agent | `.claude/agents/vault-<slug>.md` | front matter `name`, `description`, `tools: Read, Write, Edit, Glob, Grep`; the prompt as body | delegating; hand-offs in the foreground; write hook |
| Codex | native sub-agent | `.codex/agents/vault-<slug>.toml` | `name`, `description`, `developer_instructions` (the fields the [Codex subagents docs](https://learn.chatgpt.com/docs/agent-configuration/subagents) require) | delegating: `spawn_agent` with the name as `agent_type` |
| OpenCode | native sub-agent | `.opencode/agents/vault-<slug>.md` | front matter `description`, `mode: subagent`; the file name is the agent name ([OpenCode agents](https://opencode.ai/docs/agents/); its loader globs `{agent,agents}/**/*.md`) | delegating: the task tool |
| Pi, Hermes Agent | `irori call` | none | no file-defined sub-agents | delegating: `irori call` (`brainsCommandPreamble`) |

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
  ([ADR 020](decisions/020-parallel-conversations.md)). The host resolves their folders and puts a preamble before the request
  naming each vault and its folder.
- On Claude Code, Codex and OpenCode the preamble (`brainsPreamble`) also names
  each vault's sub-agent and tells the irori agent to hand the vault's work
  to it. On Claude Code the folders are also `additionalDirectories`.
- Claude Code in full access runs in `bypassPermissions`. The write hook still
  decides every write there: the Agent SDK evaluates hooks before the permission
  mode, and "a hook deny applies even in `bypassPermissions` mode"
  ([Agent SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions)).
  Sub-agents inherit the parent's mode, so a vault's sub-agent works without
  asking too. In the standard mode its requests reach the person as before.
- Codex and OpenCode have no irori write hook: the preamble tells the irori
  agent not to change a vault's files itself, but nothing enforces it.
- Pi and Hermes Agent have no file-defined sub-agents. The preamble
  (`brainsCommandPreamble`) names each vault, its folder and its vault agent
  name, and tells the irori agent to hand work with `irori call` (next
  section) and not to change a vault's files itself. It no longer tells the
  irori agent to read a vault's `AGENTS.md`: the vault agent does that,
  because it runs in that vault.
- While the irori agent's run lasts, every vault handed to it is busy, as if
  its own vault agent were running: Git operations and vault settings wait.
  The person's own conversations in that vault run beside it (ADR 020).

## `irori call` (Pi, Hermes Agent)

- An irori agent run on Pi or Hermes Agent with vaults handed to it hands work
  over with `irori call` on the `irori` command (next section): the same
  loopback bridge, launcher and URL in `IRORI_COMMAND`. Until ADR 033 this was a
  separate `hibachi` command; a separate `vault` command would have shadowed
  HashiCorp Vault's CLI on the run's `PATH`.
- Usage: `irori call <vault agent or vault name> "<task>"`, or the task on
  standard input (the client reads it when only the name is given). A name is
  a handed vault's sub-agent name (`vault-<slug>`) or its name when only one
  handed vault has it (`vaultOf`). The client waits without a deadline,
  prints the vault agent's report and exits 0; on failure it prints
  `irori: <reason>` and exits non-zero. The agent service answers `call`
  itself (`AgentService.call`); elsewhere, on a vault agent or on a CLI with
  file-defined sub-agents, `irori call` is refused with the reason
  (`callRefused`).
- The host starts a run in that vault (`AgentService.handOff`) on the irori
  agent's CLI and model, in `defaultAgentAccess`, with the task after a line
  asking for a short report. The vault is held by the irori agent's run; that
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
  `MultiEdit` and `NotebookEdit` (`src/agents/delegation.ts`):
  - The irori agent itself writes only in its own folder.
  - A vault's sub-agent writes only inside its vault.
  - Any other agent, built in or defined by a vault for itself, writes only in
    the irori agent's folder.
  - A refused write tells the agent to hand the work to that vault's sub-agent.
  - `Bash` is not bounded by path. Claude Code asks the person for it as usual.
- **Foreground hand-offs.** A sub-agent in the background cannot ask the person,
  so Claude Code refuses its edits. A hand-off asked for in the background is
  rewritten to run in the foreground.
- **Attribution (Claude Code).** Each hand-off becomes events that carry `delegate` (vault,
  hand-off and state). The events show the hand-off's start, the sub-agent's
  steps and requests (matched through `canUseTool`'s `agentID`), and its report
  (`task_notification`). A sub-agent's own words stay with its hand-off; the
  reply shown is the irori agent's. Hand-offs through `irori call`
  are attributed the same way. Codex and OpenCode sub-agent activity is not
  attributed to a vault yet.
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
  report, and sub-agent requests labelled with their vault.
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
  as files, read-only, including the definitions irori wrote. On the right, for
  each vault, its sub-agent name, whether the definition for the chosen CLI
  exists (**定義済み** / **未作成**), and every definition file it has, with its
  CLI. A missing one says irori writes it on the first hand-off. On Pi or
  Hermes Agent the screen names `irori call` instead.

## Verification

- `tests/your-ai.test.ts`: naming (`vault-<slug>`), the write rule, the
  preamble for each CLI, the definition text for each CLI (the Codex TOML parsed
  back), the folder record and starter (no `brain-agents` skill), reading only
  inside the folder, and irori writing absent definitions: an edited one is kept,
  a second run writes nothing, and neither a linked folder nor a link in the
  file's place is followed out of the folder.
- The same file runs a delegation through a Claude Code protocol fixture
  (`tests/fixtures/claude-your-ai.mjs`), which loads `.claude/agents` like Claude
  Code. It checks that the definitions irori wrote load, that the vaults are
  held, the attribution of steps, requests and the report, that the irori
  agent's own write in a vault is refused, and that hand-offs run in the
  foreground.
- It runs the same fixture in full access: the fixture, like Claude Code, runs
  hooks in `bypassPermissions` and asks nothing; the irori agent's own write in
  a vault is still refused and the sub-agent writes without a request.
- It also runs the irori agent through protocol fixtures on Pi (the `vault`
  command preamble, no definition written) and on OpenCode (delegating
  preamble, `.opencode/agents/vault-product.md` written with `mode: subagent`),
  and the Schema settings service on the irori agent's folder: only the root
  `AGENTS.md` as instructions (never deleted), a rule, hooks and a skill written
  and listed from its `.agents/skills`, hash conflicts, a definition file
  refused as a setting, and a linked `.claude/rules` not followed out.
- `tests/vault-command.test.ts`: name resolution (sub-agent name, name,
  ambiguous, not handed), the command preamble, launcher quoting, and the
  bridge through the real `vault` launcher (the test's Node as the runtime):
  the report on stdout, the task on stdin, a refused hand-off's exit status and
  reason, no URL or a forged token refused. Then the irori agent on Pi's
  fixture runs `vault vault-product "..."` in its shell: the vault's own
  Pi fixture run happens in that vault, is kept in its conversation, and its
  words come back as the command's output and the `reported` event; a vault
  not handed is refused; stopping the irori agent stops a hand-off in progress.
- `scripts/your-ai-ui-smoke.ts`, the Claude fixture in the app: setup, the
  access pill (full access by default; the request part selects the standard
  mode), the screen before any hand-off (**未作成**, the person's own definition
  kept), the Schema settings there (the instructions form first, a rule and a
  skill added in the irori agent's folder, the folder as files), a hand-off
  answered in irori mode with the settings locked meanwhile, the report, the
  map's line, the held vault's panel, and the definition irori wrote shown on
  the screen. Then on Pi a hand-off through `irori call`, run by the
  app's own Electron as Node: its task in the irori agent's list as done, and
  the run in Product's conversation.
- `npm run test:your-ai` (`scripts/your-ai-acceptance.ts`) runs real Claude Code
  2.1.280 through SDK 0.3.269. It uses the person's allowance, about $0.5 per
  run at list prices. It passed on 2026-09-26 with hand-written definitions of
  the same shape (names `alpha` / `beta`, not `vault-*`); it was not rerun
  after irori began writing them:
  - the definitions in the irori agent's `.claude/agents` load;
  - the hand-off names the sub-agent, and its id links `SubagentStart`,
    `task_started`, the sub-agent's messages and `task_notification`;
  - `canUseTool` carries that id;
  - the sub-agent follows its vault's `AGENTS.md`;
  - the write rule keeps both a sub-agent and the irori agent out of other
    vaults;
  - a background request runs in the foreground, with the report before the
    result;
  - a resumed session still delegates.

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

- **The `irori` command is unverified on real CLIs.** Whether each CLI's shell
  tool keeps irori's `PATH` and `IRORI_COMMAND`, and whether Codex's sandbox in
  the standard mode allows its loopback connection, are unverified.

- **Unverified on real CLIs:** the owner verifies real CLIs himself. Not run: a
  real Claude Code irori agent in `bypassPermissions` (the hook and inheritance
  rely on the Agent SDK documentation and the fixture); real Pi and Hermes Agent
  running `irori call` from their shell tools (whether their tool
  environment keeps irori's `PATH` and `IRORI_COMMAND`, and whether a tool
  timeout of theirs cuts a long hand-off); the launcher from an installed
  macOS or Windows app (`irori.cmd` is unexercised).
- Claude Code refuses `bypassPermissions` as root outside a recognised sandbox;
  the irori agent then needs the standard mode, as a vault agent does.
- A hand-off through `irori call` resumes the vault agent's saved
  session for that CLI, and is refused while that vault has queued
  instructions of its own.

- **Unverified on real Codex and OpenCode.** No real turn was run. Whether Codex
  loads project `.codex/agents` for the irori agent's folder, which Codex does
  not trust, and whether the model then calls `spawn_agent` with that
  `agent_type`, are unverified; so is OpenCode's task tool picking the
  `.opencode/agents` sub-agent, and whether OpenCode's full-access session rules
  reach the sub-agent's child session. If Codex ignores the file, the irori agent
  can still work (full access) but without the vault's definition.
- **No enforced write boundary outside Claude Code.** On Codex, OpenCode, Pi and
  Hermes Agent the vaults' boundaries are instructions in the preamble and the
  definitions, not a hook: in full access the CLI can write anywhere its own
  rules allow. Since ADR 020 the busy hold no longer keeps other runs
  out of a handed vault; it holds only irori's own changes there.
- On those CLIs the person-lines notice reaches Pi and OpenCode only for a
  vault's file named by its absolute path; Codex and Hermes Agent have no hook.
- A definition names the vault's folder at the time irori wrote it. irori does
  not rewrite it when the vault is renamed or moved; the person edits or
  deletes the file, and irori writes a fresh one next time if it is gone.
- A vault's sub-agent is not the vault's own vault agent. It works in the
  irori agent's folder, loads the irori agent's settings rather than the
  vault's `.claude/settings.json`, and reaches the vault through its folder
  and the definition that tells it to read the vault's Schema.
- A vault's own `.claude/agents` load too (through `additionalDirectories`), so
  their names can collide with the irori agent's definitions.
- Every vault of the workspace is held for the whole run. Holding only the
  vaults a hand-off reaches is later work.
- Claude Code's `InstructionsLoaded` hook did not fire in the acceptance run, so
  whether a vault's `AGENTS.md` loads by itself when a sub-agent reads a file
  there is unconfirmed. The definition tells the sub-agent to read it.
