# 041 — Code and other text files open in the editor

Date: 2026-10-13. Status: owner request; implemented for 0.2.13.

## Context

The owner asked that `.py` and the other files VS Code opens without being asked
open in irori too. The editor already showed any file in its source view, with
the language `@codemirror/language-data` knows by name, but only a short list of
extensions reached it (`md txt csv json yaml toml ts js css`). Everything else
went to the external application, code included.

## Decisions

1. **Every file opens in irori except a known binary format.** A file with a
   viewer (PDF, Word, PowerPoint, spreadsheets, images) opens in it; a format on
   `binaryFilePattern` (archives, programs, media, fonts, databases and model
   weights, the binary Office and design formats) goes to its application; any
   other file, with an extension or without (`Makefile`, `.gitignore`), opens in
   the editor's source view.
2. **The bytes decide.** The host reads such a file as text only when it is at
   most 2 MiB of UTF-8 without NUL, as before. When it is not, the window hands
   it to its application instead of showing an error. A listed text format
   (`textFilePattern`) still reports its error.
3. **Writing and search are unchanged.** `textFilePattern` still bounds what an
   agent's generated files may be and what search indexes. Contents files stay
   view-only.

## Consequences

- A `.env` or other secret-holding text file opens in the editor when the
  person clicks it, as in VS Code.
- A text file over 2 MiB, or in another encoding, opens in its application.
- Search does not find text in code files; that is a separate change.
