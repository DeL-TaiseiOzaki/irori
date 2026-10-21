# 052 — The stage opens files in columns with tabs

Date: 2026-10-21. Status: owner request; implemented for 0.2.46.
Brings to the stage what [ADR 021](021-optional-hibachi-agent-and-agent-dock.md)
and [ADR 034](034-irori-mode-threads.md) gave the agents: columns side by side,
each with its own tabs.

## Context

The owner asked for the main content to take several threads, as the agents
already do. Until 0.2.45 the stage showed one file: opening another replaced it,
and the only way to see two vaults' files was the vault beside (ADR 038), which
shows trees, not pages. The owner chose columns with tabs, as in the agent dock,
over tabs alone or a read-only reference beside the page.

## Decisions

1. **Tabs.** A file opened on the stage becomes a tab of the focused column,
   after the tab on show; a file already open there comes back on show. The tabs
   show once a column has two, or once there are two columns. Closing the tab on
   show brings the one after it, or the one before it when it was the last; the
   last tab leaves the vault's home.
2. **Columns.** **Open beside** in the stage bar adds a column after the focused
   one, showing the same file, and gives it the focus. There are at most four,
   as in irori mode. Each column has a × while there are two or more; closing the
   focused one gives the focus to the column before it (after it, for the first).
3. **One editor, in the focused column.** The note on show — its saving, drafts,
   conflicts, comments, backlinks and the note bar — is the focused column's.
   The other columns show their files as the vault has them, read again on every
   file change, so a save in the focused column shows in another column showing
   the same file. A click in another column saves the note on show first, then
   moves the editor there; a note that cannot be saved keeps the focus where it is.
   *An editor per column would have doubled the save, draft and conflict handling.*
4. **Per vault.** Each vault keeps its own columns and tabs while irori runs, as
   the agent columns keep a vault's conversations. Choosing another vault shows
   its stage; coming back reopens the file the focused column showed. A workspace
   tab returns the same way. They are not kept across restarts.
5. **Tabs follow files.** A rename or move inside the vault, including a layer
   folder's new name, carries the tabs; a deletion or a move to another vault
   closes them, and a column whose file left shows the tab beside it.
6. The graph, materials and Schema views still take the whole stage.

## Consequences

- `src/domain/stage-columns.ts` holds the columns and tabs; every document the
  editor loads is placed through it, so the tabs cannot drift from the note on show.
- A workspace tab no longer remembers its note separately (ADR 037 D6): its
  vault's stage does.

## Later

- Keeping the stage's columns and tabs across restarts.
- Dragging a tab to another column.
