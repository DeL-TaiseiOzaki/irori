# ADR 008 — The graph index is a module the knowledge base carries

Date: 2026-09-22. Status: decided by the owner; implemented in 0.1.24.
Settles the open decision recorded in [STATUS](../STATUS.md) on 2026-09-17.

## Context

irori draws its ontology graph from a CSV pair declared in `.irori/ontology.json`
([ONTOLOGY](../ONTOLOGY.md)). The recommended template became an Open Knowledge
Format bundle on 2026-09-17: every page carries `type`, `title` and optionally
`relations: [{ rel, target }]`, and the template stopped shipping a declaration.
Its `lint --irori-graph` asked an agent to write the CSV pair from the pages, and
the owner asked for the question of drawing the graph from the bundle itself to
be discussed before irori changed.

The discussion came back with the reading of EvoAgent for the template's
vocabulary (`_research/ontology-evolution-2026-09-22/` in the development
workspace), which gives the vocabulary a reviewed way to change. Three facts
shaped the choice:

- Reading the graph straight from the pages costs about a hundred times more
  than reading a CSV pair. With irori's own `yaml` and link reader, 2,000
  template-shaped pages took 0.59 s and 15,000 took 4.0 s, against 0.007 s and
  0.045 s for the same graph as CSV. Whatever the source, the drawn graph needs an
  index.
- An agent-written pair drifts and fails whole: irori rejects the file when one
  relation's endpoint is not a row, and the template's own rule produced such
  files (fixed in irori-templete #8).
- A device-local index, built by irori from the pages as search already is,
  would always be current, but the owner does not want the visible structure to
  differ between devices, as it would with uncommitted edits or different builds.

## Decisions

### D1 — The pages are the source; the index is a module of the knowledge base

The graph index lives at `Knowledge_Base/ontology/` and is tracked in Git, so
the same commit shows the same graph on every device. It is derived from the
pages and never edited by hand. Rejected: a device-local index (above), which
would need no commit but could show different graphs on different devices.

### D2 — irori generates it, deterministically, on request

**グラフ索引を作成**, and afterwards **グラフ索引を更新**, writes the module
from the pages' `type`, `title` and `relations`: a row for every page taking part in a relation between two pages of
the bundle, ids that are bundle paths, NFC paths, sorted rows and fixed
serialisation, so the same pages give the same bytes on any device and OS.
Relations to URLs, folder indexes and missing pages are left out and counted.
The person commits the result. Rejected: agents writing it through
`lint --irori-graph`, which is slow at thousands of rows, error-prone and not
reproducible; the template's lint now checks the module instead.

### D3 — The module is CSV node and edge tables

The columns are the ones the existing reader takes (`id,label,note,parentId,group`
and `sourceId,relation,targetId`). CSV is kept over a JSON file because
spreadsheets and graph tools such as Gephi or Neo4j's import read node and edge
tables directly, a pull request's diff stays one row per line, and the same
reader serves tables that people maintain by hand. JSON's advantages, nesting and
no quoting pitfalls, matter less when a program writes the file.

### D4 — A declaration still wins

A knowledge base with `.irori/ontology.json` keeps its hand-maintained tables,
read exactly as before, and irori never generates over them. Such tables are the
case where CSV is plainly better than JSON: a list of people, customers or terms
kept in a spreadsheet, with no page per row.

### D5 — Freshness is checked by regenerating in memory

The panel draws the committed CSV first, then generates the module in memory and
compares it with the files, reporting the rows that would be added and removed.
This replaces the idea, raised while deciding, of a per-row page hash: the
comparison is exact, and editing a page's body does not mark the index stale.
The check runs in the main process, so the walk yields every 64 pages and
remembers each page's facts by size and modification time: for 2,000 pages a
first check took 1.15 s and a repeated one 55 ms, with no pause between
event-loop turns longer than 32 ms.

## Consequences

- Committing `Knowledge_Base/ontology/` is the person's step, and a stale module
  shows as counts in the panel until it is updated.
- The graph shows typed relations only. Body links stay navigable through
  **リンク元**; drawing them is a later option.
- The template's `lint --irori-graph` checks the module against the pages and
  reports differences; it no longer writes the pair.
