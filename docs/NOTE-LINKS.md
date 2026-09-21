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

## Not built here

Source view does not follow links; the gesture works in the rich editor. There
is no backlink list yet — R03 and R08 both name backlinks as open, and finding
them needs a scan or an index, not this resolution. A heading is not scrolled
to. A missing page is not offered for creation. Links into `contents/` and into
another registered KB are refused rather than routed, and no link is rewritten
when a note moves.

## Verification

`tests/note-links.test.ts` covers the resolution table above, including the
refusals, the symlink that leaves the space, the nested registered KB, the
`contents/` rejection and the validated IPC request.
`scripts/links-ui-smoke.ts` drives the real application: it follows a link down
into a folder, back up out of it, reports a missing page while the note stays
open, and carries unsaved text through a link by saving it first — and it
checks that a plain click opens nothing.
