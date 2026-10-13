# 042 — Connected folders wait for their drive; each vault has a work folder

Date: 2026-10-14. Status: owner request; implemented for 0.2.15.
Extends [ADR 019](019-local-folder-connections.md) (folders on this device in
contents) and [ADR 039](039-what-a-vault-agent-is-told.md) (what a vault agent
is told).

## Context

On 2026-10-14 (0.2.14, Windows 11) the four connected folders of the owner's
Personal vault, all under Google Drive for desktop's virtual drive `J:`, showed
as errors. irori started 18 seconds before Drive for desktop, so when the window
connected them at startup `J:` was not there, `localTarget()`'s `realpath`
failed and each connection became `error`. Drive then made `J:` ready, and the
binding, the junction at `contents/<name>` and the folder were all as they
should be, but irori never looked again: only 再接続 or a restart fixed it.
Drive for desktop's folders report small inode numbers that a remount of the
drive may change; `refresh()` then reported the connection lost, also for good.

In the same request the owner asked where agents work. An agent had made
`%TEMP%\irori-work\` for its scratch, where the person cannot follow it.

## Decisions

1. **A folder not there yet is waited for.** When `localTarget()` finds no
   folder at the binding's path (the drive is not mounted, a sync app is still
   starting), `link()` leaves the connection `waiting` instead of `error` and
   does not fail. The window shows フォルダを待っています and `irori list`
   `waiting for its folder`. A folder that is there but is not a directory, or
   overlaps a vault or irori's data, is still an error.
2. **irori looks again, on three occasions.** A timer, first after 5 seconds and
   then twice as long each time up to 2 minutes; `connections()`, which the
   window already polls every 5 seconds and `irori list` calls; and the window
   coming to the front. Whether the folder is there is checked outside the
   cloud queue, so waiting never makes irori busy, and a folder is linked only
   when no run or Git operation works in its vault, as a person's 再接続 would be.
   A folder linked this way announces the vault's files as changed.
3. **A changed identity is linked again.** When a mounted connection's link or
   folder no longer checks out, `connections()` links it again to the folder now
   at the binding's path. irori's own link, unchanged since irori made it, is
   reused when it leads there and removed first when it leads to the folder's
   former real path. Anything else at `contents/<name>` stays, and the connection
   is an error. A folder that has gone waits as in 1. File reads still refuse a
   connection that does not check out until it has been linked again.
4. **The safety checks stay.** `localTarget()`'s overlap checks, `checkVacant()`
   and `unlink()`'s rule (only irori's own link, pointing at the bound folder)
   are unchanged. irori makes, moves or removes nothing in the person's folder.
   Disconnecting a waiting connection stops the wait and removes only irori's
   own link if one was left.
5. **Agents are told about a folder once it is linked.** `linkedPaths()` and
   `localFolders()` list mounted connections only, so a run that starts after a
   folder came back is told about it and may change it; one that started before
   is not.
6. **Each vault has a work folder.** Agents keep scratch files, intermediate
   results, downloads and trial scripts in the vault's work folder, never in the
   system's temporary folder. It is `.irori/work` in the vault by default, made
   with a `.gitignore` of `*` when a run first needs it, so it stays out of Git
   and out of the knowledge layer. The person may choose another existing folder
   on this device in the vault's settings (作業フォルダ) or with
   `irori work <vault> <folder>`; it is kept in irori's data, not the vault's
   records, because a path names the person. It may not be a vault's root, hold
   a vault, lie in another vault or overlap irori's data. A chosen folder that is
   not there gives way to the default for that run.
7. **Both agents hear it, and may write there.** The vault agent's introduction
   names the folder (inside the vault, by its path there). The irori agent's
   list of handed vaults names each one's folder, with one line on what goes
   there. Any agent of the run may write in a handed vault's work folder; a
   work folder outside the vault is added to Claude Code's additional
   directories and Codex's writable roots.

## Consequences

- A connection made before its drive was ready connects by itself. One that the
  person's folder replaced at `contents/<name>` still needs them.
- A connection whose folder never comes back waits, checked every 2 minutes,
  until the person disconnects it or chooses its folder again.
- `.irori/work` is Schema by the existing rule for hidden top-level folders, so
  search, indexes and the OKF check leave it out. It is not shown among the
  vault's notes; 開く in the settings opens it in the file manager.
