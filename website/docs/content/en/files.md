---
title: File viewers
description: Read PDFs, Office documents, images, and code alongside your notes, in tabs and side-by-side columns.
---

## Supported formats

| Format                                                       | View                  |
| ------------------------------------------------------------ | --------------------- |
| PDF                                                          | Document viewer       |
| Word `.docx`                                                 | Document              |
| PowerPoint `.pptx`                                           | Slides                |
| Excel `.xlsx`, `.xlsm`, `.xls`, `.ods`                       | Spreadsheet           |
| CSV                                                          | Table or source       |
| Images                                                       | Image viewer          |
| Code and other text files                                    | Editor, highlighted   |
| Google Docs, Sheets, Slides (`.gdoc`, `.gsheet`, `.gslides`) | Their own application |
| Archives, media, and other binary files                      | Their own application |

Office, PDF, and image viewers accept files up to 100 MiB. Rendering may differ from the original application. A spreadsheet shows its sheet tabs in a row along the bottom of the grid.

Code and other text files, such as `.py`, `Makefile`, or `.gitignore`, open in the editor highlighted for their language when they are UTF-8 text up to 2 MiB; otherwise they open in their own application. Google Docs, Sheets, and Slides files hold only the document's ID, so irori opens them in their application; see [Google Drive](drive.md).

## Open materials

Select a file in a vault's Contents to open it in the center. [Google Drive](drive.md) materials can open while their connection is available. The Knowledge and Contents lists follow the file on show: the folders above it open and its row is selected. To add, move, or copy files, see [organizing files and folders](notes.md).

PDF and Office viewers are for reading. Edit those documents in their original applications. Markdown and other text materials can be edited in irori when their connection permits writing.

## Use materials in notes

Write [Knowledge notes](notes.md) as you read and leave relative links to the materials. Ask an [AI agent](agents.md) to summarize or organize specific source files.

The agent's access depends on its CLI settings and the connection's state. A disconnected folder cannot be read as though it were connected.

## Tabs and columns

Each file you open becomes a tab. **Open beside** in the page's bar splits the page into up to four columns, each with its own tabs, so you can read a PDF next to the note you are writing. A file opened from the lists, a link, or search goes to the column you are working in. Clicking another column saves the note and moves editing there; the other columns show each file as saved.

Each vault keeps its own columns and tabs while irori runs. Tabs follow a renamed or moved file and close with a deleted one.
