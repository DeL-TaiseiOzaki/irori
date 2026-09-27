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

"irori" alone is still the app. The irori agent and the hibachi agents differ
only in hierarchy (the irori agent instructs; hibachi agents are its
sub-agents) and in context (each hibachi's `AGENTS.md`). For the irori agent, a
hibachi agent is a sub-agent named `hibachi-<name>` in its CLI's agents folder.

The irori agent runs from its own folder, its Schema, and works across the
hibachis of the open workspace by handing each part of a request to that
hibachi's sub-agent. Each such sub-agent reads that hibachi's Schema before it
works. The decisions are in [ADR 014](decisions/014-ui-v5.md) (decision 5 and
"Answered by the owner"); the owner's 2026-09-27 answer replaced "irori never
writes the definitions" with the rule below. The investigation behind the
design is in the [spike](research/YOUR-AI-SPIKE-2026-09-25.md).

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
  - an empty `.claude/agents/`.
- Earlier starters also held a `brain-agents` skill for the irori agent to write
  the definitions. New folders no longer get it, and irori never deletes it from
  an existing folder.

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

| CLI | File | Format | Preamble |
| --- | --- | --- | --- |
| Claude Code | `.claude/agents/hibachi-<slug>.md` | front matter `name`, `description`, `tools: Read, Write, Edit, Glob, Grep`; the prompt as body | delegating; hand-offs in the foreground; write hook |
| Codex | `.codex/agents/hibachi-<slug>.toml` | `name`, `description`, `developer_instructions` (the fields the [Codex subagents docs](https://learn.chatgpt.com/docs/agent-configuration/subagents) require) | delegating: `spawn_agent` with the name as `agent_type` |
| OpenCode | `.opencode/agents/hibachi-<slug>.md` | front matter `description`, `mode: subagent`; the file name is the agent name ([OpenCode agents](https://opencode.ai/docs/agents/); its loader globs `{agent,agents}/**/*.md`) | delegating: the task tool |
| Pi, Hermes Agent | none | no file-defined sub-agents | direct (`brainsDirectPreamble`) |

## A request

- The irori agent runs on the CLI chosen in its panel (Claude Code unless the
  person chose another), with the model chosen for that CLI. Both are kept on
  the device (`yourAi` in the device settings).
- irori mode sends each request with the workspace's hibachis that are not
  busy. The host resolves their folders and puts a preamble before the request
  naming each hibachi and its folder.
- On Claude Code, Codex and OpenCode the preamble (`brainsPreamble`) also names
  each hibachi's sub-agent and tells the irori agent to hand the hibachi's work
  to it. On Claude Code the folders are also `additionalDirectories`, and the
  run always uses the standard access mode, because sub-agents inherit the
  parent's permission mode.
- Codex and OpenCode run in full access where the CLI offers it
  (`yourAiAccess`), so their sub-agents can reach the hibachi folders. They have
  no irori write hook: the preamble tells the irori agent not to change a
  hibachi's files itself, but nothing enforces it.
- Pi and Hermes Agent have no file-defined sub-agents. The irori agent works in
  the handed hibachis itself: the preamble (`brainsDirectPreamble`) names each
  hibachi and its folder, says there are no sub-agents, and tells it to read the
  `AGENTS.md` at the top of a hibachi's folder before reading or changing its
  files and to write only in its own folder and the handed hibachis. They run in
  full access where the CLI offers it.
- While the irori agent's run lasts, every hibachi handed to it is busy, as if
  its own hibachi agent were running. That hibachi agent, Git operations and
  hibachi settings wait. The hibachi agent's panel says why.

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
  reply shown is the irori agent's. Codex and OpenCode sub-agent activity is not
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
- **The irori agent's panel:** the CLI select and the model pill beside the
  composer.
- **The irori agent's screen** (the orb, or "<CLI> · あなたの Schema"): the folder
  read-only, each file's text, and for each hibachi its sub-agent name, whether
  the definition for the chosen CLI exists (**定義済み** / **未作成**), and every
  definition file it has, with its CLI. A missing one says irori writes it on
  the first hand-off. On Pi or Hermes Agent the screen says that CLI has no
  sub-agents. There is no button asking the irori agent to write definitions any
  more.

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
- It also runs the irori agent through protocol fixtures on Pi (direct-work
  preamble, no definition written) and on OpenCode (delegating preamble,
  `.opencode/agents/hibachi-product.md` written with `mode: subagent`).
- `scripts/your-ai-ui-smoke.ts`, the Claude fixture in the app: setup, the
  screen before any hand-off (**未作成**, the person's own definition kept), a
  hand-off answered in irori mode, the report, the map's line, the held
  hibachi's panel, and the definition irori wrote shown on the screen.
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

## Limits

- **Unverified on real Codex and OpenCode.** No real turn was run. Whether Codex
  loads project `.codex/agents` for the irori agent's folder, which Codex does
  not trust, and whether the model then calls `spawn_agent` with that
  `agent_type`, are unverified; so is OpenCode's task tool picking the
  `.opencode/agents` sub-agent, and whether OpenCode's full-access session rules
  reach the sub-agent's child session. If Codex ignores the file, the irori agent
  can still work (full access) but without the hibachi's definition.
- **No enforced write boundary outside Claude Code.** On Codex, OpenCode, Pi and
  Hermes Agent the hibachis' boundaries and Schemas are instructions in the
  preamble and the definitions, not a hook: in full access the CLI can write
  anywhere its own rules allow. Only the busy hold (no other run in a handed
  hibachi) still applies.
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
- Every free hibachi of the workspace is held for the whole run. Holding only the
  hibachis a hand-off reaches is later work.
- Claude Code's `InstructionsLoaded` hook did not fire in the acceptance run, so
  whether a hibachi's `AGENTS.md` loads by itself when a sub-agent reads a file
  there is unconfirmed. The definition tells the sub-agent to read it.
