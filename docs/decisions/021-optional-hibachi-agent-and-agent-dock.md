# 021 — The hibachi agent is optional; agents sit in a dock of columns

Date: 2026-10-02. Status: owner decision; implemented for 0.1.65.
Builds on [ADR 017](017-conversation-history.md) and
[ADR 020](020-parallel-conversations.md).

## Context

On 2026-10-02 the owner described irori first as an IDE that makes it easy to
edit and read several knowledge bases (GitHub repositories) and local or cloud
contents. Asking a hibachi's own agent is an option on top of that, not the
center, and the Schema layer, which exists for that agent, should show only when
the option is on.

The owner also asked that the agents' sessions, the hibachi agent's and the irori
agent's, show in the sidebar beside the page, that the sidebar widen easily, that
several sessions show at once side by side (the reference was Obsidian with
several Claudian panes), and that the page itself can be hidden so only an
agent's sessions show.

## Decisions

### D1 — The hibachi agent is a device setting, off by default

- **設定 → エージェント → hibachi agent** turns the hibachi agent on for this
  device (`DeviceSettings.hibachiAgent`, default `false`). An existing device
  starts with it off after the update.
- Off, irori shows Knowledge and Contents only: the explorer's Schema section,
  the hibachi home's Schema card, the Schema settings view, the irori mode
  columns' AI and Schema rows, the irori mode panel's hibachi agent tab and the
  ontology's "hibachi agent" button are not shown. The irori agent stays, and so
  does everything a hibachi agent does at the irori agent's request (hand-offs,
  routines); the files of the Schema layer are still the hibachi's.
- On, everything shows as before.

### D2 — The agent dock holds columns

- The pane beside the page is the agent dock. It holds one or more columns, each
  a conversation view with its own tabs, history, log and composer, as Claudian's
  panes do. **列を追加** adds a column to the right showing the same agent with a
  new conversation and widens the dock for it; a later column's close button
  removes it, and the first column's closes the dock.
- With the hibachi agent on, the mark at the start of a column chooses what it
  shows: the hibachi agent of the hibachi on show, or the irori agent. Off, every
  column shows the irori agent.
- A hibachi column follows the hibachi on show. The first column keeps each
  owner's conversation on show under the owner's id, as before, so the Overview
  and the first column agree; later columns keep their own per owner.
- Each column after the first keeps its composer draft on the device under its
  number (`DraftKey.column`); the first column keeps the drafts it had.
- The dock has no maximum width; the columns divide it and remember their
  widths per set of columns.

### D3 — The page can be hidden

**本文を隠す** in the first column folds the page away so the explorer and the
dock fill the window; dragging the dock over the page does the same. **本文を表示**,
or opening a file, brings it back, and closing the dock always does.

## Consequences

- The renderer's conversation state moved from the window into the column
  (`AgentColumn`). The window still tracks runs and requests; a run's end sends
  the next queued instruction unless a column shows that conversation, in which
  case the column sends it.
- References, the open note's place in the context, the skill and "share the
  person's lines" are now per column.

## Later

- Keeping the dock's columns and open tabs across restarts.
- A column fixed to one hibachi instead of following the one on show.
