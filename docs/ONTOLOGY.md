# The ontology

Date: 2026-11-13 ([ADR 060](decisions/060-the-ontology-is-the-declaration.md)).
Replaces the CSV graph presentation of 2026-09-13 and the generated graph index
of 2026-09-22 ([ADR 008](decisions/008-graph-index-module.md)), which this
document described until 0.2.64.

The ontology of a knowledge base is what kinds of pages it has and how they may
relate. A knowledge base states it in one file, `.property/property.json`, and
irori applies that file to the pages. The pages are instances of the ontology,
not part of it: irori keeps no graph of them.

## The declaration

`.property/property.json` is a schema-layer file of the knowledge base, read by
every agent and by irori ([ADR 015](decisions/015-page-properties.md)). irori
defines no vocabulary of its own; a knowledge base without the file has no
ontology for irori to apply.

```json
{
  "schemaVersion": 1,
  "properties": { "type": { "kind": "type" }, "title": { "kind": "text" } },
  "required": ["type", "title"],
  "types": {
    "concept": { "description": "One reusable claim.", "heading": "# Concepts", "required": ["sources"] },
    "project": { "description": "The record of a project.", "heading": "# Projects", "required": [] }
  },
  "relations": {
    "about": { "description": "The record this page is about.", "from": "any", "to": ["person", "org", "project"] },
    "part_of": { "description": "This record belongs to the target.", "from": ["person", "org", "project"], "to": ["org", "project"] },
    "uses": { "description": "What this page describes depends on the target.", "from": "any", "to": "page" },
    "same_as": { "description": "The same identity elsewhere.", "from": ["person", "org", "project"], "to": "url" }
  },
  "avoid": [{ "name": "depends_on", "use": "uses" }]
}
```

- A **type** has a meaning, the heading its pages are listed under in a folder
  index, and the keys its pages must carry besides the ones every page carries.
- A **relation** has a meaning, the types it goes `from` (`any`, or a list) and
  what it points `to`: `page` for any page, `url`, or a list of types. A page
  states one in its frontmatter as `relations: [{ rel, target }]`, the target a
  link relative to the page or a URL.
- **`avoid`** lists names not to write, each with what to use instead.

## What irori does with it

**Applies it to the pages.** `BundleService` (`src/host/bundle.ts`) walks the
knowledge layer with search's own walk (`SearchService.walk`: the same layer
rules, hidden-path and `node_modules` exclusions, blocked aliases, and entry,
file and 2 MiB limits) and keeps every `.md` that is not a folder's `index.md`.
It parses only each page's leading `---` block with the host's `yaml` package
(failsafe schema, so every value is a string) and takes the page's `type`,
`title`, `description`, the keys that hold a value and its `relations`.
`checkOntology` (`src/domain/ontology.ts`) then reports where a page parts from
the declaration:

| Finding | What it means |
| --- | --- |
| `unreadable` | The frontmatter cannot be read. |
| `type-missing` | The page has no `type`. |
| `type-undeclared` | Its type is not declared; `avoid` may say what to use. |
| `key-missing` | A key every page, or its type, requires is absent or empty. |
| `relation-incomplete` | A relation has no `rel` or no `target`. |
| `relation-undeclared` | The relation's name is not declared; `avoid` may say what to use. |
| `relation-from` | The relation does not go from a page of this type. |
| `relation-not-url` | The relation points at a URL, and the target is not one. |
| `relation-not-page` | The relation points at a page, and the target is no page of this knowledge base. |
| `relation-target-type` | The relation points at pages of other types than the target's. |
| `relation-repeated` | The page states the same relation to the same target twice. |

The check reads nothing but those facts, so the same pages give the same report
on every device. It never refuses a page and never changes one. It runs in the
main process; the walk yields between batches of pages, and each page's facts
are remembered by size and modification time, so a repeated check reads only
the pages that changed. The first 500 findings are returned with the full
count.

**Shows it.** With a knowledge base selected, **オントロジー** opens the view. It
draws each type as a node with its number of pages, and each relation as a line
from the types that may carry it to the types it points at; an end that names
no type is drawn as *どのページからも*, *どのページへも* or *URL*. Below are the
types and the relations with their meaning, how many pages use each and how
many findings name each, the names pages use that the declaration does not
have, and the findings, each of which opens its page. The view reads the files
again when they change. A knowledge base that declares nothing is told so.
**vault agent** prepares a request in the agent panel to review the declaration
against the pages; it preserves an unsent request and starts no model turn.

**Uses it where a page is edited.** The property view offers the declared types,
marks an undeclared one and marks a required key that is missing (ADR 015). The
relation picker that offers only the names a page's type may use, and the new
page that starts from a type, are not built yet; `relationsFrom` gives the
picker its names.

## Folder indexes

[ADR 028](decisions/028-generated-indexes.md). They are offered when the
knowledge folder's root `index.md` opens with frontmatter naming `okf_version`
and `.property/property.json` reads.

**Which folders.** The same walk, without submodule folders (holding `.git`) and
nested vaults. A folder with a page (a `.md` other than `index.md`) in it or
below it gets an `index.md`; its `# Folders` lists the subfolders that get one or
already have an `index.md`. An `index.md` in a folder with no page in or below it
is left alone.

**The text** (`src/domain/folder-index.ts`). The root keeps its frontmatter block
byte for byte; no other index has frontmatter. `# Folders` first, `* [name](name/)`
plus ` - description` kept from the current line linking `name/` or
`name/index.md`; then each declared type in `types` order under its `heading`
(`# <type>` without one), `* [title](file.md) - description` in file-name order,
the title falling back to the file name and the description being `description`
on one line; pages with a missing or undeclared `type` last under
`# Other pages`. Headings only with entries, one blank line between sections,
nothing else kept. Link text escapes `\`, `[` and `]`; destinations are NFC with
whitespace, `%`, parentheses, angle brackets, `#`, `:`, `\`, backticks and
control characters percent-encoded, so `resolveNoteLink` resolves every line,
and a folder link opens that folder's `index.md`. NFC, `\n`, one final newline,
UTF-8 without BOM; names sort by code point.

**Freshness and writing.** The view shows how many indexes an update would add
and change. **索引を更新** (**索引を作成** while none exists) and `irori index`
write them through `FileService.writeGenerated` — knowledge layer only, no
hidden components, no aliases, the folder created when needed, an atomic
replace guarded by the hash of the bytes replaced — only the files whose bytes
change, after every output is checked (2 MiB, no NUL). After a write the view
says once that committing makes other devices show the same indexes. A knowledge
folder that is not a bundle has no index to write.

## CSV tables

Open any CSV to see a paginated table, including unknown columns. Use **ソース**
for basic editing and the ordinary version-aware save/draft/conflict flow.
**表** previews the current buffer without rewriting it. An unchanged CSV is
never serialized. CSV on Drive remains read-only. A CSV is a table and nothing
more: irori draws no graph from one. [Papa Parse](https://www.papaparse.com/docs)
owns CSV parsing; tables allow 20,000 rows and 100 columns, 100 rows per page.

## What irori no longer does

Until 0.2.64 irori generated `ontology/entities.csv` and `ontology/relations.csv`
in the knowledge folder from every page's relations, the person committed them,
and the view drew them; and it drew a CSV pair that `.irori/ontology.json`
declared instead. Both are gone (ADR 060). The files of an earlier irori stay
where they are: the view says `ontology/` is still there and can be deleted, and
`.irori/ontology.json` is read by nothing.

## Reuse, limits and evidence

[React Flow](https://reactflow.dev/learn/layouting/layouting) draws the
diagram and Dagre lays it out; both load on demand with the view. Host file
access stays behind the validated `HostAPI` registry (`ontology`,
`updateIndexes`).

The ordinary text limit remains 2 MiB per page. The check has no limit of its
own beyond the walk's (50,000 files, 100,000 entries, 4,000 entries in one
folder). Not measured: the view with a declaration of hundreds of types, and
native keyboard and screen-reader acceptance of the diagram; the tables carry
everything the diagram shows.

Behavior tests (`tests/ontology.test.ts`, `tests/bundle.test.ts`,
`tests/folder-index.test.ts`, `tests/bundle-host-load.test.ts`) cover every
finding, a declaration that names target types and one that does not, the pages
the walk keeps, a page that could not be read and is read again, coalesced
checks and fresh updates, the indexes' bytes and the former graph index left
alone. The Electron journey (`scripts/ontology-ui-smoke.ts`) covers a knowledge
base that declares nothing, the diagram, the tables, findings that open their
page and follow the files, the folder indexes, the stage view's keyboard
handling and a CSV's table/source/save. Packaged-app smoke loads the view's
lazy chunk outside the checkout. None of these tests calls a model or a Google
account. Latest suite and native CI results belong in [STATUS](STATUS.md) and
[PACKAGING](PACKAGING.md).
