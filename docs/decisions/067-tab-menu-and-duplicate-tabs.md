# 067 — A workspace tab's right click, and one workspace in several tabs

Date: 2026-11-19. Status: owner request; implemented for 0.2.85.
Changes [ADR 037](037-workspace-tabs.md) decision 1 (one tab per workspace) and
[ADR 064](064-tab-joins-another-window.md) decision 3. Builds on
[ADR 063](063-tab-out-to-a-new-window.md) and [ADR 065](065-tabs-reordered-by-dragging.md).

## Context

The owner asked to open the same workspace more than once in one window, and for a
tab's right click to offer what a browser's tab does. Until 0.2.83 a workspace had
one tab per window: opening it again brought that tab on show, and a tab dropped
from another window onto a window that had its workspace showed that tab instead.

## Decisions

1. **A workspace may be open in several tabs.** Each tab has its own place: its
   level, Overview view, vault on show and the vault beside (ADR 037 D6). What the
   workspace shares stays shared: its irori agent conversations, its vaults' runs,
   their cloud folders, its rail groups.
2. **A tab's right click** offers, as a browser's does:
   - **タブを複製** — the same workspace as a new tab after it, where the tab is,
     brought on show.
   - **新しいウィンドウに移動** — the tab moves to a window of its own (ADR 063),
     without a drag; not for a window's only tab.
   - **タブを閉じる**, **他のタブを閉じる**, **右側のタブを閉じる** — the tab, all
     the others, or those to its right close at once. The tab right-clicked stays
     on show when the one on show closes with the others.
3. **What stops is what no tab has any more.** Closing tabs stops the runs of
   vaults no remaining tab here or in another window has, and the irori agent's
   conversations of workspaces no remaining tab shows; the person agrees once
   first, for all the tabs closed together (ADR 037 D4, ADR 051 D3). Closing one of
   two tabs of a workspace stops nothing of it.
4. **The start screen still brings a workspace's tab on show** when it is open,
   its first tab if it has several; a second tab comes from **タブを複製**.
5. **A tab dropped from another window is a tab of its own** where it was let go,
   with its place, even beside a tab of the same workspace. *Changes ADR 064 D3.*

## Consequences

- The renderer knows a tab by a key of its own; the host still knows a window's
  tabs by their workspaces and vaults (`windowTabs`), now possibly twice over. A
  window's only tab (ADR 064 D5) is the one tab it has, not one workspace.
- Not covered: reopening a closed tab, a new tab to the right of one, and pinning
  or grouping tabs.
