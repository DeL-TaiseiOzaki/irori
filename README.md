# irori

Version 0.1.1 adds an [integrated native terminal](docs/TERMINAL.md) with automatic shell detection and bundles rclone. Google account login still awaits the distributor's OAuth client; [setup instructions](docs/DISTRIBUTOR-GOOGLE.md) explain that external requirement. See [CHECKPOINT](docs/CHECKPOINT.md) for exact package/publication evidence.

[Download irori](https://del-taiseiozaki.github.io/irori/) — an unsigned Windows x64 testing preview is available. See [preview notes and checksums](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.1-preview.1). Windows 11 device acceptance is pending; Mac downloads remain unavailable.

CSV files have a paginated table and the existing source editor. Declared ontology CSV can be viewed as a hierarchy/subgraph with note links; native agents help construct the records. See [ontology display and agent setup](docs/ONTOLOGY.md).

A desktop IDE/ADE for writing Markdown notes and running **local native coding harnesses** in the selected knowledge workspace. Codex, Claude Code, OpenCode and Pi are selectable; the new OpenCode/Pi adapters have native control tests but still need real model-turn acceptance.

This independent repository contains the first working note + agent milestone. Electron is provisional; it is not a completed Windows/macOS release. The two sibling repositories remain independent and unchanged.

Release follow-up: [Forge packaging and CI](docs/PACKAGING.md) now produce unsigned engineering candidates and test the packaged app outside the checkout. [Confirmed product decisions](docs/decisions/002-release-and-workspace.md) set MIT licensing, Windows 11 x64/MacBook M5 Pro arm64 acceptance, CSV/graph ontology presentation, and workspace-level independent GitHub/Drive connections. New Drive attachments now belong directly to the workspace; [the workspace flow and legacy compatibility](docs/WORKSPACE-DRIVE.md) are implemented. Existing KB-owned attachments remain usable without moving files.

## Run from source

Requires Node.js **24.15+ (24.x) or 26+**, npm, and a desktop session. Install and configure the desired `codex`, `claude`, `opencode` or `pi` CLI using its own setup/login flow. irori uses the installed CLI, its native configuration, and its existing authentication. Pi requires version 0.85+; native control probes used OpenCode 1.18.30 and Pi 0.85.1. See [harness compatibility](docs/HARNESSES.md).

```sh
cd /workspace/KB_design/irori
npm ci
npm run setup:electron
npm run build
npm start
```

`setup:electron` downloads the pinned Electron binary; it is also useful when npm lifecycle scripts were disabled. Windows and macOS use the same npm commands from their own checkout path. The Windows testing installer is available from the download page above; building from source is optional for developers.

For this root-owned Linux development container, after the successful build:

```sh
npm run start:container
```

This explicit command disables Chromium's OS sandbox for the Linux test environment. It uses the current GUI display and does not change agent permission policy. Ordinary `npm start` now explains the root restriction before launching Electron instead of ending in a Chromium fatal error. On a normal desktop, use a non-root user and `npm start`.

A GUI display must actually be accessible to you. An SSH/container shell alone does not show an Electron window on your laptop. For interactive use on a Linux VM, `npm run preview:vm` now starts a private browser viewer of the actual desktop with sample KBs; see [VM preview setup](docs/VM-PREVIEW.md). For headless verification, use:

```sh
xvfb-run -a npm run test:ui
```

This runs UI checks and writes `test-results/irori-desktop.png`, then exits. `xvfb-run -a npm run start:container` can keep the app running on a virtual display, but that virtual window is not automatically visible to you.

If the system Node is still 20, `npm ci` emits engine warnings even though subsequent npm scripts use the pinned local Node 24. The pasted run completed installation and compilation; those warnings were not the root-user startup failure. Use a supported Node 24.15+ or 26+ runtime for dependency installation on development machines. The Vite chunk-size warning concerns bundle size and does not mean that the build failed.

1. Startup shows **ワークスペースを選択**. Select a saved workspace, or use **KBフォルダを開く** to register existing local checkouts/folders with a name and optional display category. The preview inspects the Git root, GitHub repository, branch and local changes.
2. **登録して開く** explicitly creates `.irori/scope.json` for a new registration and adds `/contents/` to `.gitignore`. Existing Markdown is not moved. Select one or more registered spaces, name the workspace and press **選択したスペースを開く**. Each checkout keeps its own Git history and native agent configuration; irori does not initialize or publish a repository.
3. Open a note in the explorer or choose **ノートを作成**. Edit directly, use Crepe's slash menu/table/block controls, or switch to **ソース**. Save with the button or Cmd/Ctrl+S.
4. Open **AIに相談**, choose a harness, and enter an instruction. **保存して実行** saves the current note, starts the real CLI in that space, and supplies the selected note's path. Native requests/questions appear in the panel; **停止** cancels the process tree. The panel explains that standard Pi tools run without built-in approval prompts; its extension dialogs are supported. OpenCode keeps its native permission configuration.
5. A clean editor refreshes after agent/external changes. A dirty editor shows both versions. Recovery drafts remain device-local.
6. The next run attempts to continue the previous native conversation, including after restarting irori. The panel shows whether a saved session exists. **会話の継続をリセット** detaches only this space/provider's session; notes and the CLI's own history remain. **新しい会話** resets before the next run. Previous conversation text is not restored to the panel yet. Native-provider restart acceptance remains outstanding.
7. Saved workspace cards support editing and removal. Cloud connections support changing the chosen local folder name, removing disconnected attachments and removing unused accounts. Removing a workspace or attachment keeps KB notes and remote files. See the [implementation audit](docs/AUDIT-2026-09-13.md) for fixes, verification and remaining features.
8. The left explorer follows the [LayeredKB layout](docs/LAYERED-EXPLORER.md): Schema above, personal/team Knowledge Base in the middle, and personal/team contents below. Expand the owning space to browse files; use its **＋** to create a note or **接続** to manage cloud folders. These views preserve separate repository settings and agent conversations.

CLI-native rules/settings/skills/MCP discovery remain the provider's responsibility. irori never combines every team's instructions. Native ancestor discovery still applies; registration is an ownership boundary, not an OS sandbox. Codex requests workspace-write/on-request/user review; Claude uses default permissions and native user/project/local settings. Existing native allow/deny rules remain effective.

## GitHub and Git collaboration

Open **変更と履歴** to review the active space's changes and commit history. Inspect a file, add its saved changes to **commit 対象**, and review the file list/message before committing locally. Existing staged changes remain visible; partial staging is preserved. **共有内容を確認** previews a separate push to that repository's remote branch.

**取得** updates remote observations. **受信** accepts clean fast-forwards; **履歴を統合** starts a native merge and opens conflicts for manual review, saving recovery copies before resolution. Finish a merge with a reviewed commit. No automatic stash, hard reset or force-push is used. The startup **GitHub から取得** flow clones into a new selected folder and continues normal space registration. Native Git credentials, hooks and signing settings apply.

The feature is exercised with real disposable Git repositories and local bare remotes through both service and Electron tests. Live GitHub authentication/branch-protection acceptance and Windows/macOS execution remain outstanding. See [Git workflow, limits and evidence](docs/GIT.md).

## Cloud connection preview

Open a workspace and choose **クラウド接続**, or use **接続** in the **Google Drive** section. A workspace may be created before registering any KB; its Drive attachments remain independent of KB membership. The new flow registers named Google accounts through the system browser, browses My Drive/shared-drive folders and lets you choose the actual **contents内のフォルダ名** with a path preview. Multiple accounts and folders can be registered independently. Japanese and spaces are supported; collisions and occupied paths are rejected. The Drive folder ID and your chosen local name persist separately.

The host manages a private rclone configuration and read-only mounts. Saved attachments reconnect when their workspace opens; individual failures leave local notes usable. Mounted text opens in read-only source mode. This preview does not upload edits, provide offline copies or recover pending cloud writes. Google consent and successful native mounts have **not** been accepted on real accounts/platforms yet.

Development prerequisites are an installed `rclone` executable (or host environment `IRORI_RCLONE_PATH`), a working native mount facility, and an irori-owned Google desktop OAuth application's `IRORI_GOOGLE_CLIENT_ID` and `IRORI_GOOGLE_CLIENT_SECRET` in the host environment. The application explains missing prerequisites and disables account creation if OAuth configuration is absent. These are developer/distribution setup requirements; the intended shipped flow will not ask ordinary users to configure rclone or create Google Cloud projects. See [cloud setup](docs/CLOUD-SETUP.md) for the current boundary and verification.

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

- React renderer → typed, validated `HostAPI` → Electron preload/main. No renderer Node access, raw IPC export, remote page navigation, or document script execution. The host alone controls a private authenticated loopback rclone service.
- Milkdown Crepe rich editor + CodeMirror 6 source mode. Markdown is authoritative; unsupported detected constructs use source mode.
- Node `FileService`: canonical paths, scope ownership, portable UUID declarations, local bindings/drafts/backups, bounded lazy directory listing, watchers, version-aware writes.
- Codex native app-server JSONL; Claude Agent SDK controls the installed unmodified `claude` binary. SDK import and processes are on demand. Session handles persist in device data, bound to scope UUID, provider and canonical checkout root. Resume errors retain the handle for retry or explicit reset; irori does not silently fall back to a new conversation. Conversation display history remains in memory.
- One agent mutation run across this application instance; file saves are blocked during a run. This does not lock out other programs or other irori instances.

Device data lives in Electron's standard `userData` directory (override with `IRORI_DATA_DIR` for tests). Workspace selections, account metadata, rclone credentials and checkout-specific cloud bindings stay there. New workspace cloud declarations live under device-local `workspace-cloud/<workspaceId>/.irori/cloud-mounts.json`; original KB declarations remain in place. Both contain folder IDs and user-chosen relative names, with no account credentials or absolute paths. Disconnected attachments stay visible; cloud access requires verified folder identity and a live managed mount. Existing `contents` bytes are never moved or deleted by setup.

Known limits include native Windows/Mac testing, scale/performance, broader Markdown preservation and IME, ontology UI, live GitHub authentication/branch-protection acceptance, native cloud-mount acceptance and uploads, OpenCode/Pi model-turn acceptance, terminal, stable note/artifact identities and versioned provenance. See the acceptance matrix before treating the preview as a release. irori is [MIT licensed](LICENSE); upstream dependencies retain their own terms in [THIRD_PARTY_NOTICES](docs/THIRD_PARTY_NOTICES.md).

## Download website

The Japanese landing/download page is in `website/`. Run `npm run dev:website` to preview it in a browser, or `npm run build:website` to produce the static `dist-website/` output. This page is the distribution entrance; it does not run the desktop application in a browser.

Windows and Mac installer buttons currently show **配布準備中** because no verified installers exist yet. The manual GitHub Pages workflow and release-asset configuration are documented in [distribution](docs/DISTRIBUTION.md). No website or installer has been published from this checkout.

## Resume from checkpoint

[Checkpoint and restart guide](docs/CHECKPOINT.md) records the accepted distribution direction, implemented work, verification evidence and remaining implementation. This is a local development checkpoint, not a downloadable release.

The implementation reuse audit is complete for the current feature set: shared host/queue/dialog/protocol code and matching service libraries are implemented. See [all decisions and validation](docs/REUSE-COMPLETION-2026-09-13.md).
