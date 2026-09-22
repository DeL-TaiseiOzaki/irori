# irori continuation handoff

Current development, 2026-09-23: the owner approved PR #73 and real native
model trials. **0.1.26 is published**; PR #74 updates its download manifest.
The new **0.1.27** work is on `feat/user-access-policy`, unmerged and unpublished.
Read the newest [STATUS](STATUS.md), [ADR 009](decisions/009-agent-access-and-extension-compatibility.md),
[real native acceptance](REAL-AGENT-ACCEPTANCE-2026-09-23.md) and
[VS Code compatibility evidence](research/VSCODE-EXTENSION-COMPATIBILITY-2026-09-23.md).

The owner chose user-selectable write permission, ordinary CLI capabilities,
and VS Code extension compatibility. These are no longer pending product
questions. Native permission selection and device outbox recovery are implemented
on the branch; Google writable transport and the compatible workbench integration
remain next work. A working VS Code API probe ran on isolated VSCodium; it did
not add an extension host to irori. Model authorization is present for native
acceptance using existing accounts, but it does not authorize account changes
or silently enabling experimental provider features. New feature merges still
need authorization. Earlier contrary delivery/decision statements are historical.

Current delivery, 2026-09-23: PR #73 is merged at `aa0bbfe` and
[v0.1.26-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.26-preview.1)
is published for Windows x64 and Mac arm64. The owner explicitly approved
real native CLI model acceptance on this date. Later work and decisions belong
in the newest STATUS entry; the earlier waiting-for-merge and model-approval
statements below describe their dated checkpoints.

Current continuation, 2026-09-22: main is `9c92f39`, with **0.1.25** published.
The owner's follow-up audit and implementation are on `fix/audit-recovery`,
prepared as **0.1.26**; they need pull-request review and an authorized merge.
Read [the audit and remaining work](AUDIT-2026-09-22.md), current
[STATUS](STATUS.md), and [HANDOFF-PROMPT](HANDOFF-PROMPT.md) before the historical
entries below. Note/reference and authorship preservation, graph regeneration,
Drive recovery, initial clone notes and exact cloud-preparation binding have
been addressed in that branch. Real device/model acceptance and the remainder
of writable cloud delivery remain open. No new installer has been published.

## Historical continuation records

Resume here, 2026-09-21 (evening, after the 0.1.19 delivery): `main` is `60eea4e`
and [v0.1.19-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.19-preview.1)
publishes it for both platforms, with the download page in step. **#61 (0.1.20)
is open** and is the first thing to check: publish it once the owner merges it.
Give the next session [HANDOFF-PROMPT](HANDOFF-PROMPT.md); it is current.

The session built backlinks (#53), their follow-ups (#55), link rewriting on
move (#56), a device-local search index (#57) and the skill reach check,
retirement markers and scopes (#58), most of it through Fable agents in separate
worktrees whose results the lead re-verified on the stacked base. The owner then
settled authorship: **the person's lines, one mark per line**, told to Claude
Code at edit time and to any agent on request, and shared later as Git AI
Standard `h_` entries alone — [ADR 006](decisions/006-person-lines.md), built in
#61; #59 closed. The workspace root became the private repository
`irori-workspace`.

Three things are easy to get wrong next time:

- **Never package from a worktree whose `node_modules` is a symlink.** Forge
  works on the shared tree: it emptied `node_modules/.bin`, rebuilt node-pty for
  Electron and deleted the other platforms' prebuilds and the Agent SDK's
  platform packages. `npm rebuild --ignore-scripts` and `npm pack` of the locked
  versions repaired it. CI's package jobs cover packaging.
- **A backgrounded Fable agent does not survive a session restart**, and after
  one it is reachable by its agent id, not its name. Check its worktree before
  assuming progress.
- **Host-side scans must stay linear in line length.** A lookahead with `.*` or a
  lazy backreference took minutes on a crafted line in the main process; a test
  in `tests/note-links.test.ts` holds crafted lines under a second.

Resume here, 2026-09-21 (after the 0.1.14 delivery): `main` is `ae6b0f9` and
[v0.1.14-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.14-preview.1)
publishes it for both platforms, with the download page in step. Give the next
session [HANDOFF-PROMPT](HANDOFF-PROMPT.md); it is current. The download is a
third smaller than 0.1.12: 215,796,224 bytes on Windows against 319,919,104,
and 182,424,344 on the Mac against 281,574,107.

That session merged four more pull requests. #49 stopped the package carrying
executables irori never runs — the Agent SDK's own ~220 MB Claude Code binary,
which the SDK resolves only when `pathToClaudeCodeExecutable` is unset while
`src/agents/service.ts` always passes the reader's installed `claude`, and
node-pty's prebuilds for other platforms. #50 made notes follow their own links
with Ctrl/Cmd + click. #51 pointed the download page at the new release and #52
records the delivery.

Four things are worth knowing before the next change:

- **The handoff's own premise about links was wrong.** It said `[[wiki link]]`
  resolution; the recommended template writes **relative Markdown links**, since
  a page's identity there is its path (`irori-templete` ADR 002 D3), and that
  repository contains no `[[` at all. #50 implements the relative form. See
  [NOTE-LINKS](NOTE-LINKS.md).
- **An index for search has a Japanese constraint.** `node:sqlite` with FTS5 is
  available in Electron 44 (SQLite 3.53.4), but `unicode61` makes a Japanese
  sentence one token, so a query inside it never matches, and `trigram` returns
  nothing for a query shorter than three characters. Two-character queries are
  ordinary in Japanese, so an index needs trigram plus a `LIKE` path for short
  ones. Measured, not assumed.
- **Every substantial change adds a section at the top of `docs/STATUS.md`**, so
  two branches cut from `main` conflict there whichever order they merge. Stack
  the later one on the earlier (`gh pr edit <n> --base <branch>`) and retarget
  it at `main` when the first merges; GitHub does not retarget by itself here.
- **The hourly drift check reads the live download page.** The scheduled run at
  01:17:04Z failed by 25 seconds because Pages was still deploying the new
  manifest; the dispatched run at 01:18:12Z reported `main` in step. Publish the
  website before the hour, or dispatch `release-sync.yml` after the deployment.

`gh workflow run release.yml` was allowed again, with the owner's explicit
instruction to merge. A `for` loop polling `gh run view` on that release run was
refused by the CLI's own classifier; single `gh run view` calls work.

Resume here, 2026-09-21: `main` is `96d0823` and
[v0.1.12-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.12-preview.1)
publishes it for both platforms, with the download page in step. Give the next
session [HANDOFF-PROMPT](HANDOFF-PROMPT.md); it is current and this paragraph
only adds what a resuming agent would otherwise have to rediscover.

That session merged five pull requests. #43 made agent runs per knowledge base
instead of per application. #44 removed 3.1 MB of unreachable code from the
package, chiefly KaTeX, which `features: { Latex: false }` never removed
because the flag is read after bundling. #45 records which lines an agent wrote,
keyed by the line's text rather than its position — read
[AUTHORSHIP](AUTHORSHIP.md) before extending it, especially for why irori does
not call `git ai checkpoint known_human`. #46 is
[ADR 005](decisions/005-host-and-references.md): irori is not built on orca,
and the four product directions the owner stated are recorded with their honest
current state.

Three things are easy to get wrong next time:

- **Stacked pull requests do not retarget themselves here.** #44 and #45 were
  opened against their parents. GitHub moves a PR to `main` only when its base
  branch is deleted, and these were not, so each had to be retargeted with
  `gh pr edit <n> --base main` before merging — merging as they were would have
  landed them on the parent branch instead of `main`.
- **A gap in published versions is deliberate.** 0.1.10 and 0.1.11 have notes
  but no package. Each PR had to advance the version to pass `release-sync.yml`;
  publishing the intermediate ones would make a reader upgrade twice to reach
  the same code.
- **`release.yml` dispatch worked** in this session with the owner's explicit
  instruction to merge, contrary to an earlier note that it is always refused.

Two decisions are the owner's and are not settled: what "taking in extensions"
is to mean, and whether the graph is drawn from the OKF bundle or the declared
CSV pair. The workspace root outside the three repositories is also under no
version control, which the owner has not yet been asked about.

Resume here, 2026-09-17: `main` and the published preview are to stay in sync.
The owner gave standing authorization for agents to publish a preview after an
authorized merge. That covers the prerelease, the website manifest and Pages
deployment, and the anonymous download check. Signing identities, notarization,
a non-preview release and account changes still need their own authorization.
The latest preview, [v0.1.9-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.9-preview.1),
publishes `main` for both platforms. See [CHECKPOINT](CHECKPOINT.md) for the
order used and what the three releases under the checks showed. A branch opened
before the checks existed carries neither a version nor notes: add both while
rebasing it, and correct any verification numbers it states, rather than
discovering it when the pull request fails.

Template and daily notes, 2026-09-17: `irori-templete` `main` is now an OKF 0.2
bundle maintained by agents (its ADR 002); it ships no ontology files and expects
the KB to declare where notes go. irori 0.1.8 adds that declaration,
`.irori/notes.json`, and **今日のノート**; read [DAILY-NOTES](DAILY-NOTES.md)
before touching note creation. The decision left open then — whether the graph
view should read the bundle instead of a declared CSV pair — was taken on
2026-09-22: the pages are the source of truth and irori generates a graph index
the KB carries in Git ([ADR 008](decisions/008-graph-index-module.md),
[ONTOLOGY](ONTOLOGY.md)); a declared pair still wins.

After merging an app-affecting change, advance the package version and publish,
or report the drift explicitly. The update check never offers a newer preview of
the version a reader already runs. `release-sync.yml` enforces the version and
notes on pull requests, and flags `main` when a shipped change stays unpublished
for more than an hour; `scripts/release-policy.ts` decides what ships. Automatic
publication with a generated website manifest is the next step. Until it lands,
publish by hand as [DISTRIBUTION](DISTRIBUTION.md) describes.

Mac download, 2026-09-16: [v0.1.5-preview.3](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.5-preview.3)
was published before anyone had confirmed it starts on a Mac. On 2026-09-17 the
owner reported that it launches; it has only been used lightly, so installed-Mac
acceptance is still open. The first published Mac build was verified, hashed and
deployed, and still could not launch; see [CHECKPOINT](CHECKPOINT.md) for what
that cost and why CI missed it. Intel Mac is out of scope and its mechanism is
removed, not disabled.

Mac delivery, 2026-09-16: the Mac download is enabled. Read
[PACKAGING](PACKAGING.md) before touching `forge.config.cjs`: the Mac bundle must
stay signed, and `osxSign.continueOnError` must stay `false`, or Forge will
happily produce an unsigned package again and the download becomes unopenable
without failing any job. The Mac signature checks in `scripts/package-smoke.ts`
run against the built output and the copy inside the disk image, never the
relocated copy — Node's copy drops the extended attributes codesign writes for
non Mach-O members. Hardened runtime must stay off while the signature is
ad-hoc: its library validation compares Team IDs, an ad-hoc signature has none,
and macOS 26 then refuses to load Electron Framework into the app. It is
disabled through `optionsForFile`, because `@electron/osx-sign` silently
discards a top-level `hardenedRuntime` — check the published CodeDirectory flags
before believing any such setting. The Mac package job runs on `macos-26` to
match the acceptance device; an older runner accepted a build that cannot
start there. Published installer names
are part of the update-check contract in `src/host/updates.ts`; renaming a
release asset silently stops that platform from resolving an update.

Checkpoint, 2026-09-16: the renderer UI arc (PRs #9-#15) is merged and verified
on `main`; see [the UI checkpoint](CHECKPOINT-UI-2026-09-16.md) for the commit
and CI identities, what was fixed along the way, and what was deliberately left
for its own branch. Source only — the published Windows preview is unchanged.

Device preferences, 2026-09-16: theme and pane sizes live in
`device-settings.json` through `deviceSettings`/`saveDeviceSettings`, not in the
renderer. Browser storage is not durable here — the window is a file URL — so do
not reach for `localStorage` for anything that must survive a launch. When a
resizable group gains or loses a pane, update the identifier list passed to
`useDefaultLayout` with it, or the layout is written and read under different
names. The stylesheet follows `data-theme` on the root, which the renderer
resolves; `nativeTheme.themeSource` is set for the operating system and cannot be
relied on to change `prefers-color-scheme`.

Source-control reads, 2026-09-16: the dropped-read defects in `RepositoryPanel`
are fixed (commit diffs have their own generation, the status read depends on
`conflictDirty`, the review refreshes in place, a click during another operation
leaves a notice). Read [UI findings](UI-FINDINGS-2026-09-15.md) before touching
that panel: its guards are refs and derived state, and an early return in an
effect whose condition is not a dependency silently drops the read for good.
`aria-busy` on the review region is load-bearing — `git-ui-smoke` waits on it.
Open items there: a refresh still restarts an in-flight read for the same target,
assistant links stay inert until a validated URL route exists, and the dark
palette still follows the operating system only.

Renderer libraries, 2026-09-15: `feat/ui-library-adoption` follows the UI
foundation with Markdown assistant replies, Japanese Crepe chrome, Base UI toggle
groups and an application error boundary; see
[ADR 004](decisions/004-ui-library-adoption.md) and STATUS. Before proposing another
library, read that ADR's rejected list — TanStack Query, virtualisation, a tree
component, tooltips, toasts, a diff library and electron-updater were each examined
against this codebase. When agent output needs richer display, extend
`AgentMarkdown`'s component overrides rather than relaxing them: the renderer must
not navigate or fetch on untrusted output.

UI foundation, 2026-09-15: the renderer's design tokens, dark palette, icon set,
resizable panes and popup primitives are migrated on `feat/ui-foundation`; see
[ADR 003](decisions/003-ui-foundation.md) and STATUS for the verification. Build,
behaviour tests and all twelve UI suites pass locally. The branch changes no
product behaviour and no published bytes. When continuing, prefer extending the
token roles over adding literal colours, and reach for Base UI before writing a
new popup by hand. The follow-ups this foundation was built for — splitting the
assistant panel into conversation and activity surfaces, showing agent edits as a
reviewable diff in the note, and a ⌘K command palette — are product behaviour
changes and need their own branches.

Workflow update, 2026-09-14: the owner requires every future new feature to start
on a dedicated branch and be submitted through a PR to `main`. Verify and push
the feature branch, open the PR and leave it open unless merging is authorized.
This supersedes older direct-to-main feature commit/push instructions; earlier
checkpoint hashes below remain historical evidence.

Source 0.1.5 daily recovery work is merged into `main` as
`278f5a407e270752057dbe4a10574a9450644934` and published. Read
[RECOVERY-AND-NOTE-TOOLS](RECOVERY-AND-NOTE-TOOLS.md) for private composer/Git
drafts, manual update checks, image feedback, safe note organization and match
navigation. The public installer and website are now the verified 0.1.5 preview;
[its release notes](releases/0.1.5-preview.1.md) and [CHECKPOINT](CHECKPOINT.md)
hold the exact package and delivery evidence. The next device step is the
owner's installation of the 0.1.5 EXE over 0.1.4.

Local combined verification passes: build/typecheck, 127/131 behavior tests
(four explicit environment skips), all twelve UI suites, website build and
fixtures, Linux x64 Forge/relocated packaged smoke and documentation/format
checks. New packaged checks exercise private composer/conflict drafts and
recoverable deleted notes after restart without inference. Preserve the
reconciliation generation/hash guard: delayed file reads must not invent
conflicts after another read/save has updated the editor. Search mapping uses
original-source Markdown AST text positions; hidden URL matches do not map to
unrelated visible text. Native CI results belong to the PR, not a new release.

Windows 0.1.4 public delivery is verified, 2026-09-14. The owner authorized
merging and publishing; both PR #2 (application) and PR #3 (release metadata)
are merged. Pages run 34843640838 deployed website revision `e32ed4e`.
At `2026-09-14T12:31:36.870Z`, a fresh anonymous desktop/mobile browser downloaded
all 318,426,624 installer bytes and matched SHA-256
`ffaa1ba1afc3ee358af1aee55860cca83fc294d69819907d277de6c5424de16b`
against CI/release evidence. Page/HTTP errors were empty; Mac remains disabled.
See [CHECKPOINT](CHECKPOINT.md) for exact identities. Next device check: close the
old application, install the new EXE, verify **0.1.4 Preview**, then paste an image
and continue typing after save/undo. No successful owner-device test is implied.

A post-publication CI rerun (34843622651) exposed a timing assumption in the new
save/undo fixture: adjacent setup and tested edits within ProseMirror's default
500 ms history group can both be undone. The fixture now pauses 600 ms before
the tested edit, preserving immediate save/undo and every assertion. Three
focused UI runs, typecheck and formatting pass. This is a test-only correction;
the published executable and its verified source/bytes are unchanged.

Windows 0.1.4 publication, 2026-09-14: the owner authorized merging PR #2 and
publishing the Windows update. PR #2 is merged as
`e72a62b53950b2ddb3f9132f4e66f341a74f80fc`; its Git tree exactly matches native CI
34841807049's tested PR merge. The
[0.1.4 preview](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.4-preview.1)
is public with the unchanged verified EXE, checksum and Windows package evidence.
The EXE is 318,426,624 bytes with SHA-256
`ffaa1ba1afc3ee358af1aee55860cca83fc294d69819907d277de6c5424de16b`; GitHub's asset
digest matches. The website manifest is updated to 0.1.4, with Mac slots disabled.
Pages deployment and anonymous delivery still need their own completion record.
The previous installed version and installed 0.1.4 acceptance remain unknown;
the owner's approval is publication authorization, not a successful device test.

Daily-workflow branch, 2026-09-14: source version 0.1.4 on
`feat/daily-editing-workflow` implements the repeated installed-app feedback.
See [Daily workflow](DAILY-WORKFLOW.md) for the save/immediate-undo fix, native
clipboard tests, compact assistant, source-control sidebar and version display.
Production build, 85/88 behavior tests (three optional skips), all ten UI suites
and website checks pass locally. The Git UI preserves partial staging and
conflict drafts while allowing note editing beside source control. Linux package
smoke covers trusted OS paste and continuous editing outside the checkout;
native CI is recorded on the feature PR. Do not confuse this source change with
an update to the owner's Windows installation or public download: the published
Windows preview remains 0.1.3, and the reported installed version is unknown.
Leave the feature PR open until merging is authorized; a new installer release
requires verified native CI bytes and the existing publication procedure.

Verified search checkpoint, 2026-09-14: application commit `ac935a9160f5e0a0be3d77a23e71d24073e53fcb` is pushed. [CI 34810865845](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34810865845) succeeds in verification and all Linux x64/Windows x64/Mac arm64 package jobs, including relocated packaged-app smoke. Local build, 85/88 behavior tests (three optional skips), all ten Electron UI suites, formatting and documentation-link checks pass. This following documentation checkpoint records the completed verification; the public Windows installer remains `9b04ed2` / `v0.1.3-preview.1`.

Development continuation, 2026-09-14: [local KB text search](KB-SEARCH.md) is implemented after the source-navigation checkpoint. **KB内を検索** searches saved Knowledge_Base text in one current-workspace KB, displays matching lines and opens the current document through the editor/workspace/agent guards. The host enforces the existing scope boundaries, skips unreadable or oversized files, bounds traversal/read work and marks incomplete results. Query/scope changes and closing discard stale responses. No persistent index, cloud fetching or cross-KB search is included.

Continue D04 writable capability/re-consent/account binding or the remaining D06 portable identity, moves/backlinks/properties, indexed search and exact line navigation. Preserve completed local text search, record navigation/reconnection and conversation recovery. The public Windows installer remains `9b04ed2` / `v0.1.3-preview.1`; source changes do not update it. Shared development configuration now lives in KB_design; contributor guidance was committed separately as `9740f98`.

Local verification for text search: build, **85/88 behavior tests** (three optional native-control skips), all **ten Electron UI suites**, changed-source formatting, local documentation links and diff checks pass. Initial search-field focus was fixed after the first UI attempt; focus entry/restoration and the complete final suite pass. New fixtures exercise the real search IPC/filesystem path and controlled delayed replies without model inference or real Google access. User VM preview/data and the public installer/site were preserved. See STATUS for hosted verification of this continuation.

Verified source checkpoint, 2026-09-14: application commit `54eeee41b6c93d44297e5896613c70b0b271e9b0` is pushed. [CI 34776177942](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34776177942) succeeds in verification and all Linux x64/Windows x64/Mac arm64 package jobs, including relocated startup smoke. Local build, 78/81 behavior tests (three optional skips), all nine Electron UI suites and documentation-link checks pass. This following documentation-only checkpoint updates the continuation prompt; the public Windows installer remains `9b04ed2` / `v0.1.3-preview.1`. No model inference, real Google access or device acceptance was added.

For a new session, use the [copyable continuation prompt](HANDOFF-PROMPT.md). It separates the newer source from the published installer and names the next D04/D06 work. Current entries supersede the historical checkpoints below.

Development continuation after `1afe3bb`, 2026-09-14: [record search and source/artifact navigation](KNOWLEDGE-NAVIGATION.md) are implemented. Missing sources can be explicitly rebound to matching files in the same scope, retaining IDs across repeated moves and restart. Location inspection distinguishes changed/missing/unavailable files; artifact and exact-version reverse links navigate to runs; current files open through existing editor/workspace guards. Copies, occupied/unknown/duplicate IDs, changed destinations, invalid paths and cross-KB aliases fail without changing historical records or file bytes. This is device-local metadata search/reconnection, not portable shared identity or full-text KB search.

Next independent work remains D04 writable capability/re-consent/exact account binding and D06 portable identity/provenance, full-text search, file moves/backlinks/properties and real artifact acceptance. Do not reimplement the completed record-navigation UI or conversation recovery. No device failure, Google consent or new model-testing permission was supplied; no installer/site publication or preview/data reset is included.

Local validation for this continuation: production build, 78/81 behavior tests (three optional native-control skips), all nine Electron UI suites and changed-document local links pass. The UI checks include binary artifact navigation, rejected out-of-workspace navigation, successful navigation after explicit membership, wrong-version rejection and retained history after reconnection/restart. Fixtures do not establish real generated-artifact or native account/device acceptance. The inherited provider cancellation test now waits for fixture prompt receipt before stopping the turn; early startup cancellation remains valid app behavior.

Verified continuation checkpoint, 2026-09-14: application commit `9d79182e33eab11d1fcdff96d9d3961cf61ef3ee` is pushed. [CI 34773932413](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34773932413) passes verification and Linux x64, Windows x64 and Mac arm64 packaging, including packaged queue recovery after restart. Local build, 75/78 behavior tests (three optional skips), all eight Electron suites and relocated Linux package smoke also pass. The public Windows installer remains 0.1.3 from `9b04ed2`; no new release or Pages deployment was performed. Resume independent D04/D06 work from this source, keeping the pending device/account/model acceptance gates. The parent workspace routing now includes irori; neither reference repository was edited, and the existing VM preview/data were preserved.

Development continuation, 2026-09-14: implemented [device-local conversation recovery](CONVERSATIONS.md) after checkpoint `2c9396a`. Recent display history and accepted pending instructions now persist by exact checkout/KB/CLI. Restored queues wait for explicit resumption; interrupted runs are not replayed, restored requests have no live controls, and current hosts use Electron's single-instance lock per device profile. Existing native session handles and the published 0.1.3 installer are unchanged. Follow-up verification is recorded in STATUS; source changes and CI artifacts do not constitute a newly published installer.

Final delivery checkpoint, 2026-09-14 JST: [Pages run 34764740194](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34764740194) successfully deployed website commit `44bcd2bc8cf682cca257cee54a9dbe837cb4b601` to [the download site](https://del-taiseiozaki.github.io/irori/). At `2026-09-13T15:10:49.647Z`, a fresh anonymous desktop/mobile browser downloaded all **318,416,896 bytes** of the Windows 0.1.3 installer and matched SHA-256 `c6099224db0b6137824088e19e43976d573d823af150ead5350be7b6312f442d` with the native CI/release evidence. No page/HTTP errors occurred; both Mac downloads remained disabled. Application source is `9b04ed2`; implementation/follow-up commits and the publication commit are pushed. This final documentation-only commit records the completed delivery.

No Windows device/Google/IME/upgrade result was supplied, and no real model test was authorized or executed. Read-only Google access, complete-release gates, untouched neighboring repositories and preserved `.local/vm-preview/{samples,device}` data remain explicit boundaries. Continue from current main using [implementation details and remaining work](EDITING-AND-RECORDS.md), rather than repeating OAuth setup or the completed editor/Git/queue work.

Published update, 2026-09-14 JST: [Windows preview 0.1.3](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.3-preview.1) contains application commit `9b04ed263b88b4754d03c7b79ab78816f0d73b06`. [Native CI 34764163901](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34764163901) passes verification and Linux x64, Windows x64 and Mac arm64 packages, including continuous editor save/image rendering and the existing configured OAuth handoff/cancellation. The unchanged CI EXE is **318,416,896 bytes (303.7 MiB)**, SHA-256 `c6099224db0b6137824088e19e43976d573d823af150ead5350be7b6312f442d`; GitHub's uploaded-asset digest matches. The website manifest now selects 0.1.3 and both Mac slots remain disabled. Pages deployment and anonymous delivery are recorded in the following checkpoint update.

Continuation after `d1b828c`: source version `0.1.3` addresses image paste, continuous document editing, bulk Git staging and queued conversations. It adds device-local source/run/artifact records and durable cloud-send preparation with an rclone delivery-engine test; Google remains read-only. See [implementation and limits](EDITING-AND-RECORDS.md). No new device result or real model permission was supplied. Native preview publication is recorded separately below when verified.

Checkpoint requested by the owner after delivery of Windows preview `0.1.2`, 2026-09-13. The owner's "OK" acknowledged delivery and requested this handoff; no successful Google login, mounted-folder access or new Windows device result was reported. This checkpoint changes documentation only. At its start, `main` was clean at `dc53e52`; the subsequent documentation commit contains this file.

## Immediate continuation after 0.1.3

Read [continuous editing and retained records](EDITING-AND-RECORDS.md) before extending the editor, conversation queue, D04 or D06. The implementation is already committed and packaged; do not restart those features. Collect explicit Windows 0.1.2/0.1.3 Google/WinFsp/read/reconnect and new editor/IME/upgrade evidence. None has been reported during this continuation. Next independent work is writable capability/re-consent and account binding for actual cloud delivery, portable knowledge identity/provenance, move/rebind/search UI and broader conversation history management. Keep the full release gates and original model-execution restrictions. The first 0.1.3 CI run at `31dcb46` was intentionally cancelled after a visual check found literal HTML empty lines; the successful final run targets `9b04ed2`. The website screenshot uses disposable examples and submits no model prompt.

## Start here

Continue development in `/workspace/KB_design/irori`, an independent Git repository on `main`, remote `https://github.com/DeL-TaiseiOzaki/irori.git`. Inspect `git status` and the relevant recent commits before making changes; check remote release/CI state when the task concerns delivery. Preserve any work added after this checkpoint. irori-extention provides irori capabilities in VS Code, and `irori-templete` is the recommended main-KB repository template under development. Each has an independent history; change a sibling only when the current task includes it.

Follow [AGENTS](../AGENTS.md) and use [STATUS](STATUS.md) to locate the current work. Load [README](../README.md) for setup, the [host decision](decisions/001-initial-host.md) for architecture changes, [confirmed product decisions](decisions/002-release-and-workspace.md) for product constraints, and [CHECKPOINT](CHECKPOINT.md) / [RELEASE-PLAN](RELEASE-PLAN.md) for delivery. The current sections and actual code supersede historical milestone statements. Open only the topic needed from [DISTRIBUTOR-GOOGLE](DISTRIBUTOR-GOOGLE.md), [CLOUD-SETUP](CLOUD-SETUP.md), [TERMINAL](TERMINAL.md), [PACKAGING](PACKAGING.md), [ACCEPTANCE](ACCEPTANCE.md), [WORKSPACE-DRIVE](WORKSPACE-DRIVE.md) and [ONTOLOGY](ONTOLOGY.md). The [initial workspace specifications](../../docs/irori/) are historical; their old Q01/Q02 proposals are superseded by ADR 002.

Respond in Japanese. Write code, identifiers, technical documents and commit messages in English. The user prioritizes simple code and established libraries, expects implementation and verification, and has authorized feature-branch commit/push and PR creation. Every new feature must follow the branch/PR workflow above. Complete independent work while waiting for device/account input. Read [the completed reuse assessment](REUSE-COMPLETION-2026-09-13.md) before proposing another broad library migration; Git collaboration and native adapters already exist.

## Public delivery and exact identities

| Item               | Verified value                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Download site      | https://del-taiseiozaki.github.io/irori/                                                               |
| Release            | `v0.1.12-preview.1`, unsigned Windows x64 and Apple silicon Mac prerelease                             |
| Application commit | `08900b05ee5ff5dcc82fd211e25e40e065ca8d04`                                                             |
| Native CI          | [35544793813](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35544793813), all jobs successful  |
| Release run        | [35545248675](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35545248675), successful           |
| Website commit     | `96d082352f94cea6fc4be3cb0c0756be8179bded` (#47)                                                       |
| Pages deployment   | [35545797228](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35545797228), successful           |
| Windows installer  | `irori-0.1.12-windows-x64-Setup.exe`, 319,919,104 bytes (305.1 MiB)                                    |
| Windows SHA-256    | `b516f7ecac2dc1e54b97a06e627dca3e97a3db8b24a0dd84832c3e1c4a143fd1`                                     |
| Mac disk image     | `irori-0.1.12-macos-arm64.dmg`, 281,574,107 bytes (268.5 MiB)                                          |
| Mac SHA-256        | `ca86e0956dadaae621503fad51b659d9a3f018ee3f7a2f274e3528e389276259`                                     |

On 2026-09-21 both installers were fetched without credentials straight from the
release URLs; both returned HTTP 200 with the byte counts and SHA-256 above,
matching `SHA256SUMS.txt` and GitHub's own asset digests. The deployed site's
bundle names both installers and the tag. Continue from current `main`; the
release commit identifies the binary, not the latest documentation. Earlier
identities are in [CHECKPOINT](CHECKPOINT.md) and the release notes.

Versions `0.1.0` and `0.1.1` have no compiled Google client configuration and cannot acquire the new settings automatically. The owner previously demonstrated that 0.1.0 reached the Windows workspace/cloud dialog after a SmartScreen unknown-publisher prompt. That is historical startup evidence, not 0.1.2 installation/upgrade/IME or Google acceptance. Signing remains open.

## Decisions to preserve

- Source license: MIT; dependency/provider terms remain separate. Devices available to the owner: Windows 11 / Ryzen 9 / x64 and MacBook M5 Pro / arm64. Exact macOS/minimum supported OS versions still need recording. Linux is an engineering test platform.
- Q01: CSV basic editing and note links, readable graphs with hierarchy/subgraph filtering. Native CLI agents build the ontology with people; irori visualizes it. Preserve unknown columns and IDs.
- Q02: one workspace joins multiple arbitrarily named GitHub KB repositories and multiple selected Drive folders, with multiple accounts. Drive ownership is independent of GitHub/KB membership; category selection is optional. Existing legacy KB attachments remain intact.
- The terminal uses xterm.js/FitAddon, node-pty, default-shell/which and tree-kill. It discovers installed shells and starts one in the selected KB. It is a native shell with the user's ordinary permissions, not a KB sandbox. Preserve typed HostAPI boundaries, session lifecycle, backpressure and child cleanup.
- rclone 1.75.1 is bundled from an official release with pinned archive hashes and its license. Packaged startup uses the bundled binary outside ASAR. Windows additionally requires WinFsp for mounting. Source checkout setup differs from installer setup.

## Google state: configured, real consent still pending

The owner completed the Google application registration and saved these repository Actions secrets:

- `IRORI_GOOGLE_CLIENT_ID`
- `IRORI_GOOGLE_CLIENT_SECRET`

Their names/update timestamps were verified; their values were not retrieved or printed. The workflow passes them to `IRORI_BUILD_GOOGLE_CLIENT_ID` / `IRORI_BUILD_GOOGLE_CLIENT_SECRET` during packaging. Build-time validation and all three native package jobs pass. The published Windows evidence records `oauthConfigured: true`. Do not ask the owner to repeat initial registration or paste values into chat. Use existing CI secrets for subsequent authorized builds. Ordinary users only use account selection and browser consent.

The owner reported declaring all Drive permissions to allow future writing. `src/cloud/accounts.ts` still requests only `drive.readonly`; mounts are also read-only. Broader console declarations neither expand the actual request nor implement uploads. D04 still requires durable staging, observed remote completion, recovery and the corresponding scope/re-consent work. No Google project/audience/test-user settings or real account access were independently accepted during this session.

`scripts/package-smoke.ts` starts account onboarding through the packaged HostAPI and actual bundled rclone, intercepts system-browser opening, checks only the local redirect to Google's authorization endpoint, validates the read-only scope and cancels. Evidence records booleans, not OAuth URLs, client values or tokens. This is not Google's validation of the client, a completed login, consent, refresh, shared-drive access or a mounted folder. Local package verification used synthetic client settings; CI used the owner's registered secrets.

Windows trial flow: close the old app, install 0.1.2, install/recheck WinFsp if prompted, then use **Google Drive → 接続** in the workspace sidebar (or header **クラウド接続**), name/add an account, complete consent, choose/register a folder and try reading it. Per-KB contents controls manage legacy connections. If the Google project is in testing, use its registered test users; testing-mode authorization expiry is described in DISTRIBUTOR-GOOGLE and the release notes.

## Next priorities

1. D03/D05: obtain the owner's exact 0.1.2 device result and fix any reproduced account, shell or mount issue. Verify real consent, WinFsp mounting, folder reads, restart/reconnect, a second account/shared drive, denial and expired credentials. Distinguish client setup from consent and filesystem readiness. Account/device input may be requested while independent engineering continues.
2. D04: implement recoverable cloud writes using established rclone capabilities where suitable. Preserve unsent bytes across restart/network failure and distinguish pending, uploading, confirmed and failed states. A scope/`readOnly` flag change alone is insufficient.
3. D06: stable note/artifact/run identities, explicit multiple-source selection, retained source versions/snapshots and provenance/reverse links; then search, rename/backlinks/properties. CSV/graph presentation and Git collaboration are already implemented. This work can proceed while device acceptance is pending.
4. D07–D10: native IME/editor/data safety and performance, provisional Electron/host assessment, credential protection, dependency/provider distribution review, signing/notarization, upgrade/rollback, supported-OS evidence and complete new-user acceptance. Full-release requirements remain intact.

D01's Q01/Q02/license/device choices and D02's native packaging foundation are implemented. The distributor client has also been supplied. Avoid restarting those setup/research tasks because an older milestone lists them as missing.

## Validation and implementation cautions

The published 0.1.3 application passed build, 69 of 72 behavior tests (three optional provider controls skipped), eight Electron UI suites and all three native package jobs. Subsequent source verification is recorded in STATUS. Website build and real/mixed/available/unavailable browser checks passed. These checks used no model inference. Documentation-only checkpointing does not rerun or extend that runtime evidence.

Node requirement is `^24.15.0 || >=26.0.0`; this workspace has Node 24.21.0 in `node_modules/.bin`, while the system Node may be 20. For code changes, use the appropriate existing scripts under a supported Node runtime:

```sh
cd /workspace/KB_design/irori
export PATH="$PWD/node_modules/.bin:$PATH"
npm run build
IRORI_TEST_RCLONE_PATH="$PWD/.local/rclone/linux-x64/rclone" npm test
# Renderer changes:
xvfb-run -a npm run test:ui
# Website changes:
npm run build:website
xvfb-run -a npm run test:website
```

The rclone path is an ignored local tool; use `npm run setup:cloud` if it is missing. Without the rclone opt-in, additional tests skip. `npm run make` / `npm run test:package` and `.github/workflows/app.yml` verify packages. Configured package checks require `IRORI_EXPECT_PACKAGED_OAUTH=1`; the workflow sets it from secret presence. Source-only changes do not update public installers.

Preserve Windows `rebuildConfig.ignoreModules: ['node-pty']` for the pinned version: official Node-API prebuilds avoid a broken MSVC rediscovery on the Windows runner. Keep native helpers and rclone unpacked outside ASAR. The host bundle externalizes runtime dependencies; copied packages must include dynamic SDK imports and be tested outside the checkout. default-shell's named export avoids CJS/ESM double-wrapping.

Use disposable KBs for mutation tests. Keep filesystem/process work behind the typed, validated HostAPI and trusted main-frame boundary. The native terminal's own commands run with user permissions; document content receives no raw IPC/Node/shell API.

## Authorization and local state

The owner authorized development, verification, feature-branch commit/push and PR creation, and separately requested the Windows testing download channel and the terminal/Google follow-ups. Every new feature now requires a dedicated branch and PR; previous commit/push authorization does not permit direct feature changes on `main` or imply merge authorization. Preserve authorization for necessary tested work without re-asking. The narrow unsigned Windows preview is not approval for a complete general release, a Mac release, unrelated external account changes, or paid native model execution. Follow AGENTS for real provider tests; do not run `test:agents` or real-model UI tests without the required authorization, or bypass provider authentication/permissions.

The old VM preview may still be running older code. `.local/vm-preview/samples` and `.local/vm-preview/device` contain untracked user data: preserve them and do not reset/delete them. This checkpoint did not restart that preview. `.local/publication/`, `.local/rclone/`, `.local/downloads/`, `out/` and `test-results/` hold ignored tools/test artifacts, including a synthetic-client local package; publish only the verified CI artifact for the exact intended commit. The anonymous download checker is `.local/publication/check-site.mjs`, not a tracked production dependency.

Desktop CI creates temporary engineering artifacts; it does not publish releases or Pages. Website deployment is manual via `.github/workflows/website.yml`. A new published installer requires a distinct version, verified native bytes, notes/checksums, the matching manifest, and anonymous delivery verification. Keep live Google client values, account tokens, authorization URLs, user notes and transcripts out of tracked evidence.
