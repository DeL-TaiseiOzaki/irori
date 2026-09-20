# Who typed which line

Date: 2026-09-21. A note worked on with an agent stops being legible once the
reader cannot separate their own sentences from the ones that arrived while they
were looking elsewhere. irori observes both writers already — it saves the
reader's bytes itself and it launches the agent — so it records what it sees.

## What is recorded

A line, keyed by its own normalised text, against whoever first produced it:
the reader, or a named run of a named CLI. `src/knowledge/authorship.ts` holds
the store; `src/domain/knowledge.ts` holds the shapes and the summary an agent
receives.

Two observations feed it:

- **A save.** `save` in `src/host/main.ts` attributes the lines the saved text
  carries that were not seen before to the reader. The bytes are already in hand
  for the pre-save hash check, so this costs no extra read.
- **A write during a run.** The file watcher batches changes per space. The run
  that owns the space when a batch opens is the one that wrote it, read at that
  moment because the run can finish before the batch is handled. Markdown in the
  knowledge layer only.

A line neither observation has seen is **unattested**, not the reader's. A note
that arrived through `git pull`, or was edited in another editor, carries no
marks rather than being claimed for whoever opened it.

## Why the line's text, not its position

A line range is stale the moment the note changes: insert a paragraph above it
and every number below has moved. Carrying ranges across edits — and across
`rebase`, `squash` and `merge`, which rewrite the commits that hold them — is
the expensive half of every tool that does this. Keying on the line's own
normalised text removes the problem rather than solving it. A line that moves
keeps its author; a line that is rewritten becomes the writer's, which is what
the reader means. No diff is computed, so [ADR 004](decisions/004-ui-library-adoption.md)'s
decision against a diff library stands.

The key is normalised because rich editing renormalises spacing and bullet
markers on save without the reader having touched the line. Lines with fewer
than three characters once whitespace, punctuation and symbols are removed carry
no key at all: a blank line, a rule or a bare bullet appears in every note, and
attributing one to whoever typed the first of them would be worse than leaving
it unmarked.

## What the reader and the agent see

Above the note, a line stating how many lines each CLI contributed. In source
view, a mark at the left edge of an agent's line. The reader's own lines and
unattested lines carry nothing, because an absent mark is not a claim.

With a note selected, the request sent to an agent states the line ranges each
writer holds in the note's saved bytes — the bytes the same request tells it to
read. It is stated as a record and not as an instruction. What an agent may do
with the reader's lines belongs to the knowledge base's own contract, not to a
sentence irori prepends.

## What is deliberately not built

- **Nothing is written into the knowledge base.** No sidecar file, no front
  matter, no block ids. The record is an observation about the reader's own work
  on this device, not a fact the repository carries, and it belongs beside the
  existing run and source records that
  [EDITING-AND-RECORDS](EDITING-AND-RECORDS.md) already keeps device-local.
- **No call into `git ai`.** Its `checkpoint known_human` entry point would
  report as the reader's every line no agent hook happened to claim, which fails
  in exactly the direction that matters: an agent's line presented as the
  reader's. Its `checkpoint agent-v1` would have irori synthesise a contract it
  does not own for four different CLIs.
- **No carrying of ranges across history rewrites**, because content identity
  makes it unnecessary.

## Known limits

Two lines with identical text share one attribution. Any write landing in a
space while one of its runs is executing is attributed to that run, so editing
the same checkout in another editor during a run misattributes those lines. The
record does not reach a second machine, a collaborator, or an agent running
outside irori. Only Markdown in the knowledge layer is tracked. The rich editor
states a total rather than marking each block, because a Markdown block and a
ProseMirror node are not guaranteed to correspond one to one; source view marks
the lines.

## The next step, when it is wanted

Export and import of the
[Git AI Standard v3](https://github.com/git-ai-project/git-ai/blob/main/specs/git_ai_standard_v3.0.0.md)
note at `refs/notes/ai`, generated from this record and read back from it. That
is what makes the record portable and what lets git-ai, git-byline and anything
else that speaks the format read irori's observations — without irori depending
on a binary, and without writing into the working tree. Reading comes first:
where a repository already carries the note, irori should show it rather than
compete with it. Whether `refs/notes/ai` joins what `gitSync` pushes is a
separate decision, and GitHub's squash and rebase merge buttons drop notes.
