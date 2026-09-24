# 012 — Editing Google Drive folders in place

Date: 2026-09-25. Status: owner request accepted and implemented for 0.1.35,
completed in 0.1.36; trials on Windows 11 and macOS devices are pending.

## Decision

The owner stated that connected Drive folders are not read-only: materials in
`contents` are edited and added to from irori, which is what the IDE is for.
Until now every connection mounted read-only, accounts asked Google only for
`drive.readonly`, and writing was planned solely through the separate
preparation and delivery outbox (D04 in [EDITING-AND-RECORDS](../EDITING-AND-RECORDS.md)).
The owner had already declared the Drive permissions in the Google project for
this ([HANDOFF](../HANDOFF.md)).

- **Per connection.** A declaration's `access` is `read-write` or `read-only`.
  New connections are editable by default and either can be switched in the
  connection dialog; a connected folder is mounted again with the new setting.
  Declarations written before this version say `read-only` and stay so until
  switched: the file travels with the KB, and it recorded the application's old
  limit rather than a choice, so irori does not rewrite it by itself.
- **Accounts.** Signing in asks for the `drive` scope. Editing files that irori
  did not create needs it; `drive.file` reaches only files an app created. An
  account signed in earlier may only read until **書き込みを許可** signs it in
  again. The rclone remote keeps its name, so bindings and connections survive,
  and cancelling that sign-in keeps the account. An editable connection whose
  account may only read mounts read-only and says why.
- **Mounting.** Editable folders use rclone's write cache (`CacheMode` 2,
  "writes") with owner-only permissions. macOS's NFS mount cannot write without
  it. Each mount carries its own `description`, so two connections to one
  folder never share a write cache or its statistics.
- **Saving.** A Drive file is written in place after the editor's hash check,
  with the previous bytes kept as a device backup. It is never replaced through
  a temporary file: on Drive that deletes the file and uploads a new one,
  losing its version history and sharing.
- **Conflicts.** The mount learns of a change made elsewhere only when rclone
  polls Drive, about once a minute. Before writing, irori asks Drive directly,
  past the mount's cache, for the file's MD5 checksum (`operations/stat`) and
  compares it with the bytes the editor started from. A file still in rclone's
  upload queue (`vfs/queue`) is our own earlier save and is not compared. A
  different checksum refuses the save as a conflict, keeps the draft and
  refreshes the folder in the mount (`vfs/refresh`) so the editor shows
  Drive's version. When Drive cannot be asked, or has no checksum for the file
  (a Google Docs file), the save goes ahead: editing keeps working offline and
  rclone uploads later. An open Drive document at rest is read again every
  25 s, so a change rclone has noticed appears without a save.
- **Uploading.** rclone uploads a file shortly after it is closed. irori shows
  how many changes wait (`vfs/stats`), refuses to disconnect a folder or change
  its access while changes wait, and asks before quitting: wait, or quit and
  leave them in rclone's cache, which uploads them the next time that folder is
  connected ([rclone mount](https://rclone.org/commands/rclone_mount/)).
- **Adding.** A note can be added to an editable folder from the sidebar, and
  **フォルダを開く** shows the mounted folder in the system file manager for
  other files. Agents working in a KB can change the editable folders mounted
  in its `contents`. Images pasted or dropped into a Drive note are written
  beside it under `_assets/`, as for a KB note, with an exclusive direct write.
- **Renaming, moving and deleting** (0.1.36). A file or folder inside an
  editable connection can be renamed, moved within that connection, or deleted
  from the sidebar menu or the open document's toolbar. irori renames on the
  mount, which rclone turns into Drive's own move, so the file keeps its ID,
  history and sharing. Deleting sends items to Drive's trash (`use_trash`, on by
  default), where they can be restored for 30 days; a deleted folder's files are
  trashed one by one. The connection folder itself is changed only in the
  connection dialog. A rename that differs only in case goes through a temporary
  name, since the mount may not tell the two apart.
- **Upload failures** (0.1.36). rclone reports a failed upload on stderr; irori
  keeps only the file's path and a category (permission, storage, sign-in,
  network, rate limit, other), never the raw line, and matches failing items in
  rclone's upload queue (`vfs/queue`) to say on the connection why changes are
  not arriving. Failures that do not clear, such as a folder shared view-only,
  no longer trap the folder: disconnecting or making it read-only can leave the
  changes in rclone's cache, to be uploaded the next time the folder is mounted
  editable.

## Not included

Merging a version changed in Drive with the draft, beyond showing it beside the
draft as for a local change; rewriting knowledge records that refer to a moved
Drive file; and trashing a folder as one item rather than file by file.

## Relation to the outbox

The preparation outbox stays for keeping a local version to send later.
Editing through the mount is now the ordinary way to change a Drive folder.
