# 037 — Workspaces open side by side as tabs

Date: 2026-10-13. Status: owner request; implemented for 0.2.8.
Changes what Home does since the start screen became workspace selection.

## Context

The owner asked to open several workspaces at once, as tabs. Until 0.2.6 one
workspace was open at a time: Home (the rail's logo, or the workspace in the
status bar) asked to stop every running agent and close the terminals, then
showed the start screen.

## Decisions

1. **One window, tabs along its top.** The owner chose a strip above the rail
   and the stage, shown whenever a workspace is open, over tabs in the status
   bar. Each tab names its workspace and marks a running or waiting agent in
   its vaults; **+** shows the start screen. The status bar no longer names the
   workspace.
2. **Home is the new-tab page.** The owner chose Home to show the start screen
   without stopping anything. A workspace opened there becomes a tab after the
   one on show, or brings its tab back if already open. The tab strip stays
   above the start screen while tabs are open, so the person can go back.
3. **Agents of other tabs go on.** Runs, queues and permission requests are
   kept across the renderer as before; a tab only changes what is on show.
   Cloud folders of every open tab stay connected.
4. **Closing a tab stops what is its own.** The runs of vaults no other open
   tab has, and the irori agent's conversations of that workspace, are
   cancelled; the person agrees first when any of them runs. Its vaults' cloud
   folders are disconnected unless another tab has the vault. Closing the tab
   on show brings the next tab, or the start screen after the last one.
5. **A terminal belongs to the tab on show.** The renderer's terminal ends with
   its panel, so leaving the tab on show (Home, another tab, closing it) asks
   first while a terminal is open and then closes it.
6. **A tab returns where it was left**: the level (vault, irori mode, routines),
   the Overview's view, the vault on show and its note. Column references
   (`sources`) are cleared as when a workspace opened before.
7. **The start screen keeps open workspaces whole.** It does not remove the
   registration of a workspace open as a tab, nor a vault one of them has.
   Editing an open workspace updates its tab.
8. Tabs are not restored after a restart; irori starts at the start screen.
