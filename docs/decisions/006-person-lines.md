# ADR 006 — The authorship record keeps the person's lines

Date: 2026-09-21. Status: accepted. Revises the record [AUTHORSHIP](../AUTHORSHIP.md)
described for 0.1.12 (#45).

## Context

The owner wants to know, in a note worked on with an agent, which lines the
person wrote and which the agent did — and above all the person's: an agent
collaborating with a person needs them to understand what the person meant.
The owner's first framing went further: inside one line, some words may be the
person's and some the agent's.

What exists was checked first (sources and dates in
[the survey](../research/2026-09-21-authorship-provenance.md)):

- **git-ai does not record it.** The Git AI Standard v3 (`refs/notes/ai`, read at
  git-ai `0670e7e`) is line-level only. git-ai tracks character ranges
  internally, but on commit it collapses each line to a single author — the
  latest editor — and drops the person's lines unless a git-ai IDE extension
  observed them being saved (`h_` keys). Its purpose is measuring and reviewing
  AI contribution, not handing the person's intent to an agent.
- **No other tool does either.** Every Git-side tool found (Agent Trace,
  git-byline, agentblame, Cursor Blame) is line-level and treats the person's
  lines as whatever the AI did not claim. The tools that separate a person's
  words inside a line (Grammarly Authorship, Etherpad, Word's tracked changes,
  iA Writer's annotations) are closed products or write into the file.
- **Sub-line tracking would be irori's own build**: editor-side spans with
  `prosemirror-changeset` (already in the tree through Milkdown) plus a character
  diff for an agent's rewrite of the file on disk, which ADR 004 declined.

The owner then judged sub-line tracking to be more than the goal needs: a
person who changes part of a line does so to make the whole sentence say what
they mean, so a line that carries any of the person's change is the person's
line. What remains is how to record that and how an agent reads it, given that
an agent needs it only some of the time.

## Decisions

1. **One mark per line: the person wrote or revised it, or not.** The record
   keeps only those lines, keyed by the line's normalised text as before, so a
   line keeps its mark through moves and reflow and loses it when rewritten.
   Nothing is recorded for an agent's lines: an agent rewriting one of the
   person's lines produces a different line, which carries no mark.
2. **A save marks only the lines it introduced.** The host reads the bytes a save
   replaces and marks the lines of the new text the old one did not carry. A
   line that arrived by pull, from another editor or from an agent is therefore
   never claimed, which the 0.1.12 record did the first time the person saved.
   Records written before 0.1.20 are not read.
3. **An agent is told when it matters, not on every turn.** Claude Code is told
   before an `Edit`, `MultiEdit` or `Write` would change one of the person's
   lines — which lines, quoted — through the Agent SDK's `PreToolUse` hook
   `additionalContext`. The line ranges are added to a request only when the
   person ticks 自分の行を伝える, which appears when the open note has such
   lines. Both are stated as a record, not an instruction, as before.
4. **Portability, when wanted, is the standard's `h_` key alone.** The owner
   chose `h_` only: the Git AI Standard allows a note of `h_` entries, which is
   exactly this record, and git-ai reads it. Distinguishing an agent's lines from
   lines of unknown origin is not needed, because material that predates irori
   is kept apart at folder level. PR #59, which wrote agent (`s_`) entries and
   deliberately no `h_`, is closed.

## Consequences

- The note shows how many lines are the person's and source view marks them.
  The 0.1.12 display of how many lines each CLI wrote goes, with the watcher's
  attribution of a batch of changes to the run that owned the space.
- Lines the person pasted count as theirs: putting text into the note is their
  decision. Lines identical to one the file already carried are not marked.
- Only Claude Code is told at edit time. Codex, OpenCode and Pi receive the
  person's lines only through the tickbox until a comparable hook is used for
  each; which of them offers one is open.
- The record stays device-local. Writing it to `refs/notes/ai` as `h_` entries,
  and reading it back, is the next step when sharing is wanted.
