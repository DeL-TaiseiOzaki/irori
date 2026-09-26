# 013 — Google Drive folders belong to KBs

Date: 2026-09-25. Status: owner decision; implemented for 0.1.37. Supersedes
the part of [ADR 002](002-release-and-workspace.md) Q02 that made new Drive
connections belong to a workspace.

## Decision

The owner asked why the sidebar showed Drive folders both under **個人の資料 /
チームの資料** and in a separate **Google Drive** frame, and decided the separate
frame should go: irori is used KB-driven.

- A Drive folder is connected to a KB's materials (`contents`), from that KB's
  **接続** button or the header's **クラウド接続**, which opens the open KB's
  connections. It appears under **個人の資料** or **チームの資料** by the KB's
  category, so connecting still needs no personal/team choice of its own.
- This matters more since Drive folders became editable ([ADR 012](012-drive-editing.md)):
  a KB's folder is mounted inside the KB, so agents working there can use it, and
  its declaration (folder IDs and names, no credentials) travels with the KB so
  others can bind their own accounts. A workspace's folder lived in this
  device's application data, out of the agents' reach and unshared.
- Connections made to a workspace by earlier versions are not mounted any more.
  Each KB's connection dialog lists them with **この KB に移す**, which moves the
  declaration and the device's account binding into the KB, keeping the mount ID
  (so changes still waiting in rclone's cache upload once it is mounted there),
  folder, name and access. If the KB already connects the same folder, the
  workspace's connection is only unregistered.
- Removing a workspace unregisters its own connections instead of refusing: no
  other view manages them. Drive's files and the device's local data stay.
- The upload preparation of the materials panel ("Drive への送信準備") offers the
  open KB's connections.

## Consequences

A workspace without any KB can no longer use Drive; the owner accepted this.
Knowledge records that point at a file of a workspace connection keep their
old location and open only while that connection remains. The workspace
storage (`WorkspaceCloudStorage`) stays to read, move and remove those older
connections.
