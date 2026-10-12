# 035 — The vault's root can be its knowledge folder

Date: 2026-10-12. Status: owner request; implemented for 0.2.0.
Extends [ADR 024](024-layer-names.md) decision 3 (the declared knowledge
folder) and [ADR 028](028-generated-indexes.md) (the OKF bundle and its folder
indexes).

## Context

Since ADR 024 a vault declares its knowledge folder by name, `Knowledge_Base`
by default. Every page therefore sits one level down, in
`Knowledge_Base/journal/…` or `Knowledge_Base/wiki/…`. irori hides that level,
but Finder, an editor and GitHub always show it: opening the repository shows
`Knowledge_Base/` before any page.

On 2026-10-12 the owner asked for the knowledge folder to be chosen as the
contents folder is, and in particular for the vault's root to be one, so that
`index.md`, `journal/`, `wiki/` and `ontology/` sit at the top of the
repository beside `AGENTS.md`, `README.md`, `.agents/`, `.irori/`,
`.property/` and `contents/`. In 0.1.99, `irori layer <vault> knowledge .`
stopped at the folder name check, and the graph index, the OKF bundle check,
the folder indexes and the new-note default all put `${root}/` in front of a
path.

A folder outside the repository as the knowledge folder is out of scope: Schema
and knowledge would then be separate repositories, and commits, links and
`irori move` would cross them. That is a separate request.

## Decisions

1. **`.` is the vault's root.** `knowledge` in `.irori/scope.json` may be
   `"."`. In code, `knowledgeFolder()` returns `''` for it, and paths are
   joined and tested with `inFolder` and `underFolder`, never with
   `${root}/`. The renderer's request and a pulled declaration accept `.` for
   the knowledge folder and refuse it for contents.
2. **Classification does not change.** Schema is still `AGENTS.md`,
   `CLAUDE.md`, the top `README.md`, `opencode.json(c)`, top-level dot entries
   and `schema/`; contents is the contents folders; everything else is
   knowledge. With the root as knowledge folder, the bundle is exactly the
   knowledge layer.
3. **The bundle works from the knowledge folder.** The OKF check reads
   `index.md` in the knowledge folder; the graph index is `ontology/` there,
   and a page's id is its path from the knowledge folder (from the repository
   root when that is the root). The walk already leaves Schema and contents
   out, so `AGENTS.md` and `README.md` are not pages: "every `.md` but
   `index.md` carries frontmatter" applies to the knowledge layer only. The
   vault's own `.git` does not make its root a submodule. New notes go to
   `Notes` at the root unless `.irori/notes.json` says otherwise.
4. **Choosing `.` moves the knowledge up.** `irori layer <vault> knowledge .`
   and **vault のルート** in the settings move each entry of the current
   knowledge folder to the root and remove the emptied folder (a `.DS_Store`
   or `.gitkeep` goes with it). Nothing moves when an entry's name is already
   at the root, would be Schema or contents there, or is another vault; the
   refusal names them all. Choosing a name again from the root moves every
   top-level knowledge entry into that folder, except a folder holding a
   contents folder and another vault. An existing folder of that name is taken
   as it is, as `irori layer` already does for a named folder.
5. **The same records follow, by the entries that moved.** A move to or from
   the root is a `LayerMove` (`from`, `to` and the `entries` at the root). The
   links into the moved entries, a moved page's own links (which may now be at
   another depth), the comments, drafts, material IDs, person-line records and
   `.irori/notes.json` are carried as for a rename. An OKF `sources` path
   written from the old folder name is rewritten relative to its page, because
   no path starts from the root as a layer folder.
6. **A template laid out at the root is recognised.** When irori first
   registers a folder that has no `Knowledge_Base/` and whose root `index.md`
   opens with frontmatter naming `okf_version`, it declares `"knowledge": "."`,
   so a knowledge base made from irori-templete in that layout needs no setting.

## Consequences

- An existing vault moves with `irori layer <vault> knowledge .` or the
  settings; Git sees the moves as renames once committed.
- irori-templete can lay its bundle out at the repository root. A vault made
  from it must be registered with 0.2.0 or later to be recognised; an older
  irori declares `Knowledge_Base` and shows the root pages as knowledge outside
  the knowledge folder.
- Text in a vault's `AGENTS.md` or skills that names `Knowledge_Base/…` without
  a link is not rewritten.
