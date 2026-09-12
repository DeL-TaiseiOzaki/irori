# Implementation status — first note/agent milestone

Date: 2026-09-12. Repository: `irori`, independent of both KB_design reference repositories. The implementation is saved as a local Git checkpoint; see [CHECKPOINT](CHECKPOINT.md) for restart instructions. No push, deployment or release has been performed.

## Implemented and exercised

- Actual Electron window with Japanese UI, native KB folder chooser, explicit personal/team/organization registration and lazy explorer.
- Portable UUID scope declarations in the KB, absolute path bindings in device data, contents override, nested scope ownership, alias rejection in both registration orders, and reference-derived regression scenarios.
- Milkdown Crepe rich editor plus CodeMirror source mode, note creation, save, external invalidation, recovery drafts, conflict versions and explicit manual reconciliation. Save/source switching/shutdown use a current editor snapshot rather than only the delayed rich-editor change callback.
- Both **Codex and Claude Code selectable in the ordinary AI panel**, actual locally installed processes in the selected fixture KB, native account authentication left intact, streamed output and tool events, allow/deny requests and cancellation.
- A real Electron UI test selected each provider, submitted the instruction from the panel, approved fixture-local operations, observed the note's bytes change, and observed the editor refresh. The Claude run also changed the note while an unsaved editor buffer existed; the conflict UI retained both versions. This was not a mock, a model-API chat demo, or a terminal-only test.
- Independent native session continuation per scope/provider within the running app; conversation UI is separated by scope/provider. SDK and CLIs start on demand.
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

This is a development preview, not the complete irori release. Native Windows/MacBook setup, IME, permissions, processes and installers remain unverified. Linux memory exceeds the proposed editing budget; the host is provisional. No GitHub/Drive collaboration, mount identity/transfer service, optional terminal, ontology editor, artifact registry or versioned provenance is implemented yet. Files under contents remain visibly unavailable until verification exists.

Codex's normal workspace sandbox could not initialize in this container (namespace restrictions); fixture mutations succeeded after native approval requests. No unsafe-mode fallback was silently added to the product. Linux root Electron automation and the explicit container-development launcher pass `--no-sandbox`; normal application configuration retains renderer sandboxing. Neither result proves native-platform OS isolation.

Per-file pre-save hash checks/atomic replace and drafts protect against observed conflicts, but there is a narrow external-writer race between the final hash check and rename. Watchers have a six-level bound. Source fallback is conservative rather than exhaustive; native Japanese IME, unusual dialects, mixed newlines and crash/power-loss recovery need more coverage. See [compatibility](compatibility/MATRIX.md).

## Next concrete work

Close the remaining Codex request/denial and editor-native-platform gates, then run the same frontend/agent workload in a small Tauri + Node-sidecar harness against Electron's measured memory. Add persistent per-scope session recovery, stable note identities and a reviewed Git change service before cloud/artifact provenance. All full-release requirements remain in [ACCEPTANCE.md](ACCEPTANCE.md); Q01/Q02 remain open.

## Startup follow-up — Linux root development shell

The reported installation and build completed. Startup failed because Electron rejected root execution without an explicit `--no-sandbox` flag; Node 20 engine warnings and Vite chunk-size warnings were not that failure.

Added `npm run start:container` as an explicit Linux-only development entry point. Standard startup now diagnoses root use and absent display variables before spawning Electron. It still does not disable the sandbox automatically. The launcher resolves the application directory independently of the caller's working directory and reports missing Electron binaries with the setup command.

Verified: build and all nine behavior tests pass; root/default and missing-display paths return actionable errors; the container command created the actual irori window (1440 × 940); the Xvfb UI smoke passes. No provider calls were needed for this startup fix. README now distinguishes a visible desktop session from a virtual Xvfb test display; no browser UI or remote-desktop server was added.

## Distribution website follow-up

Added a Japanese static landing/download page with the actual fixture screenshot, feature descriptions, responsive layout, setup FAQ and three platform slots. Unavailable installers are explicitly disabled; published HTTPS installer URLs can be supplied through the validated release manifest. A separate Vite build and manual GitHub Pages workflow prepare website publication without changing the desktop host boundary. No new library dependency was needed.

Verified locally: website and desktop production builds pass, all nine application behavior tests pass, and the website smoke passes in a real Electron/Chromium window. The smoke checks anchor navigation, FAQ expansion, all three unavailable download buttons, the screenshot asset and a 390px mobile layout without horizontal overflow. Desktop and mobile screenshots were visually inspected. No provider call was needed for this website work. Website publication, native installer production, signing, native tests and first-run CLI setup remain outstanding; the page does not turn the desktop app into a browser application. See [distribution](DISTRIBUTION.md).
