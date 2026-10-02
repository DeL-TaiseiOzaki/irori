# Implementation status — notes, native agents and connection onboarding

Published 2026-10-02: **0.1.63** (#152, conversations side by side) is merged at
the owner's request and published as
[v0.1.63-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.63-preview.1)
by release run `36957402030` from main's successful CI run `36956668641`
(source `dab3b85`). The release carries Windows 202,729,984 bytes, Mac
170,215,174 bytes and `irori-0.1.63-full.nupkg` 202,091,092 bytes; anonymous
downloads of all six release files matched GitHub's asset digests, and the three
packages matched `SHA256SUMS.txt`. The website manifest now offers this release.
Owner device checks remain: two Claude Code or Codex conversations of one hibachi
running at once on the installed Mac and Windows builds. main's CI for #149
(`76d08fa`, docs only) failed once in `harness-ui-smoke` (a reload during a
request showed no finished turns); the next run on `dab3b85` passed.

Parallel conversations, 2026-10-02 (**0.1.63**,
[ADR 020](decisions/020-parallel-conversations.md)): the owner asked for CLI
agent sessions to run in parallel, the same as Claudian's tabs. This replaces
ADR 017 D4's one run per checkout.
- `AgentService` keys runs by run id: one run per conversation (`begin` also
  refuses a second claim), any number per hibachi. Each conversation's queue waits
  only for its own run; `startNextQueued(scopeId, conversationId?)` and
  `cancel(scopeId?, conversationId?)` gain the conversation. The irori agent no
  longer keeps the person's runs out of a handed hibachi; a hand-off stays one at
  a time per irori-agent run and hibachi, and its stop stops only it. `busy(scope)`
  (any run) still holds Git, settings, reorganizing and routine steps.
- The hibachi agent's panel keeps open conversations as tabs (shown from two),
  marking running and waiting ones; running tabs cannot close; a running
  conversation without a tab gets one. The renderer tracks runs by id.
- The person-lines and `hibachi` scripts are now written atomically.
- Verified with `npm run build`, `npm test`, `xvfb-run -a npm run test:ui` and
  `npm run format:check`. Not verified: real CLI turns running side by side,
  installed Windows/macOS builds.

Published 2026-10-01: **0.1.62** (#150, folders on this computer) is merged at
the owner's request and published as
[v0.1.62-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.62-preview.1)
by release run `36841492770` from main's successful CI run `36840169441`
(source `57cf6be`). The release carries Windows 202,728,448 bytes, Mac
170,211,167 bytes and `irori-0.1.62-full.nupkg` 202,090,938 bytes; anonymous
downloads of all six release files matched GitHub's asset digests, and the three
packages matched `SHA256SUMS.txt`. The website manifest now offers this release.
Owner device checks remain: a real sync-app folder (Drive for desktop, Dropbox,
iCloud) connected on the installed Mac and Windows builds, editing there, and a
Claude Code or Codex turn reading and writing it.

Folders on this computer, 2026-10-01 (**0.1.62**,
[ADR 019](decisions/019-local-folder-connections.md)): Google's restricted-scope
review and yearly security assessment stand between Drive sign-in and people
outside the test users, and the owner wants no one to set up Google Cloud. The
owner chose the Obsidian approach: a provider's own sync app (Drive for desktop,
Dropbox, Box, iCloud, OneDrive) keeps the folder on the device, and irori shows
a folder from it in contents. The connection dialog offers **このコンピューター**
first and **Google Drive** second.
- `CloudService` keeps local connections in `.irori/local-folders.json` (no path)
  and `local-bindings/` in irori's data (the path). Connecting makes
  `contents/<name>` a symlink (a junction on Windows); `locate` checks the link's
  identity and target and the folder's device and inode before following it, and
  refuses links inside it. Folders overlapping a hibachi or irori's data are
  refused; deletion goes through `shell.trashItem`. `HostAPI` gains
  `addLocalFolder` and `bindLocalFolder`; the existing connection methods handle
  both kinds. Standard-access Claude Code gets the folders as
  `additionalDirectories`, Codex as `sandbox_workspace_write.writable_roots`.
- The website gains the bilingual synced-folders guide; the Drive guide says
  sign-in is for invited testers.
- Verified with `npm run build`, `npm test`, `xvfb-run -a npm run test:ui`, the
  website build and smoke, and `npm run format:check`. Codex 0.159.0's app server
  reported the writable root without running a model. Not verified: real sync
  apps, installed Windows/macOS builds, Windows junctions, real CLI turns.
- Google readiness draft PR #146 also claims 0.1.62; whichever merges second
  takes the next version.

Custom-domain deployment, 2026-09-30: the owner registered **irori-ai.com** at
XServerドメイン. Website-only [PR #147](https://github.com/DeL-TaiseiOzaki/irori/pull/147)
is merged at `cb1846b`; [Pages run 36691804740](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/36691804740)
successfully deployed the updated canonical/alternate, social and download URLs.
GitHub Pages is configured with `irori-ai.com`. The owner corrected nameservers
and entered DNS records: registry/Google confirm `ns1.xdomain.ne.jp`–`ns3.xdomain.ne.jp`,
and Google/Cloudflare return the four required A records plus the www CNAME.
HTTP homepage and the old-site redirect work. Anonymous HTTP browser checks
passed on rerun after a transient document 503: desktop/mobile, images, current
download targets, both languages, canonical metadata and search. **HTTPS is
live since 2026-10-02**: GitHub's DNS health check, which had reported a
DNS/CAA failure nobody could reproduce, began passing for both hosts; one more
remove/re-add of the custom domain then got a certificate for `irori-ai.com`
and `www.irori-ai.com` (until 2026-12-31), and **Enforce HTTPS** is on. HTTP and
`www` redirect to `https://irori-ai.com/`. GitHub Support was not contacted
([HTTPS diagnosis and resolution](CUSTOM-DOMAIN.md#https-diagnosis-and-resolution)).
[DNS and ownership steps](CUSTOM-DOMAIN.md) record the evidence.
The owner added the Google Domain Property TXT record; a fresh Google DNS
response matches the supplied value. On 2026-10-01 the owner reported that
Search Console confirmed ownership and opened the Domain Property.
The published desktop remains 0.1.61. Google readiness is separate draft
[PR #146](https://github.com/DeL-TaiseiOzaki/irori/pull/146); no Google publishing
or verification setting has changed.

Published 2026-09-30: **0.1.61** (#142) is merged at the owner's request and
published as [v0.1.61-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.61-preview.1)
by release run `36672845624` from main's successful CI run `36671463044`
(attempt 2, source `1d11447`). Windows and Mac package launch/update checks passed;
Linux package checks passed. The release carries Windows 202,725,888 bytes,
Mac 170,185,390 bytes and the Windows full update package
202,086,166 bytes. Anonymous downloads of all six release
files matched GitHub's asset digests; the three application packages also matched
`SHA256SUMS.txt` and native package evidence. The website manifest now offers this
release. Pages deployment and release-sync verification follow its merge.

The first main CI attempt caught an existing Schema UI smoke timing race: the
watcher could list a renamed skill before its metadata write completed. The
assertion now polls for the same exact file contents, preserving all checks;
the focused smoke passed locally. The unmodified source CI passed on attempt 2.

Correctness/performance audit, 2026-09-30: **0.1.61**, based on published
0.1.60 (`b91a1dd`).
The [audit](AUDIT-2026-09-30.md) records the current architecture, reproductions,
measurements and remaining candidates. Small changes across eight application
files recover transient search/graph read failures, preserve live permission/
question controls across delayed snapshots, avoid repeated history reads during
ordinary streaming and document reads for another hibachi's file events, and
repair differently cased body/frontmatter references during moves. Conversation
reads retain only the existing view window while preserving stored history.

Verification on the isolated branch: `npm run build`, `npm test` with local
rclone (**399 tests: 394 passed, zero failed, five environment-gated skips**),
all **26 Electron UI suites**, `npm run format:check`, changed documentation
links and `git diff --check` passed. The fifth skip is the optional sibling
irori-templete fixture, absent beside the temporary worktree; the shared checkout
passed 395 with four skips before isolation. New regressions failed before their
corrections, including a 64 MiB heap-limited history read. Five paired Node 24.21.0
measurements on a synthetic 100 MiB history reduced median heap growth from
148 MiB to 21 MiB and RSS from 201 MiB to 48 MiB; time was 270 ms versus 299 ms,
so this is a memory improvement rather than a history speedup. Real model
inference and installed Windows/macOS device acceptance were not run. Native CI
package launch and update checks passed before publication.

Published 2026-09-30: #136 (**0.1.58**, comments), #139 (**0.1.59**, prompts) and #140
(**0.1.60**, conversations) are merged in that order, by the owner's own `gh pr merge` after
this session's merge was refused by the classifier, and published together as
[v0.1.60-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.60-preview.1)
by release run `36660235725` from main's CI run `36658865418` (source `a6b53a0`). 0.1.58 and
0.1.59 were never published on their own; the release notes are 0.1.60's. The release carries
Windows 202,725,888 bytes, Mac 170,183,421 bytes and `irori-0.1.60-full.nupkg` 202,086,069
bytes; anonymous downloads matched `SHA256SUMS.txt`.

Conversations, 2026-09-30 (**0.1.60**, #140):
[ADR 017](decisions/017-conversation-history.md) stage 1 (D1, D2, D4, D5 without search, D6's
**新しい会話**, D8), described in [CONVERSATIONS](CONVERSATIONS.md). The owner approved the plan
on 2026-09-30 and chose, where the ADR was silent or the code differed from it: record tool
results (Claude Code's `tool_result`, Codex's finished items) with the 1 MiB mark, views still
getting 16,000 characters; the irori agent's hand-off through the `hibachi` command goes to one
hibachi conversation per irori agent conversation (`handedBy`); a resume that fails before the
agent does anything sets this device's handle aside, so the next turn starts a new session.
- `src/agents/conversations.ts` (`ConversationStore`) keeps `<data>/conversations/<id>/`
  (`meta.json` atomic, `events.jsonl` appended with fsync, U+2028/U+2029 escaped) and
  `<data>/conversation-state/<id>.json` (queue and run in progress), one `SerialQueue` per
  conversation, the 250 ms buffer, recovery of a claimed run from its claim, damage counted
  per line and per `meta.json`. `src/host/device.ts` makes `device.json`.
  `src/agents/conversation-migration.ts` moves `agent-conversations`/`agent-sessions` once
  (deterministic ids, `conversations-migrated.json`), leaving the old files.
- `AgentService` keeps the run map by space (one run per checkout), places each run in a
  conversation (named, the owner's latest for the CLI, a routine step's own, or a hand-off's),
  resumes `native[deviceId]` only with the same checkout digest and access, and gives every
  event an id and its conversation. `SessionStore`, `resetSession` and `newSession` are gone.
- `HostAPI`: `agentConversations`, `agentConversation(scopeId, agent, id?)`,
  `createConversation`, `renameConversation`, `pinConversation`, `archiveConversation`,
  `deleteConversation`, `removeQueuedMessage(conversationId, id)`, `startNextQueued`;
  `agentSession`, `resetAgentSession` and `startQueuedMessage` removed. Renderer:
  `src/app/ConversationHistory.tsx` (履歴) in the hibachi panel and `YourAiPanel`, whose header
  gains 新しい会話; the panel follows one conversation per owner and drains the owner's queue
  oldest first; `AgentLog` shows a tool's result under its call (by `call`), and a CLI's
  later updates of one call join its step. Routine records name their step's conversation.
- Verified with `npm run build`, `npm test` (393 tests with #136 and #139 below it: 386 passed, 0 failed, 7 skipped; new
  `tests/conversation-migration.test.ts`, rewritten `tests/conversations.test.ts` and
  `tests/sessions.test.ts`), `xvfb-run -a npm run test:ui` (exit 0; new
  `scripts/conversations-ui-smoke.ts`) and `npm run format:check`. Real CLIs were not run.
- Not done: stage 2 (a chosen folder, search) and stage 3 (rewind, clone, rebuilt context);
  a conversation continued on another device or folder starts a new native session without
  the earlier turns until then. Removing the old `agent-conversations`/`agent-sessions`
  files is for the release after this one.
Prompts in one place, 2026-09-30 (**0.1.59**): the owner asked to gather the words irori gives CLI agents
by situation and to have every mechanism take them from there. They now live in `prompts/` at the
repository root, one file per situation (the irori agent's handed hibachis and starter Schema, the
hibachi sub-agent definition and hand-off, selected note, person's lines, comments, sources, skill,
routine step, refusals), indexed with their order and channel in `prompts/README.md`; `AGENTS.md`
makes it the rule. The text is unchanged except that Claude Code now hears the same
"User declined to answer." as Codex. `tests/prompts.test.ts` fails when a prompt file or export is
missing from the index. Verified with `npm run build`, `npm test` and `xvfb-run -a npm run test:ui`.

Comments, 2026-09-30 (**0.1.58**; [ADR 018](decisions/018-comments.md)): the owner asked to comment
on any Markdown file and for the irori agent and hibachi agents to read the comments. **コメント** in
the note's bar (`src/app/NoteComments.tsx`) comments on the selected passage or the whole note;
choosing a quote selects it in the editor (`EditorHandle.selection` / `reveal`), and **解決** removes
a comment. Comments are kept in the hibachi as `.irori/comments/<path>.json`, committed with it
(the owner's choice), by `src/host/comments.ts` through the new `HostAPI` methods `noteComments`,
`addNoteComment` and `removeNoteComment`; unknown fields survive and a broken file is never
overwritten; a moved note's comments move with it. A hibachi agent's instruction carries the
comments of its note, or one line saying where the hibachi's comments are; the irori agent's
hibachi list gives each hibachi's count (`src/domain/comments.ts`, `src/domain/you.ts`). Verified
with `npm run build`, `npm test` (new `tests/comments.test.ts` and a harness test of the prompt Pi
receives) and `xvfb-run -a npm run test:ui` (new `scripts/comments-ui-smoke.ts`). Not done: a real
CLI reading the comments, highlighting passages in the editor, Drive files and the irori agent's folder.

Published 2026-09-30: #137 (**0.1.57**, routines) is merged at the owner's word
("mergeして公開まで行きましょう．") and published as
[v0.1.57-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.57-preview.1)
by release run `36623266425` from main's CI run `36621924195` (source `1c45665`).
The release carries Windows 202,709,504 bytes, Mac 170,162,875 bytes and
`irori-0.1.57-full.nupkg` 202,070,226 bytes; anonymous downloads matched
`SHA256SUMS.txt`. #133 (the design record alone) was closed as carried by #137.

Routines, 2026-09-30 (**0.1.57**, #137, which carried #133's design commits):
[ADR 016](decisions/016-routines.md)
stage 1, described in [ROUTINES](ROUTINES.md). The owner chose routines as irori's one
general way to gather what a person keeps in other tools and to run any defined job: a
folder with `routine.yaml` in the irori agent's `routines/` or a hibachi's
`.irori/routines/`, `run` and `agent` steps, started only by **実行**. The owner put the
list in irori mode, as a third view (**ルーティン**) beside the map and the columns.
- `src/host/routines.ts` (`RoutineService`) reads `routine.yaml` strictly (Zod, one-sentence
  reasons), finds routines for the open workspace, keeps the review (a digest of the folder
  and the confirmed text, so a change shows line by line; a changed routine runs only with the
  digest the review showed), runs `run` steps (`.js` with irori as Node once **JavaScript** is
  added, other files by their `#!` line, argv commands from `PATH`) with `IRORI_WORK`,
  `IRORI_STATE` and `IRORI_ROUTINE`, honours `{"continue": false}`, stops on **停止**, and
  records each run (last 20; output capped at 16 KiB; files changed per hibachi from Git
  status and content hashes). A run left running is marked unknown when irori opens.
- Agent steps go through `AgentService.startStep`: an ordinary run shown in its
  conversation, in a new native session that is never saved (the person's own session
  stays), with the preamble (gathered text is material, no routine edits, report changes,
  `[FAILED]`) and the variables in the CLI's environment. A step waits while its agent or a
  handed hibachi runs. Running routines hold Git operations as agent runs do; quitting asks.
- `HostAPI`: `routines`, `reviewRoutine`, `runRoutine`, `stopRoutine`, `routineRuns` and
  `routine` events; the device setting `routineRuntimes`. The renderer's
  `src/app/RoutinesView.tsx` lists routines by owner with **実行**/**停止**, the review
  dialog, steps with output or report, changed files, history, and an agent step's request
  answered in the step; the settings have the **JavaScript** switch.
- Verified with `npm run build`, `npm test` (377 tests: 370 passed, 0 failed, 7 skipped as
  before; new `tests/routines.test.ts`), `xvfb-run -a npm run test:ui` (exit 0; new
  `scripts/routines-ui-smoke.ts`) and `npm run format:check`.
- Real CLIs, at the owner's word (2026-09-30), with `npm run test:routines` on a disposable
  Git hibachi: Claude Code 2.1.280 in the standard mode (this container runs as root, where
  Claude Code refuses `bypassPermissions`; the script allowed its one write request as the
  person would in the step) and Codex 0.156.1 in full access (its sandbox cannot start
  here). On each, a `run` step wrote `$IRORI_WORK/items.txt` and an agent step turned it
  into `Knowledge_Base/inbox-<cli>.md` in about 15 s; the run's change record named exactly
  that file, the conversation showed the routine's line and the step's prompt without the
  preamble, and no native session was saved. A second routine whose agent could not do its
  task reported `[FAILED]` with a reason, and the step failed with that reason.
- Not done: secrets, Python and the irori agent's routine skill (stages 2–4); an installed
  macOS or Windows 11 app; real Pi, OpenCode and Hermes Agent steps; changes under a
  hibachi's contents folders are not in a run's record.

Published 2026-09-29: #131 (**0.1.56**, labels and values) is merged at the owner's word
("マージ公開までやって") and published as
[v0.1.56-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.56-preview.1)
by release run `36560142606` from main's CI run `36559142972` (source `71b8da6`).
The release carries Windows 202,697,216 bytes, Mac 170,115,058 bytes and
`irori-0.1.56-full.nupkg` 202,056,864 bytes; anonymous downloads matched
`SHA256SUMS.txt`. A second copy pass after 0.1.55: visible text is labels and values,
errors are one sentence, names are as short as they can be, and nothing is shown twice
on one screen. 送信待ち is the single term for changes waiting for Google Drive.

Published 2026-09-29: #129 (**0.1.55**, less explanatory text) is merged at the owner's
word ("マージ＋公開までやって") and published as
[v0.1.55-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.55-preview.1)
by release run `36544049853` from main's CI run `36542859364` (source `15f7c3d`).
The release carries Windows 202,705,408 bytes, Mac 170,161,478 bytes and
`irori-0.1.55-full.nupkg` 202,065,578 bytes; anonymous downloads matched
`SHA256SUMS.txt`. The owner's rule behind it: a well-designed screen needs no
explanation, so helper paragraphs, repeated tooltips and "where this is kept" notes
were removed, and only what prevents a wrong or irreversible action stays, in one
sentence. The download website was redesigned in English (#127) and cut down the same
way (#128).

Published 2026-09-29: #125 (**0.1.54**, page properties) is merged at the owner's word
("同じ字で公開してください") and published as
[v0.1.54-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.54-preview.1)
by release run `36530029192` from main's CI run `36529091919` (source `f46a187`).
The release carries Windows 202,713,600 bytes, Mac 170,175,782 bytes and
`irori-0.1.54-full.nupkg` 202,074,276 bytes; anonymous downloads matched
`SHA256SUMS.txt`. #124 (the design record alone) was closed as carried by #125.

Page properties, 2026-09-29 (**0.1.54**; [ADR 015](decisions/015-page-properties.md) stage 1): the owner asked for
Notion-like properties above a knowledge page instead of hand-written YAML
frontmatter. Every Markdown page of the knowledge layer except `index.md` now opens
with its title and description as the heading and one row per property
(`src/app/PageProperties.tsx`, `src/app/PageEditor.tsx`); irori assumes no folder
names. The optional `.property/property.json` (irori-templete ADR 005), read by the
new `HostAPI` method `pageProperties` with the person's actor from the KB's
`git config user.email`, supplies selects, required keys and the keys a type adds.
Edits rewrite one value in place in the YAML source (`src/domain/properties.ts`), so
comments, order, quoting and flow collections survive; broken frontmatter opens as
YAML and is left alone. Saving a changed page sets every `auto: last-change`
property to `{ by: human:<id>, at }` in the editor's own text first, so autosave
does not loop. Verified with `npm run build`, `npm test` (new
`tests/properties.test.ts`) and `xvfb-run -a npm run test:ui` (new
`scripts/properties-ui-smoke.ts`). Not done: pickers for `resource`, `sources` and
`relations`, **確認済みにする**, tag suggestions, a new page from a type (stages 2
and 3), and native IME in the property fields.

Published 2026-09-28: #122 (**0.1.53**) is merged at the owner's word ("マージして公開して")
and published as
[v0.1.53-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.53-preview.1)
by release run `36428007641` from main's CI run `36426700197` (source `d54aae9`).
The release carries Windows 202,679,296 bytes, Mac 170,128,671 bytes and
`irori-0.1.53-full.nupkg` 202,039,339 bytes; anonymous downloads matched
`SHA256SUMS.txt`.

Make a hibachi here and publish it, 2026-09-28 (**0.1.53**): the owner asked for the reverse of cloning — a hibachi
made in the app that becomes a GitHub repository. **hibachi を追加 → 新しく作成**
creates a folder, starts Git on `main`, registers it and commits only
`.irori/scope.json` and `.gitignore`; **GitHub にもリポジトリを作成する** publishes it in
the same step. In the 変更 view an ordinary-folder hibachi gets **Git を始める**, and a
hibachi without a remote gets **GitHub に公開…**, which runs `gh repo create`
(private by default), adds `origin` and pushes through the existing push path
with the authorship notes ([GIT](GIT.md#making-a-hibachi-here-and-publishing-it)).
New `HostAPI` methods: `createSpace`, `gitInit`, `githubAccount`, `gitPublish`;
`src/git/github.ts` runs gh. Verified with `npm run build`, `npm test`
(`tests/git-publish.test.ts`) and `scripts/git-ui-smoke.ts` with a stand-in gh.
Unverified: a real `gh` against github.com (repo creation, `git_protocol`,
organizations without `read:org`), macOS and Windows. The new hibachi does not
copy the irori-templete structure.

Published 2026-09-28: #120 (**0.1.52**) is merged at the owner's word ("マージ公開までやって")
and published as
[v0.1.52-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.52-preview.1)
by release run `36376072906` from main's CI run `36375356486` (source `b002eb2`).
The release carries Windows 202,672,128 bytes, Mac 170,114,421 bytes and
`irori-0.1.52-full.nupkg` 202,031,825 bytes; anonymous downloads matched
`SHA256SUMS.txt`. Drive mounts, editable and read-only, use rclone's full cache
(`CacheMode` 3, 2 GiB and 7 days per mount), so a file read once is not
downloaded again on reopening or on the 25 s re-read. Checked: build, unit tests
with rclone 1.75.1 and the option types in rclone's own `options/set`.
Unverified: a real mount on macOS or Windows 11.

Published 2026-09-28: #118 (**0.1.51**) is merged at the owner's word ("マージまでしていいよ",
then "公開して") and published as
[v0.1.51-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.51-preview.1)
by release run `36374442510` from main's CI run `36372933316` (source `79dcffa`).
It carries Windows 202,672,128 bytes, Mac 170,114,933 bytes and
`irori-0.1.51-full.nupkg` 202,030,746 bytes; anonymous downloads of all three
matched `SHA256SUMS.txt`.
- The irori mode rail button shows `assets/irori-mode-icon-256.png` at 40 px,
  dimmed unless hovered or current. The 2048 px master was upscaled from the
  owner's `irori-agent-mode.png` with Real-ESRGAN and given `irori-icon.png`'s
  tile silhouette. Checked in the dark theme's screenshots only; not yet seen
  in the light theme or an installed app.
- `harness-ui-smoke.ts:271` failed on every CI run of main at `d3f46b9` and of
  this PR: the done-message count could be taken before the OpenCode
  conversation's history loaded, so the check read the previous run's
  `default` session. Both OpenCode access checks now poll the session.

Published 2026-09-27: #114 (**0.1.48**), #115 (**0.1.49**) and #116 (**0.1.50**)
are merged at the owner's word ("全部マージしていいよ") and published together as
[v0.1.50-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.50-preview.1)
by release run `36322699549` from main's CI run `36322115768` (source `be6c046`).
0.1.48 and 0.1.49 were never published on their own. The release carries Windows
201,456,128 bytes, Mac 168,933,078 bytes and `irori-0.1.50-full.nupkg`
200,816,614 bytes. The three entries below describe the branches; "not yet
merged" in them is superseded. PR CI flakes seen on the way, both passing on
rerun: `harness-ui-smoke.ts:271` (an OpenCode session read as `default` once) and a
Linux `npm ci` headers download reset. The owner verifies real CLIs (Hermes, Pi
and Hermes running `hibachi`, Codex/OpenCode picking `hibachi-*` sub-agents,
Claude Code as the irori agent in full access).

irori agent parity, 2026-09-27 (branch `feat/irori-agent-parity`, stacked on
`feat/schema-settings` and `feat/hibachi-agent`, not yet merged; **0.1.50**): the
owner asked that the irori agent and hibachi agents have the same shape. There
is no "hibachi mode" label any more. The irori agent's screen edits its folder
with the same Schema settings as a hibachi (root `AGENTS.md` only as
instructions, never deleted; skills from its `.agents/skills`; rules; hooks),
through the same four `HostAPI` methods with its id as the scope;
`SchemaSettingsService` now resolves a `SchemaFolder` (a hibachi's checkout or
`YourAiService.schemaFolder`) and keeps the path, alias and hash rules; writes
wait while the irori agent runs. The irori agent starts in full access on every
CLI, Claude Code included (`yourAiAccess` removed), with the composer's access
pill; on Claude Code the `PreToolUse` write hook still decides in
`bypassPermissions` and sub-agents inherit the mode. Pi and Hermes Agent, which
load no sub-agents from files, get a `hibachi` command on the run's `PATH`
(`src/agents/hibachi-bridge.ts`): a loopback server with a per-run token, a
launcher in irori's data directory running irori's own executable as Node, and
a hand-off that starts that hibachi's own run (same CLI and model,
`defaultAgentAccess`) as the one run the irori agent's hold admits, reports its
words back and appears in both logs; `brainsCommandPreamble` replaces the
direct-work preamble. Verified with `npm run build`, `npm test` (new
`tests/hibachi-command.test.ts`) and `xvfb-run -a npm run test:ui` (the irori
agent smoke now covers the settings, the access pill and a Pi hand-off through
the real Electron-as-Node launcher). Unverified: real Claude Code in
`bypassPermissions` as the irori agent, real Pi/Hermes shells running `hibachi`
(environment and tool timeouts), `hibachi.cmd` on Windows, installed apps
([YOUR-AI](YOUR-AI.md#limits)).

Schema settings, 2026-09-27 (branch `feat/schema-settings`, not yet released):
the brain panel's Schema section lists 指示 / Instructions (`AGENTS.md` at the
root and in knowledge folders), スキル / Skills, ルール / Rules
(`.claude/rules/*.md`) and フック / Hooks (`hooks` in `.claude/settings.json`)
instead of the raw file tree, which stays behind a ファイルとして表示 toggle.
Each item opens a form on the stage; a skill is defined by name, description,
instructions and attached files rather than by writing `SKILL.md`. Storage is
unchanged. Four narrow `HostAPI` methods (`schemaSettings`, `readSchemaFile`,
`writeSchemaFile`, `moveSkill`) accept only those paths, inside the brain, with
no alias and hash-checked writes, and wait while a run, Git or a connection is
busy. Details and limits: [SKILLS](SKILLS.md#schema-settings). Verified with
`npm run build`, `npm test` and `xvfb-run -a npm run test:ui`, which gains
`scripts/schema-settings-ui-smoke.ts`. Not done: Codex/OpenCode/Pi hook formats,
binary attachments (text only, 2 MiB), and a real-agent check that Claude Code
picks up a rule or hook written this way.

Hibachi Agent, 2026-09-27 (branch `feat/hibachi-agent`, not yet merged or
published): the brain's AI panel and its entry points are called **Hibachi
Agent**. It starts in full access wherever the CLI offers it (`defaultAgentAccess`),
also for instructions sent from the Overview, and the open note's context chip
can be removed and put back. Runs no longer stop after 10 (your AI: 30) minutes;
Pi's `prompt` reply lost its 600-second deadline too, since an extension command
can hold it while the person answers. **Hermes Agent** is the fifth CLI
(`src/agents/hermes.ts`): `hermes chat --query-file - --format stream-json` with
the prompt on stdin, `--resume`, `-m` and `--yolo` (full access only), parsed per
Hermes's `stream_json.py`. It is exercised only by a protocol fixture; Hermes is
not installed here. Every composer has a **model pill** fed by the new HostAPI
`agentModels(agent)` (`src/agents/models.ts`, cached per CLI version): Codex
`model/list` and Claude Code `supportedModels()` were read live from codex-cli
0.156.1 and Claude Code 2.1.280 without generating text; OpenCode and Pi lists are
fixture-parsed; Hermes takes a typed name. The model travels as `StartRun.model`
(validated, never an option) to each CLI's own model setting. **Your AI** runs on
any CLI, chosen with its model in its panel and kept in the device settings.
Claude Code keeps sub-agent delegation, its write hook and standard access; other
CLIs get a preamble naming each brain's folder and telling them to read its
`AGENTS.md` first, and run in full access, with no enforced write boundary
([YOUR-AI](YOUR-AI.md)). UI smokes whose fixtures assumed the old standard access
or the old label now select or seed it explicitly. Details:
[HARNESSES](HARNESSES.md). Unverified: a real Hermes run, Hermes's field names
beyond its source, real OpenCode/Pi model lists, and model-switching resume on a
real CLI.

Names and sub-agents, same branch, 2026-09-27 (owner's decisions): all copy and
the text irori writes for agents now say **hibachi** for a brain, **hibachi
agent** for its AI, **irori agent** for "your AI", and **irori mode** for the
Overview level; "irori" alone is still the app, and code identifiers are
unchanged. Sub-agents are named `hibachi-<slug>`, and irori now writes each handed hibachi's definition itself,
only when the file is absent, for the irori agent's CLI: `.claude/agents/*.md`,
`.codex/agents/*.toml` (`name`, `description`, `developer_instructions`) or
`.opencode/agents/*.md` (`mode: subagent`). Codex and OpenCode therefore get the
delegating preamble; Pi and Hermes keep the direct one. The `brain-agents` skill
is no longer in the starter and the "update the definitions" request button is
gone; the irori agent's screen lists each hibachi's definition files. Unverified:
real Codex/OpenCode runs, including whether Codex loads project `.codex/agents`
for the untrusted irori agent folder ([YOUR-AI](YOUR-AI.md)).

Stray errors, 2026-09-27: #112 (**0.1.47**) is merged at the owner's word and
published as
[v0.1.47-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.47-preview.1)
by release run `36251799999` from main's CI run `36251195816` (source `e97e88e`).
The release carries Windows 201,437,696 bytes, Mac 168,944,269 bytes and
`irori-0.1.47-full.nupkg` 200,796,944 bytes. The owner's 0.1.46 clone of the
private mock KB worked, but the error bar showed "Unknown or ambiguous cloud owner".
Reproduced in Electron with the real repository (clone → open → remove that
workspace on the start screen → open another). `openWorkspace` asked
`cloudConnections` for the removed workspace's ID. It now skips that ID once the
host no longer lists it (removal already unregisters its connections). The
missing-owner error and an unreadable `.irori/cloud-mounts.json` now have wording
a person can act on. `git-ui-smoke`'s intermittent failure at the
refused-then-retried resolution was traced to a lost click. The resolve buttons
were disabled during any conflict re-read. `GitPanel` now keeps them enabled
while the conflict on screen is the selected file's (the host's version check
still refuses a stale one). Resolving drops a re-read in flight, which otherwise
reported the resolved file as changed. The smoke holds that re-read open to
prove both. Windows `test:package` once missed its autosave wait (about 1 in 60
runs, no detail). `replaceFile` (`src/host/local-json.ts`) now retries a temp-file
rename that Windows refuses with `EPERM`/`EACCES`/`EBUSY` for about 3 s; it is
used by note save, note move and conflict resolution. That is the likely cause,
not a proven one: 40 loaded Linux packaged runs never reproduced it. `package-smoke`
prints the file, the editor text and any messages if it recurs.

GitHub clone authentication, 2026-09-26: #110 (**0.1.46**) is merged at the
owner's word and published as
[v0.1.46-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.46-preview.1)
by release run `36238298132` from main's CI run `36237777808` (source `c1bdeb9`).
The release carries Windows 201,433,600 bytes, Mac 168,949,896 bytes and
`irori-0.1.46-full.nupkg` 200,795,381 bytes. The owner could not clone a private
repository after `gh auth login`: Git uses gh only after `gh auth setup-git`.
`GitProcess.run` (`src/git/process.ts`) now retries a network operation that
`https://github.com` refused (authentication, or "repository not found") once
with `-c credential.https://github.com.helper=` followed by gh's
`auth git-credential` helper, found on irori's child PATH. The empty value clears
other helpers for that host only, so a stale keychain entry cannot answer first.
Nothing is written to Git configuration. `GitError` appends Git's last lines
after a blank line, with URL credentials, GitHub tokens, `password=`/`token=`
values and the home directory removed. The renderer's `ErrorMessage` folds them
under 詳細, and `errorText` replaces `String(e)`, so messages no longer read
"Error: Error:". A failed clone removes the empty folder it made. The
registration dialog's empty preview is hidden. Tests: `tests/git-github-cli.test.ts`
(stand-in git/gh; real Git for helper precedence) and a failed clone first in
`git-ui-smoke`. On #110's CI, `git-ui-smoke`'s conflict resolution step (untouched)
and the Windows `test:package` autosave poll each failed once; unchanged reruns
passed, and three local `git-ui-smoke` runs passed. Not yet tried against a real
private repository from an installed app.

Delivery, 2026-09-26: #107 (file viewers) is merged with the owner's go-ahead,
and **0.1.45 is published** as
[v0.1.45-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.45-preview.1)
by release run `36233968176` from main's CI run `36233474364` (source `6e63563`).
The release carries Windows 201,434,624 bytes, Mac 168,938,194 bytes and
`irori-0.1.45-full.nupkg` 200,795,242 bytes. #107's first CI run failed once in
`links-ui-smoke`: the reference scan hit its time budget on the runner and
reported "not every note was checked". That suite does not touch the viewers.
An unchanged rerun passed.

File viewers, 2026-09-26: **0.1.45** is prepared on `feat/file-viewers`. The
owner asked to be able to see at least PDF, PPTX, DOCX and XLSX. Files with a
viewer (`src/domain/viewers.ts`: PDF, Word `.docx`, PowerPoint `.pptx`,
spreadsheets `.xlsx/.xlsm/.xls/.ods`, images) now open on the stage instead of in
the external application. `host.read`/`cloudRead` return them as a view-only
`Document` (`viewer` set, empty text, version from size and mtime, so the
existing reconcile reloads a changed file), and the new `viewerBytes` HostAPI
method hands the bytes over after the same scope/Drive resolution, an extension
check and a 100 MiB limit. The renderer draws them with pdf.js, docx-preview,
@jvmr/pptx-to-html and SheetJS 0.20.3 (from SheetJS's CDN; npm's `xlsx` is the
vulnerable 0.18.5), each loaded lazily (`src/app/FileViewer.tsx`,
`src/app/viewers/`). pdf.js's CMaps, standard fonts and decoders are bundled as
lazy chunks because the CSP refuses fetch; Office markup is neutralized
(`safe-dom.ts`) and rendered in shadow roots. The notices generator now also
copies licence files from package subfolders the bundle used (pdf.js fonts and
wasm). Details and limits: [file viewer libraries](libraries/file-viewers.md).
Tests: `tests/viewers.test.ts`, a Drive case in `connections.test.ts`, and
`viewers-ui-smoke` with fixtures in `tests/fixtures/viewers/`.

Delivery, 2026-09-26: #103, #104, #96 and #105 are merged with the owner's
go-ahead, and **0.1.44 is published** as
[v0.1.44-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.44-preview.1)
by release run `36212990477` from main's CI run `36212468170` (source `f31164d`).
It carries your AI (0.1.42), the motion and finish (0.1.43) and the conflict
re-read (0.1.44); 0.1.42 and 0.1.43 were not published on their own. The
release was published with 0.1.44's first notes, which described only the fix.
Its title and notes were then replaced with this repository's notes covering
everything since 0.1.41; the "Exact package" section was kept.

The release carries Windows 198,849,536 bytes, Mac 166,497,490 bytes and
`irori-0.1.44-full.nupkg` 198,210,248 bytes. Main CI on `8511b90`
(`36211591365`) had failed twice in `git-ui-smoke`, which is what #105 fixes. The
hourly drift check failed while main held unreleased changes.

Conflict re-read, 2026-09-26: **0.1.44** is prepared on `fix/git-resolve-reread`.
A refused **統合内容を保存して解決** (the conflicted file changed on disk) now reads the
conflict again at once (`GitPanel.resolveConflict`). Before, a conflicted file's
status stayed `UU`, so only the file watcher's event refreshed the conflict's
version; when that event came late, the second attempt was refused too. This is
what failed `git-ui-smoke` twice on CI (#103's first run and `main` CI
`36211591365`), each time passing on a rerun.

UI v5 motion, 2026-09-26: **0.1.43** is prepared on `feat/ui-v5-motion`, stacked
on your AI. Levels move with a zoom (`goToLevel`, 560 ms from the Overview into a
brain around the clicked brain, reversed going back, none under reduced motion);
sheets rise over a fading backdrop; a permission request arrives with an
overshoot. A screen-capture script (`scripts/ui-screens.ts`) produced the main
screens in hearth/ja, dark/en and light/ja for comparison with the canvas, which
led to: Schema files keeping their `.md` in the tree, the home's Schema card
listing instruction files first, a house on the home crumb, the graph fitting at
most at 1:1, and the Overview using the chrome button look and a two-line header
for your AI. The Overview smoke checks the zoom and its absence under reduced
motion. This completes the six stages of the v5 plan.

Your AI, 2026-09-26: **0.1.42** is prepared on `feat/your-ai`. Your AI is the
person's own Claude Code agent, run from `~/irori/you` (device record
`your-ai.json`, id reused for its conversations), set up from the Overview with
an irori-written starter (`AGENTS.md`, the `brain-agents` skill, an empty
`.claude/agents/`). A request carries the workspace's free brains (`brains` on
`StartRun`); the host resolves their folders as `additionalDirectories`, names
each brain's sub-agent (`brainAgentNames`) in a preamble, holds those brains for
the run (`busy`), and keeps writes in bounds with a `PreToolUse` rule
(`src/agents/delegation.ts`). Hand-offs are forced to the foreground, since a
background sub-agent's edits are refused without a prompt. Events carry
`delegate` (hand-off start, sub-agent steps and requests via `canUseTool`'s
`agentID`, the `task_notification` report). The host now announces the end of
every request (`resolved`), and every view uses that instead of "a later event
arrived", which also fixes Claude Code brain runs where the tool-call message
came after its request. Renderer: the Overview's island has **あなたの AI | Brain
の AI**, the map has the hearth orb with hand-off lines and sparks, and the Your
AI screen shows the folder and each brain's definition. Tests:
`tests/your-ai.test.ts`, a Claude protocol fixture
(`tests/fixtures/claude-your-ai.mjs`), `your-ai-ui-smoke`, and the opt-in real
run `npm run test:your-ai`, which passed with Claude Code 2.1.280 on 2026-09-26
(see [YOUR-AI](YOUR-AI.md)).

Delivery, 2026-09-26: PRs #97–#101 are merged with the owner's go-ahead, and
**0.1.41 is published** as
[v0.1.41-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.41-preview.1)
by release run `36155578107` from main's CI run `36154273703` (source `a49c1a4`),
which passed first time. It carries the whole v5 switch: 0.1.38, 0.1.39 and
0.1.40 were not published on their own, and the 0.1.41 notes cover everything
since 0.1.37. The release carries Windows 198,837,248 bytes, Mac 166,474,608
bytes and `irori-0.1.41-full.nupkg` 198,197,251 bytes. The hourly drift check
failed once while the stack was being merged (main held 0.1.39 for more than an
hour while the owner's answers were pending).

UI v5, 2026-09-25: the owner approved the v5 design canvas and asked to switch
the whole interface to it. [ADR 014](decisions/014-ui-v5.md) records the
decisions: the brain (one registered KB with its Schema, Knowledge and Contents)
is the unit, a workspace is any combination of brains, the levels are Overview →
Brain → Note, each brain's AI is its CLI agent, your AI is the person's own agent
that hands tasks to brain AIs, brains get an editable icon and colour, and ember
belongs to the AI alone. The owner answered the three questions (default language, your AI's
folder, where brain identity is stored) on 2026-09-26 with the defaults the ADR
used. The work lands as stacked pull requests.

UI v5 Overview, 2026-09-25: **0.1.41** is prepared on `feat/overview`, stacked
on brain identity. The renderer no longer holds the brain on show while its AI
runs or has a queue: another brain can be chosen and run its own AI (the host
already allowed one run per scope). A brain keeps the AI chosen for it. A queue
goes on when its brain's run completes even while another brain or the
Overview is on show (`sendNextQueued`); a stopped or failed run still pauses
it. The conversation snapshot carries the requests a run waits on now
(`Conversation.requests`, `withRequests`), since saved history keeps them only
as text, so a request can be answered after switching brains or from the
Overview. The rail's **全体** opens the Overview (`Overview.tsx`,
`overview.css`): a map (deterministic rows by category in `domain/overview.ts`,
reference lines from run records whose sources belong to another workspace
brain) with a **Brain の AI** island (state, request cards, stop, resume, and a
composer that sends or queues to a chosen brain), and a side-by-side view (AI /
Schema / Knowledge / Contents per brain). The ⌘K palette gains **すべての Brain**,
grouped by brain; the search host now supersedes a scan only within the same KB,
so scans of different KBs run side by side. The workspace cannot be left while
any brain's AI runs. New `overview-ui-smoke` (two fixture runs at once,
switching during a run, a background queue, answering, stop/resume, sending and
queueing from the Overview); unit tests for the layout, the reference lines, two
brains' runs with live requests and per-KB scans. Your AI (the hearth of the map)
is phase 5.

Brain identity, 2026-09-25: **0.1.40** is prepared on `feat/brain-identity`,
stacked on the brain views. `.irori/scope.json` gains an optional `appearance`
(`icon`: a glyph of 24, one or two characters, or an image `.irori/icon-<hash>.<ext>`;
`color`: one of eight) and `category` becomes optional, following the ADR's
default for the open question (identity shared through the KB). HostAPI adds
`updateSpace` (name, category, appearance; validated, atomic, keeping unknown
fields; refused while the brain's AI, Git or a connection is busy) and
`saveSpaceIcon`. `BrainSettings.tsx` is the sheet (name, category, previews,
icon kind and glyph grid, colours), opened from the brain menu and the home.
`BrainTile` draws glyphs, characters and images everywhere. New
`brain-settings-ui-smoke`; `space-settings.test.ts` covers the declaration.
A KB without a category cannot be opened by 0.1.39 and earlier.

UI v5 brain views, 2026-09-25: **0.1.39** is prepared on `feat/ui-v5-brain-views`,
stacked on the foundation. A brain's views take the stage instead of opening
dialogs: **Home** (`BrainHome.tsx`, replacing the welcome: identity, today's
note, new note, terminal, Schema / Knowledge / Contents cards, recent changes
and runs), the **graph** (`OntologyPanel` in a `StageView`: filters, dotted
canvas, detail card, legend, entity list behind the table button, index state
in the bar) and **materials and outputs** (`KnowledgePanel`, two columns). A
reload no longer switches views; only opening a document does (`show`). The
link button counts backlinks and lists them in a popover (`Backlinks.tsx`).
Search is a ⌘K palette with brain chips, arrow-key choice and marked matches.
Two delegated branches were merged: the Drive connection dialog as a two-column
sheet (`connections.css`, secondary actions in ⋯ menus) and the Start screen
(`startup.css`: workspace rows with brain tiles, the brains ↔ workspaces
diagram, combining brains, adding a brain from a folder or GitHub). The file
tree stays mounted behind Changes so open folders stay open. Smokes follow the
views (regions instead of dialogs, the palette's chips, the popover) and
disambiguate the home's duplicate actions.

UI v5 foundation, 2026-09-25: **0.1.38** is prepared on `feat/ui-v5-foundation`.
`src/app/tokens.css` carries the canvas's tokens for the hearth, light and dark
themes (the old role names remain as aliases), Geist and Geist Mono are bundled
as variable woff2, and the theme setting gains `hearth`, which the system choice
shows in a light desktop. The five-pane `LayerExplorer` is replaced by a 64 px
rail (`Rail.tsx`: brains in workspace order with running and waiting states,
the Overview's reserved place, add, search, settings) and one brain panel
(`BrainPanel.tsx`: header, search, Files | Changes, and resizable Schema,
Knowledge and Contents sections with Drive upload and read-only badges). The
stage carries a crumb bar (`NoteBar.tsx`) with the save state, backlinks, the
note's details (location, human lines) and its menu (rename and move, delete,
Drive actions, reload, save, table or source, code assistance, materials); the
terminal is a drawer at its foot. The AI panel shows the brain's Schema line,
steps as a timeline (`AgentLog.tsx`), permission cards and a composer with
brain-tiled references and **＋ 参照**. Git's Changes view serves the brain on show,
with numbered diff cards on the stage. Settings (theme, Markdown font, language,
updates, pending-upload recovery) moved to the rail; Ctrl+K opens search and
Ctrl+` the terminal. Brain tiles use the name's initial on a colour derived
from the scope ID until identity becomes editable. Every Electron UI smoke that
selected by the old structure was rewritten; `layers-ui-smoke` now proves the
rail and brain panel.

Delivery, 2026-09-25: PR #94 is merged with the owner's go-ahead, and **0.1.37
is published** as
[v0.1.37-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.37-preview.1)
by release run `36091671804` from main's CI run `36091077153` (source `5270ac9`),
which passed first time. The release carries Windows 198,651,392 bytes, Mac
166,238,512 bytes and `irori-0.1.37-full.nupkg` 198,011,147 bytes.

Drive folders in KBs, 2026-09-25: **0.1.37** is prepared on `feat/drive-in-kb`
from the owner's decision to drop the separate Google Drive frame
([ADR 013](decisions/013-drive-folders-in-kbs.md), superseding ADR 002 Q02's
workspace-owned connections). The sidebar's Drive row, its styles and the
workspace dialog entry points are removed; the header **クラウド接続** opens the
open KB's connections; workspace connections are no longer mounted on opening a
workspace; `CloudService.moveConnection` moves one into a KB keeping its mount
ID, folder, name and access (a duplicate folder only unregisters the workspace's
copy); `removeWorkspace` unregisters a workspace's own connections instead of
refusing; the materials panel prepares uploads for the open KB. The workspace
Drive UI smoke is rewritten for the move, and the layers smoke no longer drags a
Drive row.

Delivery, 2026-09-25: PRs #90 (0.1.34), #91 (0.1.35) and #92 (0.1.36) are
merged with the owner's go-ahead, and **0.1.36 is published** as
[v0.1.36-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.36-preview.1)
by release run `36070496716` from main's CI run `36069692901` (source
`7127111`). #92's pull-request verify first failed in `git-ui-smoke`'s five-second
wait for the resolved-conflict count, a known timing-sensitive step it does not
touch; the failed job alone passed on rerun, and main's CI passed first time.
The release carries Windows 198,652,416 bytes, Mac 166,234,704 bytes and
`irori-0.1.36-full.nupkg` 198,012,875 bytes. 0.1.34 and 0.1.35 were not published
on their own.

Drive editing completed, 2026-09-25: **0.1.36** is prepared on
`feat/drive-complete`, stacked on 0.1.35, from the owner's request to finish every
remaining Drive item at once. Four delegated branches (three on Fable) were
merged: rename/move/delete through the mount (`moveEntry`/`deleteEntry`,
`Entry.connection` for connection roots, a sidebar menu and document toolbar,
`CloudEntryActions.tsx`); images in editable Drive notes (`ImageService` takes the
cloud service; exclusive direct writes); a save-time Drive version check
(`operations/stat` MD5 against the editor's starting bytes, skipped for items in
`vfs/queue`, bounded to 5 s, `vfs/refresh` on conflict; a 25 s re-read of open
Drive documents); and upload failure reasons (`src/cloud/upload-errors.ts`
classifies rclone's stderr ERROR lines into path + category, matched to failing
`vfs/queue` items, shown as `CloudConnection.uploadError`). The lead added
leaving unsent changes when disconnecting or making a folder read-only, since a
permanent failure otherwise trapped the folder. [ADR 012](decisions/012-drive-editing.md)
is updated. Unit tests: 280 pass.

Drive editing, 2026-09-25: **0.1.35** is prepared on `feat/drive-editing`,
stacked on 0.1.34, from the owner's statement that materials in `contents` are
edited and added to, not read-only. [ADR 012](decisions/012-drive-editing.md)
records the design: per-connection `access` (new connections `read-write`,
older declarations stay `read-only` until switched), sign-in with the `drive`
scope and **書き込みを許可** to sign older accounts in again under the same
remote, rclone's write cache for editable mounts with a per-mount
`description`, in-place hash-checked saves (never temporary file and rename),
workspace Drive documents saved and drafted through the cloud service, pending
uploads from `vfs/stats` shown in the dialog and guarding disconnect, access
changes and quitting, notes added from the sidebar, and **フォルダを開く**.
Connection tests cover mount options, in-place saving with drafts and
conflicts, read-only refusals, added notes, pending uploads, workspace
documents and signing in again; the package smoke now expects the `drive` scope.

Windows Drive folders, 2026-09-25: **0.1.34** is prepared on
`fix/windows-drive-mount` from the owner's report that a connected Drive folder
showed `UNKNOWN: unknown error, realpath` on Windows, in both the workspace Drive
list and a KB's materials. The mount itself succeeded. `CloudService.resolve`
called `fs.realpath` on the path, and on Windows rclone's WinFsp volume mounted
on a folder is a junction to `\??\Volume{GUID}` with no DOS name, so libuv's
`GetFinalPathNameByHandleW(VOLUME_NAME_DOS)` fails and Node reports `UNKNOWN`
for every path in the mount (nodejs/node#50019, closed as not planned).
`resolve` now walks the components below the verified mount point with `lstat`
and refuses any link, as `parent()` already did above it. A connections test
models the Windows failure and fails on the old code with the same error. The
cloud dialog also stops showing `rclone <version> · …` when mounting is
available; the line appears only when a prerequisite is missing or mounting is
unusable.

Delivery, 2026-09-25: PRs #86 (0.1.31), #87 (0.1.32) and #88 (0.1.33) are
merged with the owner's go-ahead, and **0.1.33 is published** as
[v0.1.33-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.33-preview.1)
by release run `36049854031` from main's CI run `36048278155` (source
`8692623`). Its Windows package job first failed when the packaged app's first
heading took longer than the smoke's five seconds; the failed job alone passed
on rerun. The release carries Windows 198,637,056 bytes, Mac 166,244,038 bytes
and `irori-0.1.33-full.nupkg` 197,997,545 bytes. 0.1.31 and 0.1.32 were not
published on their own; an installed 0.1.29 or later is offered 0.1.33 in the app.

Interface language, 2026-09-25: **0.1.33** is prepared on `feat/ui-language`,
stacked on 0.1.32, from the owner's request to choose English or Japanese as
the system language. [ADR 011](decisions/011-interface-language.md) records the
design: a `language` device setting (`ja` default, `en`), chosen in the display
settings menu and applied live from the App root; `t(ja, en)` in
`src/domain/i18n.ts` at each use site in both processes, with the Japanese text
unchanged so existing tests keep selecting by it. About 1,100 `t()` calls across
60 files were written by five delegated agents with disjoint file ownership and
then reviewed. Knowledge-base content, agent prompts, matching strings and tool
output are not translated. The new `language-ui-smoke` visits the workspace, a
note, the cloud, search and note dialogs, the AI panel, source control, a host
error and the startup screen after a restart with English-named fixtures, and
fails on any Japanese interface text. Known limits: text already in component
state, and an open editor's own chrome, change language when shown again.

Resizable explorer panes, 2026-09-25: **0.1.32** is prepared on
`feat/resizable-explorer-panes`, stacked on 0.1.31, from the owner's request to
size each knowledge and materials frame freely. `LayerExplorer` replaces its CSS
grid with a vertical `react-resizable-panels` group (Schema, knowledge,
materials, and the workspace Drive list when present) and a horizontal group
per shared row (personal, team), saved through `layoutStorage` like the
workspace panes. Folds follow the reader's drags only (`isUserInteraction`); a
layout pass that squeezes a row re-applies the reader's folds. The rule meant to
stretch `.sidebar` in its pane selected `.workspace-panes > .explorer-pane`,
which never matched because the library wraps each pane in its own element; the
old grid's intrinsic height hid that, and the selectors now start at the pane. Folding both panes of a row collapses
the row to its heading, and a row dragged below its minimum folds both panes.
The settings schema and request validator allowed layout keys of 64 characters,
while the library writes `react-resizable-panels:<group>:<panel ids>`; the
three-pane workspace key is 67, so the sidebar and AI panel widths with the
panel open were never saved. The limit is 160. `layers-ui-smoke` drags each
border and checks the saved layouts; `settings.test` stores the 67-character key.

Dialog contrast and Drive folder choice, 2026-09-25: **0.1.31** is prepared on
`fix/dialog-contrast-cloud-folder` from the owner's report. `.modal` painted a
fixed white panel while inheriting the dark theme's light text (contrast 1.26:1
measured), so the cloud connection dialog was unreadable; panels now use
`--surface`/`--ink`, the remaining literal colours in dialogs and the Git panel
use tokens, and `CloudRecovery` gains its missing panel. The Drive folder list
could only choose a subfolder through its radio button, so a folder reached with
**開く** could never be connected. The opened folder now has
**「名前」を接続先にする**, the chosen row is highlighted and the form scrolls
into view. `cloud-ui-smoke` connects an opened shared-drive folder and asserts
dialog contrast above 4.5:1 in both themes; it fails on the old stylesheet.

Delivery, 2026-09-23 (night): PR #84 is merged and **0.1.30 is published** as
[v0.1.30-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.30-preview.1)
by release run `35851726103` from main's CI run `35850884875` (source
`2814b93`): Windows 198,617,600 bytes, Mac 166,267,685 bytes and
`irori-0.1.30-full.nupkg` 197,977,634 bytes. The release was published from a
draft, and the public list read with the app's headers named its six files on
the third check, a minute after publication. Install 0.1.30 rather than 0.1.29
by hand; it is the first version that finds a release the list shows without
files.

Release list fallback, 2026-09-23: **0.1.30** is prepared on
`fix/release-asset-fallback`, with the owner's go-ahead. After 0.1.29 was
published, GitHub's release list served it without files for over half an hour,
so an installed irori could not be offered it. The update check now reads a
newer release's own `/releases/<id>/assets` when the list names no files (at
most three per check, never for the installed or older releases). `release.yml`
publishes from a draft 30 seconds after every file is uploaded and then reports
whether the public list, read with the app's headers, names the files; the drift
check reads each release's own assets. Verification: build, formatting and
`npm test`; the new test fails without the lookup. The drift lookup was run by
hand against 0.1.29 and found all four required files.

Delivery, 2026-09-23 (evening): PRs #79 (handoff), #80 (0.1.29) and #81 are
merged, and **0.1.29 is published** as
[v0.1.29-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.29-preview.1)
by release run `35845216421` from main's CI run `35843823360` (source
`93951b9`). Its Windows job first failed in the new update smoke: renaming the
freshly installed folder returned `EPERM` before any update ran. It passed on its
second attempt, and #81 now waits for such locks. The release carries Windows
198,619,136 bytes, Mac 166,268,652 bytes, `irori-0.1.29-full.nupkg` 197,978,744
bytes, `SHA256SUMS.txt` and both evidence files. PR #82 pointed the download
manifest at it and Pages run `35845928596` deployed it. The site bundle offers
the tag, and all three files match `SHA256SUMS.txt` when downloaded anonymously.

GitHub then served stale asset lists for the new release. Fetching the release
by id listed all six files as uploaded from 09:50:10 UTC, and downloads worked.
The release list, the by-tag lookup and the release page's asset fragment
returned no files, or all but the Setup.exe, for a quarter of an hour, and
alternated between stale and current answers afterwards. An installed irori
reads that list, so it offers 0.1.29 only once GitHub serves the current one;
two drift runs (`35846151308`, `35846225239`) failed on the same stale answer
while reporting main in step. A whitespace-only edit of the release body and a
same-value `prerelease` update did not clear it; re-uploading `SHA256SUMS.txt`
was refused because the name exists, and nothing changed.

In-app updates, 2026-09-23: **0.1.29** is prepared on `feat/in-app-update`. The
owner asked for an installed irori to update itself with one button, like the
Codex and Claude desktop applications, without downloading or reinstalling it by
hand. An installed irori now checks the public releases 10 seconds after it
starts and hourly, shows a newer version without a click, and
**更新して再起動** downloads it, verifies its size and `SHA256SUMS.txt` digest
over HTTPS, stages it and restarts through the window's own shutdown. Windows
applies Squirrel's full package with the installed `Update.exe`; the Mac swaps
in the bundle from the published disk image after `codesign`, identifier and
version checks, because Squirrel.Mac cannot accept an ad-hoc signature.
Releases now also publish `irori-<version>-full.nupkg`, and the drift check
requires it from 0.1.29. [UPDATES](UPDATES.md) and
[ADR 010](decisions/010-in-app-updates.md) describe the design and its trust
limits. Versions up to 0.1.28 still need one manual install of 0.1.29. The same
version also gives **端末の送信準備を復元** the navigation colors: on the startup
screen and in the sidebar it was a white button with pale text in the light
theme.

Verification: production build, formatting, **251 tests (244 passed, seven
environment-gated skips)** and **all fifteen Electron UI suites**, including the
rewritten update suite, pass. Mutating the checksum comparison, the HTTPS rule,
the streaming size bound, the download removal, the Squirrel result check, the
Mac identifier check or either rollback makes a test fail. The Windows and Mac
package jobs gain `test:update-package`, which applies the build's own update
file with the real platform tools. In [CI 35839263045](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35839263045)
Squirrel's `Update.exe` applied 0.1.29 over an installation made to look like
0.0.1 in 11.3 seconds, and `--processStartAndWait` started
`app-0.1.29\irori.exe` after its parent exited. On macOS 26 the disk image was
staged, verified and swapped into a temporary Applications folder in 5.8
seconds, and Launch Services opened the new bundle and the previous one was
removed. The first real update between two published versions, and macOS App
Management's response to it on an approved installation, need the owner's
devices.

Delivery, 2026-09-23: PRs #75 (0.1.27) and #76 (0.1.28) are merged, and
**0.1.28 is published** as
[v0.1.28-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.28-preview.1)
from main's CI run `35758758467` (source `e8b6d5d`): Windows x64 198,609,408
bytes and Mac arm64 166,285,874 bytes. 0.1.27 was not published on its own;
the 0.1.28 notes cover both. PR #77 added the notes and download manifest, the
download website serves 0.1.28, both installers match `SHA256SUMS.txt` when
downloaded anonymously, and the drift check passes. The entries below describe
the branches before merge.

Editor assistance, 2026-09-23: **0.1.28** is prepared on
`feat/editor-assistance-toggle`, stacked on the unmerged 0.1.27 branch
`feat/user-access-policy`. The owner asked for editor conveniences to be shown
or hidden with one button. **コード支援 ON / OFF** in the document toolbar
switches syntax coloring, line numbers, folding, bracket assistance and
completions together in source files and Markdown code blocks, as
[EDITOR-ASSISTANCE](EDITOR-ASSISTANCE.md) describes. Source files now pick a
language from the filename. The choice is a device setting that survives a
restart and reverts on a failed write. Switching keeps the same editor, text,
selection and Undo history, and writes nothing to the note. Diagnostics and
project run buttons are still not implemented.

Verification: production build, formatting, **235 tests (228 passed, seven
environment-gated skips: no local rclone, OpenCode or Pi binary, and a
case-sensitive filesystem)** and **all fifteen Electron UI suites**, including
the new editor-assistance suite, pass on the stacked branch.

Owner follow-up, 2026-09-23: **0.1.26 is published** from PR #73; main is
`7726a93` after the download-manifest PR #74. **0.1.27** is prepared on
`feat/user-access-policy`, pending review and a new merge authorization.

The owner selected user-controlled write access, ordinary native CLI
capabilities and VS Code extension compatibility; [ADR 009](decisions/009-agent-access-and-extension-compatibility.md)
records the resolved decisions. The composer now offers truthful native/default
and full-access modes for Codex/Claude/OpenCode, with Pi native-only. Queued
instructions keep their mode and a change starts a fresh native session without
losing display history. The device recovery screen restores staged cloud bytes
after the connection/workspace is removed, without overwriting existing files.
Google OAuth/mounts remain read-only; their separate user-selected write policy
still needs writable transport, re-consent and provider acceptance.

[Real native trials](REAL-AGENT-ACCEPTANCE-2026-09-23.md) on 0.1.26 confirm
Codex/Claude actual note edits, schema invariance, explicit denial, active
cancellation and continuity after recreating host services/native processes.
Claude questions and person-line context also passed. Codex default-mode
structured questions remain unavailable; Pi/OpenCode lack configured models.
The lifecycle script now fails for missing gate events instead of passing a
zero-question/zero-approval run. Full-access mode has SDK/protocol coverage
and an actual OpenCode permission roundtrip, not new real-model acceptance.

The [VS Code compatibility probe](research/VSCODE-EXTENSION-COMPATIBILITY-2026-09-23.md)
passed seven actual extension-host checks in isolated official VSCodium
1.135.06055 (API 1.135.0): edit/save, language services, configuration/storage,
theme contribution, Node child, terminal and webview messages. This demonstrates
a compatible foundation; irori integration, VSIX installation and actual
third-party extension acceptance remain open. Code-OSS workbench integration
is the recommendation, not a completed host migration.

Verification: production build, formatting, **232 tests (228 passed, four
environment-gated skips)** including local rclone, and **all fourteen Electron
UI suites** pass. New coverage includes SDK/native access mapping, queue/session
mode isolation, the mode selector and orphaned-byte restoration. Relative links
and diff checks pass. Device trials, signed distribution and general-release
acceptance remain open. The historical entries below retain their dated scope.

Preview publication, 2026-09-23: the owner authorized PR #73, merged at
`aa0bbfe5d60bb83fc307091f3259c91660d1f249`. **0.1.26 is published** for Windows
x64 and Mac arm64 through [release run 35749374357](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35749374357),
using the installers tested by [main CI 35748469575](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35748469575).
The earlier unmerged/unpublished statements below are historical. The website
manifest now targets this release; Pages deployment is the publication step.
No new signing identity or general-release channel is involved.

Recovery audit follow-up, 2026-09-22: **0.1.26** is prepared on
`fix/audit-recovery`, from main `9c92f39`. The published preview remains 0.1.25;
this change is awaiting pull-request review and an authorized merge.
[AUDIT-2026-09-22](AUDIT-2026-09-22.md) records each finding, the implemented
response and the outstanding acceptance work.

Application note moves carry the person's line marks and update OKF relation
and source references alongside Markdown links, preserving unrelated YAML,
comments, BOM and line endings. Shared authorship follows Git-detected renames,
and a new clone receives the notes immediately or displays a partial-failure
notice while preserving the checkout. Graph outputs are checked before any
write; damaged/oversized generated modules can be regenerated through the UI,
and NFC graph links resolve decomposed local names. Normal note saves now also
reject oversized or NUL-containing text before touching the file or draft.
Healthy cloud connections clear transient errors; shutdown handles an already
absent mount only after independent verification. D04 advances by retaining and
checking the exact account/shared-drive identity of every new preparation.
Google permissions and mounts remain read-only, with no delivery IPC exposed.

Verification: production build, formatting, **229 behavior tests (225 passed,
four environment-gated skips)** and **all fourteen Electron UI suites** pass.
New tests failed before their repairs; integrated UI checks cover initial-clone
notes, person marks and OKF references after rename, broken/oversized graph
regeneration, declared-CSV protection and decomposed-name navigation. The
concurrent-search fixture now waits for its first request to reach the gate,
removing the observed test hang without weakening the cancellation assertions.
Disposable local rclone copy/checksum checks passed. Changed-document relative
links and `git diff --check` pass. No real model turn, Google account/mount,
installed Windows/Mac trial, package build or publication was performed locally.
The first remote CI attempt exposed missing author identity in the new clone
fixture's notes setup. Its disposable repository now declares its own fixture
identity and disables signing, independent of global Git configuration.

Remaining: writable capability/re-consent/verified transport, orphaned outbox
recovery UI, portable source/run/artifact provenance, native device/model
acceptance and long-term template evidence. Unsupported YAML aliases/multiline
references are reported rather than guessed; graph files are not a multi-file
transaction. Older entries below retain their milestone-specific evidence.

ObsidianUI controls, 2026-09-22: **Magnet Tabs** now marks the selected workspace
view, Git view and folder/clone registration mode with a moving indicator and
hover background. **Arrow Fill Button** serves the registration and workspace
submit actions and the welcome screen's new-note action. Both are adaptations of
the official MIT source in `src/app/obsidian/`, using irori's light/dark tokens;
Motion 13.4.0 is the only new direct dependency. Base UI keeps the toggle groups'
keyboard behavior and busy guards, and reduced motion updates live. Registration
now gives its input native initial focus, fixing an existing dialog/ToggleGroup
initialization race that consumed the first arrow press. See
[ADR 007](decisions/007-obsidian-ui.md) for sources, scope and update policy.

Verification: production build, format check, **204 behavior tests (197 passed,
seven environment-gated skips)** and all **fourteen Electron UI suites**. The
focused UI additions exercise keyboard selection, repeated activation, disabled
submit, live reduced motion and light/dark rendering. The first behavior run
stalled in the existing concurrent-search test; its isolated run and the full
rerun passed. No provider inference, installed Windows/Mac trial or local package
build was performed on the branch. Version 0.1.25 and its release notes
accompany this change: it was renumbered twice while 0.1.22, then #67's 0.1.23
and #69's 0.1.24, merged first. After merging `main` with all three:
production build, format check, 209 behaviour tests (205 passed, four
environment-gated skips) and all fourteen Electron UI suites
pass.

The graph index the knowledge base carries, 2026-09-22: the owner settled the
decision left open on 2026-09-17 — the pages of an Open Knowledge Format bundle
are the source of truth, and the graph is a module the knowledge base carries in
Git, `Knowledge_Base/ontology/`, that irori generates deterministically on
request and the person commits, so every device shows the same graph for the
same commit ([ADR 008](decisions/008-graph-index-module.md)). A declared
`.irori/ontology.json` still wins and is never generated over.
`GraphIndexService` (`src/host/graph-index.ts`) walks the bundle through
search's own walk (`SearchService.walk`, the same layer rules, exclusions and
limits), reads only each page's leading frontmatter with the host's `yaml`,
resolves each relation's `target` with `resolveNoteLink`, keeps it when it names
a page of the bundle, and writes `entities.csv`
(`id,label,note,parentId,group`), `relations.csv` (`sourceId,relation,targetId`)
and a fixed `index.md` — NFC paths, code point order, `\n`, no BOM, Papa Parse
quoting — through `FileService.writeGenerated`, only when the bytes change.
`readOntology` reads the module with the built-in mapping when no declaration
exists, and the view says which source it came from. `graphIndexStatus`
generates in memory and reports whether the tables on disk match and how many
entity and relation rows an update would add and remove, plus the relations
left out; the panel shows the graph first and that line when the check returns,
with **グラフ索引を更新**, or **グラフ索引を作成** when neither a declaration
nor a module exists. See [ONTOLOGY](ONTOLOGY.md).

Measured on this container with a disposable bundle: 2,000 pages cost 1.15 s
for a cold status (walk, read and parse), 55 ms warm (stats only, facts
remembered by size and modification time), 81 ms for the update, and the
longest gap between event-loop turns during a cold walk was 32 ms; 15,000
pages cost 7.2 s cold before the 2,000-entity refusal, 0.35 s warm, with a
9.6 ms longest gap. A folder holding more than 4,000 entries makes the walk
incomplete, which the check reports as an error rather than an index missing a
folder.

Verification: production build, format check, **209 behaviour tests (205
passed, four environment-gated skips)** — `tests/graph-index.test.ts` covers
identical bytes for reversed input and a reversed second KB, a decomposed file
name linked composed, every exclusion with its count, the label fallback, a
title with a comma read back through the reader, a duplicate collapsing, the
refusal above 10,000 relations with nothing written, freshness after a body
edit (current) and after a relation edit (the exact counts), the module read
with and without its relation table, a declaration winning and refusing
generation, and the guarded writer's boundaries. Mutation check: with the
relation sort removed, the byte test fails; with NFC normalisation removed,
three tests fail; restored, all pass. All **fourteen Electron UI suites**
pass in one run, where the ontology suite generates the index from a bundle,
sees three nodes, reads the stale counts after a page's relations change on
disk, updates to four nodes and opens a node's page, with the declared-CSV
journey unchanged before it. The Linux package and its smoke pass: 21,938,554
bytes archived and 89,396,019 unpacked, the host set unchanged (`yaml` and
`papaparse` were already the host's). `test:agents` and `test:lifecycle` were
not run; no model inference was used. Version 0.1.24 with its notes accompanies
the change; publication follows the merge.

Not done: a page's ordinary body links are not relations, only the
`relations` list is; pages kept outside `Knowledge_Base/` are not in the graph;
the index is generated on request, not on save; and a folder with more than
4,000 entries stops the check. Implemented by a Fable agent in its own
worktree and re-verified by the lead.

The package stopped carrying packages the application never loads,
2026-09-22: the Linux x64 archive falls from 115,078,717 to 21,902,040 bytes
and the application directory from 500,379,979 to 407,203,302, with no feature
removed; the unpacked directory, node-pty and rclone, is unchanged at
89,396,019. Those figures are 0.1.19's code; rebased on 0.1.22 the archive is
21,919,228 bytes and the directory 407,220,490.

Forge copied every production dependency although Vite had already bundled
the renderer's into `dist/`: 271 top-level packages, from React and Milkdown
to the Vue compiler and Babel parser that nothing imports, plus npm's `.bin`
links and hidden lockfile. The kept set is now read from the built host rather
than maintained: `scripts/build-host.mjs` keeps every package external, so
`dist-host/main.cjs` and `preload.cjs` name what the host loads as
`require("name")` or `import("name")` — fourteen packages — and
`packageAfterPrune` walks their `dependencies` and `optionalDependencies`
with Node's resolution and removes everything else under `node_modules`.
Twenty-five package directories remain. Zod and papaparse are used on both
sides and stay. The renderer's packages are not moved to `devDependencies`,
which would restate the classification by hand and take them out of
`npm audit --omit=dev`.

Since the bundle no longer carries each package's LICENSE, the build writes
one: `scripts/third-party-notices.ts`, a Vite plugin, takes Rollup's module
graph in `generateBundle`, maps each module under `node_modules` to its
package and emits `dist/third-party-notices.txt` — 210 entries of name,
version, declared licence and licence-file text, 282,864 bytes inside
`app.asar`. The graph rather than the chunks' modules, because a package whose
modules only re-export another's, `@milkdown/kit`, is in no chunk yet is what
the source imports; the first draft read the chunks and the package smoke
caught it. See [PACKAGING](PACKAGING.md) and
[THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md).

Verification: production build, format check, **205 behaviour tests (201
passed, four environment-gated skips)** after rebasing on 0.1.22, all **fourteen Electron UI suites**,
and the Linux packaged smoke, which now derives the host set from the archived
bundles and asserts that each of those dependencies is packaged, that every
other production dependency is not, and that the notices file is present and
names each of them at its installed version — while still driving the editor,
graph, terminal and both SDK imports inside the packaged application, which is
what shows the kept set is the loadable one. The new assertions fail on the
0.1.19 package (no notices file), on a build with the removal disabled
(`@base-ui/react` packaged) and on a build whose plugin withheld `react`
(`react@19.3.0` missing). An in-memory build with sourcemaps attributes
rendered code to 202 packages, all named; the other eight named are barrels or
tree-shaken modules. `test:agents` and `test:lifecycle` were not run; no model
inference was used. Version 0.1.23 with its notes accompanies the change;
publication follows the merge.

Limits: Windows and Mac packages were not built here; their package jobs drop
the same files and print their own weights. The kept set follows the two host
bundles' bare specifiers; a package the host loaded by a computed path outside
its own directory would escape it, and none does today. The notices name a
package by its `license` field and licence files as published, without
verifying either.

Pi and OpenCode hear about the person's lines before an edit, 2026-09-22.
Neither protocol lets a hook add context and let the call run: Pi's extension
`tool_call` handler can return `{ block, reason }`, and an OpenCode plugin's
`tool.execute.before` can throw, whose message the model reads as the tool's
error. So `src/agents/person-lines.ts` writes one small script per CLI to
`<dataDir>/agents/` (never the KB), loaded with Pi's `-e` and through
`plugin` in `OPENCODE_CONFIG_CONTENT`, and starts a per-run loopback listener
with a random token; the script posts each `edit`/`write` and irori answers with
`personLinesNotice`. A notice holds that exact call once and the identical call
then runs; no notice, or irori unreachable, means no hold. `editedPath` and
`editedText` now read OpenCode's (`filePath`, `oldString`/`newString`,
`replaceAll`) and Pi's (`path`, `edits[]` of `oldText`/`newText`) inputs.
Codex is not told at edit time: its hooks load only from `~/.codex` or the
project's `.codex` after the person trusts each definition, irori writes
neither, and under `workspace-write` with `on-request` a patch inside the
checkout reaches irori as no approval request (whose decision carries no reason
anyway). `turn/steer` could only tell it afterwards. Investigated and
implemented by a delegated agent; the lead reviewed the diff and integrated it.

Verification: production build, format check, **205 behaviour tests (201
passed, four environment-gated skips)**, including one driving irori's actual
Pi and OpenCode scripts through the protocol fixtures — a person's line held
once with its text quoted, then run; an agent's line not held; both scripts in
the data directory and nothing in the KB — and the Electron UI suites. Real Pi
0.85.1 loaded the script with `--mode rpc -e` and no extension error; a real
OpenCode 1.18.30 `serve` listed the plugin path in `/config`, but its lazy
plugin import was not observed. No model turn was run.

Not done: how Pi's and OpenCode's models treat a held call is unobserved. Pi
matches `oldText` loosely, so an edit only that looseness applies is not seen.
Codex has no edit-time notice.

The person's lines travel with commits, 2026-09-22: a commit made in the Git
panel attaches a Git AI Standard v3 note under `refs/notes/ai` naming, for each
knowledge-layer Markdown file it adds or modifies, the committed file's person
lines as one `h_` entry — `h_` plus SHA-256 of the committer's `Name <email>`,
first 14 hex digits, with `metadata.humans` naming that identity. Only `h_` is
written, as the owner decided for 0.1.20; an agent's lines stay unattested.
`GitService.noted` reads the `h_` entries of the last 50 noted commits touching
a file, maps each named line of that commit's version to its line key, and
`AuthorshipStore.view` joins them with the device record, so the count, the
source-view marks, the summary and Claude Code's edit notice all include a
collaborator's or another device's lines. The note plumbing — `src/git/notes.ts`,
fast-import with the notes tip as parent, merge into an existing note, fetch
into `refs/notes/ai-remote/<remote>` then `git notes merge -s ours`, push never
forced — is #59's, which is closed; its agent (`s_`) writing and reading are
removed. Push carries the notes by default, as #59 did, because sharing is the
point of this change; the confirmation says so. The UI says
人が書いた・直した行 and 人の行を伝える instead of あなたが書いた・直した行 and
自分の行を伝える, since a line may now be a collaborator's.

Verification: production build, format check, **204 behaviour tests (200
passed, four environment-gated skips)** — four in `tests/git-notes.test.ts`
rewritten for `h_`: the note's exact attestation and metadata and none for an
agent-only commit; a device without a record reading a moved line back; `s_` and
legacy keys ignored and malformed notes skipped; a post-commit hook's note
merged with the person's entry last; Fetch, Pull, a refused Push and the merge
that follows — and the fourteen-suite Electron run, where `git-ui-smoke` shows a
seeded collaborator `h_` line counted, the commit naming the typed line under
the committer's key, and Push carrying the ref.

Not done: a commit made outside irori carries no note, and squash or rebase
merges on GitHub drop them. A collaborator's lines and this person's are not
told apart. Codex, OpenCode and Pi are still told only through the tickbox.

The person's lines, 2026-09-21: the authorship record keeps one mark per line —
the person wrote or revised it, or not — and nothing about an agent's lines.
The owner set the goal: which lines are the person's matters most, because an
agent working with the person needs them to understand what the person meant;
and a person who changes part of a line does so to make the whole sentence say
what they mean, so a line with any of their change is theirs. Sub-line tracking
was considered and judged more than the goal needs, and no existing tool records
it anyway — git-ai collapses its internal character ranges to one author per
line and drops the person's lines, and every other tool surveyed is line-level
or closed. See [ADR 006](decisions/006-person-lines.md) and
[the survey](research/2026-09-21-authorship-provenance.md).

A save now marks only the lines it introduced: the host reads the bytes it
replaces and marks the lines the old text did not carry, so a line that arrived
by pull, from another editor or from an agent is never claimed for the person,
as the 0.1.12 record did at the person's first save. Records from before 0.1.20
are not read. The watcher no longer attributes a batch of changes to the run
that owned the space, and `AgentService.current` goes with it. The note states
how many lines are the person's and source view marks them.

An agent is told when it matters. Before Claude Code's `Edit`, `MultiEdit` or
`Write` changes one of the person's lines, the Agent SDK's `PreToolUse` hook
adds which lines, quoted, as `additionalContext`; `editedText` applies the tool's
input as the tool would, and nothing is guessed when it does not recognise one.
Any agent is given the person's line ranges only when the person ticks
自分の行を伝える, which appears when the open note has such lines and starts
unticked — every request carried them before. Both are stated as a record, not
an instruction. When sharing is wanted, the record maps to the Git AI Standard's
`h_` entries alone, which the owner chose; #59, which wrote agent entries and no
`h_`, is closed.

Verification: production build, format check, **199 behaviour tests (195
passed, four environment-gated skips)** — six in `tests/authorship.test.ts`,
rewritten for the new record, and one in `tests/harnesses.test.ts` showing the
Pi fixture's request carries the person's lines only when asked — and the
Electron UI suites, where `harness-ui-smoke` shows the OpenCode fixture's
appended line uncounted, a typed and saved line counted, the count surviving a
restart and the tickbox starting unticked. Letting a save claim lines the file
already carried, taking a replacement string as a pattern, naming unchanged
lines in the notice, or adding the summary to every request each fails a test.
Version 0.1.20 with its notes accompanies the change; publication follows the
merge.

Not done: Codex, OpenCode and Pi are not told at edit time; the hook's effect on a
real Claude Code turn was not observed, since real model runs need separate
authorisation. Which words inside a line are the person's is not kept, pasted
text counts as the person's, and the record stays on the device.

Skills that say who they are for, why they left, and how far they reach,
2026-09-21: three techniques borrowed from teamai-cli after the
[reassessment](../../irori-extention/docs/research/teamai-cli-evaluation.md)
declined the tool itself. A skill's front matter may name `roles` and
`projects` under `metadata`, and the composer gains **役割** and
**プロジェクト** selectors that narrow the picker to the reader's own choice,
kept per KB in the device record and never in the KB; a skill naming neither
shows for everyone, and a reader who chose nothing sees everything. A KB
retires a skill by replacing `SKILL.md` with `RETIRED.md` — date, reason,
optional replacement, and deliberately no `name` or `description`, so no CLI
discovers it — and irori names the retirement under the composer, fails a run
(selected or queued) that names it with that reason, and flags a personal copy
that keeps the name alive. **到達確認** opens a reach view: for each declared
or retired name, whether Codex, Claude Code, OpenCode and Pi would find it
natively when launched in the KB, which user-scope directories hold a
same-named skill, and who wins — teamai's R7 lesson, where a personal skill
silently shadows the project's. The per-harness table cites each CLI's
documentation or source with its version (Codex 0.155.1, Claude Code 2.1.278,
OpenCode 1.18.30, Pi 0.86.1 documentation); the host reads only
`<dir>/<name>/SKILL.md` under the home directory for the five directories
those rows name and returns home-relative names. See [SKILLS](SKILLS.md).

irori writes none of it: markers come from the KB's own contract or the user,
the audience choice lives in `device-settings.json`, and the schema-layer
property in `tests/harnesses.test.ts` is unchanged. The new UI is in
`SkillPicker.tsx` and `SkillReach.tsx`; `main.tsx` only mounts the picker and
prints the retirement notices.

Verification: production build, format check, **197 behaviour tests (193
passed, four environment-gated skips)** — four new: roles and projects, the
retirement marker, the retired listing with the reach check against a
disposable home, and the per-KB audience record — the harness fixture refusing
a retired name with the KB's reason, and all **fourteen Electron UI suites**,
where `skills-ui-smoke` drives the role selector, the retirement notice and the
reach view under a disposable `HOME`, asserting that no machine path is shown
and that the KB's skill directory gains nothing. Each of seven mutations fails a test:
narrowing when no role is chosen, accepting a marker with `description`,
treating a retired name as unknown, counting a directory without `SKILL.md` as
a personal copy, retiring a package that keeps both files, the list bound, and
replacing rather than merging the per-KB audience record. `test:agents` and
`test:lifecycle` were not run; no model inference was used. Version 0.1.19 with
its notes accompanies the change; publication follows the merge.

Limits: the reach table describes documented versions and is not a probe of
the installed CLI; enterprise and admin scopes, `.claude/skills` or
`.codex/skills` inside the KB, a relocated `CODEX_HOME` and Pi's trust state
are not examined. A marker's `replacement` is not checked to exist. One role
and one project per KB per device. The matching `irori-templete` convention is
proposed with the change, not yet written into the template.

A device-local index for search and backlinks, 2026-09-21: a request to
**KB内を検索** or **リンク元** no longer reads every file. `SearchService` keeps
one SQLite database per knowledge base under the application's data directory,
through Electron's built-in `node:sqlite` (SQLite 3.53.4, no native dependency
to build), holding each eligible file's text with the size and modification
time it was read at, and an FTS5 trigram index over that text. The 2026-09-21
measurement shaped it: `trigram` narrows a query of three or more characters to
candidate files, and a shorter query — the ordinary two-character Japanese
word — is matched over the stored text of every checked file, as the backlink
reading is. `src/host/search-index.ts` owns the database; `src/host/search.ts`
keeps the walk, the guards and the per-line matcher.

The walk stays. A request lists the layer as before and stats each eligible
file; an unchanged file is taken from the index, a changed, added or renamed one
is read through the existing guards, and a removed one is forgotten once the
walk reaches the end. So an answer never comes from stale text and does not
depend on the watcher, and the hits come from the same per-line matcher over the
same text in the same order — previews, line numbers, `iu` case folding and the
200-hit cut-off are unchanged. FTS5 folds case with Unicode 6.1 tables, 899
pairs short of what the JS matcher accepts (Georgian Mtavruli, Cherokee, later
IPA letters), so each non-ASCII letter of a query is written in every case it
takes; a check over every cased code point found no miss. The database is a
cache: a file that is not one, one from another schema version or one whose
damage a query meets is deleted and rebuilt, nothing is written inside the KB,
and each write is a synchronous transaction of at most 64 files or 1 MiB never
held across an await, so a superseded request cannot hold the lock against its
successor. Such a batch holds the main process for about 80 ms, and a single
2 MiB file about 200 ms, while files are being indexed; the window keeps
painting, as it is a separate process.

Measured on disposable fixtures outside the repository, 2,000 and 15,118 mixed
Japanese/English notes (5.7 MB and 42.8 MB of text): the previous implementation
read every file in 471 ms and, with its limits raised, in 4.8–6.1 s (backlinks
7.6–9.4 s; at its 2,000-file limit the larger fixture was always incomplete).
The index builds in 768 ms, and in 7.2 s over two requests; a repeat request
then takes 74–77 ms and 508–540 ms (a two-character query with no match,
matched over every text: 149 ms and 1.1 s; backlinks: 244 ms and 1.7 s), and
88 ms and 823 ms after ten files changed. The databases are 9.1 MB and 69.4 MB.
The file and entry limits rise from 2,000 and 10,000 to 50,000 and 100,000,
because a checked file now costs a stat (about 36 µs, listing included) rather
than a read; the 32 MiB limit now bounds what one request reads into the index.
See [KB-SEARCH](KB-SEARCH.md).

Verification: production build, format check, **193 behaviour tests (189
passed, four environment-gated skips)** including six new ones in
`tests/search-index.test.ts` — a repeat request reads no file and writes
nothing in the KB, freshness across modify/add/delete/rename and a same-size
later-mtime edit, one- and two-character Japanese queries, case parity beyond
ASCII, a corrupt or mismatched database rebuilt, and backlinks from indexed
text — and all **fourteen Electron UI suites** against the built application,
where every search in the search and links suites goes through the index, which
is what shows `node:sqlite` loading in Electron's main process (`scripts/build-host.mjs` keeps it an external require). The packaged
application was not exercised locally — in a worktree whose `node_modules` is a
symlink, packaging operates on the shared tree — so the package smoke, which
now runs one search inside the packaged application, is left to the CI package
jobs on the pull request. Ignoring the
modification time, dropping the case expansion, narrowing short queries, keeping
a damaged database, keeping stale rows, re-reading every file or placing the
index inside the KB each fails a test; those tests count the files a request
reads through the scan's own reader. The budget test in `tests/search.test.ts`
now starts each budget from a cold index, since the byte budget counts what is
read into it. Version 0.1.18 with its notes accompanies the change; publication
follows the merge.

What is not done: search and backlinks still run when asked, not on every open,
and the first request on a large knowledge base reports incomplete until the
build finishes (two requests at 15,118 notes). A change that keeps a file's size
within the filesystem's modification-time resolution of the previous write is
not seen until the next change. Backlinks are matched over every note's stored
text, since a link's encodings defeat an exact narrower lookup, so at 15,118
notes they cost 1.7 s. This is the "Indexed search" item of the handoff's next
work.

Links follow a note when it moves, 2026-09-21: **名前・場所** now keeps relative
Markdown links correct across a rename or a move. Before the move, the dialog
counts what will change — 「参照元 2 件のノートにある 3 件のリンク」 — and
**リンクも更新する**, on by default, is the way to decline. After it, the status
line says what happened — 「このノート内 2 件と参照元 2 件のノートの 3 件のリンクを
更新しました。」 — names the notes it could not update, and says whether the scan
reached everything. A knowledge base is pages pointing at each other by
relative path, so until now every rename left the notes that led to the moved
one pointing at nothing, and a note with relative links refused to change
folder at all.

The move itself is unchanged: bytes copied and hash-checked, managed images
copied beside the note, the source record rebound to the bytes as moved — which
is why the rewrite comes after the rebind rather than inside the move. Then each
note is an ordinary hash-checked save: first the moved note, whose own links are
rewritten so they still lead where they did from the new folder, including links
to itself, while its copied images keep their text; then every Markdown note of
the knowledge layer whose link resolved to the old path, found by the backlink
scan. `rewriteLinks` and `linkCount` in `src/domain/note-links.ts` are pure text
work sharing the destination pattern, the fence and code-span reading and the
NFC comparison of the backlink list; `src/host/relink.ts` reads and writes. Only
the destination changes: the author's `<…>`, percent-encoding, fragment and
title stay, CRLF and a BOM survive, a new path with a space is bracketed,
parentheses are escaped as the editor does, and a destination that already
resolves right is left alone — so moving a note back restores the links by the
same mechanism. A note changed meanwhile, holding unsaved text, or unreadable is
skipped and named rather than overwritten, and the move stands. Trash and
restore rewrite nothing. See [NOTE-LINKS](NOTE-LINKS.md).

The option controls all rewriting: with it off, the move preserves every byte
and the conservative guard on cross-folder moves remains, now naming the
option. Wiki links and HTML `src`/`href` are not rewritten and refuse a folder
change either way. Reference definitions and reference-style links, which used
to block a folder change, are rewritten like any other link.

Verification: production build, format check, **187 behaviour tests (183
passed, four environment-gated skips)** including the eleven new ones in
`tests/move-links.test.ts`, and all **fourteen Electron UI suites**:
`links-ui-smoke` renames a page two notes link to and moves another into a
folder, reads the dialog's count and the status line, checks the rewritten
bytes and follows the rewritten links both ways; `daily-workflow-ui-smoke`
still moves a note with a pasted image byte for byte.
Breaking the fence reading, the code-span blanking, the NFC comparison, the
percent-encoded form, the parent steps of a relative path, the wiki/HTML guard
or the unsaved-text guard each fails a test, and replacing the stale hash with a
re-read overwrites a racing edit, which its test catches. Version 0.1.17 with
its notes accompanies the change; publication follows the merge.

The count shown before a move covers the other notes; the note's own links are
stated, not counted, and a referring note holding unsaved text is counted there
but skipped by the move. The rewrite reads every note of the layer as the scan
does, within the same limits, and says so when it hit one; the index remains the
next step for search, backlinks and this. A link whose case differs from the
file's name, a link from another registered KB, and frontmatter
`relations`/`sources` are not rewritten.

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

**Decided 2026-09-22 (recorded here on 2026-09-17 as an open decision):** the
recommended template (`irori-templete`, ADR 002 D8) ships no
`.irori/ontology.json`; its `Knowledge_Base/` is an Open Knowledge Format 0.2
bundle whose pages carry `type`, `title` and `relations`. The owner decided that
the pages are the source of truth and that irori generates a graph index the
knowledge base carries in Git, `Knowledge_Base/ontology/`, with a declared pair
still winning — [ADR 008](decisions/008-graph-index-module.md), built in 0.1.24
(the newest section above).

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
