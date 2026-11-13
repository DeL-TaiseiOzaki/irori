---
title: Links and search
description: Follow connections between notes and find knowledge across a workspace.
---

## Connect notes

Use relative Markdown links to refer to another note. To link to `research.md` in the same folder:

```markdown
[Research notes](research.md)
```

Choose the link to open the note. Renaming or moving a note within irori updates supported note links. Review the resulting [diff](git.md) after a move.

## Follow backlinks

Backlinks show other notes that refer to the note you have open. Adding links lets you trace how a topic connects to earlier work.

A vault that declares its page types and relations in `.property/property.json` can show that declaration, its ontology, as a diagram and tables. The relations a page states in `relations` are checked against the declared names, the types they go from and the types they point at, and the pages that differ are listed. irori does not draw the pages themselves as a graph.

## Search the workspace

Use the app's search to find knowledge in the vaults open in your workspace. Choosing a result opens its note and owning vault.

This documentation site's search covers guide articles. It does not search notes on your computer or AI conversations.
