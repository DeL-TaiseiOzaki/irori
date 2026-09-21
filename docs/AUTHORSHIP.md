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

## The portable record

The device record reaches other devices and other tools as a
[Git AI Standard v3](https://github.com/git-ai-project/git-ai/blob/main/specs/git_ai_standard_v3.0.0.md)
authorship log — the note git-ai attaches to a commit under `refs/notes/ai`:
attestation lines, a `---` divider and JSON metadata, read against the spec at
git-ai commit `e2411d9` and git-ai's own reader and writer at `0670e7e`.
`src/git/notes.ts` holds the format; `GitService` in `src/git/service.ts` reads,
writes and carries it. There is no dependency on the git-ai binary, and nothing
is written into the working tree: a note lives in a ref.

**Reading comes first.** A note names lines by number, exact only in the file as
that commit had it, so for the open note irori reads the notes attached to the
newest fifty commits that touched the file, reads each noted commit's version of
the file, and turns each attested line into the same content key the device
record uses. A line that has moved since keeps its writer; a line rewritten
since carries no claim. Session keys (`s_…::t_…`) and legacy keys resolve to the
tool the metadata names, shown with the CLI's display name when it is one irori
launches and as written otherwise; a key the metadata does not describe is
skipped, as git-ai's reader skips it. Known-human keys (`h_`) are read but
change nothing: irori marks nothing for a person's lines and does not relay
another tool's human claim as the reader's, so such a line stays unattested here.

The two records combine per line, in this order: what this device saw a run
write; what the repository's note says; what this device saw the reader save;
nothing. A save claims whatever it had not seen before, including lines that
arrived by `git pull`, so it yields to the committed record. Above the note,
the line count names the tool and says when part of it comes from the
repository's notes; source view marks those lines like any agent's; the request
sent to an agent lists them separately, as `per the repository's authorship
notes`.

**Writing, at commit.** When the reader commits through the Git panel, irori
attaches a note for that commit naming only the lines the device record
attributes to an agent run, as they stand in the committed Markdown of the
knowledge layer: one `s_<session>::t_<trace>` entry per run and file, the
session id being `SHA-256("<agent>:<run id>")[0..14]` as the standard derives
it, the trace id fresh per note. The metadata carries `schema_version`,
`base_commit_sha`, an empty `prompts` map and a `sessions` map whose `agent_id`
names the CLI, irori's run id and `"unknown"` as the model, the word git-ai's
own Claude preset writes when it cannot tell; git-ai's parser requires the field.
The reader's lines are never attested, because a save cannot tell what was typed
from what merely passed through it, and an unobserved line is not the reader's.
A commit with no agent line gets no note.

A note another tool already attached — git-ai's hooks write one from inside
`git commit` — keeps every entry and every metadata field it had; irori's
entries are appended after that tool's for the same file, later entries winning
in git-ai's reader, and its sessions are added to the map. A note irori cannot
read is left as it is, and the commit result says so. The write goes through
`git fast-import`, which is how git-ai writes notes and which refuses to move
`refs/notes/ai` unless the new tip contains the current one, so a note written
by another process between irori's read and its write is not overwritten: the
commit stands and its result says the note was not attached.

**Carrying.** Fetch, Pull and 履歴を統合 also fetch `refs/notes/ai` into
`refs/notes/ai-remote/<remote>`, the tracking ref git-ai uses, and merge it
into the local `refs/notes/ai` with `git notes merge -s ours` — or copy it when
there is no local ref yet — so a repository both tools touch ends in the same
state whichever fetched. A remote without the ref is fetched as before. Push
sends `refs/notes/ai:refs/notes/ai` after the branch, never forced; a rejection
leaves the branch pushed and says that the notes were not, which a Fetch settles.
See [GIT](GIT.md).

## What is deliberately not built

- **Nothing is written into the knowledge base.** No sidecar file, no front
  matter, no block ids. The record is an observation about the reader's own work
  on this device, not a fact the repository carries, and it belongs beside the
  existing run and source records that
  [EDITING-AND-RECORDS](EDITING-AND-RECORDS.md) already keeps device-local. The
  portable form of it is a note in `refs/notes/ai`, outside the working tree.
- **No call into `git ai`.** Its `checkpoint known_human` entry point would
  report as the reader's every line no agent hook happened to claim, which fails
  in exactly the direction that matters: an agent's line presented as the
  reader's. Its `checkpoint agent-v1` would have irori synthesise a contract it
  does not own for four different CLIs. The note is written from irori's own
  record instead, and the format is small enough to speak directly.
- **No `h_` entry**, for the same reason: irori's save observation is not the
  standard's "explicitly observed being typed".
- **No carrying of ranges across history rewrites**, because content identity
  makes it unnecessary: a note is read at the commit it describes.

## Known limits

Two lines with identical text share one attribution. Any write landing in a
space while one of its runs is executing is attributed to that run, so editing
the same checkout in another editor during a run misattributes those lines. The
record reaches a second machine, a collaborator or another tool only through
commits made in the Git panel, and only for Markdown in the knowledge layer; an
agent running outside irori is unrecorded here, though a note it wrote through
git-ai is read. The rich editor states a total rather than marking each block,
because a Markdown block and a ProseMirror node are not guaranteed to correspond
one to one; source view marks the lines.

The model is not known to irori and is written as `"unknown"`. A merge commit
gets no note. Only the newest fifty noted commits that touched a file are read,
in that file's own history: a note attached to a commit that a squash or rebase
merge on GitHub replaced is not reached, because the merge button makes a new
commit with no note (see [GIT](GIT.md)). Reading costs a `git log` and one
`git cat-file` per noted commit each time the note's saved bytes change; an
index is the next step for this as for search.
