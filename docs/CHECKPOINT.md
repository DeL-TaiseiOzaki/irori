# Checkpoint — note editing, native agents, and download website

Date: 2026-09-12. This is a local development checkpoint, not a release.

## User intent at pause

The user accepted the website/download distribution direction and intends to continue all remaining implementation later. The immediate request is to checkpoint the work and pause implementation. Do not interpret this checkpoint as permission to publish a website, push a release, or mark the backlog complete.

The intended product remains a desktop IDE/ADE where actual local Claude Code and Codex processes edit KB notes, run tools and produce artifacts. End users should eventually visit the website, download a Windows/Mac installer, install it, open their KB and complete agent setup without a developer build workflow.

## Saved state

- Independent irori application with React, provisional Electron host, Milkdown Crepe rich editing, CodeMirror source editing and a typed host boundary.
- Explicit personal/team/organization spaces, portable scope UUIDs, ownership-first three-layer classification and contents boundaries.
- Note save, external refresh, dirty conflict display, local recovery drafts and conservative Markdown byte preservation.
- Both actual native agents selectable in the normal AI panel, with streaming, permission/user-input handling and process cancellation. Native account authentication remains provider-owned.
- Explicit Linux root-container startup and actionable startup diagnostics.
- Japanese landing/download website, actual fixture screenshot, responsive layout, FAQ and Windows x64 / Mac Apple silicon / Mac Intel slots.
- Separate static website build, validated release manifest and manual GitHub Pages workflow. Distribution direction: GitHub Pages for the entrance and GitHub Releases for installer assets. No native installers or public deployment exist; all download slots remain unavailable.
- Source, lockfile, behavior/UI/provider test scripts, dependency notices, host assessment, acceptance backlog and sanitized measurement evidence.

Both sibling repositories remain clean and independent:

| Repository | Revision at checkpoint |
| --- | --- |
| LayeredKB-vscode-extention | `2a2e7e04ee2d393584682669303457211ff7711c` |
| claudian-orchestra-template | `fa74f2a14665459b63ed98566b5f833627d728be` |

KB_design itself is not a Git repository. Product specifications remain in `../docs/irori/`; no parent repository, monorepo or submodule was introduced.

## Verification already completed

These are the recorded results from the implementation session; provider tests were not repeated merely to create this checkpoint.

| Check | Result |
| --- | --- |
| Application build and typecheck | Pass |
| Application behavior suite | 9 tests pass |
| Electron UI smoke under Xvfb | Pass: real rich/source edits, Japanese text, preservation, external refresh and conflicts |
| Real provider tests | Both Codex and Claude read/edit a disposable note; both also exercised through the ordinary app panel |
| Lifecycle probes | Claude deny/question/continuation and both cancellation paths exercised; real Codex question/denial acceptance remains open |
| Website build and browser smoke | Pass: navigation, FAQ, unavailable downloads, screenshot asset and mobile overflow check |
| Website visual review | Desktop and mobile screenshots inspected; copies saved alongside measurements |

Detailed results and practical limitations: [STATUS](STATUS.md), [measurements](measurements/2026-09-12.md), [sanitized evidence](measurements/2026-09-12-evidence.json), [compatibility matrix](compatibility/MATRIX.md).

Raw provider transcripts, temporary KB paths, logs, generated bundles, dependencies and local device state are excluded from Git. Build outputs can be regenerated from the lockfile. Existing ignored test artifacts remain on this machine.

## Remaining work and restart order

The full R01–R12 backlog is retained in [ACCEPTANCE](ACCEPTANCE.md). Do not replace it with this shorter restart list.

1. Close remaining agent/editor reliability gates: real Codex question/deny, persisted per-space session recovery, expired-login/version errors, native rules/skills/MCP parity, Japanese IME and broader Markdown preservation.
2. Build first-run CLI detection and install/login guidance. The current development app requires separately installed and authenticated native CLIs.
3. Prepare native packaging and a Windows/Mac architecture test matrix; validate real install, launch, file operations, agent permissions and cancellation. Signing/notarization, distribution licensing and updater work remain open. Use [DISTRIBUTION](DISTRIBUTION.md) to connect only verified installer URLs to the website, then publish and test the public flow.
4. Revisit the provisional host with measured equivalent workloads. Linux app-only RSS is about 690 MiB, with the measured Claude process tree around 1 GiB; this exceeds the proposed editing budget. Tauri plus a Node sidecar remains a candidate, not a completed comparison. See [ADR 001](decisions/001-initial-host.md).
5. Complete file safety/scale, stable note identities, search/backlinks/rename, offline/rebind UI and ontology after its interaction decision.
6. Implement GitHub collaboration and selected-folder cloud mounts with independent Git/cloud recovery, followed by optional terminal and durable artifact/source-version provenance. Existing contents entries stay unavailable until folder identity and mount verification exist.

Known safety/compatibility limits include the final-hash-check/rename external-writer race, bounded watcher depth, no restart-resume, incomplete dialect/IME coverage and unverified native-platform isolation. The root-container startup explicitly disables Chromium's OS sandbox; ordinary application startup does not do so automatically.

Q01 (ontology interaction) and Q02 (physical repository placement policy) are still unanswered. Acceptance of website distribution does not resolve them or finalize Electron over Tauri.

## Resume

Read `AGENTS.md`, `README.md`, this checkpoint, `docs/STATUS.md`, `docs/ACCEPTANCE.md` and the relevant decision/distribution document. Recheck the worktree and environment before editing. Continue in irori only unless a separate reference-repository change is actually needed and authorized.

With dependencies already installed, the independent checks are:

```sh
npm run build
npm test
xvfb-run -a npm run test:ui
npm run build:website
xvfb-run -a npm run test:website
```

A fresh checkout needs Node 24+, `npm ci` and `npm run setup:electron`. Desktop startup needs a real accessible GUI; Xvfb smoke creates a virtual test window, not a browser-accessible application. Website preview uses `npm run dev:website`. Real-provider checks are separately opt-in, consume the native account allowance and must use disposable KBs.

To locate this checkpoint in Git:

```sh
git log -1 --format='%h %s' -- docs/CHECKPOINT.md
```
