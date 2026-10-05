# 024 — A hibachi names its Knowledge and Contents layers and their folders

Date: 2026-10-05. Status: owner request; implemented for 0.1.70.

## Context

A hibachi has three layers: Schema, Knowledge and Contents. irori showed them
under those English names everywhere. It also assumed that a KB keeps its
knowledge pages in `Knowledge_Base/` and its connected folders in `contents/`.
`.irori/scope.json` already listed the contents folders, but nothing in the app
changed them. `Knowledge_Base/` was written into the new-note place, the home
and overview lists, the tree, the Changes view, OKF `sources` paths and the
graph index ([ADR 008](008-graph-index-module.md)).

On 2026-10-05 the owner asked for Knowledge and Contents to be renamable, with
Schema left as it is. Asked what "name" meant, the owner chose both the name
shown and the folder on disk, set separately, for each hibachi.

## Decisions

1. **Schema keeps its name and its places.** Agents know the places by name
   (`AGENTS.md`, `.agents/`, top-level dot folders), so they do not change.
2. **Shown names belong to the hibachi.** `labels` in `.irori/scope.json`
   (`{ "Knowledge_Base": "知識", "contents": "資料" }`, up to 40 characters each)
   is what the panel headings, breadcrumbs, the ontology view, search and the
   settings preview show. An empty name returns to irori's, and the field is
   removed when it holds none. The layer identifiers in code stay as they are.
3. **The knowledge folder is declared.** `knowledge` in `.irori/scope.json`
   names the folder that irori used to call `Knowledge_Base`; with no
   `knowledge`, it is still `Knowledge_Base`. Classification does not change:
   everything outside Schema and contents is knowledge, as before. The folder is
   where irori puts new notes by default (`<folder>/Notes`), what the home and
   overview lists open, what the Changes view leaves out of paths, a root for OKF
   `sources` paths, and where the graph index lives (`<folder>/ontology/`).
4. **The contents folder is the first entry of `contents`.** Renaming it renames
   that entry. An entry declared inside another folder keeps its parent folder.
5. **A folder name is one ordinary name.** At most 64 characters; no `/ \ : * ? " < > |`
   or control characters; no leading dot, no trailing dot, no leading or trailing space; not
   `schema`, `AGENTS.md`, `CLAUDE.md`, `opencode.json(c)` or `node_modules`; not
   another layer's folder or inside one; not another registered hibachi.
6. **Renaming moves the folder when it exists.** The new name must then be free
   (a change of case on a case-insensitive volume is allowed). When the folder
   is not there yet, only the declaration changes, so a KB can name a folder it
   already has (an Obsidian vault's `wiki/`, for example). The folder and the
   declaration change together; if writing the declaration fails, the folder
   moves back.
7. **What names the folder's paths follows it.** In order: connected folders
   are disconnected before a contents rename and linked again after it; the
   connection records (`.irori/local-folders.json`, `.irori/cloud-mounts.json`)
   name the new folder; kept drafts, material IDs and person-line records on
   this device move to the new paths; `.irori/notes.json` paths that were in the
   knowledge folder follow it; comments move as a note move moves them. Last,
   every Markdown file of the hibachi outside contents, Schema files included,
   has its links into the folder rewritten. The rewrite covers body links and OKF
   `relations`/`sources`, using the same hash-checked save as a note move
   ([ADR 006](006-person-lines.md) marks are carried). A file that changed
   meanwhile, holds unsaved text or cannot be read is skipped. The skipped files
   are reported along with anything else that could not be carried.
8. **The ignore line is added, not replaced.** When `.gitignore` ignores the
   previous contents folder, the new one is added beside it. Another device
   keeps its own folder of links under the previous name until it follows, and
   those links must not reach the KB's history.
9. **Agents are told nothing new.** The words irori gives agents name connected
   folders by their paths ([ADR 019](019-local-folder-connections.md)). Those
   paths already carry the new name.

## Consequences

- A rename is one step in **hibachi の設定 → 層**, and it waits for runs and
  connection setup to finish, as Schema changes do.
- Prose that mentions the folder by name without a link, such as the template's
  `AGENTS.md` text "`Knowledge_Base/`", is not rewritten. A graph index moves
  with its folder, but its `note` column still names the previous folder.
  irori shows it as out of date until it is regenerated.
- Unsaved edits to files of connected folders keep their drafts under the
  previous path, because irori does not walk those folders to find them.
- Another device that pulls the renamed declaration sees its connected folders
  as not connected until it connects them again. Its old folder of links stays
  ignored.
