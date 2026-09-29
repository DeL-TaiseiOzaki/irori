# 015 — Page properties above the note

Date: 2026-09-29. Status: owner request accepted in design; not implemented.
Addresses the "properties" item that [ACCEPTANCE](../ACCEPTANCE.md) leaves open
under R03 and R08.

## Context

A knowledge page's frontmatter carries what the bundle knows about it: its
type, title, description, provenance, lifecycle and relations. irori shows
that frontmatter as a literal YAML block at the top of the document
(`src/editor/preservation.ts`), so the person writes YAML by hand. The owner
finds that tedious and asked for properties set at the top of the page, as in
Notion.

The owner also fixed the frame on 2026-09-29:

- irori thinks only in the three layers, schema, knowledge and contents
  (`src/domain/scopes.ts`). It does not assume folder names inside any of
  them; what the folders are is the knowledge base's design, which
  irori-templete provides for its own.
- Frontmatter is required on knowledge pages. Files in contents are free,
  Markdown included.
- `generated` means who last touched the page, leaning on the Open Knowledge
  Format (OKF).

A property editor needs to know which keys exist, the values a select offers
and the keys a type requires. irori-templete now declares them in
`.property/property.json` (templete ADR 005, PR #12). irori reads that
declaration; it does not define a vocabulary of its own.

## Decisions

### D1 — Where the view applies

Every Markdown file in the knowledge layer, except `index.md`, opens with a
properties block above its body instead of the literal frontmatter block. A
page with no frontmatter shows an empty block with **プロパティを追加**. Files
in the schema layer keep their own forms (skills in Schema settings), and files
in contents open as they do now, with no properties block. No folder is
treated differently from another.

### D2 — The declaration

irori reads `.property/property.json` at the hibachi's root, a schema-layer
file because its top-level entry starts with a dot. It is optional.

```json
{
  "schemaVersion": 1,
  "properties": { "<key>": { "kind": "<kind>", "options": [], "default": "", "auto": "last-change", "description": "" } },
  "required": ["<key>"],
  "types": { "<type>": { "description": "", "heading": "# ...", "required": ["<key>"] } },
  "relations": { "<rel>": { "description": "", "from": "any", "to": "page" } },
  "avoid": [{ "name": "", "use": "" }]
}
```

Kinds: `type` (a select over the declared `types`), `text`, `select`,
`multi-select`, `datetime`, `actor-time` (`{ by, at }`), `actor-time-list`,
`link` (a `contents/` path, a page or a URL), `sources` and `relations`. A
narrow `HostAPI` method reads and validates it with Zod; a broken declaration
is reported in Schema settings and the view falls back to D3's generic rows.

Without a declaration, every key is shown in a generic row whose editor follows
the value: text for a string, a date picker for an ISO 8601 timestamp, chips for
a list of strings, and a YAML field for anything nested. Nothing is marked
required, and no key is added that the page does not have.

### D3 — The view

- `title` is the page's heading and `description` the line under it, both
  edited in place. The other properties follow as rows of label and value, in
  the declaration's order, then the page's other keys in file order.
- `type` comes first among the rows; choosing another type adds that type's
  required keys as empty rows and removes nothing.
- A required key that is missing or empty is marked on its row. Saving is never
  blocked: OKF consumers must not reject a page for a missing field.
- `link`, `sources` and `relations` values are picked, not typed: pages of the
  same knowledge base, files under a contents mount through the existing cloud
  browser, or a URL. A page is written as a link relative to the page, a file as
  `contents/<mount>/<path>`, matching the template's contract. `relations`
  offers only declared `rel` names that the page's type may use, and none from
  `avoid`.
- `multi-select` suggests the values already used in the knowledge base, from
  the device-local index the search and backlink list read.
- `actor-time-list` (`verified`) has **確認済みにする**, which appends the person
  and the current time.
- Keys the declaration does not know keep their generic rows and are never
  dropped.
- **YAML で編集** switches the block to the raw frontmatter and back.

### D4 — Storage stays YAML

The file keeps its YAML frontmatter; the view is a way of editing it. Edits go
through `yaml`'s document API (already a pinned dependency), changing only the
nodes that changed, so comments, key order, quoting, flow collections such as
`{ by: ..., at: ... }`, the BOM and line endings survive. Opening a page and
closing it leaves its bytes untouched, as now. Frontmatter that does not parse,
or has a duplicate key, opens in the raw view with the error and no property
editing until it parses.

### D5 — `generated` is set on save

When the person saves a knowledge page whose body or properties changed, irori
sets every property the declaration marks `"auto": "last-change"` to
`{ by: human:<id>, at: <now, with offset> }`. `<id>` is the local part of
`git config user.email` in that hibachi's checkout, the template's actor rule.
Without an email irori leaves the value alone and says why, once per hibachi.
Without a declaration irori sets nothing. irori never rewrites `generated`
after an agent's change on disk: the agent names itself under the knowledge
base's contract.

### D6 — New pages start from a type

When a declaration exists, the new-note dialog asks for the type and writes
frontmatter with that type, the title from the file name, `generated`, and the
remaining required keys as empty rows to fill. The folder is still the one the
dialog offers (`.irori/notes.json`), not one derived from the type.

## Not in this decision

- Table or board views over pages grouped by type, as Notion's databases.
- A properties block for contents files, which could show the pages that name
  the file in `resource` or `sources`.
- Editing the declaration through a form. Its vocabulary changes through the
  knowledge base's own review (templete ADR 003); irori shows the file in Schema
  settings and opens it as text.
- Per-type page templates under `.property/`.

## Stages and verification

1. The view and D4's round trip for `type`, `text`, `select`, `multi-select`,
   `datetime` and the generic rows, the raw toggle, and D5.
2. The pickers for `link`, `sources` and `relations`, and **確認済みにする**.
3. D6.

Each stage runs `npm run build`, `npm test` and `xvfb-run -a npm run test:ui`.
Round-trip tests cover comments, flow collections, unknown keys, a broken or
duplicate-key frontmatter, BOM and CRLF, and a no-op open; the UI suite edits a
disposable knowledge base made from irori-templete.
