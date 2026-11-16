# 064 — A workspace tab let go on another window's tabs joins them

Date: 2026-11-16. Status: owner request; implemented for 0.2.76.
Builds on [ADR 063](063-tab-out-to-a-new-window.md) (a tab dragged out opens in a
new window) and [ADR 051](051-multiple-windows.md) (several windows). Covers the
first item ADR 063 left out, and changes its decision 2.

## Context

0.2.74 let a workspace tab dragged out of the title bar open in a window of its
own, but a tab could not go back: the owner asked that a tab let go on another
window's tabs join that window, as a browser's tabs do.

## Decisions

1. **Let go on another window's title bar, the tab joins it.** The window is the
   one seen at that point: irori keeps its windows in the order they were last
   in front, and the first that holds the point is taken (`stripUnder` in
   `src/domain/window-frame.ts`). Let go on that window's page, or on a title bar
   another window covers, the tab is not joined; elsewhere it opens a window of
   its own as before (ADR 063).
2. **The window shows where while the tab is over it.** Out of its strip, the
   dragged tab tells the host where it is once a frame (`dragTab`). The window
   whose title bar is under it shows the tab's name, outlined, between the tabs
   where it would join; the mark goes when the tab leaves or is let go.
3. **It joins where it was let go and comes on show** there, as a click on it
   would: a terminal of that window's tab on show closes after the person
   agrees, and the tab stays in the strip if they decline. It keeps where it
   was left (ADR 037 D6) unless that window has the workspace open already, in
   which case that tab is shown in its own place.
4. **Nothing stops.** As in ADR 063, the window it left keeps the tab until the
   other window shows it, and keeps it if that window cannot take it in 30
   seconds. A window takes one dropped tab at a time; another let go on it
   meanwhile opens a window of its own.
5. **A window's only tab can be dragged too, and only joins.** *Changes ADR 063
   D2.* Its drag says **ほかのウィンドウのタブの上で離す**; let go anywhere but
   another window's title bar, nothing happens. Once it joins, its note saved
   first, the window it left closes as any window closes (ADR 051 D4): the
   person is asked only when a terminal of that window is still open.

## Consequences

- The host offers a window `dragTab` (where a tab dragged out of it is, or
  nothing) and two events for the window under it: `tabOver` (where the tab
  would join, or that it left) and `tabArrives` (take it with `movedTab`, which
  now also gives the point across the window it was let go at).
- The order windows were in front is irori's own record of their focus. A
  window of another application over an irori window's title bar is not seen,
  so a tab let go there joins the irori window under it.
- Not covered: reordering tabs by dragging within a strip, and a menu or
  keyboard way to move a tab between windows.
