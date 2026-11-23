# 070 — A vault chooses which layers it has

Date: 2026-11-23. Status: owner request; implemented for 0.2.93.
Extends [ADR 024](024-layer-names.md) (a vault names its Knowledge and Contents
layers) and [ADR 035](035-knowledge-at-the-vault-root.md) (classification).
Changes what [ADR 039](039-what-a-vault-agent-is-told.md) decision 1 tells a
vault agent about a vault that left a layer out.

## Context

Every vault had three layers. irori took a vault to be a knowledge base: it
offered new notes, the ontology and the home's note list in each one, and read
everything outside Schema and contents as knowledge.

On 2026-11-23 the owner asked for a vault that is a workspace for code and
other work, beside a knowledge-base vault in one workspace: a vault with Schema
and Contents and no notes. While writing the request the owner generalised it.
If any vault can choose its layers, irori need not define kinds of vault and
say what each is for:

- Schema and Knowledge: a pure knowledge base or a place for ideas;
- Schema, Knowledge and Contents: a knowledge base with its materials;
- Schema and Contents: a code base or another working environment.

## Decisions

1. **`layers` in `.irori/scope.json` names the Knowledge and Contents layers
   the vault has**: `["Knowledge_Base", "contents"]`, one of them, or `[]`,
   with the identifiers `labels` already uses. A declaration without `layers`
   has both, so every existing vault is unchanged, and choosing both removes
   the field. Every vault has Schema. Code reads the choice with `hasLayer`.
2. **Any combination.** irori names no kind of vault and attaches no purpose
   to a combination. A vault of Schema alone is allowed too.
3. **Nothing on disk moves, and the declaration stays whole.** `knowledge`,
   `contents` and `labels` stay as declared while a layer is left out, so
   choosing the layer again brings it back as it was, and an irori before
   0.2.93, which does not read `layers`, still reads a valid declaration (and
   shows all three layers).
4. **Without Knowledge, the vault's own files are Schema.** Classification
   needs a layer for every path. A declared contents folder is Contents; the
   rest is Knowledge when the vault has it and Schema when it does not. No file
   disappears: the Schema section lists them in its file view, where they open,
   save, are renamed and deleted, and the Changes view shows them. The panel
   opens Schema on its files in such a vault. Because no path is knowledge,
   what works on knowledge has nothing to work on: new notes and the daily
   note, the ontology, the OKF bundle and its indexes, note search, and moves
   between vaults' knowledge.
5. **A contents folder stays Contents while the layer is left out.** What was
   connected there is reached through links and is ignored by Git; it must
   never be read as the vault's own files. The folder is not shown, and the
   default work folder ([ADR 044](044-where-agents-work.md)) stays in it.
6. **Contents is left out only once nothing is connected.** With a folder or
   repository on record, the change is refused and says to disconnect first.
   A vault without Contents refuses a new connection and `irori layer
<vault> contents`.
7. **What is left out is not offered.** The vault panel, the vault beside, the
   home and the overview show only the layers the vault has; their actions
   (new note, today's note, new folder, ontology, connect) go with them. A
   request that reaches the host anyway is refused with the vault's name and
   the layer's shown name. A layer left out keeps its shown name and folder in
   the settings, disabled.
8. **The person chooses in the vault's settings, an agent with
   `irori set <vault> --layers`.** The settings' **層** has a checkbox for
   Knowledge and one for Contents, beside Schema's, which is always on.
   `--layers` lists `schema`, `knowledge` and `contents`, separated by commas;
   `schema` alone is a vault of Schema alone. `irori list` says which layers a
   vault left out. A change waits for another's run in the vault, as a layer
   folder does, because it sorts the vault's files anew; the settings disable
   the choice during a run.
9. **A vault agent hears the layers its vault has.** A vault with all three
   hears the introduction word for word as before, so no session hears it
   again because of this version. A vault that left a layer out is told which
   layers irori has and which this vault has, hears nothing of the other's
   folders or connected folders, and without Knowledge is told that the other
   files show with Schema as the vault's own working files and that it keeps
   no notes. The irori agent hears `no Knowledge layer` or `no Contents layer`
   on a handed vault's line.

## Consequences

- A workspace vault is made in two steps: register or create the vault, then
  choose its layers. Registration still declares `contents` and adds
  `/contents/` to `.gitignore`.
- Code a vault keeps at its own root shows under Schema, not Contents.
  Contents holds connections ([ADR 019](019-local-folder-connections.md),
  [ADR 046](046-github-repositories-in-contents.md)), so a repository is
  Contents when it is connected there. The vault's root as its contents
  folder, the counterpart of ADR 035, is a separate request.
- In the Schema file view, files are renamed and deleted but not created or
  moved between folders. In a vault without Knowledge, a new file at the root
  comes from an agent, the terminal or another application.
- Without the vault agent the Schema section is not shown
  ([ADR 021](021-optional-hibachi-agent-and-agent-dock.md)); a vault without
  Knowledge then shows Contents alone, and a vault of Schema alone says it has
  no layer to show.
- Records that belong to knowledge (`.irori/notes.json`, comments, drafts, the
  graph index) are left as they are while Knowledge is out.
- A declaration pulled from another computer that leaves Contents out is taken
  in even when this computer still has folders connected; they stay linked on
  disk and are not shown or told to agents until the layer is back.
- irori-templete is not changed: its layout has all three layers.
