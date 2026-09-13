# Continuous editing and retained records — 0.1.3

Source follow-up, 2026-09-14: [record search and source/artifact navigation](KNOWLEDGE-NAVIGATION.md) now expose explicit matching-version reconnection after a move, current-file status/opening, artifact links and version-specific reverse navigation. Shared portable identities, full-text search and in-app file moves remain open.

Source follow-up, 2026-09-14: [conversation recovery](CONVERSATIONS.md) now persists bounded history and pending instructions, with explicit restart resumption and no automatic replay of interrupted work. The in-memory limitation below describes the published 0.1.3 preview; the remaining D04/D06 gates still apply.

This continuation addresses the owner's note, Git and conversation feedback at checkpoint `d1b828c`. It keeps the existing Milkdown/CodeMirror editors, native Git runner, provider adapters, rclone and CI. No provider model inference or real Google account operation is part of its automated verification.

## Writing and images

Markdown notes always open as documents, including read-only cloud Markdown. Saving updates the observed disk version without recreating the editor: selection, focus and undo history survive Ctrl/Cmd+S. Changes save after one second of inactivity and before opening another note, Git review or sending a message. Saves remain hash checked; external changes preserve the device draft and require reconciliation. Saves during an agent run use the same protection instead of a blanket prohibition. A native agent or another application still shares filesystem access: the final check/rename race remains a release gate.

Crepe handles image paste, drop and its image picker. The host accepts PNG, JPEG, GIF and WebP up to 20 MiB, checks signatures, writes a content-addressed image under `_assets/` beside the note and returns a relative Markdown URL. Identical bytes reuse the same asset. Local images load through the scoped host as data URLs; Markdown never receives device paths or temporary blob URLs. SVG and arbitrary network image loading are not enabled. Orphaned assets are retained when an upload is undone; automatic garbage collection is not implemented.

Frontmatter and detected unsupported extensions appear as literal editable blocks within the document. Their raw block content, BOM and CRLF are retained. Normal rich editing can normalize Markdown spacing; no-op opens retain exact original bytes. This does not claim exhaustive dialect preservation. CSV retains table/source views; other text/configuration formats retain CodeMirror.

The selected transparent `irori_icon-Photoroom.png` replaces the old checkerboard image byte for byte. Platform ICO/ICNS encodings feed Forge and the Windows installer; the app and website share the PNG.

## Git and conversation

The Git list supports **すべて追加** and **すべて解除**, with a single native NUL-delimited pathspec operation. Conflict/blocked paths are excluded from bulk addition, and unrelated partial staging remains intact. The staged list plus message is the local commit review; **コミット** commits directly. Remote push retains its separate repository/branch confirmation. Independent KBs are never combined into one commit.

The composer stays editable during native work. Enter submits and Shift+Enter inserts a newline; composition events do not submit. A running turn accepts up to twenty pending messages, bound to the same provider/KB and the note/source selection at submission. The next turn starts after successful completion using existing native session continuation. Failure or explicit stop pauses pending messages until **送信を再開**; pending messages can be removed. Users can read/edit other notes in the active KB and browse workspace Drive while a turn runs. Provider/KB switching remains locked while work is active or queued. The conversation follows streamed output unless the user scrolls upward.

Display history and pending messages remain in renderer memory; native session handles persist as before. Queue durability, live turn steering and restoring full conversation text after restart are follow-up work. Protocol fixtures verify this UI flow; they are not real-model acceptance.

## D06: observed source versions and manual artifacts

**参照に追加** explicitly selects sources, including sources from another registered KB or workspace Drive. Sources are shown in the composer and passed with the selected note through the typed host boundary. Before launching the CLI, the host retains the current saved bytes (including Git-uncommitted changes), SHA-256, file ID, owning scope and relative path. A second read rejects a file changing during capture. Each file is limited to 64 MiB. The prompt identifies these retained observations and their private snapshot locations; native filesystem permissions still apply and no extra permission is silently granted.

`knowledge/` under device data contains content-addressed blobs, a per-scope path/UUID index, immutable run-start records, separate completion records and separately appended artifact registrations. A source keeps its ID across edits/restarts. Copies at different paths receive different IDs. Explicit matching-version rebinding after a move now has a [location/reconnection UI](KNOWLEDGE-NAVIGATION.md); in-app file moves and provider-native file IDs remain open. Prior records retain their original paths and exact bytes even after source deletion. Hash validation detects altered retained bytes.

**資料と成果物** displays the most recent 100 runs and artifact registrations, previews retained text, links back to runs that reference the same source ID, and restores retained bytes into a new user-selected file. Existing destination files are not overwritten. Artifacts can be arbitrary files, including PPTX; each registration stores a version and an explicitly selected run. `manual-registration` denotes a human association, not proof that a model produced those bytes. Earlier registrations remain available.

These records are device-local. They are not portable shared KB identity metadata, complete lineage automation, a real generated PPTX acceptance test, or a cross-device provenance export. Records with no completion observation remain visibly incomplete. Unregistered external renames, search/backlinks/properties, portable identity sharing, cloud-native document versions, complete source selection for non-text formats and scale/retention management remain D06 gates. No existing notes are rewritten merely to assign identities.

## D04: durable preparation and bounded delivery engine

**Drive への送信準備** retains the selected local file version and exact attachment/folder identity in a separate device-local outbox. Preparation works independently of a mounted destination and never creates a fallback directory under `contents`. The UI labels the current Google connection read-only and does not claim that preparing a file has uploaded it. Pending bytes and their restore action remain available after restart.

The delivery service has pending/uploading/confirmed/failed states. It verifies retained local bytes, observes the destination, rejects a different existing version, delegates copying to rclone, then downloads/hashes the destination before recording confirmation. Retrying an uncertain copy recognizes already matching bytes without another upload. Errors keep both the record and retained bytes. Tests cover failure after remote copy, restart in uploading state, destination conflicts and attachment identity changes; an actual rclone local-backend test exercises copy/stat/downloaded SHA-256. See [rclone RC copy/stat/hash operations](https://rclone.org/rc/).

The Google HostAPI intentionally exposes preparation/list/restore only. The transport engine has not been connected to a writable Google capability. OAuth scope, re-consent, exact account binding at delivery, native Google document conversion, version-aware overwrite, connection-removal recovery UX, queue cancellation/retention, mount refresh, actual network/power-loss testing and provider-side conditional writes remain open. There is no automatic upload on restart and no general cloud-write release claim. Google client registration and existing repository secrets do not need repeating.

## Verification boundary

Required checks are production build, behavior tests with the bundled local rclone opt-in, all eight Electron suites, website fixtures, and native Forge package CI. Added tests exercise repeated edits without remount, actual clipboard image bytes/reopen, auto-save before navigation, bulk Git staging, message queuing/cancellation, source/artifact/outbox persistence and restoring bytes through a native save dialog. Package smoke also checks retained editor state and image bytes/rendering outside the checkout. Exact final results and distribution identity are recorded in CHECKPOINT.

Windows 11 Google consent, WinFsp mounts, folder reads/reconnect, IME and upgrade results are still awaiting device evidence. An acknowledgement is not acceptance. RELEASE-PLAN D03–D10 remains the complete-release gate. The owner authorized updates to the unsigned Windows testing channel only; Mac publication and real model execution remain separately gated.
