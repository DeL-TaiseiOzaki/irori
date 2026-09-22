# VS Code extension compatibility: host choice and first executable probe

Date: 2026-09-23. Status: feasibility recommendation; production host migration
is proposed, not implemented or approved by this report.

The owner chose **VS Code extension compatibility** and ordinary native CLI
capabilities. An irori-only plugin API is therefore not an alternative answer.
This resolves the extension-format question in [ADR 005](../decisions/005-host-and-references.md),
but does not by itself settle a replacement of irori's workbench.

**Recommendation:** use a pinned Code-OSS desktop workbench as the first
compatibility baseline and likely execution foundation. Keep irori's knowledge
model and develop a small built-in integration against that host. Compare Theia
if retaining a heavily customized shell outweighs matching the upstream
workbench. Do not begin by maintaining an independent `vscode` API shim inside
the existing renderer. This is an architectural inference from the evidence
below, not a claim that any third-party extension has already run in irori.

## Evidence inspected

- irori `aa0bbfe5d60bb83fc307091f3259c91660d1f249`, version 0.1.26:
  [main/preload](../../src/host/main.ts), [HostAPI](../../src/domain/types.ts),
  [editor](../../src/editor/Editor.tsx), and [ADR 001](../decisions/001-initial-host.md).
  Electron hosts a React/Crepe/CodeMirror application, sandboxed document UI and
  a validated irori IPC bridge. It has no VS Code extension host, document model,
  extension registry or contribution-point implementation.
- Read-only `references/vscode`, commit
  [`832cf23c5887351668f61c8648eb9c2ec6ee7d23`](https://github.com/microsoft/vscode/tree/832cf23c5887351668f61c8648eb9c2ec6ee7d23).
  Its [Node host](https://github.com/microsoft/vscode/blob/832cf23c5887351668f61c8648eb9c2ec6ee7d23/src/vs/workbench/api/node/extHostExtensionService.ts)
  intercepts `vscode` imports; its
  [API factory](https://github.com/microsoft/vscode/blob/832cf23c5887351668f61c8648eb9c2ec6ee7d23/src/vs/workbench/api/common/extHost.api.impl.ts)
  depends on workbench services and RPC actors. The inspected public declaration
  has 21,238 lines and the factory 2,340: useful evidence of scope, not an effort
  estimate. Copying the host entry point does not supply its service graph.
- Read-only `references/claudian`, commit
  [`7081d313591952499cbd73c187bfc748e9ca06a8`](https://github.com/YishenTu/claudian/tree/7081d313591952499cbd73c187bfc748e9ca06a8).
  [Its entry point](https://github.com/YishenTu/claudian/blob/7081d313591952499cbd73c187bfc748e9ca06a8/src/main.ts)
  extends Obsidian's `Plugin` and registers Obsidian views. Its provider/process
  design is relevant to native agents; it supplies no VS Code compatibility host.

Upstream links below were checked on 2026-09-23. Local references remain reading
material; nothing from them was copied into the application.

## What must actually execute

A VSIX is a distribution container. Manifest validation, extraction, a listed
extension, or a theme imported at build time does not establish runtime
compatibility. Activation, executable dependencies and the requested APIs must
work. Desktop Node extensions use a `main` entry; web extensions use a `browser`
entry and a worker runtime. A browser-only host cannot satisfy ordinary Node
CLI extensions. [Extension host](https://code.visualstudio.com/api/advanced-topics/extension-host),
[manifest](https://code.visualstudio.com/api/references/extension-manifest).

| Area | Required behavior and irori consequence |
| --- | --- |
| Lifecycle | Scan/install/disable/update, `engines.vscode`, dependencies, activation events, CJS/ESM loading, extension contexts, disposal and crash recovery. State belongs to a private application profile. |
| Documents/workspaces | URI identity, multi-root selection, document versions, edits, save/undo and file watching. Crepe and the code editor must share one authoritative document, rather than autosaving separate buffers over each other. |
| Configuration/storage | User/workspace/folder precedence, change events, global/workspace state, secret storage and authentication/URI callbacks. irori settings and provider accounts are not automatically VS Code equivalents. |
| Workbench/webviews | Commands, contexts, menus, tree views and webview panels/views need real UI services. Webviews need resource URI routing, CSP, message passing and disposal; they receive no irori preload or raw Node bridge. [Webview API](https://code.visualstudio.com/api/extension-guides/webview). |
| Native execution | Node modules, native binaries, process lifetime, environment, terminals and task execution must work on each target OS. A Node extension can access files outside `FileService`; its process isolation is not a per-KB filesystem sandbox. |
| Languages/debug | Completion and diagnostics are only the beginning. LSP clients need document synchronization and server processes; debug extensions need DAP, launch configurations, breakpoints and adapter lifecycle. [LSP](https://code.visualstudio.com/api/language-extensions/language-server-extension-guide), [debugging](https://code.visualstudio.com/api/extension-guides/debugger-extension). |
| Version-sensitive APIs | Proposed APIs and product-specific services require explicit assessment for each extension/version. They are unstable and cannot be inferred from a successful import. [Proposed APIs](https://code.visualstudio.com/api/advanced-topics/using-proposed-api). |

Treat installed executable extensions as a separate trust boundary from note
content. Workspace trust can limit extension activation; it does not turn
ordinary Node execution into irori's capability-gated file service. Native CLI
permission parity is a separate adapter concern and does not implement extension
compatibility. [Workspace trust](https://code.visualstudio.com/api/extension-guides/workspace-trust).

Drive stays a separately bound, read-only resource. A future `FileSystemProvider`
can expose it through a non-`file` URI, but extensions that assume local paths or
spawn a language server against those paths need individual acceptance. Do not
present virtual Drive folders as universally compatible native workspaces.
[Virtual workspaces](https://code.visualstudio.com/api/extension-guides/virtual-workspaces).

## Foundation comparison

| Foundation | Assessment |
| --- | --- |
| Existing Electron app plus our own API shim | Retains the current shell, but requires maintaining the execution host, API behavior, editor/workbench integration and compatibility tests. Small curated contributions are feasible; broad native extensions make this an ongoing platform implementation. Not recommended for the chosen goal. |
| Code-OSS desktop workbench | Reuses the upstream host and corresponding workbench together, providing the strongest starting point for upstream API behavior. Requires a new application composition, branding/build/update maintenance and migration of irori UI/services. Recommended baseline, with minimal upstream patches. |
| Eclipse Theia | Established framework for custom Electron/browser products with VS Code support through `@theia/plugin-ext-vscode`. Offers product customization without owning a Code-OSS fork, but compatibility is version-specific and some APIs are stubbed. Compare the exact required extensions against its coverage report. [Architecture](https://theia-ide.org/docs/architecture/), [authoring](https://theia-ide.org/docs/authoring_vscode_extensions/), [compatibility](https://theia-ide.org/docs/user_install_vscode_extensions/), [coverage](https://eclipse-theia.github.io/vscode-theia-comparator/status.html). |
| `@codingame/monaco-vscode-api` | Real reuse of VS Code services with a VSIX build plugin and configurable extension services. A credible path for an embedded code surface, but irori must still integrate the service topology, native host, storage and lifecycle. Its browser/worker examples do not alone prove local CLI extension execution. Keep as a comparison option, not a shortcut claim. [Upstream README](https://github.com/CodinGame/monaco-vscode-api/blob/main/README.md). |

Code-OSS can preserve a rich Markdown experience through a
`CustomTextEditorProvider`: the webview supplies the rich UI while the host owns
the shared `TextDocument`. This is a concrete migration seam for Crepe, subject
to testing undo, IME, external edits and crash recovery.
[Custom editors](https://code.visualstudio.com/api/extension-guides/custom-editors).
Moving every existing panel or retaining two independent writable editors is
outside the first milestone.

## Distribution is a separate constraint

The inspected Code-OSS source is
[MIT licensed](https://github.com/microsoft/vscode/blob/832cf23c5887351668f61c8648eb9c2ec6ee7d23/LICENSE.txt).
Microsoft's branded VS Code distribution includes separately controlled assets
and services; its product configuration is not a template to copy into irori.
[Repository/distribution differences](https://github.com/microsoft/vscode/wiki/Differences-between-the-repository-and-Visual-Studio-Code).

Microsoft's current FAQ explicitly excludes alternative products, including
Code-OSS forks, from accessing Visual Studio Marketplace. It also restricts
Microsoft/affiliate extensions acquired there to its product family. Do not add
Marketplace endpoints or substitute product identities. Use Open VSX or
publisher-authorized VSIX/source distributions, checking each extension and its
downloaded binaries separately. An open source repository does not by itself
authorize every published binary. [Microsoft FAQ](https://code.visualstudio.com/docs/supporting/faq#_extensions).

No extension was named by the owner. A Codex-like sidebar means representative
webview, workspace, native process and account-callback requirements here; it is
not a compatibility or distribution claim about OpenAI's actual extension.
Specific proprietary services, remote-development extensions and debug adapters
remain per-extension questions.

## Executed compatibility probe

This change includes a self-authored MIT development extension in
[tests/fixtures/extension-compatibility](../../tests/fixtures/extension-compatibility/package.json)
and an opt-in [runner](../../scripts/extension-compatibility/run.mjs). It supplies
an isolated profile, extension directory and disposable local workspace to an
explicitly supplied desktop executable:

```sh
node scripts/extension-compatibility/run.mjs /absolute/path/to/code-oss
# Headless Linux only; --no-sandbox is an explicit root test-environment exception:
xvfb-run -a node scripts/extension-compatibility/run.mjs /absolute/path/to/code-oss --no-sandbox
```

Use the desktop `.exe` on Windows, not a command shim. The runner refuses the
remote CLI and removes inherited CLI routing variables. Its 90-second limit
terminates its own process tree. No provider or account is contacted by the
probe; settings, synthetic secrets and files are confined to the disposable
profile/workspace, with workspace trust disabled only there.

The actual host must discover and activate the extension and execute seven
checks: command-driven workspace edit/save, language completion/diagnostics,
configuration/memento/synthetic-secret round trips, theme selection, native
Node child execution, terminal execution, and a webview that loads an extension
script and exchanges messages. The result records the host name, API version and
completed checks in ignored `test-results/extension-compatibility/report.json`.
Missing execution evidence fails the runner.

**Execution result on 2026-09-23:** all seven checks passed in the official
[VSCodium 1.135.06055 Linux x64 desktop release](https://github.com/VSCodium/vscodium/releases/tag/1.135.06055),
reporting `app: VSCodium` and `vscodeVersion: 1.135.0`. The runner exited 0.
The extension ran unchanged; no probe correction was needed during the runtime
test. This is executable evidence for a Code-OSS-derived foundation, not irori
integration.

The official `VSCodium-linux-x64-1.135.06055.tar.gz` asset is 243,185,899 bytes.
Its SHA-256 matched both GitHub release metadata and the publisher's adjacent
`.sha256` asset before extraction:
`c09d8ac8dd7f52b09ee159ee24b440541dfd8f937a0f6f88cc428c78e48ee1f2`.
The packaged product records commit
`1a46a584725d5dd330e0bcd7f5510f24990efcf2`. It was downloaded into ignored
`.local/tools/vscodium-compatibility/1.135.06055/` at the workspace root;
there was no global installation or source build. To reproduce from the irori worktree, set `KB_WORKSPACE_ROOT` to the
workspace directory and run:

```sh
PATH="$PWD/node_modules/.bin:$PATH" xvfb-run -a node scripts/extension-compatibility/run.mjs "$KB_WORKSPACE_ROOT/.local/tools/vscodium-compatibility/1.135.06055/desktop/codium" --no-sandbox
```

The runner removed its temporary profile/workspace, and a subsequent check found
no process executing from the downloaded runtime directory. JavaScript syntax
checks also pass. Supplying `/usr/bin/false` fails with “without extension
execution evidence”, as required. The local VS Code source reference remains
unbuilt; existing Microsoft remote-server installations were not used or
modified.

This probe uses `--extensionDevelopmentPath`, not VSIX installation. It does not
validate an extension manager, an actual third-party extension, LSP/DAP, theme
pixel rendering, persistence across restart, provider login or native Windows/Mac
behavior. It is not shipped application extensibility.

## Next bounded slice and remaining decision

1. Package the probe as a VSIX, then install/disable/re-enable it through the
   chosen host. Add unchanged, license-checked theme and language-server sample
   VSIXs. Record source commit, package hash and exercised behavior, including
   extension-host restart and process cleanup. Successful discovery alone fails
   acceptance.
2. Add one built-in irori bridge: open a selected disposable KB, display one rich
   Markdown editor through the shared host document model, and verify that an
   extension edit is visible without overwriting unsaved work. Keep Drive and
   other irori services behind explicit adapters; do not migrate every panel.
3. If product-shell flexibility motivates a Theia comparison, run the same probe
   against a pinned desktop candidate and exercise the same VSIX fixtures.
   The VSCodium result is the completed baseline for that comparison.

The true remaining product choice is how much of the current shell to retain
when integrating the compatible workbench. Prefer Code-OSS plus an irori rich
editor/KB integration unless executable evidence favors Theia for the required
extensions and UI. The successful foundation probe supports this recommendation;
it does not approve a production host migration or reopen the already confirmed
VS Code compatibility goal.

The probe is small; a production workbench migration spans multiple releases,
native packaging and data-safety acceptance. The measured upstream archive size
does not estimate an irori release. No delivery-duration, final package-size or
memory estimate is justified before those measurements. The
recent package reductions and current note/Drive workflows remain acceptance
baselines, not benefits that a new host inherits automatically.
