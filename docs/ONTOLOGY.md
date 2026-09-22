# CSV ontology presentation

Date: 2026-09-13. Implements the initial CSV/graph presentation in [ADR 002](decisions/002-release-and-workspace.md). Native CLI agents and people construct the ontology; irori projects saved CSV records into readable tables and graphs.

## The graph index the knowledge base carries, 2026-09-22

The recommended template is an Open Knowledge Format bundle whose pages carry `type`, `title` and `relations` in their frontmatter. The owner decided ([ADR 008](decisions/008-graph-index-module.md)) that the pages are the source of truth and that the graph index is a module the knowledge base carries: `Knowledge_Base/ontology/`, tracked in Git, generated deterministically by irori on request and committed by the person through the ordinary Git flow. It is not a device-local index, so every device shows the same graph for the same commit. Agents do not hand-write it.

**Generation.** `GraphIndexService` (`src/host/graph-index.ts`) walks the knowledge layer with search's own walk (`SearchService.walk`: the same layer rules, hidden-path and `node_modules` exclusions, blocked aliases, and entry, file and 2 MiB limits), keeping the `.md` files under `Knowledge_Base/` that are neither a folder's `index.md` nor inside `Knowledge_Base/ontology/`. It parses only each page's leading `---` block with the host's `yaml` package (failsafe schema, so every value is a string) and takes `type`, `title` and `relations`. Each relation's `target` is resolved from its page with `resolveNoteLink` and kept only when it names another walked page; a URL (`same_as`), a missing page, a folder index, a path outside the bundle, a file that is not a page and an entry without `rel` are left out and counted. `entities.csv` (`id,label,note,parentId,group`) has one row per page that is the source or target of a kept relation: `id` is the page's path inside `Knowledge_Base/` without `.md`, `label` its `title` or its file name when the title is absent or blank, `note` its path from the KB root, `parentId` empty and `group` its `type`. `relations.csv` (`sourceId,relation,targetId`) has one row per kept relation, exact duplicates removed. The bytes are deterministic: paths in NFC, rows in code point order (entities by id; relations by source, relation, target), Papa Parse `unparse` with the fixed columns, `\n` line ends, one final newline, UTF-8 without BOM and quoting only where CSV needs it; both tables carry their header even when empty. `index.md` is a fixed English text saying the files are generated and are to be regenerated in irori. A result above the reader's limits (2,000 entities or 10,000 relations) is refused with a message and nothing is written. Files go through `FileService.writeGenerated` — knowledge layer only, no hidden components, no aliases, the folder created when needed, an atomic replace guarded by the hash of the bytes replaced — and only when their bytes change. Nothing is generated while `.irori/ontology.json` exists.

**Reading.** With no declaration and `Knowledge_Base/ontology/entities.csv` present, `readOntology` reads the module with the built-in mapping above, the relation table optional, through the same parser and validations as a declared pair; the view says whether its `source` is `module` or `declared`. A declared pair is read exactly as before and wins over a module.

**Freshness.** `graphIndexStatus` generates the module in memory and compares it with the files on disk: whether both tables hold the bytes the pages give now and, if not, how many entity rows and relation rows an update would add and remove, plus the relations left out and the pages whose frontmatter could not be read. A page's body is not part of the comparison, so only what the graph is made of makes the index stale. The check runs in the main process; the walk yields between batches of pages, and each page's facts are remembered by size and modification time, so a repeated check reads only the pages that changed. The panel shows the graph from the CSV first and the freshness line when the check returns.

**Panel.** For a module: the freshness line and **グラフ索引を更新**. With neither declaration nor module: the pages can be indexed, and **グラフ索引を作成** does it. After a write the view reloads and says once that committing `Knowledge_Base/ontology/` makes other devices show the same graph. **構築・表示設定をエージェントに相談** stays, and a declared CSV pair changes nothing.

## User flow

Open any CSV to see a paginated table, including unknown columns. Use **ソース** for basic editing and the ordinary version-aware save/draft/conflict flow. **表** previews the current buffer without rewriting it. An unchanged CSV is never serialized. CSV on Drive remains read-only.

With a KB selected, **オントロジー** opens its declared graph. Choose a subgraph/group, a hierarchy root and descendants, or parent-child relations only. The graph supports zoom/fit and has a paginated entity/note table for keyboard navigation. Selecting a graph node exposes its associated note. The entity/relation CSV buttons return to ordinary file editing. Graph presentation itself does not modify records. Filters show the displayed/total counts, and exclude edges whose endpoints are outside the selected subset.

**構築・表示設定をエージェントに相談** prepares a request in the ordinary native-agent panel, including the supported mapping format. It preserves any existing unsent request and does not start a model turn. The user chooses the native harness and sends it through the existing permission flow. The request asks the agent to inspect existing files and propose a mapping before changing the ontology.

## Explicit declaration for agents

An arbitrary CSV is not ontology. Create `.irori/ontology.json` in the owning KB to declare existing entity/relation files and their columns. The declaration is schema-layer metadata; CSV records belong to that KB's knowledge layer. Example:

```json
{
  "schemaVersion": 1,
  "entities": {
    "path": "ontology/entities.csv",
    "id": "id",
    "label": "label",
    "note": "note",
    "parent": "parentId",
    "group": "group"
  },
  "relations": {
    "path": "ontology/relations.csv",
    "source": "sourceId",
    "target": "targetId",
    "label": "relation"
  }
}
```

```csv
id,label,note,parentId,group,other_column
knowledge,Knowledge,notes/knowledge.md,,Foundations,preserved
research,Research,notes/research.md,knowledge,Research,preserved
source,Source,,research,Research,preserved
```

```csv
sourceId,relation,targetId
research,uses,source
```

Column names can be mapped to an existing schema. `id`/`label` default to those names; relation mappings default to `sourceId`/`targetId`/`relation`. Omit `note`, `parent`, `group` or the entire `relations` declaration when unused. A mapped optional column must exist, but its cell may be empty. Headers must be nonempty and unique; records must be rectangular comma-separated CSV. Quoting, embedded commas/newlines, BOM and unknown columns are supported. Formula-like values remain inert strings.

Entity identity is the owning `scopeId` plus the unchanged CSV ID, independent of label and diagram position. Library node/edge IDs are disposable projections; they never replace CSV IDs. IDs/labels must be nonempty, IDs unique, parents present and acyclic, and relation endpoints present. General relations can contain cycles. A note field contains one Markdown path relative to the owning KB. Traversal, absolute paths, contents, schema files, foreign/nested KB ownership and aliases are rejected. Missing notes remain explicit links and report a normal missing-file error when opened; no substitute file is created.

Saved CSV revisions are returned as content hashes for refresh. These fingerprints are not immutable source snapshots or artifact provenance. No existing note/frontmatter is bulk-rewritten, and graph views do not register durable note/artifact/run IDs.

## Reuse, limits and evidence

[Papa Parse](https://www.papaparse.com/docs) owns CSV parsing. [React Flow](https://reactflow.dev/learn/layouting/layouting) supplies graph interaction/accessibility controls and Dagre provides directed layout. Native HTML tables retain ordinary table semantics and paginate without a custom editable-grid engine. Graph/editor chunks load on demand; host file access remains behind the validated `HostAPI` registry.

The ordinary text limit remains 2 MiB. CSV tables allow 20,000 rows/100 columns, with 100 rows per page. Ontology parsing allows 2,000 entities/10,000 relations. A rendered graph is limited to 250 entities/1,000 relations; larger graphs require an explicit group/hierarchy filter, while the complete entity list remains available. Nothing is silently truncated. Larger-graph performance, native keyboard/screen-reader/IME acceptance, multiple linked notes per entity, stable note IDs and reverse note/entity navigation remain follow-up work.

Behavior tests cover quoted unknown data, string IDs, structural errors, hierarchy/subgraph direction, duplicate IDs/cycles/unknown references, unchanged bytes, hashes, stale saves, missing notes and ownership/alias boundaries. The Electron UI journey covers table/source/save transitions, graph filters, note navigation, external invalidation, dialog keyboard behavior and preparation of the agent request. Packaged-app smoke also loads the actual host parser and lazy graph chunk outside the checkout. None of these tests calls a model or Google account. Latest suite/native CI results belong in [STATUS](STATUS.md) and [PACKAGING](PACKAGING.md).

This advances R08 and part of D06. Search, rename/backlinks/properties, explicit multi-source selection, durable note/artifact/run IDs, retained source versions/snapshots and output provenance remain full-release requirements.
