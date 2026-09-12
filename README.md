# irori

A desktop IDE/ADE for writing Markdown notes and running **actual local Claude Code and Codex processes** in the selected knowledge workspace.

This independent repository contains the first working note + agent milestone. Electron is provisional; it is not a completed Windows/macOS release. The two sibling repositories remain independent and unchanged.

## Run

Requires Node.js **24+**, npm, and a desktop session. Install and sign in to the original `codex` and/or `claude` CLI using the provider's own flow. irori uses the installed CLI, its native configuration, and its existing authentication; it does not collect account tokens or replace them with API billing.

```sh
cd /workspace/KB_design/irori
npm ci
npm run setup:electron
npm run build
npm start
```

`setup:electron` downloads the pinned Electron binary; it is also useful when npm lifecycle scripts were disabled. Windows and macOS use the same npm commands from their own checkout path. Native installers are not available yet.

For this root-owned Linux development container, after the successful build:

```sh
npm run start:container
```

This explicit command disables Chromium's OS sandbox for the Linux test environment. It uses the current GUI display and does not change agent permission policy. Ordinary `npm start` now explains the root restriction before launching Electron instead of ending in a Chromium fatal error. On a normal desktop, use a non-root user and `npm start`.

A GUI display must actually be accessible to you. An SSH/container shell alone does not show an Electron window on your laptop; irori currently has no browser UI or remote-desktop server. For headless verification, use:

```sh
xvfb-run -a npm run test:ui
```

This runs UI checks and writes `test-results/irori-desktop.png`, then exits. `xvfb-run -a npm run start:container` can keep the app running on a virtual display, but that virtual window is not automatically visible to you.

If the system Node is still 20, `npm ci` emits engine warnings even though subsequent npm scripts use the pinned local Node 24. The pasted run completed installation and compilation; those warnings were not the root-user startup failure. Use Node 24+ for dependency installation on development machines. The Vite chunk-size warning concerns bundle size and does not mean that the build failed.

1. Select **KBフォルダを開く**. Choose the folder, a name, and personal/team/organization category.
2. **登録して開く** explicitly creates `.irori/scope.json` for a new registration and adds `/contents/` to `.gitignore`. Existing Markdown is not moved. The folder can be an existing independent Git checkout; irori does not initialize or publish a repository.
3. Open a note in the explorer or choose **ノートを作成**. Edit directly, use Crepe's slash menu/table/block controls, or switch to **ソース**. Save with the button or Cmd/Ctrl+S.
4. Open **AIに相談**, choose Codex or Claude Code, and enter an instruction. **保存して実行** saves the current note, starts the real CLI in that space, and supplies the selected note's path. Allow/deny requests and questions appear in the panel; **停止** cancels the process tree.
5. A clean editor refreshes after agent/external changes. A dirty editor shows both versions. Recovery drafts remain device-local.

CLI-native rules/settings/skills/MCP discovery remain the provider's responsibility. irori never combines every team's instructions. Native ancestor discovery still applies; registration is an ownership boundary, not an OS sandbox. Codex requests workspace-write/on-request/user review; Claude uses default permissions and native user/project/local settings. Existing native allow/deny rules remain effective.

## Verification

```sh
npm run build
npm test
# Actual Electron; Linux CI needs xvfb-run -a before this command:
npm run test:ui
# Actual provider accounts and disposable KBs; consumes native account allowance:
npm run test:agents
npm run test:lifecycle
# Both providers through the actual UI (POSIX example):
IRORI_UI_REAL_AGENTS=1 xvfb-run -a npm run test:ui
```

PowerShell: set `$env:IRORI_UI_REAL_AGENTS="1"`, then run `npm run test:ui` on the desktop. Native-platform acceptance is still outstanding.

Tests put detailed local evidence in ignored `test-results/` and mutate only disposable directories. [Status](docs/STATUS.md) records what was actually exercised. [Acceptance/backlog](docs/ACCEPTANCE.md) retains all confirmed requirements. [Host decision](docs/decisions/001-initial-host.md), [compatibility](docs/compatibility/MATRIX.md), and [measurements](docs/measurements/2026-09-12.md) distinguish verified, provisional, and outstanding work.

## Implementation boundary

- React renderer → typed, validated `HostAPI` → Electron preload/main. No renderer Node access, raw IPC export, HTTP server, remote page navigation, or document script execution.
- Milkdown Crepe rich editor + CodeMirror 6 source mode. Markdown is authoritative; unsupported detected constructs use source mode.
- Node `FileService`: canonical paths, scope ownership, portable UUID declarations, local bindings/drafts/backups, bounded lazy directory listing, watchers, version-aware writes.
- Codex native app-server JSONL; Claude Agent SDK controls the installed unmodified `claude` binary. SDK import and processes are on demand. In-memory conversation continuation is separate per space/provider. Restart-resume is not implemented.
- One agent mutation run across this application instance; file saves are blocked during a run. This does not lock out other programs or other irori instances.

Device data lives in Electron's standard `userData` directory (override with `IRORI_DATA_DIR` for tests). Portable declarations have no absolute paths or credentials. Disconnected contents declarations stay visible, but **cloud access is intentionally disabled** until folder identity and mount availability can be verified. Existing `contents` bytes are never moved or deleted by setup.

Known limits include native Windows/Mac testing, scale/performance, broader Markdown preservation and IME, ontology UI, GitHub collaboration, managed cloud folders, terminal, stable note/artifact identities and versioned provenance. See the acceptance matrix before treating the preview as a release. The distribution license for irori itself remains undecided; upstream notices are in [THIRD_PARTY_NOTICES](docs/THIRD_PARTY_NOTICES.md).

## Download website

The Japanese landing/download page is in `website/`. Run `npm run dev:website` to preview it in a browser, or `npm run build:website` to produce the static `dist-website/` output. This page is the distribution entrance; it does not run the desktop application in a browser.

Windows and Mac installer buttons currently show **配布準備中** because no verified installers exist yet. The manual GitHub Pages workflow and release-asset configuration are documented in [distribution](docs/DISTRIBUTION.md). No website or installer has been published from this checkout.

## Resume from checkpoint

[Checkpoint and restart guide](docs/CHECKPOINT.md) records the accepted distribution direction, implemented work, verification evidence and remaining implementation. This is a local development checkpoint, not a downloadable release.
