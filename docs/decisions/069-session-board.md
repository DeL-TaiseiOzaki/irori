# 069 — A session board shows every conversation as a card

Date: 2026-11-20. Status: owner request; implemented for 0.2.88.
Builds on [ADR 020](020-parallel-conversations.md) (conversations run side by
side), [ADR 034](034-irori-mode-threads.md) (irori mode's columns),
[ADR 050](050-vault-agents-and-their-sub-agents.md) (hand-offs and a folder's
sub-agents) and [ADR 059](059-the-window-shows-the-work.md) (window items).
Adds a meaning to the Identity role of
[ADR 053](053-priority-and-colour-roles.md).

## Context

On 2026-11-20 the owner asked for a kanban view of sessions, modelled closely on
Orca. Conversations showed only as tabs of a column or as columns side by side.
With several runs at once, a conversation out of sight was a dot on a tab at
best, and what a hand-off or a CLI's own sub-agent was doing showed only inside
its parent's log. The owner wanted a column left of the agents' columns holding
a small card for each session with what it is doing, however many run, and the
work of sub-agents and sub-sessions as cards framed in another colour.

Orca (read at `references/orca`, commit `ee61e3b`) keeps an agent board with
four lanes in this order: needs you (blocked or waiting), working, done (until
the person has looked) and idle (hidden unless asked for). A card names the
agent, what the person asked, the agent's last words and how long ago; the most
recent change comes first. Sub-agents show under their parent, indented on a
rule. Its board is a separate drawer or window; the owner asked for a column.

## Decisions

1. **The board is a column left of the agents' columns**, in the dock beside a
   vault's page and in irori mode, 212 px wide by default (176 to 360; its
   handle drags it like a column's). Showing it widens the dock or irori mode's side by as much.
2. **It lists the workspace's conversations**: the irori agent's of this
   workspace and every vault's. One shows while it runs, waits for the person,
   has queued instructions, ended since the person last looked at it, or is
   open as a tab or on show in a column. The history's other conversations do
   not.
3. **Four lanes, as Orca orders them**, each shown only when it holds a card:
   **要対応** (a permission or question waits, or the last run failed),
   **実行中** (a run, or queued instructions), **完了** (a run ended since the
   person last looked) and **開いている** (open, nothing to report). The last one
   folds on its heading. Within a lane the most recent change comes first.
4. **A card** shows only the vault's tile or the irori agent's mark, the
   request (the person's request of the run on show, in two lines at most; a
   hand-off's task), a state dot and its CLI. Pointing at a card, or focusing
   it, shows a panel beside the board with the whole request, what a waiting
   request asks (a question's words, or the file or command a permission is
   for), the end of the last reply, how long the run has gone on (or when an
   ended one last changed) and the model. The owner asked for this on
   2026-11-21, to keep the cards minimal (0.2.90). A click shows the
   conversation in the first column, going to its vault or to irori mode, and
   counts as looking at it. A conversation on show in a column on screen is
   looked at while it is there, so its finished run does not wait in 完了.
5. **Sub-sessions are cards under their parent, framed in the sub-session
   colour.** A hand-off (a vault's conversation the irori agent started with
   `irori call`) is a card of its own with a solid frame; it opens its own
   conversation. A CLI's own sub-agent — Claude Code's `Task` or `Agent`,
   Codex's `spawnAgent`, OpenCode's `task`, Pi's sub-agent extension and Hermes
   Agent's `delegate_task` — is a card with a dashed frame, named by its
   description and kind; it opens its parent's conversation. Each CLI says when
   one ended in its own way: Claude Code's, OpenCode's, Pi's and Hermes Agent's
   call returns with it; Codex 0.166 reports `subAgentActivity` items for the
   sub-agent's thread, `started` and then `completed` or `interrupted` (an
   earlier protocol's `spawnAgent` returns at once, and a later call's
   `agentsStates` ends the thread); Antigravity's `invoke_subagent` returns once
   it launched, with no later word naming it, so its sub-agents work until the
   run ends. Any still working when the run ends end with it. A hand-off that
   shows brings its parent's card with it. Once a conversation ended and the
   person looked at it, its sub-agents fold away with its run.
6. **Colour.** States keep ADR 053's roles: attention for waiting, danger for a
   failure, running neutral and told by motion, an ended run uncoloured. The
   sub-session frame is the Identity role's `--schema` colour: a folder's
   sub-agents are declared in its Schema, and a hand-off runs as the vault agent
   its Schema defines. It names what kind of session a card is, never a state.
7. **A window item.** `sessions` (セッションボード) under 表示 → 画面に出すもの,
   in a new place, **エージェントの列の左**. It is on for a new device: the
   board is the work, not a developer's control. Off, conversations still open
   as tabs and columns.
8. **Nothing new is stored.** The board reads the owners' lists from the host
   when a run begins or ends, and follows the runs' events in between. A run
   this window did not see begin is read once. What was looked at, and the
   board's lanes, are not kept across restarts. A hand-off's row now carries the
   conversation that handed it (`ConversationSummary.handedBy`).

## Consequences

- `src/domain/session-board.ts` folds a conversation's events into its card
  state, recognises each CLI's sub-agent tool and lays out the lanes;
  `tests/session-board.test.ts` covers it. `src/app/useSessionBoard.ts` gathers
  the rows and events; `src/app/SessionBoard.tsx` draws the column.
- `scripts/session-board-ui-smoke.ts` runs two Pi fixture conversations side by
  side: the cards' lanes as runs start, end and ask, a sub-agent's dashed card,
  a card opening its conversation, and the window item. The Pi fixture starts a
  sub-agent through the extension's tool when a request says `subagent`, and the
  Antigravity fixture launches one as 1.5.12 does.
- On 2026-11-20 real Claude Code 2.1.316 (`Agent`), Codex 0.166.0
  (`subAgentActivity`) and Antigravity CLI 1.5.12 (`invoke_subagent`) runs each
  started a sub-agent in the app: its dashed card showed while it worked, and in
  完了 as done when the run ended out of sight. Codex's and Antigravity's
  sub-agents were not recognised before that run: Codex no longer reported
  `spawnAgent`, and irori's Antigravity adapter dropped the `subagent` step.
- The window items count nine, four on for a new device.

## Later

- Moving a card between lanes by hand, or a person's own statuses, as Orca's
  workspace board allows.
- A sub-agent's own steps: a card shows what it was asked, not what it does.
- The board in its own window, as Orca's pop-out.
