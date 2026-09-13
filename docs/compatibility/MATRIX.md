# Compatibility matrix

Verified dates: 2026-09-12 and connection follow-up 2026-09-13; Linux x86_64 container only. Earlier provider evidence was not repeated for the connection slice.

| Component | Pinned/observed version | Disposition |
|---|---|---|
| Node | dev runtime 24.21.0; system initially 20.20.0 | Node ^24.15.0 or >=26 required; local dev binary pinned to avoid initial engine mismatch |
| Electron | 44.3.0 | Linux executable launched under Xvfb; native release gates pending |
| React | 19.3.0 | Actual UI tests |
| Milkdown Crepe | 7.22.1 | Actual rich editor/table; basic features reused, native IME/reorder acceptance pending |
| CodeMirror | core 6.x, exact packages in lockfile | Source editor, UTF-8 2 MiB limit; native IME pending |
| Codex CLI | 0.154.0 | Actual app-server turns, note mutations, streamed output, permit and cancel |
| Claude Code | 2.1.232 | Actual installed binary, native account login, note mutation, permit/deny/question/cancel |
| Claude Agent SDK | 0.3.269 | Pinned controller using installed native executable, not bundled CLI |
| Tauri 2 | not installed/built | Comparison candidate; Linux webkit2gtk-4.1 SDK absent |
| Git | host executable | Native inspection, status/diff/history, stage/commit, clone/fetch/pull/merge/push verified with disposable repositories/local bare remotes; live GitHub and native-platform acceptance pending |
| rclone | 1.75.1 local test binary, not bundled | Real authenticated RC, config questions and shutdown pass; account/folder/mount logic has explicit protocol fixtures; real Google consent and native mounts unverified |
| OpenCode | 1.18.30 local native probe | Native server/session/SSE controls and adapter/UI fixtures; model inference unverified |
| Pi | 0.85.1 local native probe | Native RPC, extension dialog, lazy persistence and seeded native restart; model inference unverified |
| PTY | not integrated | Optional terminal remains backlog |

Native credential status was checked without copying tokens. Both providers' existing account sign-in was available. Native authentication expiry, clean-machine sign-in and release/distribution conditions remain outstanding. Native settings/rules are left enabled, but loading every skill/MCP/ancestor-rule combination has not been verified. Claude user-input smoke also exercised same-process-app session continuation. As of 2026-09-13, device-local session handles persist per scope/provider/checkout with explicit reset; protocol and seeded Electron restart tests pass, but native-provider restart acceptance remains open. Conversation display history is not persisted by irori across app restart.

## Markdown boundary

Unedited files retain their original bytes. Crepe may normalize table/list Markdown internally at initialization; initialization is not treated as a user edit. After user changes in rich mode, serialization may normalize bullet markers, table spacing and blank lines. Markdown, rather than editor JSON, is saved.

Detected BOM, CRLF, frontmatter, wiki links/embeds, Obsidian callouts, HTML-like blocks, directives, template forms, footnotes and display math use source mode. Source mode retains BOM and detected CRLF line separators during edits. This is a conservative heuristic, not an exhaustive dialect parser; mixed line endings and additional unsupported syntaxes need more fixtures before general compatibility can be claimed. No HTML/macros/plugins are executed. Images/LaTeX blocks are disabled in the initial rich editor. Renderer CSP blocks remote images and connections.

## Filesystem/lifecycle limits

- Resolve canonical path and ownership at every file operation. Ordinary symbolic links and unverified contents are visibly blocked. Cloud text access requires a live verified managed mount and is read-only. Reads/saves cannot follow an alias into a foreign scope or outside the selected root. Windows junction/case/Unicode behavior is unverified.
- A directory lists at most 4,000 entries. Watchers descend six levels, exclude contents/node_modules/.git, and are invalidation hints. Manual reload exists; deeper external changes are not automatically observed.
- Save checks the base hash twice and keeps a recovery draft plus prior observed bytes. Atomic replacement has a remaining narrow race with arbitrary external writers between final check and rename. This is not an OS compare-and-swap. Managed saves are serialized and blocked during managed agent runs. Private device metadata/recovery records now use file fsync; complete power-loss behavior, document-write durability and multi-instance coordination remain release work.
- Inaccessible space bindings are retained on disk. Startup profiles count unavailable scopes; full unavailable-space rebind/removal UI remains open. Cloud declarations retain user-chosen names and selected folder IDs, with device-local account rebinding/reconnection. Folder browsing is lazy; successful native mounts and mount-aware external refresh remain unverified/unimplemented respectively. See [cloud setup](../CLOUD-SETUP.md).
- Agent timeout: ten minutes; protocol request timeout: 45 seconds. Cancellation aborts the SDK/turn, then terminates the process group on POSIX or tree-kill on Windows. Native Windows tree cleanup is not yet tested.
- Supported approval shapes include command/file approvals and per-turn additional permissions, plus tool user-input questions. Unknown protocol requests (including currently unsupported MCP elicitation/dynamic forms) fail closed and produce an explicit error. No feature parity is implied for rejected requests.
