# 034 — irori mode runs the irori agent's threads side by side

Date: 2026-10-12. Status: owner request; implemented for 0.1.99.
Replaces, for irori mode, the last bullet of
[ADR 020 D4](020-parallel-conversations.md#d4--tabs-in-the-hibachi-agents-panel)
("The irori agent's panel keeps one conversation on show with 履歴") and its
Later item "Tabs for the irori agent's panel", and extends
[ADR 021 D2](021-optional-hibachi-agent-and-agent-dock.md#d2--the-agent-dock-holds-columns)
to irori mode. Builds on [ADR 017 D4](017-conversation-history.md) (the irori
agent's history per workspace).

## Context

On 2026-10-11 the owner asked to open several threads with the irori agent in
irori mode, as a vault's column already allows. irori mode showed one irori
agent conversation with 履歴. A second conversation could run, but only out of
sight. The host already ran any number of an owner's conversations at once
(ADR 020 D1).

The owner also reported that irori mode showed the same irori agent
conversation in every workspace, on Claude Code and on Codex. Since 0.1.94 the
host keeps the irori agent's history per workspace. The renderer, however, kept
the conversation on show under the irori agent's id alone and cleared it when
another workspace opened. A conversation named by a view was also read without
checking its workspace: the routines page could open another workspace's
routine conversation in irori mode, and any stale id would show there. A
disposable run with the Claude Code and Codex protocol fixtures, through the
home screen, a restart, a vault's dock and a change of CLI, kept the threads
apart, so the owner's exact path was not reproduced. The fix makes every
irori-mode view per workspace and has the host refuse a named conversation of
another workspace.

The owner also reported that after 停止 a thread took no more instructions. 停止
pauses the conversation's queue (ADR 020 D2). A later send joined the paused
queue and waited there. irori mode's panel had no **送信を再開**, and a vault
column showed one only as a small button under the queue.

## Decisions

### D1 — irori mode shows the irori agent in columns

- Beside the map and on the routines page, the irori agent is shown in the
  same columns as the dock: each column has its own tabs, 履歴, log and
  composer. **列を追加** adds a column with a new conversation. There are at
  most four columns, because the map keeps its width. A later column's ✕ closes
  it; the first column has none.
- Closing a tab or a column never stops its run. A conversation that runs
  without a tab gets a tab in the first column. This covers a closed column, a
  routine's step and a reload.
- The first column of irori mode and the dock's first column show the same
  irori agent conversation. Later columns keep their own.
- The map draws hand-off lines from every irori agent conversation on show in a
  column or running in the workspace, and the hearth glows while any of them
  runs.
- The irori agent's screen opens from the map's hearth, and from the mark at
  the start of each irori mode column.

### D2 — Everything the irori agent shows is per workspace

- The conversations the irori agent's columns show, their tabs and irori
  mode's set of columns are kept under the irori agent's id and the workspace's.
  Opening another workspace shows that workspace's own threads. Returning to a
  workspace shows its threads and columns as they were. They are not kept
  across restarts.
- The host refuses to show an irori agent conversation from another workspace,
  even when a view names it: "この会話は別のワークスペースの irori agent の会話です。"
  The routines page opens an irori agent step's conversation only in its own
  workspace. A vault's conversations stay one history wherever the vault is
  opened.

### D3 — Sending to a stopped thread continues it

A send to a conversation whose queue was paused by 停止 or a failure joins the
queue and lets it go on, oldest first, as **送信を再開** does. This also works
while the stopped run is still ending. The order of ADR 020 D2 holds: a queued
instruction still goes before a later one. The queue says **一時停止中** while it
waits. The same applies to a send from irori mode to a vault's agent.

### D4 — Runs at once in the irori agent's folder

Two threads may start together in a folder that lacks a CLI's definition
folder: a run that finds the folder made a moment ago by another run goes on.
Vaults that two runs add to one workspace through `irori` both stay, because
the workspace is read and saved in one step.

## Consequences

- `YourAiPanel` is gone. irori mode, the dock and the vault columns share
  `AgentColumn`.
- Routine steps of the irori agent still wait while any of its runs works
  (ADR 020 D5). The owner has not decided whether they should wait less.

## Later

- Keeping irori mode's columns and tabs across restarts.
