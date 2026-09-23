<div align="center">

<img src="assets/irori-icon.png" alt="" width="112" height="112">

# irori

**From your notes to your next piece of work.**

A desktop IDE/ADE for writing notes and continuing them with local CLI coding agents.

[日本語](README.md) | **English**

<a href="https://del-taiseiozaki.github.io/irori/"><img src="https://img.shields.io/badge/%E2%AC%87%20Download-irori%20for%20Windows%20%26%20Mac-c2410c?style=for-the-badge" alt="Download irori"></a>

[![Release](https://img.shields.io/github/v/release/DeL-TaiseiOzaki/irori?include_prereleases&label=release)](https://github.com/DeL-TaiseiOzaki/irori/releases)
[![CI](https://github.com/DeL-TaiseiOzaki/irori/actions/workflows/app.yml/badge.svg)](https://github.com/DeL-TaiseiOzaki/irori/actions/workflows/app.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64%20%7C%20macOS%20arm64-lightgrey.svg)](#download)

[Download site](https://del-taiseiozaki.github.io/irori/) ·
[Release notes](https://github.com/DeL-TaiseiOzaki/irori/releases) ·
[Documentation](#documentation) ·
[Issues](https://github.com/DeL-TaiseiOzaki/irori/issues)

<img src="website/public/app-preview.png" alt="The irori development UI: spaces and notes on the left, a Japanese note in the center, and the AI panel with Codex selected on the right." width="860">

<sub>An actual development screen. The displayed content is disposable test data.</sub>

</div>

---

> The application UI and the download site are currently in Japanese.

## Download

The distribution entrance is the **[download site](https://del-taiseiozaki.github.io/irori/)**. irori is a desktop application you install; it does not run in a browser.

| Platform | Status | Get it |
| --- | --- | --- |
| **Windows 11 x64** | Testing preview (no distribution signature) | Installer .exe on the [download site](https://del-taiseiozaki.github.io/irori/) |
| **macOS (Apple Silicon)** | Testing preview (no distribution signature) | Disk image .dmg on the [download site](https://del-taiseiozaki.github.io/irori/) |
| Linux | No installer planned | [Run from source](#run-from-source) |

- The current version, file sizes and SHA-256 digests are in the latest prerelease's notes and its attached `SHA256SUMS.txt` on the [releases page](https://github.com/DeL-TaiseiOzaki/irori/releases).
- Neither build carries a distribution signature. Windows shows its unknown-publisher warning. **A Mac refuses the first launch**: open System Settings, Privacy & Security, and press the button beside irori's blocked notice once. Later launches behave normally.
- Windows is built for **x64** (AMD Ryzen / Intel); this is not a Windows ARM build. The Mac build is **Apple Silicon (M series) only**; Intel Macs are not supported.
- Installation, IME and CLI integration on real Windows 11 and macOS devices are still awaiting acceptance. Start with a disposable KB folder or a copy.
- From 0.1.29 an installed build finds a newer version by itself and updates with one press of **更新して再起動**, with no download or reinstall by hand ([UPDATES](docs/UPDATES.md)). From 0.1.28 or earlier, install once more from the download website. Application changes merged to main are published as a preview promptly, and an automated check flags one left unpublished for more than an hour ([DISTRIBUTION](docs/DISTRIBUTION.md)).

After installing you also need:

1. Git — used for note history and sharing: [Git for Windows](https://git-scm.com/downloads/win) or [Git for macOS](https://git-scm.com/downloads/mac).
2. Any CLI you want to drive (`claude`, `codex`, `opencode`, `pi`), installed and logged in through its own setup flow. Each service's terms and pricing apply. Note editing works without configuring any CLI.
3. A KB folder for your notes — a new folder, or an existing Git checkout.

## What irori is

- **Write notes.** A what-you-see Markdown editor with autosave, image paste into `_assets/`, and Cmd/Ctrl+S that keeps your selection and undo history. The Markdown file is always authoritative.
- **Continue with an agent.** Claude Code, Codex, OpenCode and Pi run in the workspace you selected, using the installed CLI with its own authentication and configuration. irori never asks for its own API key.
- **See how knowledge connects.** Browse CSV as a table and a graph, view a declared ontology as a hierarchy or subgraph, and jump to the linked notes.
- **Keep everything local.** Notes stay as Markdown in the folder you chose. Git operations, a read-only Google Drive connection preview and an integrated terminal are available inside the app.

## Using it

1. Launch and choose a workspace. **KBフォルダを開く** registers an existing folder or checkout under a name. **登録して開く** creates `.irori/scope.json` and adds `/contents/` to `.gitignore`; existing Markdown is never moved.
2. Open a note or create one. Editing stays in document view, and pasted images land in `_assets/` next to the note.
3. Open the assistant panel, pick a harness, and send an instruction. Live requests and questions appear in the panel; stopping cancels the process tree. Queue the next instruction for automatic continuation, and conversations are restored after a restart — resuming is always explicit.
4. Use source control for diffs, staging and commits. Fetch, pull and merge require explicit confirmation; no automatic stash, hard reset or force push is used.
5. Connect Google accounts and folders from the cloud section (read-only connection preview). Mounting on Windows needs [WinFsp](https://winfsp.dev/rel/). A Mac uses macOS's own NFS mount and needs no extra installation.
6. The terminal at the bottom opens a shell in the current KB folder.

Rules, settings, skills and MCP discovery remain each provider's responsibility, except that a skill a KB declares in `.agents/skills/` can be chosen in the composer, and irori sends it with the request to whichever harness runs. irori never merges instructions across teams. Registration is an ownership boundary, not an OS sandbox.

## Project status

The published builds are the **Windows x64 and macOS arm64 testing previews**, neither carrying a distribution signature. This is not a completed release.

Still outstanding:

- Acceptance on real Windows 11 / macOS devices (installation, IME, CLI integration, GitHub synchronization)
- Real Google consent and native mounts on actual accounts, plus Drive uploads (connections are read-only today)
- Real model-turn acceptance for OpenCode and Pi (native control tests pass)
- Distribution signing (Windows signing, and Apple Developer ID signing with notarization), scale and performance, broader Markdown preservation, cross-device history

[ACCEPTANCE](docs/ACCEPTANCE.md) separates verified, provisional and outstanding work; [STATUS](docs/STATUS.md) records the current position and [CHECKPOINT](docs/CHECKPOINT.md) the delivery evidence.

## Run from source

This is the developer path; end users should install from the download site.

Requires Node.js **24.15+ (24.x) or 26+**, npm and a desktop session. Pi requires 0.85+; native control probes used OpenCode 1.18.30 and Pi 0.85.1. See [harness compatibility](docs/HARNESSES.md).

```sh
git clone https://github.com/DeL-TaiseiOzaki/irori.git
cd irori
npm ci
npm run setup:electron
npm run build
npm start
```

`setup:electron` downloads the pinned Electron binary; it also helps when npm lifecycle scripts are disabled. Windows and macOS use the same commands from their own checkout.

- On a **root-owned Linux container**, use `npm run start:container` after a successful build. It explicitly disables Chromium's OS sandbox for that test environment and does not change agent permission policy. On a normal desktop, use a non-root user and `npm start`.
- A GUI display must actually be visible to you; an SSH or container shell alone will not show an Electron window. For a Linux VM, `npm run preview:vm` starts a private browser viewer of the real desktop ([VM preview](docs/VM-PREVIEW.md)). For headless verification use `xvfb-run -a npm run test:ui`.
- If the system Node is still 20, `npm ci` prints engine warnings even though later npm scripts use the pinned local Node 24. The Vite chunk-size warning is not a build failure.

### Preview the download site

```sh
npm run dev:website      # local preview
npm run build:website    # static output in dist-website/
```

`website/` is the distribution entrance; it does not run the desktop application in a browser. Publication steps are in [DISTRIBUTION](docs/DISTRIBUTION.md).

### Verification

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

On PowerShell, set `$env:IRORI_UI_REAL_AGENTS="1"` and run `npm run test:ui` on the desktop. Detailed evidence goes to the ignored `test-results/`, and tests mutate only disposable directories.

## Implementation boundary

- React renderer → typed, validated `HostAPI` → Electron preload/main. No renderer Node access, raw IPC export, remote page navigation or document script execution. The host alone controls a private authenticated loopback rclone service.
- Milkdown Crepe for the document editor, CodeMirror 6 for other text and CSV source. Markdown is authoritative; unsupported blocks stay literal in the document.
- A Node `FileService` owns canonical paths, scope ownership, portable UUID declarations, local bindings/drafts/backups, bounded lazy directory listing, watchers and version-aware writes.
- Codex uses the native app-server JSONL protocol; the Claude Agent SDK controls the installed unmodified `claude` binary. Session handles and bounded display history / pending messages persist in device data, bound to scope UUID, provider and canonical checkout root. A failed resume keeps the handle instead of silently starting a new conversation.
- Device data lives in Electron's standard `userData` (override with `IRORI_DATA_DIR` for tests): workspace selections, account metadata, rclone credentials and cloud bindings. Existing `contents` bytes are never moved or deleted by setup.

Design decisions are recorded in [ADR 001 (host)](docs/decisions/001-initial-host.md) and [ADR 002 (release and workspace)](docs/decisions/002-release-and-workspace.md).

## Documentation

| Topic | Documents |
| --- | --- |
| Distribution and publication | [DISTRIBUTION](docs/DISTRIBUTION.md) / [UPDATES](docs/UPDATES.md) / [PACKAGING](docs/PACKAGING.md) / [RELEASE-PLAN](docs/RELEASE-PLAN.md) |
| Status and acceptance | [STATUS](docs/STATUS.md) / [ACCEPTANCE](docs/ACCEPTANCE.md) / [CHECKPOINT](docs/CHECKPOINT.md) |
| Daily editing and records | [DAILY-WORKFLOW](docs/DAILY-WORKFLOW.md) / [EDITING-AND-RECORDS](docs/EDITING-AND-RECORDS.md) / [EDITOR-ASSISTANCE](docs/EDITOR-ASSISTANCE.md) / [RECOVERY-AND-NOTE-TOOLS](docs/RECOVERY-AND-NOTE-TOOLS.md) |
| Agents and conversations | [HARNESSES](docs/HARNESSES.md) / [CONVERSATIONS](docs/CONVERSATIONS.md) / [WORKSPACE-CONNECTIONS](docs/WORKSPACE-CONNECTIONS.md) |
| Git and cloud | [GIT](docs/GIT.md) / [CLOUD-SETUP](docs/CLOUD-SETUP.md) / [WORKSPACE-DRIVE](docs/WORKSPACE-DRIVE.md) / [DISTRIBUTOR-GOOGLE](docs/DISTRIBUTOR-GOOGLE.md) |
| UI and knowledge views | [UI-DESIGN](docs/UI-DESIGN.md) / [LAYERED-EXPLORER](docs/LAYERED-EXPLORER.md) / [ONTOLOGY](docs/ONTOLOGY.md) / [KB-SEARCH](docs/KB-SEARCH.md) / [KNOWLEDGE-NAVIGATION](docs/KNOWLEDGE-NAVIGATION.md) / [TERMINAL](docs/TERMINAL.md) |
| Development environment | [VM-PREVIEW](docs/VM-PREVIEW.md) / [compatibility matrix](docs/compatibility/MATRIX.md) / [measurements](docs/measurements/2026-09-12.md) |

To continue development, start from [HANDOFF](docs/HANDOFF.md) and the [continuation prompt](docs/HANDOFF-PROMPT.md). The contributor contract is [AGENTS.md](AGENTS.md).

## Reporting problems

Open a [GitHub issue](https://github.com/DeL-TaiseiOzaki/irori/issues) with the displayed version, your OS and the exact message. Please leave out note content, credentials and OAuth URLs.

## License

[MIT License](LICENSE). Dependencies keep their own upstream terms ([THIRD_PARTY_NOTICES](docs/THIRD_PARTY_NOTICES.md)).
