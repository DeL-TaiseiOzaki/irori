# 065 — Workspace tabs are reordered by dragging them along the strip

Date: 2026-11-16. Status: owner request; implemented for 0.2.77.
Builds on [ADR 037](037-workspace-tabs.md) (workspace tabs),
[ADR 063](063-tab-out-to-a-new-window.md) and
[ADR 064](064-tab-joins-another-window.md) (tabs dragged out of a window). Covers
the reordering both left out.

## Context

A workspace tab could be dragged out of its window or onto another window's
tabs, but let go along its own strip it went back where it was. The owner asked
that dragging a tab along the strip reorder the tabs.

## Decisions

1. **Let go along the strip, the tab takes that place.** It goes before the first
   of the other tabs whose middle is right of the pointer, or after them all
   (`reorderTab` in `src/domain/workspace-tabs.ts`). Along the strip means what
   is not out of it: up to 24 px below the tabs and inside the window
   (ADR 063 D1).
2. **A mark shows where.** While the tab moves along the strip, a short accent
   line stands in the gap it would take, and the tab hangs under the pointer
   so the mark stays seen. Let go where it already stands, nothing changes and
   no mark shows.
3. **Only the order changes.** The tab on show stays on show, nothing stops, no
   window opens or closes. The places are taken as the drag begins, so the mark
   does not move the tabs it is measured against.
4. Like the tabs themselves (ADR 037 D8), the order is not kept across a restart.

## Consequences

- The strip measures its other tabs once a drag begins; a strip scrolled during
  the drag is not measured again.
- Not covered: a menu or keyboard way to reorder or move tabs.
