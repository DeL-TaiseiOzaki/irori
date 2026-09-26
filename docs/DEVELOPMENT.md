# Developing irori

How to run irori from a checkout, verify a change, and find the design records.
The [README](../README.en.md) covers using the application; the contributor
contract is [AGENTS.md](../AGENTS.md).

## Run from source

End users should install from the [download site](https://del-taiseiozaki.github.io/irori/) instead.

Requires Node.js **24.15+ (24.x) or 26+**, npm and a desktop session. Pi requires 0.85+; native control probes used OpenCode 1.18.30 and Pi 0.85.1. See [harness compatibility](HARNESSES.md).

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
- A GUI display must actually be visible to you; an SSH or container shell alone will not show an Electron window. For a Linux VM, `npm run preview:vm` starts a private browser viewer of the real desktop ([VM preview](VM-PREVIEW.md)). For headless verification use `xvfb-run -a npm run test:ui`.
- If the system Node is still 20, `npm ci` prints engine warnings even though later npm scripts use the pinned local Node 24. The Vite chunk-size warning is not a build failure.

## Preview the download site

```sh
npm run dev:website      # local preview
npm run build:website    # static output in dist-website/
```

`website/` is the distribution entrance; it does not run the desktop application in a browser. Publication steps are in [DISTRIBUTION](DISTRIBUTION.md).

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

On PowerShell, set `$env:IRORI_UI_REAL_AGENTS="1"` and run `npm run test:ui` on the desktop. Detailed evidence goes to the ignored `test-results/`, and tests mutate only disposable directories.

## Architecture

- React renderer → typed, validated `HostAPI` → Electron preload/main. No renderer Node access, raw IPC export, remote page navigation or document script execution. The host alone controls a private authenticated loopback rclone service.
- Milkdown Crepe for the document editor, CodeMirror 6 for other text and CSV source. Markdown is authoritative; unsupported blocks stay literal in the document.
- PDF, Office and image viewing: the host hands over only the bytes of a file whose extension has a viewer, up to 100 MiB, and pdf.js, docx-preview, pptx-to-html and SheetJS draw it in the sandboxed renderer. Office output is stripped of scripts, frames and external URLs before it is shown ([viewer libraries](libraries/file-viewers.md)).
- A Node `FileService` owns canonical paths, scope ownership, portable UUID declarations, local bindings/drafts/backups, bounded lazy directory listing, watchers and version-aware writes.
- Codex uses the native app-server JSONL protocol; the Claude Agent SDK controls the installed unmodified `claude` binary. Session handles and bounded display history / pending messages persist in device data, bound to scope UUID, provider and canonical checkout root. A failed resume keeps the handle instead of silently starting a new conversation.
- Device data lives in Electron's standard `userData` (override with `IRORI_DATA_DIR` for tests): workspace selections, account metadata, rclone credentials and cloud bindings. Existing `contents` bytes are never moved or deleted by setup.

Design decisions are recorded in [ADR 001 (host)](decisions/001-initial-host.md) and [ADR 002 (release and workspace)](decisions/002-release-and-workspace.md).

## Documentation map

| Topic | Documents |
| --- | --- |
| Distribution and publication | [DISTRIBUTION](DISTRIBUTION.md) / [UPDATES](UPDATES.md) / [PACKAGING](PACKAGING.md) / [RELEASE-PLAN](RELEASE-PLAN.md) |
| Status and acceptance | [STATUS](STATUS.md) / [ACCEPTANCE](ACCEPTANCE.md) / [CHECKPOINT](CHECKPOINT.md) |
| Daily editing and records | [DAILY-WORKFLOW](DAILY-WORKFLOW.md) / [EDITING-AND-RECORDS](EDITING-AND-RECORDS.md) / [EDITOR-ASSISTANCE](EDITOR-ASSISTANCE.md) / [RECOVERY-AND-NOTE-TOOLS](RECOVERY-AND-NOTE-TOOLS.md) |
| Agents and conversations | [HARNESSES](HARNESSES.md) / [YOUR-AI](YOUR-AI.md) / [SKILLS](SKILLS.md) / [CONVERSATIONS](CONVERSATIONS.md) / [WORKSPACE-CONNECTIONS](WORKSPACE-CONNECTIONS.md) |
| Git and cloud | [GIT](GIT.md) / [CLOUD-SETUP](CLOUD-SETUP.md) / [WORKSPACE-DRIVE](WORKSPACE-DRIVE.md) / [DISTRIBUTOR-GOOGLE](DISTRIBUTOR-GOOGLE.md) |
| UI and knowledge views | [UI-DESIGN](UI-DESIGN.md) / [ADR 014 (v5)](decisions/014-ui-v5.md) / [LAYERED-EXPLORER](LAYERED-EXPLORER.md) / [ONTOLOGY](ONTOLOGY.md) / [KB-SEARCH](KB-SEARCH.md) / [NOTE-LINKS](NOTE-LINKS.md) / [KNOWLEDGE-NAVIGATION](KNOWLEDGE-NAVIGATION.md) / [TERMINAL](TERMINAL.md) |
| File viewers | [file viewer libraries](libraries/file-viewers.md) |
| Development environment | [VM-PREVIEW](VM-PREVIEW.md) / [compatibility matrix](compatibility/MATRIX.md) / [measurements](measurements/2026-09-12.md) |

To continue development, start from [HANDOFF](HANDOFF.md) and the [continuation prompt](HANDOFF-PROMPT.md). The contributor contract is [AGENTS.md](../AGENTS.md).
