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
around the link; choosing one opens it through the ordinary open path. It is the
reverse of following a link, and it answers with the same resolution: a line
counts when one of its links, resolved against the note that carries it by
`resolveNoteLink`, names the open note's path. So `../wiki/x.md`, `./x.md#見出し`,
`<x y.md>`, `x%20y.md` and the editor's own `file\(1\).md` all count, while an
absolute path, a `..` above the KB or another scheme does not.

What counts is what a Markdown reader sees as a link: inline links, images and
reference definitions. A link inside a code span or a fenced code block is text —
a note that explains how to write a link is not linking. Paths compare in NFC,
because a Mac may store a Japanese file name decomposed while the link is
written composed.

The reading is linear in a line's length, and has to be: it runs in the main
process, so a stalled pattern freezes the window. A first version found fences
with a lookahead and code spans with a lazy backreference, and on two crafted
lines it took four minutes. Fences are now one anchored match, code spans are
paired in one pass over the backtick runs, and a test holds both lines to under
a second.

There is no index. Asking scans the knowledge layer with the machinery of
[KB text search](KB-SEARCH.md) — the same layer, the same exclusions, the same
per-file reading guards and the same limits — reading Markdown only, and says
when a limit or an unreadable file left the answer incomplete. The scan runs when
asked rather than whenever a note opens, because without an index it costs a
read of every note. The note itself is not listed, and nothing is written.

## Not built here

Source view does not follow links; the gesture works in the rich editor. A
heading is not scrolled to. A missing page is not offered for creation. Links
into `contents/` and into another registered KB are refused rather than routed,
and no link is rewritten when a note moves. A backlink opens the note that
carries it at the top rather than at the link; the list states the line.
Frontmatter keys — OKF `relations` and `sources` — are not read as links, since
whether irori reads the bundle's own graph is the open decision in
[STATUS](STATUS.md).
A link whose case differs from the file's name is not listed, even on a
case-insensitive disk where following it works.

## Verification

`tests/note-links.test.ts` covers the resolution table above, including the
refusals, the symlink that leaves the space, the nested registered KB, the
`contents/` rejection and the validated IPC request.
`scripts/links-ui-smoke.ts` drives the real application: it follows a link down
into a folder, back up out of it, reports a missing page while the note stays
open, and carries unsaved text through a link by saving it first — and it
checks that a plain click opens nothing.

For backlinks, the same test file covers each way a destination is written,
code spans and fenced code, NFC comparison, linear time on crafted lines, the
layer exclusions, the note's own link, an incomplete scan and the validated
request. The UI suite lists the note
linking to a page, opens it from the list, and shows the answer for a note
nothing links to.
