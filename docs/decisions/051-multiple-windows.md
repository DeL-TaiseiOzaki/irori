# 051 — irori opens in several windows

Date: 2026-10-18. Status: owner request; implemented for 0.2.32.
Builds on [ADR 037](037-workspace-tabs.md) (workspace tabs).

## Context

The owner asked that irori open in more than one window. Until 0.2.31 the
main process had one `BrowserWindow`: every event went to it, a reload of it
stopped every run, routine and terminal, and closing it shut irori down.

## Decisions

1. **One irori, several windows.** The menu's **ファイル > 新しいウィンドウ**
   (Ctrl/Cmd+Shift+N), and the Dock menu on macOS, open another window at the
   start screen, stepped down from the window in front. Every window talks to
   the same host: one device record, one set of agents, routines, Git and cloud
   connections. Starting irori a second time still brings an existing window to
   the front.
2. **Each window keeps its own tabs.** A window tells the host which workspaces
   and vaults its tabs show (`windowTabs`); `otherWindows` returns what the
   others show. Tabs are still not restored after a restart (ADR 037 D8).
3. **What another window has open stays open.** Closing a tab stops runs and
   releases cloud folders only of vaults no tab in any window has, and stops the
   irori agent's conversations of that workspace only if no other window shows
   it. The start screen does not remove a workspace or vault open in any window.
   *Extends ADR 037 D4 and D7 across windows.*
4. **Closing a window that is not the last** is closing all its tabs: its draft
   is saved first, then, once the person agrees in a native dialog when any of
   them runs, its terminals, the runs of vaults only it has open and the irori
   agent's conversations of workspaces only it has open stop, and those vaults'
   cloud folders are disconnected. Routines go on, as they do when a tab closes.
5. **The last window, Quit and an update's restart** shut irori down as before:
   every window's draft is saved, and the person agrees once to stop what runs.
   Windows close one at a time, so two closing together cannot both count as not
   the last.
6. **A terminal belongs to its window**: its output goes to that window alone.
   Every other event (files, runs, routines, updates) goes to every window, so a
   run started in one window shows in another that has its vault open. A queued
   instruction is sent once even when two windows ask at the same time.
7. **A reloaded or crashed window** stops only what it alone had, as closing it
   would but without asking. When it is the only window, it stops everything, as
   before.

## Consequences

- The host trusts a request from any of its windows' main frames showing the
  app's document; any other sender is refused as before.
- Host dialogs (open, save, external app) belong to the window in front.
- Not covered: moving a tab from one window to another, and restoring windows
  after a restart.
