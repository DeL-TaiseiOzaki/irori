# Implementation status — notes, native agents and connection onboarding

Date: 2026-09-12. Repository: `irori`, independent of both KB_design reference repositories. The implementation is saved as a local Git checkpoint; see [CHECKPOINT](CHECKPOINT.md) for restart instructions. No push, deployment or release has been performed.

Pause checkpoint, 2026-09-13: the user successfully opened and explored the layered UI in Chrome and requested a checkpoint. The local checkpoint now includes workspace/cloud lifecycle management, all four harness adapters, the layered explorer and VM preview. Final UI-change evidence is build pass, 30 behavior tests passed with four native probes skipped, and all four UI scripts passed. The audit's earlier opt-in native control run passed all 34 tests without inference. [CHECKPOINT](CHECKPOINT.md) is the current restart entry; later sections retain chronological milestone evidence and their then-current limitations.

Latest implementation: 2026-09-13. Startup workspace profiles, existing-checkout inspection, read-only cloud connection services/UI and OpenCode/Pi adapters are implemented locally. See the follow-ups below, [CLOUD-SETUP](CLOUD-SETUP.md) and [HARNESSES](HARNESSES.md). Earlier dated evidence remains historical; it does not establish native acceptance of these additions.

Latest audit: workspace edit/removal, offline scope retention, attachment rename/removal and unused account removal are now implemented. Connection polling and cross-scope failure handling, placeholder recovery, attachment limits and read-only shortcuts were corrected. See [audit evidence and remaining gaps](AUDIT-2026-09-13.md).

## Implemented and exercised

- Actual Electron window with Japanese UI, native KB folder chooser, explicit personal/team/organization registration and lazy explorer.
- LayeredKB reference layout: schema across the top, personal/team Knowledge Base panes in the middle and personal/team contents panes below. Repository ownership stays explicit; independent scroll/collapse and per-scope note/cloud actions are implemented. See [LAYERED-EXPLORER](LAYERED-EXPLORER.md) for the four-space renderer regression.
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

| Check | Result and boundary |
| --- | --- |
| `npm run build` | Pass; existing bundle-size warning remains |
| Behavior suite with `IRORI_TEST_RCLONE_PATH` | 21 passed, zero failures/skips; plain `npm test` skips the one explicitly opt-in native rclone probe |
| Native rclone v1.75.1, official archive checksum verified | Real child startup/PID, authenticated RC, unauthorized request rejection, native Drive config question and shutdown; no Google consent or mount |
| `xvfb-run -a npm run test:ui` | Both actual Electron scripts pass: original editor/session regression plus explicit cloud protocol fixture |
| Cloud UI fixture | Two-space workspace, two accounts, My/shared-drive selection, same-name folder IDs, user aliases, collision error, restart persistence; no actual remote/mount |
| Visual inspection | Startup and cloud connection screenshots inspected; artifacts remain ignored |

No native agent inference was requested for this slice. Actual Google consent, FUSE/Windows/macOS mounts, cloud files through native harnesses and interruption/crash recovery remain unverified. This container lacks `/dev/fuse` and deployment OAuth configuration. Read/write cloud operations, pending uploads, attachment rename/removal, ready-account removal, Git collaboration and OpenCode/Pi are not implemented. [CLOUD-SETUP](CLOUD-SETUP.md) records setup, device/portable boundaries and the remaining gates. No installer, deployment, commit or push was produced by this implementation turn.

## OpenCode and Pi implementation — 2026-09-13

The ordinary AI panel now selects all four native harnesses. OpenCode uses a fresh authenticated loopback server and event stream; Pi uses its native JSONL RPC. Both use the owning checkout's native configuration and existing provider setup. The renderer never receives arbitrary HTTP/process operations. Session handles, reset, run locking and process-tree cancellation are shared with Codex/Claude. OpenCode validates the session checkout and filters foreign conversation events; native permission replies are one-time. Pi validates resumed session files and waits for settled runs, including native retries, while command-only extension invocations can finish without invoking a model. Files not yet persisted by native Pi are not presented as saved sessions.

Added native extension dialogs and single/multiple-choice replies, with accessible question grouping and selection state. Pi's lack of standard tool approval popups and its native project-trust dependency are visible in the panel. No `--approve` or permission bypass is introduced. Schema classification now includes `.opencode`, `.pi`, `.agents`, `opencode.json` and `opencode.jsonc`, retaining contents precedence.

Verified: production build and 29 tests pass with the four opt-in native controls enabled (plain tests skip those controls). Actual OpenCode 1.18.30 verifies authenticated health, unauthorized rejection, checkout/session identity, SSE connection and shutdown. Actual Pi 0.85.1 verifies RPC discovery/abort plus native extension confirmation, lazy persistence and two fresh-process resumptions of a seeded session. None of these calls a model. Explicit executable fixtures separately cover streamed text, denial, questions, errors/crashes, cancellation, reset and failed resume without fallback. New Electron coverage exercises both adapters through the panel, multiple answers and restart/reset; original editor/cloud checks remain required. Full details and test configuration are in [HARNESSES](HARNESSES.md).

Native model inference, model-based editing/resume, full rules/skills/extensions/MCP parity and mounted-file access remain open for the new adapters. Windows/macOS testing, native Google consent/mounts and cloud uploads remain separate gates. The standalone `test:agents` and `test:lifecycle` scripts still target Codex/Claude. No credentials, transcripts, generated binaries or machine paths were added to tracked evidence. No commit, deployment or release was made.

## Interactive Linux VM preview — 2026-09-13

Added `setup:preview` and `preview:vm` development commands. A separate authenticated Xvfb desktop runs the actual Electron app; noVNC 1.7.0 and websockify provide a password-protected browser viewer over loopback. Access uses a private forwarded port. The launcher creates persistent personal/team sample KBs in ignored local state without overwriting edits, and leaves ordinary native CLI configuration/authentication intact. Closing a browser disconnects the viewer; closing irori finishes the preview services.

The browser toolbar includes a Japanese composition field that sends Unicode keystrokes to the selected app input. Verified in an actual browser: password login, desktop rendering, workspace opening, pointer/ASCII input, Japanese helper input and creation of a Markdown note with its Japanese name preserved on disk. Screenshots were inspected and stay in ignored test output. Listener inspection confirmed loopback-only addresses. Build and behavior checks pass (25 passed, four opt-in native controls skipped); no native model inference or Google login was invoked. The user's own laptop connection still depends on forwarding the VM port. This viewer is a development utility, not an installed-platform release or full native IME acceptance. See [VM-PREVIEW](VM-PREVIEW.md).
