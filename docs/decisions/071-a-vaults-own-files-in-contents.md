# 071 — A vault's own files can be its Contents

Date: 2026-11-24. Status: owner decision; implemented for 0.2.95. D3 amended
2026-11-28 (0.3.2).
Revises [ADR 070](070-a-vault-chooses-its-layers.md) decision 4 (without
Knowledge, the vault's own files are Schema) and its first two consequences.
Extends [ADR 019](019-local-folder-connections.md) (contents shows connections
and blocks other data) and [ADR 045](045-work-folder-in-contents.md) (a folder
of the vault itself shows in contents as a connection does).

## Context

ADR 070 let a vault leave Knowledge out, for a workspace of code beside a
knowledge-base vault. Contents still held only what was connected: a folder or
a GitHub repository linked into the contents folder. A repository of code
registered as a vault therefore showed its code under Schema, in a file view
that renames and deletes but neither creates nor moves, and the layer that
means "the material this vault works on" stayed empty until the same code was
connected a second time.

Asked on 2026-11-24 which layer the files at the top of such a vault belong to,
the owner chose to let the vault's root be its Contents, so that an existing
repository of code is a vault as it is.

## Decisions

1. **A vault's own files have one layer.** Its own files are those outside
   Schema and its contents folders. They are Knowledge when the vault has that
   layer, as always; Contents when it has Contents and no Knowledge; Schema when
   it has neither (`ownLayer` in `src/domain/scopes.ts`). A vault of Schema and
   Contents needs no setting: its code is Contents.
2. **A vault with both layers may choose Contents.** `rootLayer: "contents"`
   in `.irori/scope.json` puts the vault's own files in Contents; Knowledge is
   then its named folder alone. The root cannot be both: the choice is refused
   while the knowledge folder is the root (ADR 035), and so is making the root
   the knowledge folder while the choice stands. An irori before 0.2.95 ignores
   the field and shows those files as knowledge. Nothing on disk moves.
3. **The contents folder stays what it was.** Connections and the default work
   folder go into the declared contents folder, which Git ignores. What it
   holds is connected, not the vault's own, and ADR 019's rule for it is
   unchanged. The Contents section shows the vault's own files first and then
   the contents folder under its name.

   *Amended 2026-11-28 (0.3.2), owner request.* The contents folder's name as a
   heading below the vault's own files read as a layer of its own, most often
   holding only the work folder. The Contents section is now one tree: each
   contents folder is a folder row among the vault's own files, sorted with
   them, with a link icon, muted text and a tooltip saying it keeps connected
   folders and the work folder outside Git. It opens like any folder; it
   cannot be renamed, moved or deleted from the tree and takes no new entries
   at its top, as before. A contents folder declared inside one of the vault's
   own folders shows inside that folder. A vault whose own files are not
   Contents is unchanged.
4. **Own files behave as an editable connection's do, in the vault's Git.**
   They open, save in place with the same conflict check, take new files,
   folders and notes, are renamed, moved, copied and sent to the system trash.
   The cloud service serves them as one more place beside the connections and
   the work folder: the vault's root, for the paths `ownContents` accepts. Git
   tracks them: the Changes view stages and commits them, while a contents
   folder stays out of Git.
5. **They stay the vault's own.** A new entry, a rename or a move is refused
   when the result would be Schema (a hidden name at the top, `AGENTS.md`),
   Knowledge, inside a contents folder or a connected folder, or inside another
   vault kept in this one's folder. A folder holding a contents folder, the
   knowledge folder or another vault is neither moved nor deleted. A link among
   them is not followed, as in a connection.
6. **Moves and deletions wait for the vault's runs**, as those of knowledge do
   ([ADR 020](020-parallel-conversations.md) D5); new entries and saves go on.
   A connected folder's entries are unchanged: they never waited.
7. **Chosen where the layers are.** The settings' **層** has
   **vault 直下のファイルも** on the Contents row: on and fixed without
   Knowledge, a choice with both layers, off and fixed while the knowledge
   folder is the root. An agent uses `irori set <vault> --own contents` or
   `--own knowledge`; `irori list` says `own files in Contents`.
8. **A vault agent is told.** Its introduction says that Contents is the
   vault's own files, changed in place and kept in its Git history, and names
   the contents folder as where folders and repositories are connected from
   elsewhere. With both layers it says Knowledge is its folder alone.

## Consequences

- A vault of Schema and Contents made with 0.2.94 shows its own files under
  Contents from this version on, where 0.2.94 showed them under Schema. Nothing
  is rewritten.
- Leaving Knowledge out of a vault that has notes shows them as files of
  Contents: they open and save, but the note tools (properties, links that
  follow a move, comments' moves, deleted notes) apply to knowledge only.
  Choosing Knowledge again makes them notes again.
- With the choice in a vault that has both layers, a note outside the knowledge
  folder becomes a file of Contents, and new notes go only into that folder.
- Search still covers knowledge alone ([ADR 041](041-code-and-text-files.md)):
  text in the vault's own Contents files is not found.
- Own files are watched, as the rest of the vault is, apart from the folders
  irori never watches (`node_modules`, `.venv` and the like).
- irori-templete is not changed.
