# 068 — irori mode reads files beside the irori agent

Date: 2026-11-20. Status: owner request; implemented for 0.2.87.
Builds on [ADR 034](034-irori-mode-threads.md) (irori mode's columns),
[ADR 052](052-stage-columns.md) (a file shown without the editor) and
[ADR 044](044-where-agents-work.md) (paths in a reply).

## Context

The owner asked to read files in irori mode while going on working there. Until
0.2.86 every way of opening a vault's file from irori mode — a path in the irori
agent's reply, a search hit, a vault on the map — went to the vault's screen.
The irori agent's first column followed in the vault's dock, but irori mode's
later columns, the map and the layout were out of sight until the person came
back.

The owner chose, of three placements, to show the file where the map and the
columns are, with the irori agent's columns staying beside it. Files are
chosen from paths and search hits and from each vault's trees. A file is read,
not edited, in irori mode.

## Decisions

1. **ファイル is a third irori mode layout**, after マッピング and 並列. It shows
   a vault's Knowledge and Contents trees and, beside them, the file chosen there.
   The irori agent's columns, or the vault agents' list, stay in the pane after
   it, as they do beside the map.
2. **What opens there.** In irori mode, and on the routines page, a path to a
   vault's file in a reply and a hit of the workspace search open in the files
   view instead of the vault: the page goes to the line the path names, or to the
   hit, once. From the routines page, irori mode comes back for it. A file irori
   does not show itself is handled as before: a path is shown in the system's
   file manager, and a row of the trees opens in its application. A path in the
   irori agent's own folder still opens on the irori agent's screen, and a vault
   on the map still opens the vault.
3. **Read only.** The file is shown as a stage column without the focus shows
   it (ADR 052 D3): read from the vault, drawn as the editor would, and read
   again when the vault's files change, so an agent's edit shows at once
   without moving the reader. **vault で編集** opens the same file in its vault,
   at the same place, for editing. *An editor in irori mode would have doubled
   the save, draft and conflict handling that ADR 052 keeps in one place.*
4. **The trees open files and nothing else.** No create, rename, move or delete
   is offered there; those stay in the vault. The trees show the file's vault
   and mark the file; the vault's name chooses another vault of the workspace.
5. **Kept with the tab.** The layout and the file on show are part of where a
   workspace tab was left (ADR 037 D6), and go with a tab moved to another
   window (ADR 063, 064). They are not kept across restarts.

## Consequences

- `VaultFiles` draws the view; `VaultSections` is the trees the vault beside
  (ADR 038) already showed, now shared. `StagePreview` takes a `target` that
  is brought into view once per request.
- `TabPlace` has `overviewFile`; `overviewViews` has `files`.
- `overview-ui-smoke` reads a search hit, a change on disk, another vault's
  file, a return to irori mode and **vault で編集**; `your-ai-ui-smoke` opens a
  reply's path in the files view and then in the vault.

## Later

- Reading the irori agent's own folder in the files view.
- Find in the file (Ctrl+F) and comments in the files view.
- Several files at once in the files view.
