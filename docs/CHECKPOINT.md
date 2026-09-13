# Checkpoint — Packaging foundation and release decisions

Workspace follow-up: [WORKSPACE-DRIVE](WORKSPACE-DRIVE.md) now implements new Drive attachments independently of KB membership, including empty workspaces and unchanged legacy attachments. Build, 60 tests with native controls and six UI suites pass locally. Explicit legacy transfer, real cloud authentication/mounts/writes, CSV/graph ontology, selected-source identity/provenance and D05–D10 acceptance remain open. Start with this follow-up and current native CI evidence before interpreting the preceding checkpoint's next-step statements.

Latest follow-up, 2026-09-13: resume from [RELEASE-PLAN](RELEASE-PLAN.md), [PACKAGING](PACKAGING.md) and [ADR 002](decisions/002-release-and-workspace.md). Forge packaging/CI and download-state tests are implemented; the MIT license and Q01/Q02 decisions are recorded. Local Linux make/package, 55 tests with native controls, five UI suites and website checks passed. Native CI results must be checked against the pushed commit, and Windows/Mac installed-device acceptance remains separate. The next product change is workspace-level independent GitHub/Drive connections, preserving existing user data, followed by the remaining D03–D10 requirements.

The inherited four uncommitted release-planning documents were retained and incorporated. The existing VM preview and its ignored sample/device data were not restarted, removed or reinitialized. No public deployment or real model execution is included. Earlier chronological checkpoint records follow; their older verification counts and open Q01/Q02 statements are historical.

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
