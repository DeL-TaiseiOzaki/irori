# 054 — irori draws its own title bar

Date: 2026-11-03. Status: owner request; implemented for 0.2.53.
Builds on [ADR 037](037-workspace-tabs.md) (workspace tabs) and
[ADR 051](051-multiple-windows.md) (the menu's New Window).

## Context

The owner called the window's top edge on Windows unrefined and asked for a
modern, smooth frame. Until 0.2.52 every window had the system's title bar,
in the accent colour when Windows shows it on title bars, and below it the
native menu bar (ファイル, Edit, View, Window — half translated), and only then
irori's own workspace tabs on the graphite chrome: three bands of different
colour and type before the app began.

## Decisions

1. **One title bar, irori's.** The window opens with the system title bar
   hidden (`titleBarStyle: 'hidden'`). The top 36 px are irori's: the workspace
   tabs sit in it, and its empty space moves the window (double-click
   maximises, as the system's bar did). A hairline joins it to the chrome
   below, as ADR 053 joins the other chrome surfaces. The start screen has the
   same bar, without tabs until one is open.
2. **The system's window controls stay the system's.** Minimise, maximise
   and close are laid over the bar's far end (`titleBarOverlay`, Windows and
   Linux) in the chrome's colours (`windowChrome` in
   `src/domain/window-frame.ts`), and follow a change of theme at once. On
   macOS the traffic lights sit at the bar's start.
   The bar leaves their space through the `titlebar-area-*` environment values.
3. **Windows' accent outline is off.** With no system title bar left for it
   to match, the window's border is the system's quiet one even when the
   person shows the accent colour on title bars (`accentColor: false`).
4. **The menu is one button away.** Windows and Linux have no menu bar any
   more: a menu button at the bar's start, over the rail, opens irori's whole
   menu in place (`showMenu`). Its shortcuts work as before. The top-level
   names are now in the reader's language (ファイル, 編集, 表示, ウィンドウ).
   macOS keeps the menu in its menu bar.
5. The first paint is the chrome's colour instead of paper, so a dark window
   does not flash light while it opens.

## Consequences

- An element drawn over the top 36 px does not take clicks there: the window
  is moved instead. Nothing but the bar's own buttons and tabs is placed there.
- Not covered: a keyboard key that opens the menu (Alt or F10), and moving a
  workspace tab out into its own window.
