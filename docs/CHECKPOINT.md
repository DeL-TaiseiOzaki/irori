# Checkpoint — Published Windows testing preview

Publication follow-up, 2026-09-13: the owner asked to publish the download website for their Windows trial. [The public site](https://del-taiseiozaki.github.io/irori/) and [unsigned Windows x64 prerelease `v0.1.0-preview.1`](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.0-preview.1) are live. The release tag points to verified application commit `86839006bc49fd35cdbf58c5ed4998db1adfe0f6`; no desktop application code was changed for publication. Website commit `de0a60b0c6ab15d4e0bba48af985665d5b268fa2` is deployed by successful [Pages run 34753093494](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34753093494). GitHub Pages uses Actions with HTTPS enforced.

Publication validation: application build and 60 behavior tests passed (four optional native controls skipped); website build and actual/mixed/available/unavailable browser checks passed. A fresh unauthenticated Electron browser opened the live HTTPS project page at desktop and mobile sizes, loaded its assets without HTTP/page errors, kept both Mac buttons disabled, and clicked the Windows link to download all 271,884,288 bytes. The downloaded SHA-256 matches the native CI evidence and GitHub asset digest: `b5ec525b85acdd2d8b44f62b0ac5c1fe353e0c0538066cac24fe535794c20ab8`. An independent anonymous HTTP download also returned 200 with the same bytes/hash. This verifies public delivery, not Windows 11 installation. [Preview notes](releases/0.1.0-preview.1.md) record prerequisites, support, package identity and limitations. Local publication artifacts/screenshots are ignored under `.local/publication/` and contain no user KB data.

The owner's publication request is a narrow exception to the previous no-download gate for this testing preview. Full-release D03–D09 and native installed-device acceptance remain open; do not mark the general release complete. Mac downloads, Google account configuration and model inference were not included in this task. Next: collect the owner's Windows 11 installation/Japanese-input results against this exact installer, then continue the full-release work below.

## Application checkpoint before preview publication


Date: 2026-09-13. Continue in this independent repository on `main`. Start with [RELEASE-PLAN](RELEASE-PLAN.md), [PACKAGING](PACKAGING.md), [WORKSPACE-DRIVE](WORKSPACE-DRIVE.md), [ONTOLOGY](ONTOLOGY.md) and [ADR 002](decisions/002-release-and-workspace.md). Inspect Git status/log and the latest CI run before interpreting historical entries below.

Implemented and verified in this continuation:

- Forge EXE/DMG/ZIP packaging, app verification/native package CI, relocated own-executable SDK/save tests, actual package dependency/checksum inventory and website download-state fixtures.
- MIT license; recorded Windows 11 Ryzen 9/x64 and MacBook M5 Pro/arm64 acceptance devices. Q01 is CSV editing/note links with hierarchy/subgraph visualization, constructed by native agents with people. Q02 joins arbitrary independent GitHub KBs and selected Drive folders in a workspace with multiple accounts.
- Workspace-owned Drive storage outside KBs, empty workspaces, optional category selection, two-account UI, preserved legacy attachments, guarded profile deletion and shared read-only cloud browsing. Native Git authentication remains per repository; multiple-account GUI onboarding/acceptance is still open.
- Declared ontology column mappings, CSV table/source mode, hierarchy/subgraph filtering, note links, invalidation and a prepared native-agent setup request. Unknown columns and IDs remain intact; no automatic CSV/Markdown rewrite. Source hashes currently describe saved display revisions, not retained immutable provenance.
- Native package defects fixed: Mac framework-copy links, Windows ASAR paths, canonical renderer trust, inherited Windows PATH and closure after a renderer crash. Root-container smoke uses Chromium's temporary-file shared-memory fallback for the VM's 64 MiB `/dev/shm`; no production launch override was added.

Local evidence: build, 64 behavior tests with all four optional native controls enabled (zero failed/skipped), seven UI suites, Linux make/packaged SDK/Japanese save/CSV graph and website build/browser fixtures pass. The forced-renderer-crash close regression passes. Implementation commit `8683900` is pushed. [CI 34752136969](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34752136969) passes verification and Linux x64, Windows x64 and Mac arm64 packages, including actual SDK imports, Japanese note save, reload, CSV graph and normal shutdown. A subsequent documentation-only commit records this result; it does not change the verified application bits.

Next work, keeping all full-release requirements:

1. D03/D05: distributor OAuth project and real two-account/shared-drive mounts, native GitHub/account/CLI onboarding and authorized real-model acceptance on the user's devices. Build-time OAuth integration is ready; Google config and usable native mounts are absent here.
2. D04: durable staged cloud writes, remote confirmation, interruption/restart recovery and re-consent design. Current permissions/mounts remain read-only.
3. D06: explicit multiple-source selection, durable note/artifact/run IDs, retained exact source versions/snapshots, curation and output provenance/reverse navigation; then search/rename/backlinks/properties. The CSV/graph presentation already exists and should not be reimplemented.
4. D07–D10: native IME/performance/host comparison, credential protection, dependency redistribution review, signing/notarization, upgrade/rollback, new-user acceptance and only then public assets/Pages. Exact minimum OS versions/support contact/publisher route still need release decisions. Legacy Drive transfer and workspace-reference sharing/export remain open.

At the application checkpoint below, commit/push alone was authorized and no public deployment was performed. The subsequent Windows testing preview was separately authorized and published as recorded above; unrelated account changes and real model inference remain outside that authorization. The inherited four release-planning documents were preserved and incorporated. The VM preview and `.local/vm-preview/{samples,device}` were not restarted or modified.

## Historical checkpoint records

The following entries preserve their original verification counts and proposals. Their open Q01/Q02 statements and next-work lists are superseded by the current checkpoint above.

Date: 2026-09-13. This checkpoint includes Git collaboration and the completed implementation reuse audit following UI checkpoint `9c04abb`. The user authorized committing and pushing this work to `origin/main`. Build, 54 tests with all native controls enabled, and all five Electron UI scripts passed. No deployment or release is included. The running VM preview still needs an application restart to load this build.

## Subsequent work

The user then requested completion of all remaining reuse work. The [completion ledger](REUSE-COMPLETION-2026-09-13.md) records the implemented SDK/IPC/queue/metadata/dialog/JSONL changes and the final decision for every alternative. Build, 54 tests with native controls and all five UI scripts pass. These changes are included in this checkpoint; start with this ledger when resuming.

The user subsequently requested implementation of the high-priority reuse findings, favoring simple code. [Git/stream/UI simplification](SIMPLIFICATION-2026-09-13.md) was implemented in the first simplification slice, with build, 46 passing behavior tests (four native controls skipped) and all five UI scripts passing. Read that follow-up and the latest `STATUS.md` before resuming; the research-only audit is historical.

Resumed on 2026-09-13 from `9c04abb`; the user chose GitHub collaboration as the next task. This checkpoint adds the [Git review/commit/sync/clone journey](GIT.md), including native merge conflict review and recovery. Build, 42 behavior tests (four opt-in native controls skipped) and all five UI scripts pass. These additions are included in this checkpoint. Inspect `git status` and `docs/GIT.md` when resuming; the implementation and backlog have progressed beyond the saved UI commit described below.

Checkpoint `2914ec4` was pushed to `origin/main` with user authorization. This follow-up checkpoint adopts the user-selected app icon and applies a modern visual system to startup, the five-pane workspace and assistant; see [UI direction, installed skills and verification](UI-DESIGN.md). The user authorized committing and pushing these changes on 2026-09-13. Build, 30 behavior tests and all four UI scripts passed; four opt-in native probes were skipped. The acceptance boundaries below still apply.

## Confirmed direction

- irori's central requirement is one workspace linking multiple independent GitHub checkouts and multiple selected cloud folders/accounts. Physical repository placement remains undecided; named profiles preserve existing checkout locations.
- Users choose the actual folder name beneath `contents` for each cloud attachment. Provider folder identity remains independent of that name.
- Codex, Claude Code, OpenCode and Pi use their native local harnesses and configuration. Scope boundaries, permissions and conversation bindings remain separate.
- The original LayeredKB UI reference is `../LayeredKB-vscode-extention/images/image2.png`. Its three-row, five-pane navigation is implemented: full-width Schema; personal/team Knowledge Base; personal/team contents. Organization spaces retain explicit labels in the team column. The reference repository/image was not modified by this work.
- The user confirmed that Chrome can open and interact with the preview. This is a UI viewing checkpoint, not acceptance of real Google mounts, all harness capabilities or a finished release.

## Saved implementation

- Named startup workspace profiles with creation, editing and removal; multiple existing-checkout inspection and registration; offline scope-ID retention during profile edits.
- Read-only Google Drive account/folder/shared-drive onboarding, private rclone configuration and authenticated loopback RC, exact provider IDs, mount identity checks, connect/disconnect/rebind, alias rename, attachment removal and unused account removal. Existing local bytes and remote files are preserved by management operations.
- Per-scope/provider native session handles and explicit reset, all four selectable harness adapters, streamed events, native questions/permissions where supported, cancellation and process cleanup. OpenCode/Pi have native control and protocol-fixture evidence; their actual model-turn acceptance remains open.
- Layered explorer with independent pane scrolling/collapse, scope groups, selected-file highlighting, lazy directory reads and per-space note/cloud actions. Root listings are shared across panes; classification and ownership remain host-authoritative. No native instructions are merged across repositories.
- Existing rich/source Markdown editing, save/conflict/recovery behavior, scoped agent context and website/download scaffolding remain available.
- Audit fixes include independent-scope reconnection failures, overlapping polling, missing placeholders, attachment count limits and read-only save shortcuts. See [audit](AUDIT-2026-09-13.md).
- Actual Electron desktop browser preview with persistent sample KBs, noVNC and a Japanese input helper. See [VM preview](VM-PREVIEW.md).

## Verification at this checkpoint

Tests are recorded from completed implementation work; no paid model calls or redundant full suite reruns are needed merely to create this checkpoint.

| Check                                        | Latest evidence                                                                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                              | Passed after the layered explorer change; existing dependency annotation and large-bundle warnings remain                                                                                                                             |
| `npm test`                                   | 30 passed, 0 failed; four opt-in native control probes skipped for the final UI change                                                                                                                                                |
| Native control probes at the preceding audit | All 34 tests passed with real rclone/OpenCode/Pi controls enabled; no Google consent or model inference                                                                                                                               |
| `xvfb-run -a npm run test:ui`                | All four scripts passed: editor/session, cloud protocol fixture, harness protocol fixtures and layered explorer                                                                                                                       |
| Layered explorer fixture                     | Four spaces (personal, two teams, organization), schema isolation, nested contents precedence, same-name note ownership, unsaved-switch protection, AI context, cloud-action ownership, pane collapse and narrower-window AI controls |
| Live browser preview                         | Updated layout inspected, browser login verified; user subsequently confirmed Chrome access and exploration                                                                                                                           |
| Website                                      | Earlier checkpoint's build/browser evidence is historical; website code was not changed during these additions                                                                                                                        |

Codex/Claude real-model evidence also belongs to the earlier milestone. Current OpenCode/Pi controls, seeded session tests and executable fixtures must not be presented as real model-turn or mounted-file acceptance. Details: [STATUS](STATUS.md), [HARNESSES](HARNESSES.md), [LAYERED-EXPLORER](LAYERED-EXPLORER.md), [CLOUD-SETUP](CLOUD-SETUP.md).

## Resume and preview access

1. Read `AGENTS.md`, `README.md`, this checkpoint, `docs/STATUS.md`, `docs/ACCEPTANCE.md` and the relevant implementation document. Inspect `git status` before editing.
2. Stay in the independent irori repository. KB_design is not a monorepo. The sibling reference repositories have not been changed by this implementation; preserve user-owned additions, including the UI image.
3. Inspect the current environment before assuming a preview is running. At pause, the browser viewer was available on VM loopback port 6080. A checkpoint does not recreate running processes, dependencies or ignored device state.
4. Forward port 6080 using the connected VS Code window's Ports view and open its displayed local address in Chrome. The user's embedded browser had shown `ERR_CONNECTION_REFUSED`, while Chrome worked. Use the actual forwarded address if VS Code assigns another local port.
5. Read the password from `.local/vm-preview/password`; it changes on launcher restart and is never stored in this checkpoint. Runtime metadata is in `.local/vm-preview/runtime.json`. Sample notes and edits live in `.local/vm-preview/samples`, and preview device data in `.local/vm-preview/device`; these are ignored and not backed up by the Git commit.
6. If the viewer is stopped, use `npm run preview:vm`. First-time VM setup, including `npm run setup:preview` and OS prerequisites, is in [VM-PREVIEW](VM-PREVIEW.md). A fresh app checkout needs Node 24.15+ (24.x) or 26+, `npm ci`, `npm run setup:electron` and `npm run build`.

For code changes run `npm run build` and `npm test`; renderer changes also require `xvfb-run -a npm run test:ui`. Real-provider inference remains opt-in and must be separately authorized, using disposable KBs. Close irori normally to flush drafts and shut down native services before restarting the preview; refreshing only Chrome does not reload the Electron host.

## Remaining work

The full R01–R12 matrix and sequencing remain in [ACCEPTANCE](ACCEPTANCE.md). Next priorities:

1. Supply deployment Google OAuth configuration and a native mount environment, then verify real consent, multiple accounts/shared drives, failure/recovery and actual mounted paths from every harness. This VM lacks `/dev/fuse` and the deployment OAuth settings.
2. Verify the implemented Git clone/fetch/diff/history/commit/push and native merge flow with live GitHub authentication/branch protections and native platforms; extend remaining branch/rebase/binary-conflict workflows. Cloud write/upload support with durable pending-write recovery, moved-folder and expired-account recovery remain open.
3. Real model turns and native restart/resume for OpenCode/Pi, remaining Codex question/denial gates, native capability parity and transcript redisplay.
4. Offline space relocation/unregistration, note search/rename/backlinks, broad Markdown/IME and scale acceptance, ontology UX (Q01), optional terminal and versioned artifact/source provenance.
5. Native Windows/macOS testing, installers/signing/updating, provider distribution review and performance budgets. Electron remains provisional; no equivalent Tauri comparison is complete. Repository placement policy (Q02) is also open.

Known limits include the narrow external-writer race at save, bounded watcher depth, device-local credentials protected by file permissions rather than OS vault integration, in-memory conversation display history and unverified native crash/mount recovery. The development container launcher uses its explicit root-only Chromium sandbox exception.

Locate this checkpoint commit with:

```sh
git log -1 --format='%h %s' -- docs/CHECKPOINT.md
```
