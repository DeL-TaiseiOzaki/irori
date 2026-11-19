---
title: Editing notes
description: Create and write Markdown notes, add images, keep working with automatic saving, and organize files and folders.
---

## Open or create a note

Select a Markdown file in a vault's **Knowledge** section. To add a note, use **+** in the Knowledge header or **New note** in a folder's menu, then choose its name and destination folder. Notes are saved as `.md` files.

When the vault declares page types in `.property/property.json`, **Create note** also asks for the **Type**. The new note starts with that type, its title and the properties the type requires, left empty and marked as required; where the vault records the last change, it names you. Choose **No type** for a plain note. See [properties](properties.md).

## Write in the editor

The visual editor writes headings, lists and task lists, quotes, tables, code blocks, and images. Switch to Markdown source mode to edit the syntax directly.

- A `mermaid` code block shows its diagram. **Edit** shows the code, and **Diagram only** hides it again.
- Footnotes (`[^name]`), wiki links (`[[page|label]]`), and callouts (`> [!note] Title`) show as a reader sees them. Typing `]]` or `]` turns what you typed into a wiki link or footnote mark. Double-click one to edit its text; Backspace removes it whole.
- The file keeps these marks exactly as written. Math, HTML, and other Markdown the editor cannot write back show their source when you click them.

## Saving and images

Changes save automatically. An image pasted or dropped into a note is saved in `_assets/` in the note's folder and linked from its text with a relative path. An Obsidian-style embed `![[shot.png]]` shows an image beside the note or in its `_assets/`, and `![[shot.png|300]]` sets its width. Click an image to see it whole; Esc or another click closes it. Keep notes and images together when moving them to another computer.

If another tool or an agent changes the same file and saving conflicts, review the incoming content and your draft. Preserve any text you need before discarding an unsaved draft.

## Organize files and folders

The Knowledge and Contents lists work like Finder or Explorer. Right-click a file or folder, or use its **⋯** button:

| Items                                                      | What they do                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| **New note**, **New file**, **New folder**, **Add files…** | Add to that folder                                                     |
| **Rename**, **Move**, **Delete**                           | Change the file or folder                                              |
| **Cut**, **Copy**, **Paste**                               | Move or copy it within irori                                           |
| **Copy path**, **Copy relative path**                      | Copy its full path on this computer, or its path from the vault's root |
| **Show in Finder** (**Show in Explorer** on Windows)       | Open its place in the file manager                                     |

Read-only rows show only the items that apply to them.

Select a row and press F2 to rename it in place. A note's name shows without `.md`, and in a file's name only the part before the extension is selected. Enter renames; Esc keeps the name. The Delete key (⌘+Delete on a Mac) deletes the row after asking.

Drag a row onto a folder to move it. Drop files or folders from Finder or Explorer to copy them in. Ctrl/⌘+C, X, and V on a row copy, cut, and paste, also between Knowledge and Contents or into a [vault opened beside](workspaces.md). Files copied in Finder or Explorer paste in as well. A name already taken keeps both (`table 2.csv`); nothing is replaced.

Renaming or moving in Knowledge updates the [links](links.md) to the file or folder. A deleted note goes to deleted notes; bring it back with **Restore deleted notes** in the vault's menu. Other files and folders go to the system trash.

While the vault's agent runs, you can still add notes, folders, and files, restore deleted notes, edit the Schema, change the vault's name, look, and shown names, and open the ontology and materials. Moving, renaming, and deleting, changing a layer's folder, and updating the indexes would move files the agent uses, so they wait until the run ends.

## Take the next step

Use [links](links.md) to connect related notes and [properties](properties.md) to add a type or status. Leave [comments](comments.md) about passages that need work and ask [AI](agents.md) to continue.

To record a change, review the diff in [Git](git.md) and commit it. Automatic saving and Git commits are separate actions.
