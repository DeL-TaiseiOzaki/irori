# ADR 001 — Provisional Electron host and native agent interfaces

Date: 2026-09-12. Status: provisional, first executable milestone.

## Decision and evidence

Use Electron 44.3.0 + React/TypeScript for the first note/agent slice. Keep renderer/domain operations behind `HostAPI` so another desktop host can reuse the frontend and Node agent service. Use Codex app-server stdio directly and the Claude Agent SDK to control the user's installed, unmodified Claude Code executable. ACP is optional and has not been introduced.

| Same required workflow | Electron | Tauri 2 + Node agent sidecar |
|---|---|---|
| Crepe/CodeMirror editor | Actual Linux Electron tests run | Same web components reusable; native webview tests outstanding |
| Claude native CLI, SDK permissions | SDK runs on demand in Node-capable main process | Reuse the same SDK in a Node sidecar; adds process/IPC/distribution responsibilities |
| Codex local app-server | Real turns, permissions, file edits and cancellation exercised | Rust can host stdio; prior handoff only proved initialize, not full turns |
| Files + typed host boundary | Node APIs plus Zod IPC validation, tested | Rust host or delegated file service; implementation not yet built |
| Linux test environment | Xvfb and Electron binary available | `pkg-config --modversion webkit2gtk-4.1` fails; necessary Linux webview SDK absent |
| Windows/Mac/IME/packaging | Not exercised | Not exercised |
| Total memory | Linux evidence exceeds proposed app-only editing budget; not a lightweight-release claim | No comparable measurement; smaller shell binary alone is not evidence |

The bounded comparison supports beginning implementation, not declaring a benchmark winner. This session has no Windows/MacBook, no cloud mounts, and no comparable Tauri app. Before fixing the production host, run the shared frontend/agent/file workload on both candidates, include all processes, and revisit this decision if Electron cannot meet the budgets.

## Integration details

Codex app-server is the provider's structured rich-client interface; the adapter follows the installed 0.154.0 generated schema, initialized client identity, thread/turn lifecycle, approval decisions and user-input responses. The generated schema was inspected in a disposable directory; it is not vendored wholesale. [Official app-server documentation](https://learn.chatgpt.com/docs/app-server).

Claude Agent SDK 0.3.269 is used as a local process controller with `pathToClaudeCodeExecutable: 'claude'`, native user/project/local setting sources, native default permission mode and `canUseTool`. The actually executed binary is Claude Code 2.1.232, not the SDK's bundled CLI. Existing account login worked during this session. No key or token is read by irori. [Programmatic execution](https://code.claude.com/docs/en/headless), [SDK](https://code.claude.com/docs/en/agent-sdk/overview), [permission/user-input callbacks](https://code.claude.com/docs/en/agent-sdk/user-input).

This is the end-user-installed, unmodified-binary route. Provider distribution and authentication terms must be reviewed for the intended release channel; a successful local run does not settle commercial distribution. [Claude Code's product/authentication conditions](https://code.claude.com/docs/en/legal-and-compliance).

Electron has context isolation, renderer sandbox enabled in application configuration, disabled Node integration, blocked arbitrary navigation/windows, a local-content CSP, and an allowlisted validated IPC surface. Linux root automation alone passes `--no-sandbox`; this exception is recorded with evidence. [Electron security](https://www.electronjs.org/docs/latest/tutorial/security).

Tauri's documented Node sidecar route remains a concrete alternative; avoiding a new Claude protocol implementation in Rust is more valuable than making every host component Rust. [Tauri Node sidecars](https://v2.tauri.app/learn/sidecar-nodejs/).

## Preserved open choices

Q01 ontology interaction and Q02 repository placement are still unanswered. Explicit folder registration is a replaceable first-slice mechanism, not a user decision requiring all future spaces to use separate folders. No ontology columns have been fixed. No reference repository has been changed, imported as a submodule, or merged.
