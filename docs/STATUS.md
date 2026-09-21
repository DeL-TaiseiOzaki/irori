# Implementation status — notes, native agents and connection onboarding

Backlinks land on the link, follow the disk's case and keep themselves current,
2026-09-21: the three limits the previous section recorded are closed. Choosing
a note from **リンク元** now opens it at the link. Each hit carries the link's
label as written and its column, found by pairing the line's brackets in one
pass in `linksTo`, and the editor selects that text through the search
navigation that already existed: `SearchTarget` gained an optional `column`, so
the link is chosen over earlier identical text on its line rather than the first
occurrence. Where the label is not on screen as written — a formatted or escaped
label, an image, a reference definition, an empty label, a label also inside a
code block, a file changed since — the note still opens and the notice says the
link could not be identified safely and names the line; search's own notices are
unchanged. The label rides on the matcher's existing `RegExpExecArray` contract
as a named group, so `scan` and `KnowledgeSearch` keep their shapes and a text
search hit is exactly what it was.

A link differing from the file's name only in case counts where the disk folds
case, as following it does there. `foldsCase` in `src/host/links.ts` asks the
disk rather than the platform: it looks the open note up under its name in the
other case through the same `resolve`, and the same device and inode is the same
file. `samePath` then compares in one case as well as NFC, both for the links
and for leaving the note itself out when it was reached through a link in the
other case.

The list follows the KB while it is open. The host's `files` event for that KB
starts another scan, an older answer is dropped, and what is shown stays until
the newer one arrives; the scan reads and writes nothing, so it raises no event
of its own. もう一度調べる and the update notice are gone with that.

Verification: production build, format check, **176 behaviour tests (172 passed,
four environment-gated skips)** with three new ones — the label a hit names and
the links that have none, the folded comparison beside the probe (asserting the
case-sensitive branch on this container and the other on a folding disk), and
the column preference — and all **fourteen Electron UI suites**, where
`links-ui-smoke` now sees a note written while the list is open join it with
nothing pressed, opens a formatted-label hit with the notice naming line 3, and
opens a plain one with `上の階層へ` selected. Version 0.1.16 with its notes
accompanies the change; publication follows the merge. Bracket
pairing on crafted lines: 2M `[` before a link 97 ms, 200k links before the
match 293 ms, 2M `](b.md)` with no `[` 2 ms. Breaking the image rule, the
bracket pairing, the case folding, the probe, the column preference or the
event subscription each fails a test.

The case probe reads the note's own folder; a KB spanning volumes of both kinds
answers for the folder the open note is in. The watcher follows six folder
levels and some volumes report nothing, so such a change reaches the list when
it is opened again. A formatted label is named, not selected. The index remains
the next step for search and backlinks alike.

The notes that link here, 2026-09-21: **リンク元** in the note's toolbar lists
the other notes in the same knowledge base whose links lead to the open one,
with the line and the text around each link, and opens the one chosen through
the ordinary open path. #50 made a link something to follow; this is the other
direction, which R03 and R08 both named as open.

A line counts when one of its links resolves to the open note through the same
`resolveNoteLink` that following uses, so `../wiki/x.md`, `./x.md#見出し`,
`<x y.md>`, a percent-encoded name and the editor's own `file\(1\).md` all
count. Inline links, images and reference definitions are read; a link inside a
code span or a fenced code block is text, not a link. Paths compare in NFC,
because a Mac may store a Japanese name decomposed while the link is written
composed.

There is no index. `SearchService`'s bounded walk now takes a per-file line
matcher, so text search and the backlink scan share one layer definition, one
set of reading guards and one set of limits; the scan reads Markdown only,
leaves out the note itself, writes nothing, and reports an incomplete answer as
search does. It runs when asked rather than on every open, because without an
index it reads every note. See [NOTE-LINKS](NOTE-LINKS.md).

The graph is untouched. Frontmatter `relations` and `sources` are not read as
links and the ontology panel still draws from the declared CSV pair; whether
irori reads the bundle's own graph remains the open decision recorded below.
If that is decided, `linksTo` in `src/domain/note-links.ts` is what the body
links of such a graph would use.

The reading is linear in a line's length. It runs in the main process, and the
first version's patterns backtracked — a lookahead for fences and a lazy
backreference for code spans took 236 seconds over two crafted lines, which would
have frozen the window. Fences are now one anchored match and code spans are
paired in one pass; the same lines take 10 ms, and a test holds them under a
second.

Verification: production build, format check, **173 behaviour tests (169 passed,
four environment-gated skips)** including five new ones in
`tests/note-links.test.ts`, and all **fourteen Electron UI suites**, where
`links-ui-smoke` now lists the note linking to a page, opens it from the list,
and shows the answer for a note nothing links to. In the last full run
`git-ui-smoke` hit its known intermittent `未解決 0 件` timeout; alone it passed,
and the eight suites after it passed in order. Breaking the fence opening or
closing, the info-string rule, the code-span pairing, the NFC comparison or the
escape handling each fails a test. Version 0.1.15 with its notes accompanies the
change; publication follows the merge.

A note chosen from the list opens at its top rather than at the link; the list
states the line. A link whose case differs from the file's name is not listed,
even on a case-insensitive disk where following it works. The list is not kept
current while it is open, and no link is rewritten when a note moves. The index
is the next step for both search and backlinks: `node:sqlite` with FTS5 trigram,
plus a `LIKE` path for queries under three characters, per the 2026-09-21
measurement.

Fifth release under the sync checks, 2026-09-21:
[v0.1.14-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.14-preview.1)
publishes #49's lighter package and #50's link following for Windows x64 and
Apple silicon Mac, from CI 35549385547 at `17c7aab` through release run
35549863218. The Windows installer is 215,796,224 bytes where 0.1.12's was
319,919,104, and the Mac disk image 182,424,344 where it was 281,574,107 — a
third less to download, with no feature removed. Anonymous downloads — no
credentials, straight from the release URL — returned those exact byte counts
and their SHA-256 matched `SHA256SUMS.txt`. Pages run 35550372058 deployed the
manifest from #51, and the deployed bundle names both installers, the tag and
the sizes.

The release came 16 minutes after the first shipped merge and the download page
25 minutes after it, inside the one-hour grace period. 0.1.13 has committed
notes but no package of its own: #49 had to advance past the published preview
to satisfy `release-sync.yml`, and #50 advanced again before either was
published, so one package carries both. The hourly drift run at 01:17:04Z failed
by 25 seconds — it read the download page while Pages was still deploying the
new manifest — and the dispatched run at 01:18:12Z reported `main` in step.
Publishing the website before the hour, or dispatching a re-check after the
deployment, avoids that false alarm.

Notes follow their own links, 2026-09-21: Ctrl/Cmd + click on a link in the rich
editor opens what it points at. A knowledge base is written as pages that point
at each other, and the recommended template writes those pointers as ordinary
relative Markdown links, because a page's identity there is its path in the
bundle (`irori-templete` ADR 002 D3) — there are no wiki links to resolve. Until
now irori displayed such a link and did nothing with it, so reading a knowledge
base meant finding every next page in the explorer.

A plain click still places the cursor: in an editor, clicking a link is how you
edit its text. Following one goes through the ordinary open path, so the note
being edited is saved with its usual conflict handling first, and a running
agent or a pending instruction still refuses a space change.

`src/domain/note-links.ts` resolves the target against the note that carries it,
as a Markdown reader would — `../decisions/x.md`, `./x.md`, a heading after `#`,
percent-encoded names — and `src/host/links.ts` answers what is there through
the same `resolve` every other file operation uses. A page that has not been
written yet is reported as missing while the note stays open, which is an
ordinary state in a knowledge base rather than a failure. An absolute path, a
`..` above the KB, a scheme other than http or https, a folder, a symlink
leaving the space, a path inside another registered KB and anything under
`contents/` are each refused. See [NOTE-LINKS](NOTE-LINKS.md).

Verification: production build, format check, **168 behaviour tests (164 passed,
four environment-gated skips)** including the new `tests/note-links.test.ts`,
and all **fourteen Electron UI suites**, where the new `links-ui-smoke` follows
a link down into a folder and back out of it, reports a missing page, carries
unsaved text through a link by saving it first, and checks that a plain click
opens nothing. Version 0.1.14 with its notes accompanies the change; publication
follows the merge.

Source view does not follow links; the gesture is the rich editor's. There is no
backlink list — R03 and R08 both name backlinks as open, and finding them needs
a scan or an index rather than this resolution. A heading is not scrolled to, a
missing page is not offered for creation, and no link is rewritten when a note
moves.

The package stopped carrying executables it never runs, 2026-09-21: the Linux
x64 application directory falls from 994,253,996 to 500,345,370 bytes and its
archive from 548,291,885 to 115,044,075, with no feature removed.

Most of it was a second copy of Claude Code. `@anthropic-ai/claude-agent-sdk`
declares one optional dependency per platform, each a complete executable of
about 220 MB, and npm installs whichever ones match the build machine — on Linux
the glibc and musl builds together, 433,217,072 bytes. The SDK resolves them
only when `pathToClaudeCodeExecutable` is unset, and `src/agents/service.ts`
always passes the reader's own installed `claude`, so nothing in irori ever
opened the bundled copy; a packaged application cannot spawn a file inside
`app.asar` in any case. The rest is node-pty's prebuilds for other platforms:
only `build/Release` or `prebuilds/<platform>-<arch>` can load, and the two
Windows ones alone are 58 MB. Both are removed in `packageAfterPrune`, after the
production dependency walk has seen the tree npm installed.

irori therefore redistributes no Claude Code executable, which is not MIT
licensed; what it still redistributes is rclone and node-pty's native code for
the target platform. See [PACKAGING](PACKAGING.md) and
[THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md).

Verification: production build, format check, **162 behaviour tests (158 passed,
four environment-gated skips)** and the Linux packaged smoke, which now asserts
that no `claude-agent-sdk-<platform>` entry and no prebuild for another platform
is in the archive, records the archived and unpacked weight in
`package-smoke.json` and prints it into the job log. That run also drives the
real terminal inside the packaged application, which is what shows the remaining
node-pty binary is the loadable one — it matters most on Windows, the one
platform that loads a prebuild instead of a rebuilt binary. Version 0.1.13 with
its notes accompanies the change; publication follows the merge.

All three platforms were measured by their own package jobs in CI
[35546734885](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35546734885),
which now print the weight: 115,044,452 bytes archived and 89,418,890 unpacked on
linux/x64, 115,157,019 and 121,209,642 on win32/x64, 115,058,909 and 92,590,649 on
darwin/arm64. Each run's uploaded artifact holds two compressed copies of the
application — the installer and a zip or nupkg — and falls from 384,736,007 to
178,491,380 bytes on Linux, 638,848,363 to 430,525,885 on Windows and 565,979,157
to 366,045,824 on the Mac. That also answers what the packages carried: not
another platform's binary, but one of their own, since npm installs an optional
dependency only where its `os` and `cpu` match.

This is delivery weight, not memory in use. The next measurable item is the
renderer packages Forge copies because they are production dependencies although
Vite has already bundled them into `dist/`, about 50 MB: dropping them means
generating the notices their licences require, since the bundle does not carry
each package's LICENSE file.

Fourth release under the sync checks, 2026-09-21:
[v0.1.12-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.12-preview.1)
publishes #43's per-space runs, #44's lighter package and #45's authorship
record for Windows x64 and Apple silicon Mac, from CI 35544793813 at `08900b0`
through release run 35545248675. Anonymous downloads — no credentials, straight
from the release URL — returned 319,919,104 and 281,574,107 bytes whose SHA-256
matched `SHA256SUMS.txt` and GitHub's own asset digests. Pages run 35545797228
deployed the manifest from #47, and the site's bundle names both installers and
the tag. The release came 11 minutes after the first shipped merge and the page
23 minutes after it, inside the one-hour grace period.

The version advanced from 0.1.9 to 0.1.12 in one release. 0.1.10 and 0.1.11
have committed notes but no package of their own: each pull request had to
advance the version past the published preview to satisfy `release-sync.yml`,
and publishing the intermediate ones would offer a reader two upgrades to reach
the same code. The three sets of notes describe what this one package contains.

Which lines an agent wrote, 2026-09-21: irori records who typed each line of a
note and shows it. Two observations feed the record — `save` in
`src/host/main.ts` names the reader's lines with bytes it already holds for the
pre-save hash check, and the file watcher names an agent's, attributing a batch
of changes to the run that owned the space when that batch opened, because a run
can finish before the batch is handled. Markdown in the knowledge layer only. A
line neither observation saw is unattested rather than the reader's, so a note
that arrived through `git pull` carries no marks.

The record is keyed by the line's own normalised text, not by its position. A
line range is stale the moment a paragraph is inserted above it, and carrying
ranges across `rebase`, `squash` and `merge` is the expensive half of every tool
that does this; content identity removes the problem instead of solving it. A
line that moves keeps its author, a line that is rewritten becomes the writer's,
and no diff is computed, so [ADR 004](decisions/004-ui-library-adoption.md)
stands. Normalisation absorbs the spacing and bullet markers rich editing
rewrites on save. Lines under three characters once punctuation is removed carry
no key: a rule or a bare bullet is in every note.

Above the note, a line states how many lines each CLI contributed; source view
marks an agent's lines in the gutter. With a note selected, the request sent to
an agent states each writer's line ranges in the bytes it is told to read,
**as a record and not an instruction** — what an agent may do with the reader's
lines is the knowledge base's contract, not a sentence irori prepends. Nothing
is written into the KB: the record sits beside the existing device-local run and
source observations. `git ai checkpoint known_human` is deliberately not called;
it would report as the reader's every line no agent hook happened to claim,
which fails in the one direction that matters. See [AUTHORSHIP](AUTHORSHIP.md).

Verification: production build, format check, **162 behaviour tests (158 passed,
four environment-gated skips)** including the new `tests/authorship.test.ts`,
and all **thirteen Electron UI suites**, where `harness-ui-smoke` has a fixture
append to an open note during a run, restarts the application and reads the
attribution back. Version 0.1.12 with its notes accompanies the change;
publication follows the merge.

The record is device-local: it does not reach a collaborator, a second machine
or an agent running outside irori. Identical lines share one attribution. Any
write landing in a space during one of its runs is attributed to that run, so
editing the same checkout elsewhere during a run misattributes those lines. The
rich editor states a total rather than marking each block, because a Markdown
block and a ProseMirror node are not guaranteed to correspond one to one. The
next step, when wanted, is export and import of the Git AI Standard v3 note at
`refs/notes/ai`, reading first.

Less code reaches the window, 2026-09-21: the packaged front end falls from
6,946,180 to 3,828,368 bytes and from 183 files to 131, with no feature removed.

The largest single item was a maths engine the product never offered. Crepe's
entry point is one flattened bundle whose top-level imports pull KaTeX and its
fifty-nine font files in regardless of `features: { Latex: false }`, because
that flag is read at runtime, after bundling. `src/editor/Editor.tsx` now
composes `CrepeBuilder` with the nine features the editor uses and imports each
feature's stylesheet, which removes 1.4 MB. What the discarded default
configuration added is a CodeMirror theme this file already overrides with the
application's own tokens, so behaviour is unchanged; `@codemirror/language-data`
becomes a direct dependency because the default config was what supplied it.
The dead `math` entry in the block menu, hidden since Latex was disabled, is
gone with it.

Three smaller items follow the same shape — code loaded by every session for a
minority of them. `AgentMarkdown`, the source-control, connections, search and
knowledge panels now load on first use, each wrapped so the panels below read
unchanged; a reply's own text is the fallback while its renderer arrives.
`parseSkill` moves to `src/host/skills.ts`, which takes `yaml` out of the
renderer — `src/domain/conversation.ts` needed only the name rule, and the
parser is called from the host alone. `src/app/branding.ts` points at a new
256-pixel mark, since the renderer draws it at 40 and 80 pixels while the
window, dock and installers keep the full-resolution file. About 1.9 kB of
stylesheet for a Git dialog that became an inline panel, for font classes
superseded by `data-markdown-font`, and for a `.modal-backdrop` with no base
rule, is deleted.

What the window loads before anything is opened falls from 818.7 kB to 589.4 kB
(258.7 to 187.2 compressed); the editor's own code from 1,595.5 kB to 1,253.0 kB
(519.6 to 414.7 compressed). Verification: production build, format check,
**157 behaviour tests (153 passed, four environment-gated skips)** and all
**thirteen Electron UI suites**; `ui-smoke` now expects the 256-pixel mark.
Version 0.1.11 with its notes accompanies the change; publication follows the
merge.

The installer is not smaller in proportion: the front end is about one percent
of the package, and the agent SDK's platform binaries dominate it. Memory in use
was not compared against the earlier build. Code blocks still carry every
language CodeMirror ships, which is the next measurable item and a product
question rather than a mechanical one.

One run per knowledge base, 2026-09-21: a run now belongs to a space rather than
to the application. `AgentService` holds `Map<scopeId, Run>` instead of one
`active` run, so two spaces work at the same time while a second agent in one
space is still refused. Pending permission and question requests are held against
their own run, so cancelling one space no longer denies another space's waiting
requests — the previous `requests.clear()` did. The host's exclusions are split
accordingly: organising a note, restoring one and changing a space's cloud
connection consult `busy(scopeId)`, while registering a space, removing an
account, cloning and the close prompt consult `anyBusy`. `HostAPI.cancel` takes
an optional scope, and the renderer derives `running` from a `runningScopes`
list rather than holding a separate flag, which also lets the explorer switch
spaces during a run.

Verification: production build, format check, **157 behaviour tests (153 passed,
four environment-gated skips)** including a new `tests/agents.test.ts` case that
starts runs in two registered spaces, refuses a second agent in one of them and
cancels them one at a time, and all **thirteen Electron UI suites**. No provider
is launched by that test and no model inference was requested. Version 0.1.10
with its notes accompanies the change; publication follows the merge.

Two real CLI processes at once are not exercised against live accounts, and the
memory cost of simultaneous native agents is not measured. The conversation panel
still shows one space, so a queue left in another space waits until that space is
selected again.

Markdown font preference, 2026-09-18: the existing appearance menu now lets a
reader choose among six offline system-font stacks for rendered Markdown:
system, gothic, rounded gothic, mincho, textbook and monospace. Each item previews
its own type; editor controls, source views and the rest of the application keep
their established face. The choice applies without remounting the editor and is
stored in `device-settings.json`, with a gothic default for existing devices and
validated IPC/storage values. Which face a stack resolves to is the device's
answer, not irori's: nothing is downloaded, and every stack ends in a generic
family. Version 0.1.9 with its notes accompanies the change; publication follows
the merge. Verification after rebasing onto the release sync checks: production
build, format check, **156 behaviour tests (152 passed, four environment-gated
skips)**, and all **thirteen Electron UI suites**. `ui-smoke` verifies the
expanded menu, the computed Markdown font immediately after selection and the
saved choice after two process restarts; the same run continues through rich
editing, save, undo/redo and image paste.

Daily notes and a declared note directory, 2026-09-17: a KB may now carry
`.irori/notes.json`, tracked with the KB, declaring `newNoteDirectory` (offered
by the new-note dialog instead of `Knowledge_Base/Notes`) and `daily` (a path
with `{{yyyy}}`, `{{MM}}`, `{{dd}}` or `{{date}}` tokens plus an optional template
note). **今日のノート** in the KB toolbar and on the welcome screen opens today's
note, creating it from the template on first use with the tokens filled in; an
existing note is reopened unchanged. Declared locations must stay in the
knowledge layer, and a template must be a real file of the KB, never under
`contents/`. See [DAILY-NOTES](DAILY-NOTES.md). Verification: production build,
format check, behaviour tests including `tests/notes.test.ts`, and the daily
workflow UI suite with the new steps. Version 0.1.8 with its notes accompanies
the change; publication follows the merge.

**Open decision to discuss later, important:** the recommended template
(`irori-templete`, ADR 002 D8, merged 2026-09-17) no longer ships
`.irori/ontology.json` or the ontology CSV pair. Its `Knowledge_Base/` is an
Open Knowledge Format 0.2 bundle whose pages carry `type`, `relations` and
ordinary links, and the template's `lint --irori-graph` can generate the CSV
pair for the current graph view. The owner asked that the question of whether
irori should draw its graph from the bundle itself (frontmatter and links,
as the OKF visualizer does) rather than from a declared CSV pair be recorded
here and discussed later. Nothing in irori changes until that discussion.

Third release under the sync checks, 2026-09-18:
[v0.1.9-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.9-preview.1) publishes #17's Markdown
typeface choice for Windows x64 and Apple silicon Mac from CI 35325838150
through release run 35329571029. Anonymous downloads matched `SHA256SUMS.txt`,
Pages run 35330584063 deployed the manifest from #41, and release-sync run
35330692231 reported `main` in step. The site offered the release 56 minutes
after the merge, inside the grace period. The branch predated the checks, so the
version and its notes were added while rebasing it. See [CHECKPOINT](CHECKPOINT.md).

Second release under the sync checks, 2026-09-17:
[v0.1.8-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.8-preview.1) publishes #38's daily
notes for Windows x64 and Apple silicon Mac from CI 35233045070 through release
run 35234095227. Anonymous downloads matched `SHA256SUMS.txt`, Pages run
35235488093 deployed the manifest from #39, and release-sync run 35235628568
reported `main` in step. The site offered the release 23 minutes after
the merge, inside the grace period. See [CHECKPOINT](CHECKPOINT.md).

First release under the sync checks, 2026-09-17:
[v0.1.7-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.7-preview.1) publishes #33's skill
changes for Windows x64 and Apple silicon Mac. The pull request check predicted
the tag, and `release.yml` appended the exact package facts to prose-only notes.
Anonymous downloads matched `SHA256SUMS.txt`, and the hand-dispatched drift job
on `main` reported the release and download page in step.

The release came 73 minutes after the change merged, past the one-hour grace
period, and no check had fired yet to flag it. Automatic publication is next.
See [CHECKPOINT](CHECKPOINT.md).

Release sync checks, 2026-09-17: `scripts/release-policy.ts` decides whether a
change reaches the desktop package. It names what does not ship, and any other
path, including an unclassified one, counts as shipping. `release-sync.yml`
applies it in two ways:

- A pull request that changes what ships must advance `package.json` and
  `package-lock.json` beyond the latest published preview and add
  `docs/releases/<version>-preview.1.md` with a title.
- On an hourly schedule, the workflow fails when `main` has held such a change
  unpublished for more than 60 minutes, when the latest preview lacks an
  installer or `SHA256SUMS.txt`, or when the download website does not offer it.

`release.yml` now appends the exact package facts to the notes it publishes, so
notes can merge before the package exists. The READMEs no longer name a version,
size or digest. Verification: production build, format check, behaviour tests
including the new `tests/release-policy.test.ts`, which runs against disposable
Git repositories. Separately, the release and website check ran locally against
the live release and page, with both a passing tag and two failing ones.

Previews kept in step with main, 2026-09-17:
[v0.1.6-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.6-preview.1) publishes `main` for Windows
x64 and Apple silicon Mac from the artifacts of CI 35179494206. It went out
through the first real run of `release.yml` and Pages run 35181102993, and
anonymous downloads matched `SHA256SUMS.txt`. The package version advanced to
0.1.6 because the update check never offers a newer preview of an installed
version.

`release.yml` needed three fixes before that run: a full-history checkout for
its ancestry check, a release title from the notes, and the established evidence
file names. The owner gave standing authorization to publish previews after
authorized merges, and automatic publication is the planned next step. See
[CHECKPOINT](CHECKPOINT.md).

Claude Code leaves a KB's configuration alone, 2026-09-17: `scripts/real-agents.ts`
(`npm run test:agents`) now records every file in the KB's schema layer with its
hash before each turn. It fails when a turn adds, removes or rewrites one of
those files. With the owner's authorization:

- One real Claude Code turn (CLI 2.1.273, native account) edited its note after
  one granted permission. The schema layer was identical afterwards, and no
  `.claude/` directory or settings file appeared.
- A copy of the merged `irori-templete`, registered as a KB, listed its five
  skills. A Claude Code turn with `journal` selected changed only one file, a new
  entry under `Knowledge_Base/journal/`.

Codex was not run against the new check. Verification: production build, format
check, behaviour tests, and the two authorized turns. See [SKILLS](SKILLS.md).

Hidden entries are configuration, 2026-09-16: a top-level entry beginning with a
dot is classified as schema rather than knowledge. A KB is often also an Obsidian
vault, a Git checkout and another agent tool's vault — claudian creates `.claude/`
and `.claudian/` in a vault when its plugin loads, whether or not anything is
saved there — and naming each known agent directory left `.obsidian/`,
`.claudian/`, `.github/` and `.gitignore` displayed in the knowledge pane as the
user's notes. Search and note operations already skip hidden path components, so
the classifier now agrees with the rest of the host. Declared contents roots still
win, and an ontology declaration must still point inside the knowledge layer, so a
CSV under a hidden directory is refused. See
[layered explorer](LAYERED-EXPLORER.md). Verification: production build, 148
behaviour tests (144 passed, four environment-gated skips) including new
classification cases, and all thirteen Electron UI suites.

KB-declared skills, 2026-09-16: a knowledge base can carry its own procedures in
`.agents/skills/<name>/SKILL.md`, and the composer offers them beside the agent
selector. Choosing one prepends its instructions to the request, naming the
schema-layer path they came from and leaving the user's words last, so the same
skill reaches whichever of the four harnesses is selected rather than being
duplicated into one directory per CLI. A package that cannot be read is named
under the composer instead of disappearing; a package must resolve inside its own
KB's schema layer and must not be an alias; a run naming a skill the space does
not declare fails rather than running without it.

irori reads that directory and never creates it, and does not create `.claude/`,
`.codex/`, `.opencode/` or `.pi/` in a KB. A harness run now has to leave the
KB's schema-layer entries identical, checked for the Pi and OpenCode adapters
through real child processes; the Claude Code adapter is not covered, because
exercising it needs an authorized model turn. Verification: production build,
**148 behaviour tests (144 passed, four environment-gated skips)**
including the new `tests/skills.test.ts` and a Pi protocol fixture asserting
delivery ahead of the request, and all **thirteen Electron UI suites**, where the
new `scripts/skills-ui-smoke.ts` drives the picker, the unreadable-package notice
and space isolation. See [SKILLS](SKILLS.md). No installer, website or published
release changes, and no model inference. This is the irori half of
`irori-templete` ADR 001 D9; nothing about a user's KB content is assumed beyond
that directory.

Two published targets, 2026-09-16: the website manifest describes Windows x64
and macOS arm64 only. The `macos-x64` field is removed from the schema, the
manifest, the page and the grid rather than held open at `null`, because Intel
Mac is out of scope by [ADR 002](decisions/002-release-and-workspace.md). Browser
fixtures still cover a partially released manifest. Publishing a release is now a
manually dispatched workflow that validates the named run, its commit, the tag
and the committed notes, and republishes only the installers a package job
recorded; it has not been exercised yet.

Mac launch fix, 2026-09-16: the first published Mac build could not start on the
acceptance device. It cleared Gatekeeper and then aborted in dyld with
`mapping process and mapped file (non-platform) have different Team IDs` — the
hardened runtime's library validation refusing Electron Framework, because an
ad-hoc signature carries no Team ID for it to match. The runtime is now off,
set through the `optionsForFile` callback the signing library actually reads,
and the package smoke asserts the flag is absent instead of present.

The reason CI missed it is the more useful record. The Mac package job ran on
`macos-15` while the acceptance device runs macOS 26.7, so the job launched the
package, drove node-pty and bundled rclone, and passed against an operating
system that does not enforce this. That job now runs on `macos-26`. A package
check is only evidence about the platform it runs on; treat a passing job on an
older runner as untested for the target, not as verified.

Mac packaging and update targets, 2026-09-16: the Mac package is signed, so a
downloaded build can be opened. Forge had no `osxSign`, and `@electron/packager`
signs only when that option is present, so every Mac package shipped with no
bundle seal and Mach-O members still identifying themselves as `Electron`. That
build launches in CI, where no file carries a quarantine attribute, and is
rejected as damaged after a browser download. Packaging now signs ad-hoc, with
`continueOnError` off so a signing failure fails the build. The signing library
applies hardened runtime and Electron's entitlements by default and ignores a
top-level override, so that state is asserted instead of configured.
`test:package` verifies both the built bundle and the copy inside the disk
image — seal, deep strict verification, bundle identifier, an ad-hoc signature
and the hardened runtime flag — and records Gatekeeper's own verdict rather than
asserting it, because unnotarized code is rejected by design. The manual
update check no longer treats Windows x64 as the only distribution: it resolves
one published installer name per target, so an Apple silicon Mac finds the disk
image and every other target still reports that nothing is published for it.
Verification: [CI 35062273261](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35062273261)
passes verification and all three package jobs for `6007508`. This is packaging
and delivery work; no installed-Mac acceptance is implied.

Appearance and device preferences, 2026-09-16: the sidebar carries a theme menu
(system, light, dark) and the choice is kept in a new device record,
`device-settings.json`, alongside pane sizes. Two faults behind that work are
also fixed: the renderer is loaded from a file URL, where browser storage is not
kept between sessions, so the pane sizes ADR 003 introduced never actually
survived a restart; and `useDefaultLayout` was given a fixed list of panel
identifiers while the group writes under the ones rendered, so a saved layout was
looked for under another name. Electron's `nativeTheme.themeSource` does not
reach `prefers-color-scheme` on this Linux environment, so the renderer resolves
the choice and writes `data-theme` for the stylesheet while the host still sets
`themeSource` for the window chrome. Verification: build/typecheck/format,
**141 behaviour tests (134 passed, seven environment-gated skips)** including the
new `tests/settings.test.ts`, and all **twelve Electron UI suites**, where
`ui-smoke` now asserts the chosen theme and a dragged sidebar width both survive
a restart. No installer, website or published release changes.

Assistant links, 2026-09-16: a reply's Markdown links open in the user's browser
through a new `openUrl` host route, and `AgentMarkdown` hands the address to it
instead of showing dead text. The address is validated twice — the request
validator in `src/domain/links.ts` keeps an invalid one from leaving the IPC
boundary, and the host parses it again before `shell.openExternal` — accepting
only `http` and `https` with a host, under 2048 characters. `file:`,
`javascript:`, `data:`, `mailto:` and application schemes are refused, and
react-markdown already neutralises a script URL before it reaches the page.
Nothing opens on its own: the click is the reader's and the target is in the
tooltip. Verification: build/typecheck/format, **136 behaviour tests (129 passed,
seven environment-gated skips)** including the new `tests/links.test.ts`, and all
**twelve Electron UI suites**, where `harness-ui-smoke` asserts a reply's link
carries its real address, a `javascript:` link does not, and `openUrl` rejects
one. No installer, website or published release changes.

Source-control read fixes, 2026-09-16: `fix/git-panel-reads` repairs the dropped
reads that [UI findings](UI-FINDINGS-2026-09-15.md) recorded. A status read
skipped because a merge draft was unsaved never happened, so the panel could keep
reporting the old unresolved count after the draft was resolved: `conflictDirty`
is now a dependency of that read. A file event no longer blanks the diff being
read — only a different file, side or view replaces what is shown, while
`aria-busy` still reports the read in flight — and `perform()` leaves a notice
instead of silently discarding a click that arrives during another operation.
`npm run format:check` now gates `src`, `scripts` and `tests` in CI, and the two
code files that had drifted are formatted. Verification: build/typecheck,
format check, **132 behaviour tests (125 passed, seven environment-gated skips)**,
the full **twelve Electron UI suites** and six consecutive `git-ui-smoke` runs,
which previously failed intermittently on `未解決 0 件`. No installer, website or
published release changes.

Renderer library adoption, 2026-09-15: `feat/ui-library-adoption` continues the
foundation work by using libraries the application already ships. Assistant replies
render as Markdown (`react-markdown` with `remark-gfm`) instead of one plain span,
with link and image overrides so untrusted model output can neither navigate the
application nor fetch anything. Crepe's slash menu, placeholder, link tooltip and
code-block panel carry Japanese copy through `featureConfigs`, and the same
configuration hands code blocks the token-driven CodeMirror theme, so code inside a
note follows the application theme. The source-control, workspace and registration
mode switches are Base UI toggle groups with roving focus rather than buttons
tracking `aria-pressed` by hand, and `react-error-boundary` turns a render failure
into a visible, retryable state instead of an empty window. See
[ADR 004](decisions/004-ui-library-adoption.md), which also records what was
considered and rejected (TanStack Query, virtualisation, a tree component, tooltips
and toasts, a diff library, electron-updater). Verification: build/typecheck,
**132 behaviour tests (125 passed, seven environment-gated skips)** and all
**twelve Electron UI suites** under Xvfb, including new `harness-ui-smoke`
assertions that a Markdown reply arrives as structure. `git-ui-smoke` is
timing-sensitive in the development container: it failed twice on a five second
diff expectation under load and passed alone and in quiet full chains.
No installer, website or published release changes.

UI foundation migration, 2026-09-15: `feat/ui-foundation` replaces the renderer's
hand-written UI machinery with third-party primitives without changing product
behaviour. Every colour now resolves through semantic design tokens, a designed
dark palette follows `prefers-color-scheme`, and the Crepe, CodeMirror and xterm
surfaces take their palette from those same tokens instead of three separate
built-in themes. Icons come from lucide-react; the sidebar, note and assistant
columns and the terminal split are resizable panes that remember the size the
user chose; the assistant settings popover and the source-control overflow menu
are Base UI components rather than `<details>` disclosures with hand-written
Escape and focus handling. The native `<dialog>` wrapper and the Milkdown editor
engine are kept deliberately. See [ADR 003](decisions/003-ui-foundation.md).
Local verification passes: build/typecheck, **132 behaviour tests (125 passed,
seven environment-gated skips)** and all **twelve Electron UI suites** under Xvfb,
plus light and dark screenshots of the running application. Source-control
overflow entries are menu items now, so `git-ui-smoke` queries them by menu-item
role and reopens the menu for the second entry; its assertions are unchanged.
No installer, website or published release changes.

Daily recovery continuation, source 0.1.5: [recovery and note tools](RECOVERY-AND-NOTE-TOOLS.md)
adds private unsent/commit/conflict drafts, explicit conflict recovery, manual
update checks, visible image-resolution failures, guarded note destination /
rename / move / recoverable deletion, and search match navigation. Work belongs
to the separate `feature/daily-workflow-recovery` branch; no merge or installer
publication is included. Production build/typecheck, **131 behavior tests
(127 passed; three optional native controls and one case-insensitive-filesystem
check skipped)**, all **twelve Electron UI suites**, website build/fixtures,
formatting, diff and local documentation links pass. Linux x64 Forge packaging
and relocated smoke pass, including draft and deleted-note recovery after
restart, note move/source identity, clipboard/save/undo and existing native
startup checks. All tests use disposable data without model inference.
Integrated testing reproduced and fixed stale external-file reads inventing a
conflict after a newer read, and a moved note leaving an obsolete-path error.
Deterministic reordered-read and successful note-operation UI checks pass.
That work is now merged into `main` and published as the Windows 0.1.5 preview
below.

Windows 0.1.5 delivery, 2026-09-15: the owner authorized publishing the merged
daily-recovery work. [PR #5](https://github.com/DeL-TaiseiOzaki/irori/pull/5)
merged application source as `278f5a407e270752057dbe4a10574a9450644934`, and
[CI 34853768104](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34853768104)
passed verification and all three package platforms for exactly that commit.
Its Windows artifact is published unchanged except for its download filename:
318,439,424 bytes, SHA-256
`847985f585977d596fb20605caa480c1b88b4dbb98745f8a96bf34e4d9a63491`, matching the
hash CI recorded in its own package smoke. [Pages 34896164099](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34896164099)
deployed website revision `4aa79c766c76eae557c091a9e03773e1e6c6bb36`, and the
live page was checked in a browser: it serves `v0.1.5-preview.1` with the Mac
slots disabled and no page errors. Its release-notes link is taken from the
manifest, so it cannot be left on an older release again. See [CHECKPOINT](CHECKPOINT.md) for the exact
identities and the deployment/download evidence. The owner's Windows
installation, upgrade from 0.1.4 and IME results remain pending.

Windows 0.1.4 delivery is complete. [Pages 34843640838](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34843640838)
deployed website revision `e32ed4e5aca7f4415f0f3e3e4008a44ba9caa703`; a fresh
anonymous desktop/mobile browser downloaded the complete installer at
`2026-09-14T12:31:36.870Z`, with its 318,426,624 bytes and SHA-256 matching native
CI and the public release. No page/HTTP errors occurred; Mac remains disabled.
[CHECKPOINT](CHECKPOINT.md) records the exact source, website and artifact
identities. The owner's Windows installation/upgrade result remains pending.

Post-publication test follow-up: CI 34843622651 hit an Undo history-group timing
assumption in the new fixture. A 600 ms pause before its tested edit separates
that edit from setup, while leaving immediate save/undo and all assertions
unchanged. Three focused UI runs pass. No application code or published bytes
change for this fixture correction.

Authorized publication, 2026-09-14: [PR #2](https://github.com/DeL-TaiseiOzaki/irori/pull/2)
is merged as `e72a62b53950b2ddb3f9132f4e66f341a74f80fc`. The
[Windows 0.1.4 preview](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.4-preview.1)
publishes the unchanged EXE from successful native CI 34841807049; the tested
PR-merge tree exactly matches the final merged tree. The installer is
318,426,624 bytes, SHA-256
`ffaa1ba1afc3ee358af1aee55860cca83fc294d69819907d277de6c5424de16b`, matching GitHub's
uploaded digest. [Release notes](releases/0.1.4-preview.1.md) record changes and
the exact identity. The website manifest selects 0.1.4; Pages deployment and
anonymous download verification are recorded separately when completed. Mac
downloads remain disabled. No Windows installed-device acceptance was supplied.

Daily-workflow follow-up, 2026-09-14: source version 0.1.4 addresses repeated
installed-app feedback. [Daily workflow](DAILY-WORKFLOW.md) records the reproduced
save/immediate-undo notification bug and its fix, native OS clipboard coverage,
the compact assistant and nonmodal Git source-control sidebar. App startup and
workspace branding now display the version. The exact Windows installation
that produced the report remains unidentified; image paste was not reproduced
as broken on the current Linux implementation.

Local verification: production build passes; **88 behavior tests, 85 passed
and three optional native controls skipped**; all **ten Electron UI suites**
pass on the final renderer. Website build and real/mixed/available/unavailable
fixtures also pass. Focused package verification exercises native clipboard
paste, saved asset bytes/reopening and continuous editing outside the checkout.
The UI suites cover save/undo/redo/autosave, source-control editing, partial
staging, sync/conflict recovery and assistant settings/queue recovery. The first
full UI attempts exposed old layer-test selectors; those now target accessible
names without weakening behavior assertions. No real model inference, Google
account operation, user-data reset or installer/site publication occurred.
This work uses a feature branch/PR; public Windows remains 0.1.3 until a
separately approved release. Native CI results belong to the PR checks.

Verified search checkpoint, 2026-09-14: application commit `ac935a9160f5e0a0be3d77a23e71d24073e53fcb` is pushed. [CI 34810865845](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34810865845) passes verification (build, behavior/UI suites and website fixtures) and Linux x64, Windows x64 and Mac arm64 package jobs with relocated packaged-app smoke. These are engineering checks; actual installed-device, Google-account and model acceptance remain open. No new installer or website release was published.

Development continuation, 2026-09-14: [local KB text search](KB-SEARCH.md) adds on-demand literal body search within one workspace KB. The sidebar dialog saves the editor before querying, shows paths/line previews, opens current files through existing guards, and discards responses after query/scope changes or closing. Search excludes schema, contents/Drive, hidden entries, links and registered nested KBs; file/result/I/O limits and unreadable files produce explicit incomplete results. Indexed large-vault and cross-KB/cloud search, exact cursor navigation, portable identities, backlinks/properties/file moves and D04 Google writes remain open. The public Windows installer remains the separate `9b04ed2` build.

Local verification for text search: production build passes; **88 behavior tests, 85 passed and three optional native controls skipped**; all **ten Electron UI suites** pass. The new search suite checks saved edits, KB/layer isolation, literal matching, incomplete/refresh notices, file opening, stale query/scope/close responses, retry, conflict preservation and keyboard focus. Initial dialog focus was corrected after the first UI run; the complete final run passes. Changed-source formatting, diff and local documentation links pass. Tests use disposable KBs and protocol/local-rclone fixtures. No real model turn, Google consent, user preview/data change or installer/site publication occurred. Hosted verification is recorded separately.

Verified source checkpoint, 2026-09-14: application commit `54eeee41b6c93d44297e5896613c70b0b271e9b0` is pushed. [CI 34776177942](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34776177942) succeeds in verification (build, behavior/UI suites and website fixtures) and Linux x64, Windows x64 and Mac arm64 package jobs, including relocated packaged-app smoke. The source-navigation continuation below is verified as engineering work; no new installer or website release was published. Real Google, native-model and installed-device acceptance remain open.

Source continuation after `1afe3bb`, 2026-09-14: [record search and source/artifact navigation](KNOWLEDGE-NAVIGATION.md) implement the next bounded D06 slice. Users can inspect current locations, open files through existing workspace/editor guards, follow version-specific run/artifact links, and explicitly reconnect missing sources to matching moved files. Historical bytes/paths remain immutable; copies, wrong versions, occupied IDs and cross-scope destinations are rejected. Records remain device-local. D04 Google writes/re-consent, portable identity/provenance, full-text search and native device/model acceptance remain open.

Local verification: production build passes; **81 behavior tests, 78 passed and three optional native controls skipped**; all **nine Electron UI suites** pass on the final build. New reconnection/record-navigation checks use disposable files and synthetic run/artifact records; the rclone opt-in uses a local backend. The provider fixture now waits for actual prompt receipt before testing dispatched-turn cancellation, fixing a startup timing assumption. One intermediate Git UI run stopped on its post-merge warning check; the final unchanged Git suite passes. No model inference, Google consent/mount/upload, installer publication or VM preview/data change occurred. Hosted package verification is recorded separately when available.

Remote verification completed, 2026-09-14: [CI 34773932413](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34773932413) passes the verification job (build, behavior/UI suites and website fixtures) and all three native package jobs at application commit `9d79182e33eab11d1fcdff96d9d3961cf61ef3ee`. Packaged pending-instruction restoration/removal and device-profile ownership pass on Windows x64, Mac arm64 and Linux x64. These are engineering checks without model inference; Windows/Google/IME/installed-device acceptance is still outstanding. No new installer was published.

Source continuation, 2026-09-14: implemented [conversation recovery](CONVERSATIONS.md) after `2c9396a`. Recent display history and accepted pending instructions persist by exact checkout/KB/CLI; restart requires explicit queue resumption, interrupted runs are not replayed, expired requests restore as text, and current hosts hold a single-instance lock per device profile. Existing native session handles and the public Windows 0.1.3 installer are unchanged.

Local verification for this continuation: production build passes; **78 behavior tests, 75 passed and three optional native controls skipped**; all eight Electron UI suites pass. Linux x64 Forge packaging and relocated packaged-app smoke pass, including pending-instruction restoration/removal after restart without model execution. Duplicate-claim, persistence-failure, interrupted-run and two-restart regressions pass. The first UI run stopped on a test locator that used a button's visible text instead of its accessible name; the corrected complete run passes. No Google consent, native mount or real model turn was performed. Remote native CI is a separate gate; no updated installer has been published.

Public delivery is complete for Windows testing preview 0.1.3: Pages deployment and fresh anonymous desktop/mobile download of all installer bytes pass, with the same SHA-256 as native CI and the release asset. [CHECKPOINT](CHECKPOINT.md) records the exact identity and timestamps. Google/Windows device and real-model acceptance remain unverified.

Published update, 2026-09-14 JST: [Windows preview 0.1.3](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.3-preview.1) contains application commit `9b04ed263b88b4754d03c7b79ab78816f0d73b06`. [Native CI 34764163901](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34764163901) passes verification and Linux x64, Windows x64 and Mac arm64 packages, including continuous editor save/image rendering and the existing configured OAuth handoff/cancellation. The unchanged CI EXE is **318,416,896 bytes (303.7 MiB)**, SHA-256 `c6099224db0b6137824088e19e43976d573d823af150ead5350be7b6312f442d`; GitHub's uploaded-asset digest matches. The website manifest now selects 0.1.3 and both Mac slots remain disabled. Pages deployment and anonymous delivery are recorded in the following checkpoint update.

Continuation after `d1b828c`: source version `0.1.3` addresses image paste, continuous document editing, bulk Git staging and queued conversations. It adds device-local source/run/artifact records and durable cloud-send preparation with an rclone delivery-engine test; Google remains read-only. See [implementation and limits](EDITING-AND-RECORDS.md). No new device result or real model permission was supplied. Native preview publication is recorded separately below when verified.

Local validation for this continuation: production build passes; 72 behavior tests ran, 69 passed and three optional native provider controls were skipped. All eight Electron suites and website real/mixed/available/unavailable fixtures pass. Actual rclone copy/hash verification used only disposable local directories. No real model inference, Google consent or native mount was performed. The VM preview and its samples/device data were not restarted or modified.

Google configuration follow-up: the owner registered both distributor repository secrets and reported declaring broader Drive permissions for future writing. Version `0.1.2` still requests only `drive.readonly`; [native CI 34761095540](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34761095540) passes all three platforms with the compiled client, including real rclone local browser handoff/scope/cancellation checks. Google does not receive consent during these tests; real account acceptance, token refresh, shared-drive mounts and cloud writes remain open. [CHECKPOINT](CHECKPOINT.md) records exact publication and device status. Earlier client-missing statements below describe older builds.

Terminal/Google follow-up: version `0.1.1` implements an on-demand xterm/node-pty terminal with shell discovery and native cleanup, bundled official rclone, WinFsp prerequisite guidance and distributor OAuth secrets in CI. Build, 64/67 tests (three optional native provider controls skipped) and eight UI suites pass; actual rclone browser handoff/cancellation passes without consent. [Native CI 34755088101](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34755088101) passes Linux x64, Mac arm64 and Windows x64 packaged terminal/file creation and bundled rclone startup at `3d5678c`. The verified Windows EXE is published as [0.1.1 preview 1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.1-preview.1). Google client/account consent and installed-device acceptance remain pending. [CHECKPOINT](CHECKPOINT.md) records exact publication and validation evidence; older entries below retain their historical results.

Publication follow-up, 2026-09-13: [the download website](https://del-taiseiozaki.github.io/irori/) and [unsigned Windows x64 testing preview](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.0-preview.1) are public at the owner's request. Pages run `34753093494` deploys website commit `de0a60b`; the installer retains CI-tested application commit `8683900`. Fresh anonymous desktop/mobile browser checks and a full EXE download/hash verification pass. Mac downloads remain disabled; Windows 11 installation/IME/native CLI acceptance and the full release gates are pending. See [CHECKPOINT](CHECKPOINT.md) for exact evidence. Earlier no-publication statements below describe their original milestones.

Ontology follow-up: [CSV tables and declared ontology graphs](ONTOLOGY.md) now support basic source editing, note links, parent/descendant and group filters, invalid-data feedback and a prepared native-agent setup request. Build, 64 behavior tests with all native controls enabled, all seven UI suites, Linux make/packaged CSV graph and website checks pass. The forced-renderer-crash shutdown regression also passes. Stable note/artifact/run identity, retained source versions and provenance remain D06 work. [Native CI 34752136969](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34752136969) passes all three package platforms, including the CSV graph, at implementation commit `8683900`.

Workspace follow-up: implemented direct workspace-owned Drive connections, empty workspaces, optional category selection, shared lazy cloud browsing/text reads and guarded profile removal. Existing KB-owned attachments remain usable without moving data. Build, 60 tests with native controls and all six UI suites pass; [WORKSPACE-DRIVE](WORKSPACE-DRIVE.md) records evidence and remaining legacy-transfer/provider gates. This ownership change alone does not complete the knowledge/provenance requirements; the later ontology follow-up is recorded above.

Distribution follow-up: the first remote CI clean build/tests/website and Linux packaging pass. EXE/DMG generation and Mac arm64 relocated startup pass; Windows exposed equivalent-file-URL rejection, now fixed by main-frame/canonical-file validation and awaiting native CI. Distributor OAuth build inputs now embed validated desktop client configuration only in the host; installed builds ignore developer OAuth environment settings. The 57-test suite passes locally with the usual four native controls skipped in this pass. See [PACKAGING](PACKAGING.md) for remote run evidence and remaining acceptance.

Packaging follow-up, 2026-09-13: implemented Electron Forge application/installer packaging, verification/native-package CI, an outside-checkout packaged-app smoke with SDK imports and dependency/checksum inventory, and unavailable/mixed/available website tests. Local Linux make/package, 55 tests with native controls, five UI suites and website checks pass. [PACKAGING](PACKAGING.md) distinguishes this evidence from native installer acceptance. The user selected MIT, Windows 11 x64 and MacBook M5 Pro arm64, CSV/graph ontology presentation and independent workspace-level GitHub/Drive connections; [ADR 002](decisions/002-release-and-workspace.md) supersedes unresolved Q01/Q02 and records the required ownership migration. No release/Pages deployment or model inference is included.

Checkpoint follow-up, 2026-09-13: the user authorized committing and pushing the Git collaboration and implementation reuse changes to `origin/main`. See [the current checkpoint](CHECKPOINT.md). Earlier working-tree statements below describe their original milestones.

Reuse completion, 2026-09-13: finished the remaining host/metadata/dialog/transport work and recorded outcomes for every audit candidate. OpenCode now uses its matching official SDK; Codex/Pi share bounded JSONL; metadata writes use write-file-atomic. Production source is 118 physical lines smaller than the audit baseline. Build, 54 tests with all native controls enabled, and all five Electron UI scripts pass. ACP was tried against native OpenCode and rejected as a blanket replacement for the current feature set. See [complete decisions and evidence](REUSE-COMPLETION-2026-09-13.md). Earlier dated entries retain their historical results.

Simplification follow-up, 2026-09-13: implemented the audit's high-priority Git, SSE and asynchronous UI changes with one new dependency (`eventsource-parser`). Shared production code is 71 physical lines smaller; measured Git stage process launches fell from 92 to 64 while retaining final index verification. Build, 46 behavior tests and all five UI scripts pass; four native controls remain opt-in/skipped. See [implementation and evidence](SIMPLIFICATION-2026-09-13.md). The audit paragraph below describes the preceding research, not the current implementation state.

Reuse audit, 2026-09-13: reviewed the current implementation and 15 published library candidates. Disposable probes measured Git metadata batching (stage: 92 to 60 native Git processes), SSE parser compatibility, scoped query caching and OpenCode SDK subscription readiness. Recommended next steps are Git consolidation, small protocol/query reuse and an ACP compatibility trial. Production code and application dependencies were not changed by this audit. See [reuse findings and priorities](REUSE-AUDIT-2026-09-13.md) and [recorded evidence](measurements/2026-09-13-reuse-audit.json).

Git follow-up, 2026-09-13: resumed from `9c04abb` at the user's request and implemented per-space change/index review, exact staging/unstaging, paginated history/diffs, reviewed local commits, fetch, clean fast-forward receive, explicit native merge with conflict-version review/recovery, exact-branch push and GitHub clone onboarding. Build and 42 behavior tests pass (four opt-in native controls skipped). The Electron Git journey exercises real disposable repositories/local bare remotes; live GitHub authentication and native-platform acceptance remain open. These changes are working-tree additions after `9c04abb`, not a published checkpoint. See [Git workflow and evidence](GIT.md). Dated milestone sections below retain their original evidence and limitations.

Date: 2026-09-12. Repository: `irori`, independent of both KB_design reference repositories. The implementation is saved as a Git checkpoint; see [CHECKPOINT](CHECKPOINT.md) for restart instructions. Checkpoint `2914ec4` was subsequently pushed to `origin/main` with user authorization; no deployment or release has been performed.

UI follow-up, 2026-09-13: applied the locally installed Anthropic frontend-design and Vercel web-design-guidelines skills to modernize startup, the five-pane workspace and the assistant. Graphite navigation, a paper writing surface, restrained amber accents and consistent SVG controls preserve the existing scope model. Build, 30 behavior tests and all four UI scripts pass; see [UI direction and review](UI-DESIGN.md). These UI/branding follow-ups are included in the next checkpoint after `2914ec4`, with commit and push authorized by the user.

Branding follow-up, 2026-09-13: the user-selected PNG is now the shared icon for app branding, the desktop window/Dock configuration, website branding/favicons and VM viewer. The original bytes are preserved in `assets/irori-icon.png`; see [asset notes](../assets/README.md). Native installer packaging remains open.

Pause checkpoint, 2026-09-13: the user successfully opened and explored the layered UI in Chrome and requested a checkpoint. The local checkpoint now includes workspace/cloud lifecycle management, all four harness adapters, the layered explorer and VM preview. Final UI-change evidence is build pass, 30 behavior tests passed with four native probes skipped, and all four UI scripts passed. The audit's earlier opt-in native control run passed all 34 tests without inference. [CHECKPOINT](CHECKPOINT.md) is the current restart entry; later sections retain chronological milestone evidence and their then-current limitations.

Latest implementation: 2026-09-13. Startup workspace profiles, existing-checkout inspection, read-only cloud connection services/UI and OpenCode/Pi adapters are implemented locally. See the follow-ups below, [CLOUD-SETUP](CLOUD-SETUP.md) and [HARNESSES](HARNESSES.md). Earlier dated evidence remains historical; it does not establish native acceptance of these additions.

Latest audit: workspace edit/removal, offline scope retention, attachment rename/removal and unused account removal are now implemented. Connection polling and cross-scope failure handling, placeholder recovery, attachment limits and read-only shortcuts were corrected. See [audit evidence and remaining gaps](AUDIT-2026-09-13.md).

## Implemented and exercised

- Actual Electron window with Japanese UI, native KB folder chooser, explicit personal/team/organization registration and lazy explorer.
- irori-extention reference layout: schema across the top, personal/team Knowledge Base panes in the middle and personal/team contents panes below. Repository ownership stays explicit; independent scroll/collapse and per-scope note/cloud actions are implemented. See [LAYERED-EXPLORER](LAYERED-EXPLORER.md) for the four-space renderer regression.
- Portable UUID scope declarations in the KB, absolute path bindings in device data, contents override, nested scope ownership, alias rejection in both registration orders, and reference-derived regression scenarios.
- Milkdown Crepe rich editor plus CodeMirror source mode, note creation, save, external invalidation, recovery drafts, conflict versions and explicit manual reconciliation. Save/source switching/shutdown use a current editor snapshot rather than only the delayed rich-editor change callback.
- Both **Codex and Claude Code selectable in the ordinary AI panel**, actual locally installed processes in the selected fixture KB, native account authentication left intact, streamed output and tool events, allow/deny requests and cancellation.
- A real Electron UI test selected each provider, submitted the instruction from the panel, approved fixture-local operations, observed the note's bytes change, and observed the editor refresh. The Claude run also changed the note while an unsaved editor buffer existed; the conflict UI retained both versions. This was not a mock, a model-API chat demo, or a terminal-only test.
- Independent native session continuation per scope/provider; device-local handles now survive application restart (2026-09-13 follow-up below). Conversation display history remains in memory and is separated by scope/provider. SDK and CLIs start on demand.
- Electron isolated/sandboxed renderer configuration, narrow Zod-validated IPC, blocked remote navigation, no renderer filesystem or process API.

## Verification evidence

| Check                                      | Result                                                                                                                                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                            | TypeScript checks and production frontend/host bundles pass                                                                                                                                                                 |
| `npm test`                                 | Nine behavior tests pass: isolation, aliases, conflicts/drafts, byte preservation, scope regressions, RPC crash, cancellation lock                                                                                          |
| `npm run test:ui` under Xvfb               | Actual rich Japanese edit/save, source save, unchanged bytes, edited BOM/CRLF/frontmatter/unknown syntax retention, table display, clean refresh and dirty conflicts pass                                                   |
| `npm run test:agents`                      | Both real agents append requested markers while preserving Japanese; stream/tool/permission events observed                                                                                                                 |
| `IRORI_UI_REAL_AGENTS=1 … npm run test:ui` | Both real agents modify the selected note through the normal UI and the editor reflects the result                                                                                                                          |
| Lifecycle probe                            | Claude real deny leaves note unchanged; Claude real structured question answered and same-session continuation completes; both native processes cancelled and mutation lock released                                        |
| Codex lifecycle limitations                | Denial probe produced no approval request; structured-question probe produced no request and timed out/cancelled. Neither counts as passed. The transport branches are implemented but real Codex verification remains open |
| Reference repositories                     | Both inspected revisions match handoff; both working trees remain unchanged                                                                                                                                                 |

Raw logs/screenshots and fixture paths are kept in ignored `test-results/`. Sanitized durable summaries are in [measurements](measurements/2026-09-12.md). Failure exploration was retained in the report rather than represented as a passed gate.

## Material limitations

This is a development preview, not the complete irori release. Native Windows/MacBook setup, IME, permissions, processes and installers remain unverified. Linux memory exceeds the proposed editing budget; the host is provisional. Read-only mount management and identity checks are implemented in the 2026-09-13 follow-up, with actual Google/native mount acceptance open. GitHub collaboration, cloud uploads/recovery, optional terminal, ontology editor, artifact registry and versioned provenance remain unimplemented. Unverified contents attachments remain visibly unavailable.

Codex's normal workspace sandbox could not initialize in this container (namespace restrictions); fixture mutations succeeded after native approval requests. No unsafe-mode fallback was silently added to the product. Linux root Electron automation and the explicit container-development launcher pass `--no-sandbox`; normal application configuration retains renderer sandboxing. Neither result proves native-platform OS isolation.

Per-file pre-save hash checks/atomic replace and drafts protect against observed conflicts, but there is a narrow external-writer race between the final hash check and rename. Watchers have a six-level bound. Source fallback is conservative rather than exhaustive; native Japanese IME, unusual dialects, mixed newlines and crash/power-loss recovery need more coverage. See [compatibility](compatibility/MATRIX.md).

## Next concrete work

Verify the new onboarding against an irori-configured Google OAuth application and actual native mount facilities, then implement upload observation and durable pending-write recovery before enabling write access. Complete native parity and real model acceptance for all four now-implemented harness adapters. Preserve the remaining native restart, editor, host comparison, Git recovery and full-release gates in [ACCEPTANCE.md](ACCEPTANCE.md); Q01/Q02 remain open.

## Startup follow-up — Linux root development shell

The reported installation and build completed. Startup failed because Electron rejected root execution without an explicit `--no-sandbox` flag; Node 20 engine warnings and Vite chunk-size warnings were not that failure.

Added `npm run start:container` as an explicit Linux-only development entry point. Standard startup now diagnoses root use and absent display variables before spawning Electron. It still does not disable the sandbox automatically. The launcher resolves the application directory independently of the caller's working directory and reports missing Electron binaries with the setup command.

Verified: build and all nine behavior tests pass; root/default and missing-display paths return actionable errors; the container command created the actual irori window (1440 × 940); the Xvfb UI smoke passes. No provider calls were needed for this startup fix. README now distinguishes a visible desktop session from a virtual Xvfb test display; no browser UI or remote-desktop server was added.

## Distribution website follow-up

Added a Japanese static landing/download page with the actual fixture screenshot, feature descriptions, responsive layout, setup FAQ and three platform slots. Unavailable installers are explicitly disabled; published HTTPS installer URLs can be supplied through the validated release manifest. A separate Vite build and manual GitHub Pages workflow prepare website publication without changing the desktop host boundary. No new library dependency was needed.

Verified locally: website and desktop production builds pass, all nine application behavior tests pass, and the website smoke passes in a real Electron/Chromium window. The smoke checks anchor navigation, FAQ expansion, all three unavailable download buttons, the screenshot asset and a 390px mobile layout without horizontal overflow. Desktop and mobile screenshots were visually inspected. No provider call was needed for this website work. Website publication, native installer production, signing, native tests and first-run CLI setup remain outstanding; the page does not turn the desktop app into a browser application. See [distribution](DISTRIBUTION.md).

## Session recovery follow-up — 2026-09-13

Resumed from local checkpoint `095edd0`. Native session handles are now saved under the device's `agent-sessions/` directory, bound to scope UUID, provider and canonical checkout root. Records are validated and replaced atomically with owner-only permissions on POSIX. No handles, absolute paths or transcripts are written into the portable KB. A copied/rebound checkout does not automatically inherit the previous checkout's conversation.

Codex passes the saved handle to `thread/resume`; Claude passes it through the existing SDK `resume` option and saves the handle from its primary initialization event. Malformed records stop execution before provider launch. A failed resumed run retains its handle and offers retry/reset guidance; it does not automatically start a new session. Reset is blocked during execution. The ordinary panel shows saved/empty/unavailable state and offers **会話の継続をリセット**, preserving notes and the native CLI's history. **新しい会話** resets before the next run and clears the panel's old conversation display.

Verified: `npm run build`, all 12 behavior tests, and `xvfb-run -a npm run test:ui` pass. New tests cover restart reads, scope/provider/checkout isolation, corrupt/mismatched records, and a clearly labeled Codex protocol fixture covering persisted resume, failed resume without fallback, and explicit reset. The real Electron smoke additionally restarts the host twice with seeded handles, resets Claude through the ordinary panel, and verifies that the reset persists while Codex remains selected for continuation. No page errors were observed; the session panel screenshot was visually inspected. Local UI evidence is in ignored `test-results/ui-sessions.json` and `test-results/irori-session-recovery.png`.

These new tests make no native-account inference requests and are not native-provider acceptance evidence. Actual Codex/Claude continuation after an irori restart, expired-login/provider-version recovery, native OS tests, and conversation transcript redisplay remain outstanding. Atomic replacement is not a power-loss durability guarantee; multiple irori instances do not coordinate session writes. Existing agent/editor and release gates remain in [ACCEPTANCE](ACCEPTANCE.md).

## Storage-first product clarification — 2026-09-13

Recorded the user's emphasis on multiple GitHub repositories and cloud folders as irori's core, guided account/folder setup hiding rclone configuration, native Codex/Claude behavior, and additional OpenCode/Pi support. Added a concrete proposed onboarding/ownership/connection design and reordered ACCEPTANCE accordingly. Official rclone, Google, OpenCode and Pi documentation was inspected and linked in [WORKSPACE-CONNECTIONS](WORKSPACE-CONNECTIONS.md). No physical-layout decision was inferred.

This follow-up changes documentation only. No cloud account was connected, no mount was created and no provider inference was requested. The container has no discovered rclone executable or `/dev/fuse`; native mount verification remains a separate gate. The previous 12-test/UI results belong to the session-recovery implementation and do not verify these proposed features.

## Connection onboarding implementation — 2026-09-13

Implemented an Obsidian-like startup selector with named device-local collections of existing scopes. Registration inspects actual Git roots, sanitized GitHub identity, branch and local changes; existing checkouts retain their files and location. Selected scopes remain independently owned. Saved profiles survive application restart.

The new per-space cloud screen supports named Google accounts, native browser-consent orchestration, My Drive/shared-drive folder browsing, editable contents mount names and path previews. Same-name Drive folders are distinguished by provider ID. Portable attachment declarations retain the user's Japanese/space-containing name independently of account bindings and Drive-side renames. Collisions, existing user bytes and aliases are rejected without overwriting them. Native tokens remain in irori's private device-local rclone config.

The host supervises an authenticated loopback rclone service, verifies child identity, checks native prerequisites and implements read-only mount/reconnect/disconnect operations. Access requires provider folder ID validation and a live mount with verified filesystem identity. An empty ordinary directory does not count as a mount. App cloud reads use source mode and cloud saves are rejected. Reopening a workspace reconnects its bound attachments; switching away disconnects scopes no longer selected. Unavailable clouds leave local notes usable. OAuth cancellation stops unfinished jobs and removes only the unfinished remote. Missing deployment OAuth parameters disable account creation with an explanation.

Verified on the final implementation:

| Check                                                     | Result and boundary                                                                                                                                            |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                                           | Pass; existing bundle-size warning remains                                                                                                                     |
| Behavior suite with `IRORI_TEST_RCLONE_PATH`              | 21 passed, zero failures/skips; plain `npm test` skips the one explicitly opt-in native rclone probe                                                           |
| Native rclone v1.75.1, official archive checksum verified | Real child startup/PID, authenticated RC, unauthorized request rejection, native Drive config question and shutdown; no Google consent or mount                |
| `xvfb-run -a npm run test:ui`                             | Both actual Electron scripts pass: original editor/session regression plus explicit cloud protocol fixture                                                     |
| Cloud UI fixture                                          | Two-space workspace, two accounts, My/shared-drive selection, same-name folder IDs, user aliases, collision error, restart persistence; no actual remote/mount |
| Visual inspection                                         | Startup and cloud connection screenshots inspected; artifacts remain ignored                                                                                   |

No native agent inference was requested for this slice. Actual Google consent, FUSE/Windows/macOS mounts, cloud files through native harnesses and interruption/crash recovery remain unverified. This container lacks `/dev/fuse` and deployment OAuth configuration. Read/write cloud operations, pending uploads, attachment rename/removal, ready-account removal, Git collaboration and OpenCode/Pi are not implemented. [CLOUD-SETUP](CLOUD-SETUP.md) records setup, device/portable boundaries and the remaining gates. No installer, deployment, commit or push was produced by this implementation turn.

## OpenCode and Pi implementation — 2026-09-13

The ordinary AI panel now selects all four native harnesses. OpenCode uses a fresh authenticated loopback server and event stream; Pi uses its native JSONL RPC. Both use the owning checkout's native configuration and existing provider setup. The renderer never receives arbitrary HTTP/process operations. Session handles, reset, run locking and process-tree cancellation are shared with Codex/Claude. OpenCode validates the session checkout and filters foreign conversation events; native permission replies are one-time. Pi validates resumed session files and waits for settled runs, including native retries, while command-only extension invocations can finish without invoking a model. Files not yet persisted by native Pi are not presented as saved sessions.

Added native extension dialogs and single/multiple-choice replies, with accessible question grouping and selection state. Pi's lack of standard tool approval popups and its native project-trust dependency are visible in the panel. No `--approve` or permission bypass is introduced. Schema classification now includes `.opencode`, `.pi`, `.agents`, `opencode.json` and `opencode.jsonc`, retaining contents precedence.

Verified: production build and 29 tests pass with the four opt-in native controls enabled (plain tests skip those controls). Actual OpenCode 1.18.30 verifies authenticated health, unauthorized rejection, checkout/session identity, SSE connection and shutdown. Actual Pi 0.85.1 verifies RPC discovery/abort plus native extension confirmation, lazy persistence and two fresh-process resumptions of a seeded session. None of these calls a model. Explicit executable fixtures separately cover streamed text, denial, questions, errors/crashes, cancellation, reset and failed resume without fallback. New Electron coverage exercises both adapters through the panel, multiple answers and restart/reset; original editor/cloud checks remain required. Full details and test configuration are in [HARNESSES](HARNESSES.md).

Native model inference, model-based editing/resume, full rules/skills/extensions/MCP parity and mounted-file access remain open for the new adapters. Windows/macOS testing, native Google consent/mounts and cloud uploads remain separate gates. The standalone `test:agents` and `test:lifecycle` scripts still target Codex/Claude. No credentials, transcripts, generated binaries or machine paths were added to tracked evidence. No commit, deployment or release was made.

## Interactive Linux VM preview — 2026-09-13

Added `setup:preview` and `preview:vm` development commands. A separate authenticated Xvfb desktop runs the actual Electron app; noVNC 1.7.0 and websockify provide a password-protected browser viewer over loopback. Access uses a private forwarded port. The launcher creates persistent personal/team sample KBs in ignored local state without overwriting edits, and leaves ordinary native CLI configuration/authentication intact. Closing a browser disconnects the viewer; closing irori finishes the preview services.

The browser toolbar includes a Japanese composition field that sends Unicode keystrokes to the selected app input. Verified in an actual browser: password login, desktop rendering, workspace opening, pointer/ASCII input, Japanese helper input and creation of a Markdown note with its Japanese name preserved on disk. Screenshots were inspected and stay in ignored test output. Listener inspection confirmed loopback-only addresses. Build and behavior checks pass (25 passed, four opt-in native controls skipped); no native model inference or Google login was invoked. The user's own laptop connection still depends on forwarding the VM port. This viewer is a development utility, not an installed-platform release or full native IME acceptance. See [VM-PREVIEW](VM-PREVIEW.md).
