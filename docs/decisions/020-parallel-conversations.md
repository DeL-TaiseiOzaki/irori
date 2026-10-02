# 020 — Conversations run side by side

Date: 2026-10-02. Status: owner decision; implemented for 0.1.63.
Replaces the "one run per checkout" part of
[ADR 017 D4](017-conversation-history.md#d4--many-conversations-per-owner-one-run-per-checkout).

## Context

Since ADR 017 a hibachi had many conversations but ran one of them at a time:
a send in a second conversation was queued until the first conversation's run
ended, and the irori agent held every hibachi it was handed, so the person's
own conversation in that hibachi waited too. The reason given was that two
runs in one checkout could overwrite each other's edits.

On 2026-10-02 the owner asked for parallel sessions when using CLI agents, "the
same as Claudian". Claudian 2.3.1 (`references/claudian`, `src/features/chat/tabs`)
gives each tab its own conversation and runtime; any number of tabs stream at
once in one vault, a streaming tab cannot be closed without forcing it, and
nothing serializes tabs that work on the same files.

## Decisions

### D1 — One run per conversation

- A conversation has at most one run. A send to a conversation that is running,
  or whose queue is not empty, joins that conversation's queue; `begin` refuses a
  second claim of a running conversation even if two sends race.
- Any number of an owner's conversations run at once, in the same checkout, on
  the same or different CLIs. Each run has its own CLI process and native
  session. As in Claudian, irori does not coordinate their edits: the person
  who starts two runs on the same files accepts that one may overwrite the other.
- The irori agent no longer holds a hibachi against the person: the person's own
  conversations in a handed hibachi run beside the irori agent's work. A hand-off
  stays one at a time per irori-agent run and hibachi, and stopping it stops only
  the hand-off.

### D2 — Each queue waits for its own conversation

- A queue starts when its own conversation's run completes; a failed or stopped
  run pauses only that queue. Another conversation's run or queue never delays it.
- `startNextQueued(scopeId, conversationId?)` starts the named conversation's
  next instruction, or without a name the oldest among the owner's conversations
  that are not running. **送信を再開** in the Overview resumes every paused queue
  of the hibachi.

### D3 — Stopping is per conversation

**停止** stops the run of the conversation on show (or the one the Overview card
follows). `cancel(scopeId)` without a conversation still stops every run in the
space, and `cancel()` every run, for shutdown.

### D4 — Tabs in the hibachi agent's panel

- The panel keeps the hibachi's open conversations as tabs, shown once there are
  two. **新しい会話**, choosing another CLI and opening a conversation from
  **履歴** add a tab; an empty conversation on show gives way instead of keeping a
  tab of its own.
- A tab shows whether its run is working or waiting for an answer. A running
  conversation's tab cannot be closed; a closed tab's conversation stays in
  履歴. A conversation that is running without a tab — after a reload, from the
  Overview, a hand-off or a routine's step — gets one.
- Tabs are not kept across restarts and have no limit. The irori agent's panel
  keeps one conversation on show with 履歴; its other conversations can still run.

### D5 — What still waits for the whole hibachi

Git operations, note and material reorganization, hibachi settings and Drive
changes still wait while any run works in the hibachi, as do routine steps
([ROUTINES](../ROUTINES.md)). These are irori's own changes, not a conversation's.

## Consequences

- Scripts irori hands to CLIs (the person-lines hook, the `hibachi` command) are
  replaced atomically, since another run's CLI may be loading them.
- The renderer tracks runs by id with their conversation, not one flag per space.

## Later

- Showing two conversations side by side.
- Keeping open tabs across restarts.
- Tabs for the irori agent's panel.
