---
title: Links and search
description: Follow connections between notes, and find words in a file or knowledge across a workspace.
---

## Connect notes

Use relative Markdown links to refer to another note. To link to `research.md` in the same folder:

```markdown
[Research notes](research.md)
```

Choose the link to open the note. Renaming or moving a note within irori updates supported note links. Review the resulting [diff](git.md) after a move.

## Follow backlinks

Backlinks show other notes that refer to the note you have open. Adding links lets you trace how a topic connects to earlier work.

A vault with an ontology CSV can also show a knowledge hierarchy or graph. This requires a declared ontology; an arbitrary CSV does not automatically become a graph.

## Find in a file

Find words in the file on show with **Ctrl+F** (**⌘F** on a Mac) or **Find in file** under "…" at the top. It works in notes, code, CSV tables, PDFs, Word, PowerPoint and spreadsheets. A spreadsheet is searched in every sheet, and the sheet and page of a match open.

Case and full-width letters do not matter. Enter or F3 moves to the next match, Shift+Enter to the previous one, and Esc closes the bar. In a note, closing it leaves the words found selected. Images have no text to find.

## Search the workspace

Use the app's search to find knowledge in the vaults open in your workspace. Choosing a result opens its note and owning vault.

This documentation site's search covers guide articles. It does not search notes on your computer or AI conversations.
