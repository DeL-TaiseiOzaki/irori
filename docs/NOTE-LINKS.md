# Following a link between notes

A knowledge base is written as pages that point at each other. The recommended
template writes those pointers as ordinary relative Markdown links, because a
page's identity there is its path in the bundle (`irori-templete` ADR 002 D3);
there are no wiki links to resolve. Until now irori displayed such a link and
did nothing with it, so reading a knowledge base meant finding each next page in
the explorer.

**Ctrl/Cmd + click on a link in the rich editor follows it.** A plain click
still belongs to the editor: it places the cursor in the link's text. The
modifier is the gesture a code editor uses for the same thing, and it keeps
clicking a link from changing what is on screen while someone is writing.

Following a link goes through the ordinary open path, so the note being edited
is saved — with its usual conflict handling — before the next one is read, a
pending instruction or a running agent still refuses a space change, and a
blocked entry stays blocked.

## What a link resolves to

`src/domain/note-links.ts` resolves the target against the note that carries it,
as a Markdown reader would, and `src/host/links.ts` answers what is there:

| Written in the note | What happens |
| --- | --- |
| `other.md`, `./other.md`, `../decisions/x.md` | The note opens. |
| `other.md#見出し` | The note opens; the heading is not scrolled to yet. |
| `%E6%97%A5%E6%9C%AC%E8%AA%9E.md` | Percent-encoding is decoded, so the file is found. |
| `table.csv`, another text file | Opens as that file does from the explorer. |
| A page that does not exist | The note stays open and the missing path is named. |
| `#見出し` alone | Stated as a link inside this note; nothing opens. |
| `https://…` | Opens in the browser, through the existing address check. |
| `mailto:`, `file:`, `javascript:`, `data:`, `//host/x` | Refused. |
| `/etc/passwd`, `..` above the KB, a path with `\` | Refused. |
| A folder, or a link that is not a regular file | Refused. |
| `contents/…` | Refused while the cloud connection is unverified. |
| A path inside another registered KB, or a symlink that leaves this one | Refused. |

The host applies the space's own guards — the same `resolve` that every other
file operation uses — so a link cannot reach further than the explorer can.
A missing page is reported as missing rather than as a failure: in a knowledge
base an unwritten page is an ordinary state, and the template's `lint` skill
looks for exactly these.

## Which notes link here

**リンク元** in the note's toolbar lists the other notes in the same knowledge
base whose links lead to the open one, each with its path, line and the text
around the link; choosing one opens it at that link, through the ordinary open
path. It is the reverse of following a link, and it answers with the same
resolution: a line counts when one of its links, resolved against the note that
carries it by `resolveNoteLink`, names the open note's path. So `../wiki/x.md`,
`./x.md#見出し`, `<x y.md>`, `x%20y.md` and the editor's own `file\(1\).md` all
count, while an absolute path, a `..` above the KB or another scheme does not.

What counts is what a Markdown reader sees as a link: inline links, images and
reference definitions. A link inside a code span or a fenced code block is text —
a note that explains how to write a link is not linking. Paths compare in NFC,
because a Mac may store a Japanese file name decomposed while the link is
written composed.

Whether a link in another case counts is the disk's decision, as it is when the
link is followed. The host looks the open note up under its name in the other
case, through the same `resolve`; where that reaches the same file — same device,
same inode — the volume folds case, and `[x](Note.md)` counts for `note.md` as
following it would open it. On a case-sensitive volume it does not, as following
it would fail. The platform is not consulted: a Mac volume may be either, and so
may a mounted drive.

Opening a hit lands on the link. Each hit carries the link's label as written and
its column, found by pairing the line's brackets in one pass, and the editor
selects that text the way it selects a search result's match — with the column
choosing the link over earlier identical text on the line. Where the label is not
on screen as written — a formatted or escaped label, an image's alt text, a
reference definition, an empty label, a label that also appears in a code block,
or a file changed since the list was made — the note still opens and the notice
says the link could not be identified safely and names the line to look at.

The list keeps itself current while it is open: the host's file-change event for
that KB starts another scan, an older answer is dropped, and what is shown stays
until the newer one arrives. The scan reads and writes nothing, so it raises no
event of its own.

The reading is linear in a line's length, and has to be: it runs in the main
process, so a stalled pattern freezes the window. A first version found fences
with a lookahead and code spans with a lazy backreference, and on two crafted
lines it took four minutes. Fences are now one anchored match, code spans are
paired in one pass over the backtick runs, brackets are paired in one pass as
well, and a test holds the crafted lines to under a second.

There is no index. Asking scans the knowledge layer with the machinery of
[KB text search](KB-SEARCH.md) — the same layer, the same exclusions, the same
per-file reading guards and the same limits — reading Markdown only, and says
when a limit or an unreadable file left the answer incomplete. The scan runs when
the list is opened and when the KB changes rather than whenever a note opens,
because without an index it costs a read of every note. The note itself is not
listed — under either case where the disk folds it — and nothing is written.

## When a note moves

**名前・場所** keeps links correct across a rename or a move inside the
knowledge layer. Before anything moves, the dialog states what will change —
「参照元 2 件のノートにある 3 件のリンク」 — from the same scan that lists
backlinks; the count is exact, since each referring note is read and its links
counted, not its matching lines. **リンクも更新する** is on by default. With it
off, the move preserves every byte as before, and a note with relative links
still refuses a folder change, as before.

With it on, the move itself is unchanged — bytes copied and hash-checked,
managed images copied beside the note, the source record rebound — and only
then are links rewritten, each as an ordinary hash-checked save:

- the moved note's own links, so they still lead where they did from the new
  folder, including links to itself; a managed image copied beside it keeps its
  text;
- every other Markdown note of the knowledge layer whose link resolved to the
  old path, so that it resolves to the new one.

What counts as a link is what the backlink list counts: inline links, images
and reference definitions, read by `resolveNoteLink` outside code spans and
fenced code, compared in NFC. Only the destination changes. The link text, the
title, the `#fragment`, CRLF line endings, a BOM and frontmatter stay as they
were, and the author's form is kept: `<…>` stays `<…>`, a percent-encoded
destination stays encoded, a new path with a space is written in `<…>`, one
with parentheses with the editor's own `\(` `\)`, and `#` or `%` in a name is
percent-encoded because a reader splits at the one and decodes the other. A
destination that already resolves right — `./sibling.md` after a rename in the
same folder — is left untouched, so moving a note back restores the links by
the same mechanism. The rewrite is pure text work in `src/domain/note-links.ts`
(`rewriteLinks`, `linkCount`), linear in a line's length like the backlink
reading; `src/host/relink.ts` does the reading and writing.

A write is the editor's own save: atomic, fsynced, and refused when the file's
hash changed since it was read. A note changed meanwhile, holding unsaved text,
or unreadable is skipped and named in the status line rather than overwritten,
and the move stands. The status states what happened —
「このノート内 2 件と参照元 2 件のノートの 3 件のリンクを更新しました。」 — and,
when the scan hit a limit, that not every referring note could be checked. The
rewrite runs under the move's guards: refused during an agent run or cloud
work, serialized with the other file mutations. Trash and restore rewrite
nothing.

## Not built here

Source view does not follow links; the gesture works in the rich editor. A
heading is not scrolled to. A missing page is not offered for creation. Links
into `contents/` and into another registered KB are refused rather than routed.
A formatted label is not selected; the notice names its line. The case probe
reads the note's own folder, so a KB spanning volumes of both kinds answers for
the folder the open note is in. A change the watcher does not report — it
follows six folder levels, and some volumes report nothing — reaches the list
when it is opened again. Frontmatter keys — OKF `relations` and `sources` — are
not read as links and are not rewritten, since whether irori reads the bundle's
own graph is the open decision in [STATUS](STATUS.md). A link whose case
differs from the file's name is listed where the disk folds case, but it is not
rewritten when the note moves. Wiki links `[[…]]` and HTML `src=` / `href=` are
not rewritten, so a note holding one still refuses a folder change. The count
shown before a move covers the other notes; the note's own links are stated, not
counted, and a referring note holding unsaved text is counted there but skipped
by the move. A note linking from another registered KB is outside the scan, and
the rewrite reads every note of the layer as the scan does, within its limits.

## Verification

`tests/note-links.test.ts` covers the resolution table above, including the
refusals, the symlink that leaves the space, the nested registered KB, the
`contents/` rejection and the validated IPC request.
`scripts/links-ui-smoke.ts` drives the real application: it follows a link down
into a folder, back up out of it, reports a missing page while the note stays
open, and carries unsaved text through a link by saving it first — and it
checks that a plain click opens nothing.

For backlinks, the same test file covers each way a destination is written,
code spans and fenced code, NFC comparison, the label a hit carries and the
links that have none, the folded comparison beside the disk probe — asserting
whichever answer the fixture's own disk gives — linear time on crafted lines,
the layer exclusions, the note's own link, an incomplete scan and the validated
request. `tests/search-navigation.test.ts` covers the column
choosing the link over earlier identical text. The UI suite lists the note
linking to a page, sees a note written while the list is open join it with
nothing pressed, opens a formatted-label hit with the notice naming its line,
opens a plain one with its label selected, and shows the answer for a note
nothing links to.

For moves, `tests/move-links.test.ts` covers each destination form and the
form chosen for a new path, code and every other byte left alone, the moved
note's own links to siblings, parents and itself, several referring notes in
nested folders with the layer exclusions and a move back, a referring note
edited meanwhile or holding unsaved text, a declined update, the guard on wiki
and HTML references, linear time and the validated requests. The UI suite
renames a page and moves one into a folder, reads the dialog's count and the
status line, and follows the rewritten links both ways.
