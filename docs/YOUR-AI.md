# irori agent (formerly "your AI")

Names, as the owner set them on 2026-09-27. They apply to user-visible copy and
to the text irori writes for agents; code identifiers (`brain`, `you`,
`YourAiPanel`, `your-ai.json`, IPC names) are unchanged.

| Name | Formerly | What it is |
| --- | --- | --- |
| **hibachi** (plural hibachis) | brain / Brain | One knowledge base in a workspace. |
| **hibachi agent** | Brain の AI, then Hibachi Agent | The AI of one hibachi, started inside it with its Schema. |
| **irori agent** | your AI / あなたの AI | The person's own agent, run from its own folder, working across the hibachis. |
| **irori mode** | Overview / 全体 | The workspace-wide level: the map, the columns and the irori agent. |

"irori" alone is still the app. There is no "hibachi mode": working in a hibachi
is everything done there, not a mode. The irori agent and the hibachi agents
have the same shape (owner, 2026-09-27): a Schema edited with the same settings,
full access by default on every CLI, and a way to hand work on. They differ only
in hierarchy (the irori agent instructs; hibachi agents work for it) and in
context (each hibachi's `AGENTS.md`). For the irori agent, a hibachi agent is a
sub-agent named `hibachi-<name>` in its CLI's agents folder on Claude Code, Codex
and OpenCode, and a run started with the `hibachi` command on Pi and Hermes
Agent.

The irori agent runs from its own folder, its Schema, and works across the
hibachis of the open workspace by handing each part of a request to that
hibachi's agent. Each hibachi agent reads that hibachi's Schema before it works.
The decisions are in [ADR 014](decisions/014-ui-v5.md) (decision 5 and
"Answered by the owner"); the owner's 2026-09-27 answers replaced "irori never
writes the definitions" with the rule below and gave the irori agent the hibachi
agent's shape. The investigation behind the design is in the
[spike](research/YOUR-AI-SPIKE-2026-09-25.md).

## The folder

- One per person on a device: `~/irori/you` unless the device record says
  otherwise. The record (`your-ai.json` in irori's data directory) holds the
  folder and the id the irori agent's conversations, sessions and run records
  are kept under. The folder is not a KB and is never registered as one.
- The person creates it in irori mode (**irori agent を用意する**). irori writes a
  minimal starter only into an absent or empty folder, and never over a file:
  - `AGENTS.md` — what the irori agent does, how hibachis are handed to it, and
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

- A hibachi's sub-agent name is stable: `hibachi-` and the hibachi's name in
  lowercase letters, digits and hyphens, or `hibachi-<first 8 of its id>` for a
  name without Latin letters, with the id added when two names collide
  (`brainAgentNames`).
- When an irori agent run starts with hibachis handed to it, the host
  (`YourAiService.writeDefinitions`, through the folder service, never the
  renderer) writes each hibachi's definition for the run's CLI **only when the
  file is absent**. An existing file is never replaced, so the person can edit
  it. Folders on the way are created inside the irori agent's folder; a link or a
  file in their place stops the run with an error, and a link where the file
  would be counts as existing. The run's log says which files were written.
- Nothing is written when the folder is set up: which hibachis and which CLI a
  request uses is known only when it is sent.
- Each definition says: this is the hibachi agent of the `<name>` hibachi at
  `<folder>`; read `<folder>/AGENTS.md` first and follow it; use the hibachi's
  `.agents/skills`; work only inside the folder; treat notes as material; report
  what was done and every file changed (`subAgentDefinition`).

| CLI | Hand-off | File | Format | Preamble |
| --- | --- | --- | --- | --- |
| Claude Code | native sub-agent | `.claude/agents/hibachi-<slug>.md` | front matter `name`, `description`, `tools: Read, Write, Edit, Glob, Grep`; the prompt as body | delegating; hand-offs in the foreground; write hook |
| Codex | native sub-agent | `.codex/agents/hibachi-<slug>.toml` | `name`, `description`, `developer_instructions` (the fields the [Codex subagents docs](https://learn.chatgpt.com/docs/agent-configuration/subagents) require) | delegating: `spawn_agent` with the name as `agent_type` |
| OpenCode | native sub-agent | `.opencode/agents/hibachi-<slug>.md` | front matter `description`, `mode: subagent`; the file name is the agent name ([OpenCode agents](https://opencode.ai/docs/agents/); its loader globs `{agent,agents}/**/*.md`) | delegating: the task tool |
| Pi, Hermes Agent | the `hibachi` command | none | no file-defined sub-agents | delegating: the `hibachi` command (`brainsCommandPreamble`) |

## A request

- The irori agent runs on the CLI chosen in its panel (Claude Code unless the
  person chose another), with the model chosen for that CLI. Both are kept on
  the device (`yourAi` in the device settings).
- It starts in **full access** wherever the CLI offers it, on every CLI
  including Claude Code (`defaultAgentAccess`, as for a hibachi agent). The
  panel has the same access pill as a hibachi agent's composer; a choice holds
  for the chosen CLI until the CLI changes, like the composer's. Pi offers only
  its own settings. The owner accepts that the irori agent may read any hibachi.
- irori mode sends each request with the workspace's hibachis, busy or not
  ([ADR 020](decisions/020-parallel-conversations.md)). The host resolves their folders and puts a preamble before the request
  naming each hibachi and its folder.
- On Claude Code, Codex and OpenCode the preamble (`brainsPreamble`) also names
  each hibachi's sub-agent and tells the irori agent to hand the hibachi's work
  to it. On Claude Code the folders are also `additionalDirectories`.
- Claude Code in full access runs in `bypassPermissions`. The write hook still
  decides every write there: the Agent SDK evaluates hooks before the permission
  mode, and "a hook deny applies even in `bypassPermissions` mode"
  ([Agent SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions)).
  Sub-agents inherit the parent's mode, so a hibachi's sub-agent works without
  asking too. In the standard mode its requests reach the person as before.
- Codex and OpenCode have no irori write hook: the preamble tells the irori
  agent not to change a hibachi's files itself, but nothing enforces it.
- Pi and Hermes Agent have no file-defined sub-agents. The preamble
  (`brainsCommandPreamble`) names each hibachi, its folder and its hibachi agent
  name, and tells the irori agent to hand work with the `hibachi` command (next
  section) and not to change a hibachi's files itself. It no longer tells the
  irori agent to read a hibachi's `AGENTS.md`: the hibachi agent does that,
  because it runs in that hibachi.
- While the irori agent's run lasts, every hibachi handed to it is busy, as if
  its own hibachi agent were running: Git operations and hibachi settings wait.
  The person's own conversations in that hibachi run beside it (ADR 020).

## The `hibachi` command (Pi, Hermes Agent)

- For an irori agent run on Pi or Hermes Agent with hibachis handed to it, the
  host starts a loopback HTTP server with a random token for that run
  (`src/agents/hibachi-bridge.ts`), writes `hibachi` (POSIX `sh`, mode 0700),
  `hibachi.cmd` (Windows) and a small client `client.cjs` into
  `<irori data>/agents/hibachi/`, never into a KB or the irori agent's folder,
  and puts that `bin` folder first on the run's `PATH`. The URL with the token
  is in `IRORI_HIBACHI`, only in that run's environment.
- The launcher runs irori's own executable as Node (`ELECTRON_RUN_AS_NODE=1` and
  `process.execPath`), so no Node install is assumed.
- Usage: `hibachi <hibachi agent or hibachi name> "<task>"`, or the task on
  standard input. A name is a handed hibachi's sub-agent name
  (`hibachi-<slug>`) or its name when only one handed hibachi has it
  (`hibachiOf`). The client waits without a deadline, prints the hibachi agent's
  report and exits 0; on failure it prints `hibachi: <reason>` and exits
  non-zero. A request with another token gets 404.
- The host starts a run in that hibachi (`AgentService.handOff`) on the irori
  agent's CLI and model, in `defaultAgentAccess`, with the task after a line
  asking for a short report. The hibachi is held by the irori agent's run; that
  run, and only it, may start hand-offs there. One hand-off at a time per
  irori-agent run and hibachi; a second is refused until the first reports.
  Stopping the hand-off stops only it. The run is an ordinary
  run of that hibachi, in a conversation of the hibachi's own for this irori
  agent conversation (`handedBy`, [CONVERSATIONS](CONVERSATIONS.md)): the first
  hand-off makes it, titled with the task, and later hand-offs from the same
  irori agent conversation continue it and its native session. The person's own
  conversations with that hibachi are not touched. A hibachi with queued
  instructions refuses the hand-off.
- The hand-off's text events are its report. The irori agent's log gets
  `delegate` events like Claude Code's: started (the task's first line), working
  (the hibachi agent's tool steps), and reported or failed.
- Stopping the irori agent's run stops its hand-offs, and so does the command's
  process going away. When the irori agent's run ends, any hand-off still
  running is stopped.

## The `irori` command and the standard skills

Added 2026-10-05 ([ADR 025](decisions/025-irori-agent-setup.md)): the irori
agent sets up the person's hibachis.

- Every irori agent run, on every CLI, has an `irori` command on its PATH,
  served like the `hibachi` command (`src/agents/irori-bridge.ts` over
  `command-bridge.ts`; the URL in `IRORI_COMMAND`; files in
  `<irori data>/agents/irori/`). The request says so first
  (`iroriCommandPreamble`, after the handed hibachis).
- `irori list`, `irori clone <GitHub URL or owner/name>`, `irori create
  <folder>`, `irori add <folder>`, `irori connect <hibachi> <folder>`, with
  `--parent`, `--folder`, `--name`, `--category` and `--read-only` where they
  apply (`parseIroriCommand`, `irori help`). The host carries them out in
  `AgentSetup` (`src/host/agent-setup.ts`).
- Only additions: a hibachi registered on this device and added to the
  workspace the request came from (`StartRun.workspace`), or a folder linked
  into a hibachi's first contents folder. A repository or folder already
  registered just joins the workspace. New hibachis go beside the irori agent's
  folder unless `--parent` names another.
- Clones, new hibachis and their first commit go ahead while runs are in
  progress, since their folders are new. `connect` waits only for the
  hibachi's own agent.
- The window refreshes its hibachis and takes in the saved workspace when the
  host announces a registration (`hibachis` event).
- Standard skills (`prompts/irori-agent-skills.ts`): `irori-setup`,
  `add-hibachis`, `new-hibachi`, `connect-folder`. Written with the starter;
  for a folder set up earlier, the + beside Schema on the irori agent's screen
  (**標準スキルを追加**, shown only while one is missing) writes the missing
  ones. A present skill folder is never replaced.

## Boundaries irori keeps

- **Writes (Claude Code).** A `PreToolUse` hook decides each `Write`, `Edit`,
  `MultiEdit` and `NotebookEdit` (`src/agents/delegation.ts`):
  - The irori agent itself writes only in its own folder.
  - A hibachi's sub-agent writes only inside its hibachi.
  - Any other agent, built in or defined by a hibachi for itself, writes only in
    the irori agent's folder.
  - A refused write tells the agent to hand the work to that hibachi's sub-agent.
  - `Bash` is not bounded by path. Claude Code asks the person for it as usual.
- **Foreground hand-offs.** A sub-agent in the background cannot ask the person,
  so Claude Code refuses its edits. A hand-off asked for in the background is
  rewritten to run in the foreground.
- **Attribution (Claude Code).** Each hand-off becomes events that carry `delegate` (hibachi,
  hand-off and state). The events show the hand-off's start, the sub-agent's
  steps and requests (matched through `canUseTool`'s `agentID`), and its report
  (`task_notification`). A sub-agent's own words stay with its hand-off; the
  reply shown is the irori agent's. Hand-offs through the `hibachi` command
  are attributed the same way. Codex and OpenCode sub-agent activity is not
  attributed to a hibachi yet.
- **Request ends.** The host sends an event naming a request when it is
  answered, declined or cancelled. Every view stops offering it then, and not
  merely because some later event of the run arrived. Sub-agents of other hibachis
  keep working meanwhile, and a tool call's message can arrive after the request
  it raised.

## Where it shows

- **irori mode, beside the map:** **irori agent** (the default) or **hibachi
  agent**. The irori agent's log shows each run's hand-offs as a task list
  (hibachi, what it was asked, working / needs approval / done), each hibachi's
  report, and sub-agent requests labelled with their hibachi.
- **Map:** the irori agent's orb at the hearth. A line runs to each hibachi with
  a hand-off under way, with a spark moving along it unless less motion is asked
  for. The hibachi glows.
- **The irori agent's panel:** the access pill (full access by default) beside
  the CLI select and the model pill.
- **The irori agent's screen** (the orb, or "<CLI> · あなたの Schema"): its
  Schema as the same settings a hibachi has ([SKILLS](SKILLS.md#schema-settings)):
  指示 (its root `AGENTS.md` only; the irori agent's folder has no knowledge
  folders, and its `AGENTS.md` cannot be deleted, since it marks the folder as
  set up), スキル (`.agents/skills`, listed as the host lists a hibachi's
  skills), ルール and フック, with the same forms, add and delete. The settings
  go through the same four `HostAPI` methods with the irori agent's id as the
  scope; they wait while the irori agent runs. The folder icon shows the folder
  as files, read-only, including the definitions irori wrote. On the right, for
  each hibachi, its sub-agent name, whether the definition for the chosen CLI
  exists (**定義済み** / **未作成**), and every definition file it has, with its
  CLI. A missing one says irori writes it on the first hand-off. On Pi or
  Hermes Agent the screen names the `hibachi` command instead.

## Verification

- `tests/your-ai.test.ts`: naming (`hibachi-<slug>`), the write rule, the
  preamble for each CLI, the definition text for each CLI (the Codex TOML parsed
  back), the folder record and starter (no `brain-agents` skill), reading only
  inside the folder, and irori writing absent definitions: an edited one is kept,
  a second run writes nothing, and neither a linked folder nor a link in the
  file's place is followed out of the folder.
- The same file runs a delegation through a Claude Code protocol fixture
  (`tests/fixtures/claude-your-ai.mjs`), which loads `.claude/agents` like Claude
  Code. It checks that the definitions irori wrote load, that the hibachis are
  held, the attribution of steps, requests and the report, that the irori
  agent's own write in a hibachi is refused, and that hand-offs run in the
  foreground.
- It runs the same fixture in full access: the fixture, like Claude Code, runs
  hooks in `bypassPermissions` and asks nothing; the irori agent's own write in
  a hibachi is still refused and the sub-agent writes without a request.
- It also runs the irori agent through protocol fixtures on Pi (the `hibachi`
  command preamble, no definition written) and on OpenCode (delegating
  preamble, `.opencode/agents/hibachi-product.md` written with `mode: subagent`),
  and the Schema settings service on the irori agent's folder: only the root
  `AGENTS.md` as instructions (never deleted), a rule, hooks and a skill written
  and listed from its `.agents/skills`, hash conflicts, a definition file
  refused as a setting, and a linked `.claude/rules` not followed out.
- `tests/hibachi-command.test.ts`: name resolution (sub-agent name, name,
  ambiguous, not handed), the command preamble, launcher quoting, and the
  bridge through the real `hibachi` launcher (the test's Node as the runtime):
  the report on stdout, the task on stdin, a refused hand-off's exit status and
  reason, no URL or a forged token refused. Then the irori agent on Pi's
  fixture runs `hibachi hibachi-product "..."` in its shell: the hibachi's own
  Pi fixture run happens in that hibachi, is kept in its conversation, and its
  words come back as the command's output and the `reported` event; a hibachi
  not handed is refused; stopping the irori agent stops a hand-off in progress.
- `scripts/your-ai-ui-smoke.ts`, the Claude fixture in the app: setup, the
  access pill (full access by default; the request part selects the standard
  mode), the screen before any hand-off (**未作成**, the person's own definition
  kept), the Schema settings there (the instructions form first, a rule and a
  skill added in the irori agent's folder, the folder as files), a hand-off
  answered in irori mode with the settings locked meanwhile, the report, the
  map's line, the held hibachi's panel, and the definition irori wrote shown on
  the screen. Then on Pi a hand-off through the `hibachi` command, run by the
  app's own Electron as Node: its task in the irori agent's list as done, and
  the run in Product's conversation.
- `npm run test:your-ai` (`scripts/your-ai-acceptance.ts`) runs real Claude Code
  2.1.280 through SDK 0.3.269. It uses the person's allowance, about $0.5 per
  run at list prices. It passed on 2026-09-26 with hand-written definitions of
  the same shape (names `alpha` / `beta`, not `hibachi-*`); it was not rerun
  after irori began writing them:
  - the definitions in the irori agent's `.claude/agents` load;
  - the hand-off names the sub-agent, and its id links `SubagentStart`,
    `task_started`, the sub-agent's messages and `task_notification`;
  - `canUseTool` carries that id;
  - the sub-agent follows its hibachi's `AGENTS.md`;
  - the write rule keeps both a sub-agent and the irori agent out of other
    hibachis;
  - a background request runs in the foreground, with the report before the
    result;
  - a resumed session still delegates.

- `tests/irori-command.test.ts`: the command's forms and refusals; the
  standard skills as valid packages, written with the starter, added when
  missing without replacing an edited one, and not through a linked folder;
  `clone` (through a local remote standing in for GitHub), `create` and `add`
  registering hibachis into the request's workspace while Git refuses other
  work, a repeated clone or add only joining, a taken folder refused; `connect`
  linking a folder and waiting for the hibachi's own run; the launcher passing
  its arguments and folder; and the irori agent on Pi's protocol fixture running
  `irori add` into its workspace.
- `scripts/your-ai-ui-smoke.ts` also checks the standard skills in a new folder,
  the + offering a deleted one again while an edited one is kept, and an irori
  agent request on Pi running `irori add`, after which the rail and the map show
  the new hibachi in the workspace.

## Limits

- **The `irori` command is unverified on real CLIs.** Whether each CLI's shell
  tool keeps irori's `PATH` and `IRORI_COMMAND`, and whether Codex's sandbox in
  the standard mode allows its loopback connection, are unverified.

- **Unverified on real CLIs:** the owner verifies real CLIs himself. Not run: a
  real Claude Code irori agent in `bypassPermissions` (the hook and inheritance
  rely on the Agent SDK documentation and the fixture); real Pi and Hermes Agent
  running the `hibachi` command from their shell tools (whether their tool
  environment keeps irori's `PATH` and `IRORI_HIBACHI`, and whether a tool
  timeout of theirs cuts a long hand-off); the launcher from an installed
  macOS or Windows app (`hibachi.cmd` is unexercised).
- Claude Code refuses `bypassPermissions` as root outside a recognised sandbox;
  the irori agent then needs the standard mode, as a hibachi agent does.
- A hand-off through the `hibachi` command resumes the hibachi agent's saved
  session for that CLI, and is refused while that hibachi has queued
  instructions of its own.

- **Unverified on real Codex and OpenCode.** No real turn was run. Whether Codex
  loads project `.codex/agents` for the irori agent's folder, which Codex does
  not trust, and whether the model then calls `spawn_agent` with that
  `agent_type`, are unverified; so is OpenCode's task tool picking the
  `.opencode/agents` sub-agent, and whether OpenCode's full-access session rules
  reach the sub-agent's child session. If Codex ignores the file, the irori agent
  can still work (full access) but without the hibachi's definition.
- **No enforced write boundary outside Claude Code.** On Codex, OpenCode, Pi and
  Hermes Agent the hibachis' boundaries are instructions in the preamble and the
  definitions, not a hook: in full access the CLI can write anywhere its own
  rules allow. Since ADR 020 the busy hold no longer keeps other runs
  out of a handed hibachi; it holds only irori's own changes there.
- On those CLIs the person-lines notice reaches Pi and OpenCode only for a
  hibachi's file named by its absolute path; Codex and Hermes Agent have no hook.
- A definition names the hibachi's folder at the time irori wrote it. irori does
  not rewrite it when the hibachi is renamed or moved; the person edits or
  deletes the file, and irori writes a fresh one next time if it is gone.
- A hibachi's sub-agent is not the hibachi's own hibachi agent. It works in the
  irori agent's folder, loads the irori agent's settings rather than the
  hibachi's `.claude/settings.json`, and reaches the hibachi through its folder
  and the definition that tells it to read the hibachi's Schema.
- A hibachi's own `.claude/agents` load too (through `additionalDirectories`), so
  their names can collide with the irori agent's definitions.
- Every hibachi of the workspace is held for the whole run. Holding only the
  hibachis a hand-off reaches is later work.
- Claude Code's `InstructionsLoaded` hook did not fire in the acceptance run, so
  whether a hibachi's `AGENTS.md` loads by itself when a sub-agent reads a file
  there is unconfirmed. The definition tells the sub-agent to read it.
