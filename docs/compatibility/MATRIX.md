# Compatibility matrix

Verified date: 2026-09-12; Linux x86_64 container only.

| Component | Pinned/observed version | Disposition |
|---|---|---|
| Node | dev runtime 24.21.0; system initially 20.20.0 | Node 24+ required; local dev binary pinned to avoid initial engine mismatch |
| Electron | 44.3.0 | Linux executable launched under Xvfb; native release gates pending |
| React | 19.3.0 | Actual UI tests |
| Milkdown Crepe | 7.22.1 | Actual rich editor/table; basic features reused, native IME/reorder acceptance pending |
| CodeMirror | core 6.x, exact packages in lockfile | Source editor, UTF-8 2 MiB limit; native IME pending |
| Codex CLI | 0.154.0 | Actual app-server turns, note mutations, streamed output, permit and cancel |
| Claude Code | 2.1.232 | Actual installed binary, native account login, note mutation, permit/deny/question/cancel |
| Claude Agent SDK | 0.3.269 | Pinned controller using installed native executable, not bundled CLI |
| Tauri 2 | not installed/built | Comparison candidate; Linux webkit2gtk-4.1 SDK absent |
| Git/rclone/PTY | not integrated | Backlog, no collaboration/terminal claims |

Native credential status was checked without copying tokens. Both providers' existing account sign-in was available. Native authentication expiry, clean-machine sign-in and release/distribution conditions remain outstanding. Native settings/rules are left enabled, but loading every skill/MCP/ancestor-rule combination has not been verified. Claude user-input smoke also exercised same-process-app session continuation; histories are not persisted by irori across app restart.

## Markdown boundary

Unedited files retain their original bytes. Crepe may normalize table/list Markdown internally at initialization; initialization is not treated as a user edit. After user changes in rich mode, serialization may normalize bullet markers, table spacing and blank lines. Markdown, rather than editor JSON, is saved.

Detected BOM, CRLF, frontmatter, wiki links/embeds, Obsidian callouts, HTML-like blocks, directives, template forms, footnotes and display math use source mode. Source mode retains BOM and detected CRLF line separators during edits. This is a conservative heuristic, not an exhaustive dialect parser; mixed line endings and additional unsupported syntaxes need more fixtures before general compatibility can be claimed. No HTML/macros/plugins are executed. Images/LaTeX blocks are disabled in the initial rich editor. Renderer CSP blocks remote images and connections.

## Filesystem/lifecycle limits

- Resolve canonical path and ownership at every file operation. Ordinary symbolic links and contents are visibly blocked in navigation. Reads/saves cannot follow an alias into a foreign scope or outside the selected root. Windows junction/case/Unicode behavior is unverified.
- A directory lists at most 4,000 entries. Watchers descend six levels, exclude contents/node_modules/.git, and are invalidation hints. Manual reload exists; deeper external changes are not automatically observed.
- Save checks the base hash twice and keeps a recovery draft plus prior observed bytes. Atomic replacement has a remaining narrow race with arbitrary external writers between final check and rename. This is not an OS compare-and-swap. Managed saves are serialized and blocked during managed agent runs. Power-loss/fsync and multi-instance coordination remain release work.
- Inaccessible space bindings are retained on disk, but unavailable-space display/rebind/removal UI is not implemented. Mount declarations remain visible and unverified; no remote folders are crawled or silently hydrated.
- Agent timeout: ten minutes; protocol request timeout: 45 seconds. Cancellation aborts the SDK/turn, then terminates the process group on POSIX or tree-kill on Windows. Native Windows tree cleanup is not yet tested.
- Supported approval shapes include command/file approvals and per-turn additional permissions, plus tool user-input questions. Unknown protocol requests (including currently unsupported MCP elicitation/dynamic forms) fail closed and produce an explicit error. No feature parity is implied for rejected requests.
