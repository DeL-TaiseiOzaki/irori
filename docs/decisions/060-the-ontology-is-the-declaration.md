# 060 — The ontology is the declaration

Date: 2026-11-13. Status: owner decision; implemented for 0.2.65.
Supersedes [ADR 008](008-graph-index-module.md) (the graph index the knowledge
base carries) and the declared CSV pair of
[ADR 002](002-release-and-workspace.md) and [ONTOLOGY](../ONTOLOGY.md) as it was
on 2026-09-13. Keeps the folder indexes of
[ADR 028](028-generated-indexes.md), which no longer share a module with a
graph. Completes the vocabulary half of [ADR 015](015-page-properties.md).

## Context

The owner asked how irori handles the ontology, and for the simplest mechanism
that does. Reading the code and the documents back gave this picture.

- A knowledge base made from the recommended template declares its page types
  and its relations in `.property/property.json` (ADR 015; irori-templete ADR
  005 and 006). irori read the `types` and `properties` of that file for the
  property view and the folder indexes. Nothing in irori read its `relations`
  or its `avoid` list.
- What irori called the ontology was something else: a graph of the pages. It
  generated `ontology/entities.csv` and `ontology/relations.csv` from every
  page's `type`, `title` and `relations`, the person committed them, and the
  ontology view drew them (ADR 008). A second mode drew a CSV pair that
  `.irori/ontology.json` declared (2026-09-13).
- The graph took any relation name. In a disposable knowledge base shaped like
  the template, five slips (a misspelt name, a name on the `avoid` list, a
  relation from a type that may not carry it, one pointing at the wrong type of
  page, and an undeclared page type) all went into the graph, and the view said
  the index matched the pages.
- The view's filters came from the CSV pair: a group and a parent hierarchy. A
  generated index has no parents, and its group is the page's type, so choosing
  a type removed every relation between pages of different types.
- The parts that would apply the declaration were decided and not built: a
  relation picker that offers only the names a page's type may use (ADR 015
  stage 2) and a new page that starts from a type (stage 3).

The owner's correction settled what was wanted: an ontology, not a knowledge
graph. The two are different things. An ontology says what kinds of things there
are and how they may relate; the pages are its instances. Noy and McGuinness
put it as "an ontology together with a set of individual instances of classes
constitutes a knowledge base", and Gruber as a vocabulary agreed for consistent
use, apart from the knowledge stated in it. The workspace's own decision of
2026-09-11 said the same of this product: the ontology is the definitions, not
a list of notes and not a register of entities. The name moved to the generated
graph a week later, and work followed the name.

Practice elsewhere agrees on what an ontology holds and how it is used. RDF
Schema describes properties by the classes they apply to (`rdfs:domain`) and
the classes of their values (`rdfs:range`). LinkML gives a slot a `range`.
Palantir's ontology has link types between two object types, kept apart from
the objects. Tana, Logseq and Capacities restrict a field to items of a type.
Wikidata checks a property's subject type and value type and reports what does
not hold, as hints rather than refusals. In each, the definitions are few and
kept in one place, and the tool uses them where data is entered and checked.

`.property/property.json` was already close to that: types with a meaning and
required keys, relations with a meaning and the types they go from. What it
could not say was what a relation points at, beyond a page or a URL.

## Decisions

1. **The ontology of a knowledge base is `.property/property.json`.** Its
   `types` and `relations`, with `properties`, `required` and `avoid`, are the
   whole of it. The pages are instances of it, not part of it. irori still
   defines no vocabulary of its own: a knowledge base without the file has no
   ontology for irori to apply.
2. **A relation says what it points at by type.** `to` is `page`, `url`, or a
   list of type names, as `from` is `any` or a list of type names:
   `"about": { "from": "any", "to": ["person", "org", "project"] }`. A
   declaration written before this still reads. No hierarchy of types, no
   identifiers apart from names, no labels and no mapping between scopes are
   added; each waits for a knowledge base that needs it.
3. **irori applies the declaration to the pages, deterministically.**
   `checkOntology` reads each page's `type`, the keys it carries and its
   `relations`, and reports where a page parts from the declaration: no type
   or an undeclared one, a required key missing, a relation with an undeclared
   name or one on the `avoid` list (with what to use instead), a relation from
   a type that may not carry it, one that points at a URL where a page is
   declared or the reverse, one that points at a page of another type, one
   stated twice, and frontmatter that cannot be read. It never refuses a page
   and never changes one: Open Knowledge Format consumers must not reject a
   page for what it lacks.
4. **The ontology view shows the declaration.** It draws the types as nodes and
   each relation as a line from the types that may carry it to the types it
   points at, and lists the types and relations with their meaning, how many
   pages use each and how many findings name each, the names pages use that the
   declaration does not have, and the findings, each of which opens its page.
   The view reads the files again when they change.
5. **irori keeps no graph of the pages.** It no longer generates, reads or
   compares `ontology/entities.csv` and `ontology/relations.csv`, and
   `.irori/ontology.json` is no longer read. A CSV in a knowledge base is a
   table, shown as one. What an earlier irori generated stays where it is;
   the view says that it is there and that it can be deleted.
6. **The folder indexes stay** (ADR 028). **索引を更新** and `irori index`
   write the `index.md` of each folder of an OKF bundle and nothing else. They
   are files because agents read them; they list pages under the headings the
   declared types give.

## What was removed

The graph index module and its freshness check, the limits that refused a graph
above 2,000 entities (and the folder indexes with it), the repair of a broken
generated table, the declared CSV pair with its column mapping, the group and
hierarchy filters, and the list of entities with their notes. `HostAPI` loses
`graphIndexStatus` and `updateGraphIndex` and gains `updateIndexes`;
`ontology` now returns the declaration applied to the pages.

## Consequences

- A knowledge base that kept a table by hand and drew it through
  `.irori/ontology.json` loses the drawing. The CSV files are untouched and open
  as tables. This reverses the choice of 2026-10-07 to keep those declarations.
- Nothing shows the pages as a graph. A page's relations are in its properties,
  and the pages that link to it in its body are in **リンク元**; the pages that
  name it in a relation are not listed anywhere yet. That is a question about
  instances, left until a real knowledge base asks it.
- A knowledge base with `ontology/` from an earlier irori keeps the folder until
  a person deletes it. Its root index lists it like any folder that has an
  `index.md`.
- A template that writes a list in `to` needs irori 0.2.65 or later: an earlier
  irori cannot read that declaration, shows generic property rows and offers no
  folder indexes.
- The mechanical half of the template's `lint` vocabulary check is now irori's.
  The review that changes the vocabulary stays with the person and the agent.

## Not in this decision

- The relation picker and the new page that starts from a type (ADR 015 stages
  2 and 3). `relationsFrom` gives the picker its names.
- Editing the declaration through a form.
- A place for the concepts of a domain themselves (a controlled list of topics
  with broader and narrower ones). If a knowledge base needs it, it fits this
  mechanism as one more type and one more relation; nothing here is reserved
  for it.

## Evidence

Read on 2026-11-13:

- Noy and McGuinness, [Ontology Development 101](https://protege.stanford.edu/publications/ontology_development/ontology101-noy-mcguinness.html):
  classes, slots and facets; the range of a slot is the classes its values may
  be; an ontology with instances is a knowledge base; competency questions bound
  the scope.
- Gruber, [Toward Principles for the Design of Ontologies Used for Knowledge Sharing](https://tomgruber.org/writing/onto-design.pdf)
  (1995): an ontology as an agreed vocabulary, and minimal ontological
  commitment.
- W3C, [RDF Schema 1.1](https://www.w3.org/TR/rdf-schema/) §3: `rdfs:domain` and
  `rdfs:range`, with their use (checking, or suggesting values in an editor)
  left to the application.
- LinkML, [Models](https://linkml.io/linkml/schemas/models.html): a slot's
  `range`.
- Palantir Foundry, [Link types](https://www.palantir.com/docs/foundry/object-link-types/link-types-overview/):
  a link type as the definition of a relationship between two object types.
- Wikidata, [Property constraints portal](https://www.wikidata.org/wiki/Help:Property_constraints_portal):
  subject-type and value-type constraints as "hints, not firm restrictions",
  reported rather than enforced.
- [Tana fields](https://outliner.tana.inc/learn/features/fields), the
  [Logseq DB version](https://github.com/logseq/docs/blob/master/db-version.md)
  and [Capacities object properties](https://docs.capacities.io/reference/object-properties):
  a field that refers to items of a given type.
- [Obsidian properties](https://obsidian.md/help/properties) and
  [Bases](https://obsidian.md/help/bases/syntax), and the Breadcrumbs plugin's
  [graph rebuild](https://breadcrumbs-docs.michaelpporter.com/commands/rebuild-graph/):
  links and what follows from them are computed from the notes, not kept as
  files beside them.

In the repositories:

- `_research/kb-structure-2026-09-11/00-decision-kb-structure.md` §6.1 in the
  development workspace, for the definition this returns to.
- Before the change, a disposable knowledge base made from the template with
  five vocabulary slips: all five were written to `relations.csv` and the view
  reported a match; choosing any type in the view's filter left none of its 62
  `about` relations; and 2,001 related pages refused the folder indexes together
  with the graph.
- `tests/ontology.test.ts` for every finding, and `scripts/ontology-ui-smoke.ts`
  for the view in a real Electron.
