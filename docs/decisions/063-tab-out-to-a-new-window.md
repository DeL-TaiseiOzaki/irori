# 063 — A workspace tab dragged out opens in a window of its own

Date: 2026-11-16. Status: owner request; implemented for 0.2.74.
Builds on [ADR 037](037-workspace-tabs.md) (workspace tabs) and
[ADR 051](051-multiple-windows.md) (several windows). Covers what ADR 051 and
[ADR 054](054-window-title-bar.md) left out: moving a workspace tab out into
its own window.

## Context

The owner asked that, with several workspaces open as tabs, dragging one of
them out of the title bar makes it a window of its own, as a browser does with
its tabs. Until 0.2.73 a second window opened only from the menu
(**ファイル > 新しいウィンドウ**), at the start screen, and the workspace had
to be closed in one window and opened in the other: closing it stopped what
only its tab ran.

## Decisions

1. **Drag a tab below the strip, or off the window.** A tab held and moved
   follows the pointer. Once it is more than 24 px below the tab strip, or
   outside the window, it says **新しいウィンドウで開く**; let go there, it opens
   in a new window. Let go within the strip, nothing happens: tabs are not
   reordered.
2. **Only while two tabs or more are open.** A window's only tab stays; there
   would be nothing left to show. A tab already on its way out does not count.
3. **The new window stands where the tab was let go**: its first tab under the
   pointer, the size of the window it came from, and inside that screen's work
   area (`droppedWindowBounds` in `src/domain/window-frame.ts`). It opens the
   workspace where the tab was left: its level, the Overview's view, the vault
   on show and the vault beside (ADR 037 D6).
4. **Moving stops nothing.** The window it left shows its next tab at once,
   and keeps the moving tab, faded and not to be clicked, until the new window
   shows it. Only then does it let go of the tab, so runs, conversations and
   cloud folders of the workspace are never in no window's tabs and never
   stop. If the new window cannot show it (closed, failed to load, or 30
   seconds passed), the tab stays where it was and the window says so.
5. **A terminal of the tab on show closes first**, after the person agrees, as
   it does when the tab is left for another (ADR 037 D5); its note is saved
   first.

## Consequences

- The host offers a window two operations: `moveTab` (open a tab of this window
  in a new window, true once that window shows it) and `movedTab` (the tab this
  window was opened to show). The workspace must be one saved on this device;
  the window that takes it reads its profile from the host.
- A window opened this way passes the start screen briefly while its vaults
  load.
- Not covered: dropping a tab onto another window's strip to move it there,
  reordering tabs by dragging, a keyboard or menu way to move a tab out, and
  moving a tab on Linux under Wayland to the point it was let go (the
  compositor places the window).
