# Your AI

Your AI is the person's own agent. It runs from its own folder, its Schema, and
works across the brains of the open workspace by handing each part of a request
to a sub-agent defined for that brain. Each such sub-agent reads that brain's
Schema before it works. The decisions are in
[ADR 014](decisions/014-ui-v5.md) (decision 5 and "Answered by the owner"). The
investigation behind the design is in the
[spike](research/YOUR-AI-SPIKE-2026-09-25.md).

## The folder

- One per person on a device: `~/irori/you` unless the device record says
  otherwise. The record (`your-ai.json` in irori's data directory) holds the
  folder and the id your AI's conversations, sessions and run records are kept
  under. The folder is not a KB and is never registered as one.
- The person creates it from the Overview (**あなたの AI を用意する**). irori writes
  a minimal starter only into an absent or empty folder, and never over a file:
  - `AGENTS.md` — what your AI does, how brains are handed to it, and that notes
    and reports are data, not instructions. There is no `CLAUDE.md`: newer Claude
    Code reads `AGENTS.md` itself, and a `CLAUDE.md` beside it would stop that.
  - `.agents/skills/brain-agents/SKILL.md` — how to write one Claude Code
    sub-agent definition per brain.
  - an empty `.claude/agents/`.
- irori never writes the definitions. **あなたの AI に定義を更新させる** on the Your AI
  screen sends your AI a request with the `brain-agents` skill.

## A request

- Your AI runs on Claude Code for now. Codex definitions (`.codex/agents/*.toml`)
  come later. Your AI always runs with the standard access mode, because both
  CLIs make sub-agents inherit the parent's permission mode.
- The Overview sends each request with the workspace's brains that are not
  busy. The host resolves their folders and passes them to Claude Code as
  `additionalDirectories`. It also puts a preamble before the request naming
  each brain, its folder, its sub-agent and whether that sub-agent is defined.
- A brain's sub-agent name is stable: the brain's name in lowercase letters,
  digits and hyphens, or `brain-<first 8 of its id>` for a name without Latin
  letters, with the id added when two names collide (`brainAgentNames`).
- While your AI's run lasts, every brain handed to it is busy, as if its own AI
  were running. Its own AI, Git operations and brain settings wait. The brain's
  AI panel says why. The run's time limit is 30 minutes.

## Boundaries irori keeps

- **Writes.** A `PreToolUse` hook decides each `Write`, `Edit`, `MultiEdit` and
  `NotebookEdit` (`src/agents/delegation.ts`):
  - Your AI itself writes only in its own folder.
  - A brain's sub-agent writes only inside its brain.
  - Any other agent, built in or defined by a brain for itself, writes only in
    your AI's folder.
  - A refused write tells the agent to hand the work to that brain's sub-agent.
  - `Bash` is not bounded by path. Claude Code asks the person for it as usual.
- **Foreground hand-offs.** A sub-agent in the background cannot ask the person,
  so Claude Code refuses its edits. A hand-off asked for in the background is
  rewritten to run in the foreground.
- **Attribution.** Each hand-off becomes events that carry `delegate` (brain,
  hand-off and state). The events show the hand-off's start, the sub-agent's
  steps and requests (matched through `canUseTool`'s `agentID`), and its report
  (`task_notification`). A sub-agent's own words stay with its hand-off; the
  reply shown is your AI's.
- **Request ends.** The host sends an event naming a request when it is
  answered, declined or cancelled. Every view stops offering it then, and not
  merely because some later event of the run arrived. Sub-agents of other brains
  keep working meanwhile, and a tool call's message can arrive after the request
  it raised.

## Where it shows

- **Overview, beside the map:** **あなたの AI** (the default) or **Brain の AI**. Your
  AI's log shows each run's hand-offs as a task list (brain, what it was asked,
  working / needs approval / done), each brain's report, and sub-agent requests
  labelled with their brain.
- **Map:** your AI's orb at the hearth. A line runs to each brain with a hand-off
  under way, with a spark moving along it unless less motion is asked for. The
  brain glows.
- **Your AI screen** (the orb, or "Claude Code · あなたの Schema"): the folder
  read-only, each file's text, and each brain's sub-agent with whether it is
  defined.

## Verification

- `tests/your-ai.test.ts`: naming, the write rule, the preamble, the folder
  record and starter, reading only inside the folder, and a delegation run
  through a Claude Code protocol fixture (`tests/fixtures/claude-your-ai.mjs`).
  The fixture run checks that the brains are held, the attribution of steps,
  requests and the report, that your AI's own brain write is refused, and that
  hand-offs run in the foreground.
- `scripts/your-ai-ui-smoke.ts`, the same fixture in the app: setup, a hand-off
  answered from the Overview, the report, the map's line, the held brain's
  panel, and definitions written on request and shown as defined.
- `npm run test:your-ai` (`scripts/your-ai-acceptance.ts`) runs real Claude Code
  2.1.280 through SDK 0.3.269. It uses the person's allowance, about $0.5 per
  run at list prices. It passed on 2026-09-26:
  - the definitions in your AI's `.claude/agents` load;
  - the hand-off names the sub-agent, and its id links `SubagentStart`,
    `task_started`, the sub-agent's messages and `task_notification`;
  - `canUseTool` carries that id;
  - the sub-agent follows its brain's `AGENTS.md`;
  - the write rule keeps both a sub-agent and your AI out of other brains;
  - a background request runs in the foreground, with the report before the
    result;
  - a resumed session still delegates.

## Limits

- A brain's sub-agent is not the brain's own AI. It works in your AI's folder,
  loads your AI's settings rather than the brain's `.claude/settings.json`, and
  reaches the brain through its folder and the definition that tells it to read
  the brain's Schema.
- A brain's own `.claude/agents` load too (through `additionalDirectories`), so
  their names can collide with your AI's definitions.
- Every free brain of the workspace is held for the whole run. Holding only the
  brains a hand-off reaches is later work.
- Claude Code's `InstructionsLoaded` hook did not fire in the acceptance run, so
  whether a brain's `AGENTS.md` loads by itself when a sub-agent reads a file
  there is unconfirmed. The definition tells the sub-agent to read it.
