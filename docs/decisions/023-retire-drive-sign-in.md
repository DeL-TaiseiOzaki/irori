# 023 — irori no longer signs in to Google Drive

Date: 2026-10-02. Status: owner decision; implemented for 0.1.67.
Replaces decision 7 of [ADR 019](019-local-folder-connections.md) and the
in-app sign-in of [ADR 012](012-drive-editing.md) and [ADR 013](013-drive-folders-in-kbs.md).
Replaces D1 of the Google data-policy proposal in draft PR #146.

## Context

Since 0.1.35 irori connected Google Drive folders itself. It signed in with its
own OAuth client, which held the `drive` scope, and mounted folders into
contents through a bundled rclone. Opening that sign-in beyond the Google Cloud
project's test users needs Google's restricted-scope verification. On 2026-10-01
the owner rejected the paid yearly security assessment (CASA) that would follow
if Drive data reached AI providers, and chose the Obsidian approach for everyone
([ADR 019](019-local-folder-connections.md)). In that approach a sync app such as
Drive for desktop keeps the folder on the device, and irori shows it in contents.

On 2026-10-02 the owner corrected an earlier premise. The 10-01 proposal said
that editing contents with a CLI agent is the product's core. In fact the CLI
agents are optional ([ADR 021](021-optional-hibachi-agent-and-agent-dock.md)).
They are separate tools that the person installs and runs with their own
accounts, as Claudian is beside Obsidian. Telling an agent which note is open is
something Claudian does too.

The owner then asked what the in-app sign-in still offered over a synced folder:

- **No Drive for desktop to install.** Installing it is acceptable.
- **Sharing a folder's identity through Git.** contents is never shared through
  Git. Knowledge points at `contents/<name>/...`, and that name is shared either
  way.
- **Upload counts, per-connection read-only and Drive's trash.** The sync app
  owns uploads and trash, and read-only stays per connection.

Nothing in that list is worth a review, so the sign-in goes.

## Decisions

1. **No Google sign-in.** irori has no OAuth client, no Google accounts, no
   rclone and no Drive mounts. The connection dialog offers one source: a
   folder on this computer. For Google Drive that is a folder kept by Drive for
   desktop. The installer no longer carries rclone or a Google client
   configuration.
2. **Existing Drive connections are retired, not lost.** A hibachi's
   `.irori/cloud-mounts.json` is still read. Each Drive connection in it is
   listed as **終了** (ended) and is blocked in contents. **フォルダに切り替える**
   makes it a folder connection under the same id, name, place in contents and
   access. Pages pointing at `contents/<name>/...` therefore still resolve. The
   Drive record, its device record and the empty folder irori once made as its
   mount point are removed. **登録を解除** removes the connection instead.
3. **Changes that never reached Drive are kept.** rclone's write cache can still
   hold files a tester changed while offline or while an upload kept failing.
   While such a file exists, the start screen shows **Drive の未送信分 N**. Its
   dialog saves the files, with their folders, into a new folder the person
   chooses. It never overwrites a file and never deletes the cache. It reads
   rclone's `vfsMeta/<fs>/<path>` (`Dirty: true`) and
   `vfs/<fs>/<path>`, a layout checked against rclone 1.75.1. The same dialog
   restores the copies once prepared for upload (`cloud-outbox/`), as before.
4. **Workspace-level Drive connections**, from before 0.1.37, are no longer
   shown. Their prepared copies stay restorable from the same dialog.
5. **Agents and connected folders stay as in ADR 019**: an agent in standard
   access is allowed into connected folders, and irori tells it the open note.

## Consequences

- Google's API policy and verification no longer apply to irori, and neither
  does CASA. Draft PR #146 (credential encryption, consent screens and policy
  drafts for public Drive sign-in) has nothing left to prepare and is closed.
- Behavior moves to Drive for desktop: online-only files may open slowly until
  they are downloaded, and upload state is shown there. The guide asks for
  folders that are available offline.
- Testers must switch each Drive connection once.
- The installer is smaller by the rclone binary.
