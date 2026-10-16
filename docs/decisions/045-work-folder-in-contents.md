# 045 — The work folder shows in contents as a connection does

Date: 2026-10-16. Status: owner report; implemented for 0.2.21.
Corrects [ADR 044](044-where-agents-work.md) decision 5 and extends its
decision 7. Keeps [ADR 019](019-local-folder-connections.md)'s rule that contents shows
connections and blocks other data.

## Context

On 2026-10-16 the owner reported that links to slides a vault agent made did
not open, and that the explorer showed `work` in Contents as 未接続. 0.2.19
made `<contents>/work` a vault's default work folder so that the explorer would
show it, but contents opens only registered connections: any other folder there,
`work` among them, is 登録されていないローカルデータ, and a path inside it fails
to resolve. A link to `/…/mtd/contents/work/…/x.pptx` was therefore drawn and
then said the file was not found. The owner also asked that a work folder the
person chooses elsewhere be treated the same way, and noted that contents holds
folders from anywhere on the device and cloud drives, so the paths agents write
vary.

## Decisions

1. **The work folder shows as `<contents>/work`.** In the vault's first contents
   folder, beside its connections, whether it is the default folder there or
   one the person chose elsewhere on this device. Its files open, change, move
   and take new entries as an editable connection's do; the folder itself is
   not renamed, moved or deleted from the explorer. A link inside it is not
   followed, as in a connection.
2. **What it gives way to.** A connection named `work` keeps the name. A chosen
   folder inside the vault, or inside one of its connected folders, already shows
   where it is and is not shown again. A folder not there yet is not shown until
   a run makes it.
3. **A reply's path into it opens.** Its real place stands for `contents/work`,
   as a connected folder's does (ADR 044 decision 7). A chosen folder outside the
   vault is also searched by name.
4. **A folder's name is compared composed as well.** macOS may give a folder
   decomposed (ド as ト and ゛) while a reply writes it composed; a path that does
   not match as written is compared in NFC.
5. **A connection not linked on this device stays out of reach.** Its files are
   not irori's to open, so a path to its real place is not a link.

## Consequences

- Choosing a work folder, or a run making the default one, refreshes the
  explorer; files agents add inside are listed when the folder is opened again,
  as with connections, since contents is not watched.
- What a run left in the default folder before another was chosen is not shown
  while the chosen folder stands in its place; it stays on disk.
