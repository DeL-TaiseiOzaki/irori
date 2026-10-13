# 038 — Two vaults side by side, and moves between their knowledge

Date: 2026-10-13. Status: owner request; implemented for 0.2.9.
Builds on [ADR 036](036-explorer-as-file-manager.md) (the explorer as a file
manager) and [ADR 037](037-workspace-tabs.md) (workspace tabs).

## Context

The owner asked to open several vaults at once and move a file from one
vault's knowledge into another's by drag and drop. Until 0.2.8 the vault panel
showed one vault; a drag was accepted only within that vault, and
`moveEntry` stayed inside one vault.

## Decisions

1. **A second panel beside the first.** The owner chose a horizontal split
   over vaults stacked in one panel. The vault panel's **Open a vault beside**
   button opens the next vault of the workspace in a panel between the vault
   panel and the stage; its name is a menu that puts another vault there, and
   × closes it. It shows that vault's knowledge and contents, with the same
   explorer actions; Schema, Changes and the vault's own commands stay in the
   main panel.
2. **The two trade places.** Opening a file beside, or choosing that vault in
   the rail, makes it the vault on show; the one that was takes its place
   beside. A workspace tab remembers the vault beside with the rest of its view.
3. **Knowledge to knowledge.** A file or folder dragged from one knowledge tree
   onto a folder of the other moves there under its name, or the first free
   one (`name 2.md`); nothing is replaced. Contents and Schema do not cross.
4. **Links break, and the person is asked first.** Links are relative and never
   cross vaults, so a link from a note that stays to what moves, or from a moved
   note to what stays, breaks. The owner chose to ask before such a move:
   `vaultMoveLinks` counts them (up to 5,000 notes, after which the dialog says
   links may break), and a move without any goes at once. Links inside a moved
   folder keep working.
5. **What goes with it.** A note's managed images (`_assets/image-<hash>`) are
   copied beside it, as a move between folders does, and stay in the old vault
   for other notes. Comments and kept drafts follow their files. Material IDs and
   the record of human-written lines are not carried across vaults.
6. **How it moves.** `moveToVault` waits, like other moves, for runs and
   connection setup in both vaults. On one volume the entry is renamed; between
   volumes it is copied and the original goes to the system trash.
7. **Not yet for agents.** `irori move` stays within one vault. ADR 031 asks
   for agents to do what people do; a cross-vault `irori move` is follow-up work.
