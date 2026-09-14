# Recovery and daily note tools — source 0.1.5

This continuation belongs to `feature/daily-workflow-recovery`, separate from
the Windows 0.1.4 delivery. It does not merge a pull request, update a public
installer, or change user accounts. Current release identities remain in
[CHECKPOINT](CHECKPOINT.md).

## Writing survives a restart

The assistant's unsent composer, Git commit message, and unfinished text-conflict
resolution persist in private device storage. Keys include the canonical
checkout, KB UUID, draft kind, and provider or conflict path where applicable.
Nothing is added to KB Git metadata. Empty text is an intentional saved value;
acknowledged submission/resolution writes a durable clear marker. A late
acknowledgement cannot clear newer typing. Restart never sends or resolves a
draft automatically.

Composer and commit input restore directly into their input fields. Conflict
drafts show a recovery preview and require **下書きを編集に戻す**. A changed Git
base version is called out before restoration; current Git checks still guard
actual resolution. Serial atomic/fsync writes and revision checks reject stale
writers. Read/write failures remain visible, preserve local text and offer an
explicit retry. Orderly shutdown flushes mounted and pending-unmounted drafts;
a failed flush prevents closing. A hard crash can still lose an in-flight
change; this is not an exactly-once model execution or power-loss guarantee.

## Diagnose images and discover updates

An image-resolution failure now displays its stored URL beside a recovery
instruction, without removing or rewriting the Markdown link. Alerts are
deduplicated and bounded. Check the file, connection and supported format,
then reopen the note. No arbitrary remote-image loading is enabled.

Startup and the workspace expose **更新を確認**. Only a click queries the fixed
official release endpoint. Windows x64 stable/preview assets are validated,
with bounded bytes and a request deadline. The UI distinguishes available,
current, unsupported and failed checks. Opening the verified release page or
installer link requires a second explicit action. No background check,
download, installation, account token or renderer-supplied URL is involved.
Delivery iterations sharing a core version do not count as a new application
version; releases containing changed application bytes must increment it.

## Organize notes without overwriting files

The new-note form accepts a KB-relative destination folder, creating validated
ordinary directories as needed. **名前・場所** renames or moves the selected
Markdown note to an existing folder in the same owning Knowledge_Base scope.
Expected content hashes, unresolved-draft checks, exclusive destination writes,
path validation and nested-scope/cloud/schema boundaries are enforced. Native
agent execution and Git operations prevent organization mutations.

Moving preserves note bytes. Content-addressed `_assets/image-HASH.ext` images
created by irori are verified and copied before source removal; existing asset
bytes must agree. Other relative outgoing links and unsupported link dialects
conservatively block cross-folder moves. Incoming links are not rewritten,
including when renaming. Source identity is captured and reconnected after a
successful move; a reconnection failure reports the completed physical move
and the remaining record-reconnection action separately.

**削除** retains exact text in device-local recovery storage before removing
the single selected note. **削除したノートを復元** restores it exclusively to its
original location, never overwriting an occupied path. Recovery records belong
to the exact checkout and survive restart. Images are retained. There is no
permanent-delete or automatic retention cleanup. Successful physical restoration
with a failed recovery-ledger update is reported as partial success.

Destination files are flushed before a move removes the source or a restore
updates its ledger. A failed move may leave a destination copy or copied assets
alongside the preserved original. External applications can still race a final
observation and mutation; multi-file transactions and directory/power-loss
durability are not claimed. Existing document save's external-writer race is
not solved by these tools.

## Open search matches where they appear

Opening a result selects and scrolls to the first query match on the selected
source line. Text/CSV source editors use source offsets. Markdown remains a
document: rendered text is selected only when source and visible occurrences
can be mapped unambiguously. Repeated matches retain their order, inline marks
preserve positions, and Unicode case folding does not shift offsets. A stale
preview or query in hidden Markdown syntax produces a visible limitation
notice instead of a guess. Selection does not change note bytes or create an
undo event. Search scope and limits are unchanged: one local KB, no Drive or
cross-KB index.

## Verification and boundaries

Focused behavior tests cover draft restart/isolation/stale writes/clear/failure,
exclusive note organization/recovery and asset integrity, bounded release
validation, and source/rendered match mapping. Electron suites cover actual
composer and Git restart recovery, the note-organization journey, missing-image
feedback, search selection and update UI states without model inference.
Final combined checks and PR evidence are recorded in [STATUS](STATUS.md).

Historical session browsing, full transcript archives, Git branch/rebase/abort
controls, cross-KB/cloud search, backlink rewriting, arbitrary relative-asset
relocation, automatic updating/signing, Windows installed-device IME/upgrade
acceptance and the general external-writer race remain separate work.
