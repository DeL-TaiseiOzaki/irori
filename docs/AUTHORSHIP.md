# The person's lines

Date: 2026-09-21 (revised for 0.1.20; see [ADR 006](decisions/006-person-lines.md)).
A note worked on with an agent stops being legible once the person cannot tell
their own sentences from the ones that arrived while they were looking
elsewhere — and an agent working with the person needs the same distinction to
understand what the person meant. irori saves the person's text itself, so it
records which lines are theirs.

## What is recorded

One mark per line: the person wrote or revised it, or not. A line that carries
any of the person's change is their line, since a person who changes part of a
line does so to make the whole sentence say what they mean. Nothing is recorded
for other lines; in particular, what an agent wrote carries no mark.

`src/knowledge/authorship.ts` holds the store, device-local under the data
directory; `src/domain/knowledge.ts` holds the shapes and the summary an agent
can be given.

**A save marks only the lines it introduced.** `save` in `src/host/main.ts` reads
the bytes the save replaces and marks the lines of the new text the old one did
not carry. A line the file already had — written by an agent, pulled from a
remote, typed in another editor — is never claimed for the person. The record
before 0.1.20 claimed any line it had not seen the first time the person saved,
pulled lines included, so records from before 0.1.20 are not read.

## Why the line's text, not its position

A line range is stale the moment the note changes: insert a paragraph above it
and every number below has moved. Keying on the line's own normalised text
removes that problem rather than solving it. A line that moves keeps its mark; a
line an agent rewrites is a different line and carries none. No diff is
computed, so [ADR 004](decisions/004-ui-library-adoption.md)'s decision against
a diff library stands.

The key is normalised because rich editing renormalises spacing and bullet
markers on save without the person having touched the line. Lines with fewer
than three characters once whitespace, punctuation and symbols are removed carry
no key: a blank line, a rule or a bare bullet appears in every note.

## What the person and the agent see

Above the note, the number of lines the person wrote or revised; in source view,
a mark at the left edge of each. Other lines carry nothing, because an absent
mark is not a claim that an agent wrote them.

An agent is told only when it matters:

- **Claude Code, before an edit.** When an `Edit`, `MultiEdit` or `Write` would
  change one of the person's lines, irori's `PreToolUse` hook in the Agent SDK
  adds, as `additionalContext`, which lines and their text. An edit that leaves
  them alone adds nothing.
- **Any agent, when the person asks.** With a note open that has such lines, the
  composer offers 自分の行を伝える, off by default. Ticked, the request names the
  person's line ranges in the bytes the agent is told to read.

Both are stated as a record, not an instruction. What an agent may do with the
person's lines belongs to the knowledge base's own contract, not to a sentence
irori prepends.

## What is deliberately not built

- **Nothing is written into the knowledge base.** No sidecar file, no front
  matter, no block ids.
- **No sub-line record.** Which words inside a line are the person's is not kept;
  the line is. The survey behind this choice, including why git-ai and the other
  tools found do not keep it either, is in
  [research](research/2026-09-21-authorship-provenance.md).
- **No record of an agent's lines**, and so no distinction between an agent's
  line and a line of unknown origin. Material that predates irori is kept apart
  at folder level.

## Known limits

Two lines with identical text share one mark, and a line identical to one the
file already carried is not marked. Text the person pastes counts as theirs.
The record does not reach a second machine or a collaborator. Only Claude Code
is told at edit time; Codex, OpenCode and Pi get the person's lines only
through the tickbox. How Claude Code's model uses the hook's context was not
exercised with a real model turn here.

## The next step, when it is wanted

Writing the record to `refs/notes/ai` as Git AI Standard v3 `h_` entries at
commit, and reading such entries back, which makes it portable and readable by
git-ai — `h_` only, since that is exactly this record. GitHub's squash and rebase
merge buttons drop notes.
