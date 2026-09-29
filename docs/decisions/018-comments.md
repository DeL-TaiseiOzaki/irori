# 018 — Comments on Markdown files, kept in the hibachi

Date: 2026-09-30. Status: owner request accepted; implemented for 0.1.58.

## Context

The owner asked to leave comments on any Markdown file and for the irori agent
and hibachi agents to read them. What an agent can read is decided by where the
comments are kept: the person-lines record (ADR 006) is device-local and reaches
an agent only through the prompt, so an agent can never look at it again, and
the irori agent, which takes hibachis rather than notes, would not see it at all.

## Decisions

1. **Kept in the hibachi and shared through Git.** The owner chose this over a
   git-ignored folder and over irori's data directory. A file's comments are
   `.irori/comments/<file path>.json` in its hibachi, committed like any other
   file, so they reach collaborators and other devices, show in 変更, and any
   agent working in the hibachi can read them.
2. **The file is JSON that a person or an agent can read.**
   `{ "note": "<path>", "comments": [{ "id", "body", "quote"?, "line"?, "by"?, "at" }] }`.
   `quote` is the selected text; without it the comment is about the whole file.
   `line` is where the passage began in the file (frontmatter counted) when the
   comment was written, a hint only. `by` is `human:<local part of the hibachi's
   git user.email>`. Fields irori does not know are kept on every write, so an
   agent or a later version may add replies or states. A file irori cannot parse
   is reported and never overwritten.
3. **The note is never changed.** Comments are not written into the Markdown,
   as ADR 006 also declined for authorship.
4. **Resolving removes the comment.** Git keeps its history. The last comment
   removed takes its file and the folders it leaves empty.
5. **Agents are told without a switch.** A hibachi agent given a note with
   comments gets them before the instruction (up to about 4,000 characters,
   then a pointer to the file), stated as notes on the text that are not part of
   the instruction unless it says so. Given another note or none, it gets one line
   saying how many comments the hibachi holds and where. The irori agent's list
   of handed hibachis says how many comments each carries and where they are
   kept. The owner prefers no extra controls, and the words are short.
6. **Any Markdown file of a local hibachi**: knowledge, Schema files such as
   `AGENTS.md`, and local contents. Drive files and the irori agent's own folder
   take none yet. A moved note's comments move with it.

## Consequences

- A comment's passage is found again by its text. When the text is rewritten the
  comment stays in the list and its quote says 本文に見当たりません when chosen.
  Passages are not highlighted in the editor.
- A quote taken from the rendered view is rendered text; when the source carries
  formatting inside it the comment has no line.
- Comments on a deleted note stay in `.irori/comments/` and return with the note
  if it is restored.
