# 073 — A vault's connections stay connected; irori links them as it starts

Date: 2026-11-24. Status: owner decision; implemented for 0.2.98.
Amends [ADR 019](019-local-folder-connections.md) D2 (when a link is removed),
[ADR 037](037-workspace-tabs.md) D3–D4 (closing a tab) and
[ADR 051](051-multiple-windows.md) D4 (closing a window). Keeps
[ADR 042](042-waiting-folders-and-work-folders.md): a folder not there waits,
and a lost one is linked again.

## Context

The owner reported that the contents connected to vaults became 未接続 from
time to time — expected now and then for Google Drive or OneDrive, but also for
GitHub repositories, whose clones are on this device and never moved. Hovering
the badge showed no detail, so the connection was not lost or waiting
(ADR 042): it had been disconnected on purpose.

irori disconnected a vault's folders in four places: when it quit (ADR 019 D2),
when a tab closed and no other tab had the vault (ADR 037 D4), when a window
closed (ADR 051 D4) and when an edit took a vault out of a workspace. It linked
them again only when a tab opened that vault's workspace. So after a restart,
or once a tab or window closed, a vault's connections stayed 未接続 on Home, in
another tab's tree and for CLI agents working outside irori until its workspace
was opened again. The owner had not expected closing a tab or a window to
disconnect anything. Since Drive mounts were retired (ADR 023), every
connection is a link to a folder on this device, which costs nothing to keep.

## Decisions

1. **A connection belongs to its vault on this device, not to a tab.** Closing
   a tab, closing a window and taking a vault out of a workspace no longer
   disconnect its folders. They stay until the person disconnects them
   (接続を解除, `irori disconnect`) or irori quits.
2. **irori links every vault's connections as it starts.** Before its first
   window loads, the host goes through every vault on this device and links each
   connection that has a folder or clone chosen on this device and is neither
   linked nor waiting (`CloudService.connectAll`). A folder not there yet waits
   as in ADR 042, one that cannot be linked shows its error, and the others go
   on. A connection with no folder chosen here (フォルダ未選択) is left as it is.
   The window is told of each vault whose files changed.
3. **Quitting still removes the links**, as ADR 019 D2 says; the next start
   links them again. A link left by a crash is used again, as before.
4. **Opening a workspace still connects its vaults' connections** that are not
   linked, so a vault registered after the start, or a connection the person
   disconnected, is linked when its workspace is opened, as before.

## Consequences

- Home, every tab and CLI agents outside irori find the same folders at
  `contents/<name>` from the start of a session to its end.
- Vaults on an SSH host are not linked at the start: their vault host is
  started when one is used, and opening their workspace connects them as
  before. With D1 they too stay connected while their host runs.
