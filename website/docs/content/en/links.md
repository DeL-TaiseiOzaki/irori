---
title: Links and search
description: Follow connections between notes, check them against the vault's ontology, and find words in a file or knowledge across a workspace.
---

## Connect notes

Use relative Markdown links to refer to another note. To link to `research.md` in the same folder:

```markdown
[Research notes](research.md)
```

Ctrl+click a link (⌘+click on a Mac) to open the note; a plain click places the cursor in it. A link to a folder, such as `wiki/`, opens that folder's `index.md`.

Renaming or moving a note, folder, image, or CSV file within irori's Knowledge updates the links to it. Review the resulting [diff](git.md) after a move. Wiki links (`[[page]]`) show in the editor, but irori does not open them or update them.

## Follow backlinks

Backlinks show other notes that refer to the note you have open. Adding links lets you trace how a topic connects to earlier work.

## Find in a file

Find words in the file on show with **Ctrl+F** (**⌘F** on a Mac) or **Find in file** under "…" at the top. It works in notes, code, CSV tables, PDFs, Word, PowerPoint and spreadsheets. A spreadsheet is searched in every sheet, and the sheet and page of a match open.

Case and full-width letters do not matter. Enter or F3 moves to the next match, Shift+Enter to the previous one, and Esc closes the bar. In a note, closing it leaves the words found selected. Images have no text to find.

## Search the workspace

Use the app's search to find knowledge in the vaults open in your workspace. Choosing a result opens its note and owning vault.

This documentation site's search covers guide articles. It does not search notes on your computer or AI conversations.

## Check the ontology

A vault can declare its page types and the relations between them in `.property/property.json`: its ontology. Open **Ontology** from the vault's menu, the Knowledge header, or the Knowledge card shown when no file is open. The view draws each type with its number of pages and each relation as a line from the types that may carry it to the types it points at. Tables below give each type's and relation's meaning and use.

irori applies the declaration to the pages and lists the ones that differ: a page with no type or an undeclared one, a missing required property, an undeclared relation, a relation from a type that may not carry it, or one that points at the wrong kind of target. Choose a line to open its page; the list follows the files as they change. Nothing is refused and no page is changed. irori does not draw the pages themselves as a graph.

A relation's `to` is `page` for any page, `url` for a URL, or a list of types. A name listed in `avoid` is reported with the name to use instead:

```json
{
  "schemaVersion": 1,
  "relations": {
    "about": { "from": "any", "to": ["person", "org", "project"] }
  },
  "avoid": [{ "name": "depends_on", "use": "uses" }]
}
```

When the vault agent is on, **vault agent** writes a request into its instruction box to review the declaration against the pages with you. Nothing is sent until you send it.

In a vault built on [irori-templete](https://github.com/DeL-TaiseiOzaki/irori-templete), **Update indexes** (**Create indexes** before any exist) writes each folder's `index.md`: its subfolders, then its pages under their type's heading, each with its description. A folder's own description is kept; other text in an index is replaced. Commit the indexes to share them. A vault agent can update them with `irori index`.

An `ontology/` folder made by an earlier version of irori is no longer read or written. The view says when one is there, and you can delete it.
