# 019 — Folders on this device in contents

Date: 2026-10-01. Status: owner decision; implemented for 0.1.62.

## Context

Drive connections are made by irori itself: irori holds the Google OAuth grant
for the full `drive` scope and mounts the folder with rclone. Offering that to
people beyond the Google Cloud project's test users needs Google's restricted
scope verification and, because CLI agents send what they read to AI providers'
servers, a yearly paid security assessment (CASA). The owner wants people never
to set up Google Cloud themselves, so a per-person OAuth client is not an option.

An application that only reads files on disk is outside Google's API policy:
Obsidian documents vault sync through the providers' own apps, and an AI plugin
there reads the same files without any Google grant. Drive for desktop, Dropbox,
Box, iCloud Drive and OneDrive all keep a folder on the device in sync.

## Decisions

1. **A contents folder can be a folder on this device.** The connection dialog
   offers **このコンピューター** (This computer) first and **Google Drive** second.
   The person chooses a folder with the system dialog, usually one a sync app
   keeps, and names it in contents as for Drive. irori never calls a storage
   provider's API for it, so no Google grant or review applies.
2. **It appears through a link.** While connected, `contents/<name>` is a
   symbolic link to the folder (a junction on Windows), so the person's tools and
   CLI agents find it where Drive folders appear. Disconnecting, quitting or
   switching workspaces removes the link; the folder is never touched.
3. **The path stays on the device.** `.irori/local-folders.json` in the hibachi
   holds the connection's name, place in contents, access and the folder's own
   name, never its path, which carries the person's account and often an email.
   The path is in irori's data (`local-bindings/`). Another device shows the
   connection as needing a folder, chosen with **フォルダを選び直す**.
   The record is a separate file so that builds before 0.1.62, whose Drive
   record format is strict, keep reading `.irori/cloud-mounts.json`.
4. **irori follows the link only after checking it.** Before each use, the link
   must still be irori's (same file identity and target) and the folder must
   still be the one connected (same device and inode). Links inside the folder
   are not followed, as inside a Drive mount. A folder that holds or lies inside
   a hibachi or irori's data is refused.
5. **Deleting moves to the system trash.** A plain folder has no Drive trash
   behind it; without a trash, irori deletes nothing there.
6. **Agents are allowed into the folder.** In standard access, Claude Code
   receives the connected folders as additional directories and Codex as
   `sandbox_workspace_write.writable_roots`. Full access needs neither.
7. **Drive sign-in stays for invited testers.** *(Replaced by [ADR 023](023-retire-drive-sign-in.md): the sign-in was removed in 0.1.67.)* The Google connection is
   unchanged and remains limited to the project's test users until the owner
   decides on verification.

## Consequences

- Sync behaviour is the provider app's: online-only placeholders can be slow or
  unreadable until downloaded, and two sync services on one folder can
  conflict. The guide asks for folders kept on the device.
- No live refresh, as for Drive mounts: the explorer rereads on navigation.
- macOS may ask once for permission to read a cloud-storage folder.
- Unverified: real Drive for desktop, Dropbox, Box, iCloud and OneDrive folders
  on installed Windows and macOS builds, Windows junction identity checks, and
  real Claude Code access to the additional directory. Codex 0.159.0's app
  server was checked to report the writable root in its sandbox without
  running a model.
