# Native harness adapters

Current native-model evidence: [2026-09-23 acceptance](REAL-AGENT-ACCEPTANCE-2026-09-23.md) verifies Codex/Claude note edits, schema invariance, persisted native conversation continuity and the Claude person-line hook. It also records unavailable Codex default-mode structured questions and absent Pi/OpenCode native model credentials. The dated records below retain their original, narrower scope.

Transport follow-up, 2026-09-13: OpenCode uses the matching official SDK 1.18.30 for HTTP methods and types, with irori's bounded fetch and eventsource-parser subscription. Codex/Pi now share bounded JSONL framing and request lifetimes. The native entry points and saved handles below remain unchanged. Build, all five UI scripts and all 54 tests (including native controls) pass; no model inference was used. The ACP trial and migration decisions are in [reuse completion](REUSE-COMPLETION-2026-09-13.md).

Date: 2026-09-13. Codex, Claude Code, OpenCode and Pi are selectable in the ordinary AI panel. OpenCode/Pi are new integration previews; their real model-driven note edits and cloud-file access have not been accepted yet. No additional model API or embedded replacement agent was introduced.

Hermes Agent and model selection, 2026-09-27: Hermes Agent (NousResearch
`hermes-agent`, binary `hermes`) is the fifth selectable CLI. Each instruction
runs `hermes chat --query-file - --format stream-json` in the checkout, with the
prompt on stdin (no command-line length limit, never shell-interpreted),
`--resume <session_id>` for a saved conversation, `-m <model>` for a chosen model
and `--yolo` only in full access. stdout records are parsed per
`hermes_cli/stream_json.py` on `main` (added 2026-08-20, fixed 2026-09-15;
`--query-file` is a day older): `system`/`init` (`model`, `session_id`), `text`
(`text`), `tool_use` (`name`, `input`), `tool_result` (`name`, `output`,
`is_error`), and one `result` (`session_id`, `exit_code`, `text`, `error`). The
parser also accepts `delta`/`content` for text and skips non-JSON lines. The
session id is saved as soon as `init` names it and again if `result` names
another (Hermes rotates it on compression). A `result` with `error` or a non-zero
`exit_code`, or an exit without `result`, fails the run. A one-shot run cannot ask:
in the default access Hermes decides dangerous commands through
`approvals.single_query_mode` (deny by default), so the panel shows no requests.
Hermes has no person-lines hook in irori. Hermes is not installed on the
development machine: only the protocol fixture (`tests/fixtures/harnesses.mjs`)
exercises it, and `available()` reports it untested.

Every CLI's composer has a model pill: "CLI の既定" passes no model, or a model the
installed CLI lists (`agentModels`, read once per CLI version and never
generating text). Codex answers `model/list` on its app server (hidden models
left out, pages followed); Claude Code answers the Agent SDK's
`supportedModels()` on a session whose input never yields, so no turn starts.
Both were read from the installed codex-cli 0.156.1 and Claude Code 2.1.280.
OpenCode's `opencode models` (`provider/model` lines) and Pi's
`pi --list-models` table are parsed from fixtures only; neither CLI is installed
here. Hermes prints no machine-readable list, so its model is typed in; a CLI whose
list is empty or unreadable also takes a typed name (Claude Code falls back to its
aliases). A model name must match `^\w[\w./:@[\]-]{0,199}$`, so it can never be
read as an option. Codex gets it as `model` on `thread/start`/`thread/resume` and
`turn/start`, Claude Code as the SDK's `model`, OpenCode per prompt as
`{providerID, modelID}`, Pi as `--provider`/`--model` and Hermes as `-m`. Every
CLI resumes a saved conversation under another model, so a model change keeps
the conversation. The choice is kept per brain and CLI for the window's life, and
travels with queued instructions.

Run lifetime, 2026-09-27: runs end on completion, a stop or the CLI's exit; the
ten-minute (thirty for your AI) deadline is gone. Pi's `prompt` reply, which an
extension command can hold while the person answers its dialogs, has no deadline
of its own either. Other protocol replies keep their 45-second bound, and
OpenCode's prompt request was already unbounded.

## Native configuration and lifecycle

Access follow-up, 2026-09-23: the composer offers native/default behavior and
explicit full access for Codex, Claude Code and OpenCode. Pi uses native
settings only. Codex maps these choices to `on-request / workspace-write` and
`never / danger-full-access`; Claude maps them to `default` and
`bypassPermissions` with its explicit bypass opt-in. OpenCode full access sets
and verifies the session's final wildcard allow rule; ordinary configuration
is preserved in default mode. Standard Codex workspace writes do not each ask
for approval. Supported native question requests remain interactive; Codex's
default-mode limitation is recorded in the real-model report. See the
[access decision](decisions/009-agent-access-and-extension-compatibility.md).
Full-access native mappings have protocol/SDK coverage and an actual OpenCode
server roundtrip; the [real-model trials](REAL-AGENT-ACCEPTANCE-2026-09-23.md)
used the standard mode on the 0.1.26 baseline.

The selected access mode travels with queued instructions and the native
session record. A mode change starts a new native session while retaining the
display history. Workspace, KB or CLI changes and app restart reset the
composer's selection to the Hibachi Agent's starting mode (full access where the
CLI offers it, since 2026-09-27; standard before); a session saved under the other
mode is not silently resumed with that label. Google OAuth and mounts remain read-only independently
of native agent access.

Install and configure the desired native CLI on the desktop's PATH. irori also searches the existing standard local binary locations. Authentication, model defaults, rules, skills and extensions remain with that CLI. The app displays detection/version status and uses the selected scope's canonical checkout as its working directory. It does not concatenate other spaces' rules. `.opencode/`, `.pi/`, `.agents/` and root `opencode.json`/`opencode.jsonc` are classified as schema; contents ownership still overrides classification.

| Adapter | Native transport | Interaction and persistence |
| --- | --- | --- |
| Codex | `codex app-server --listen stdio://` | Existing approval/question handling and scoped thread handles |
| Claude Code | Existing Agent SDK controlling the installed `claude` | Existing native settings, permission callbacks and session ID |
| OpenCode | `opencode serve` on a private authenticated loopback port | SSE text/tools, native permission replies and single/multiple-choice questions; native session ID |
| Pi | `pi --mode rpc` with LF-delimited JSON | Text/tools, native extension dialogs, native session file; requires Pi 0.85+ for settled-run handling |
| Hermes Agent | `hermes chat --query-file - --format stream-json`, one process per instruction | Text/tools from JSONL; no requests (one-shot); `--resume` session id |

The OpenCode child gets a random server password and fixed loopback binding. The renderer receives neither credentials nor a generic HTTP/command API. The host subscribes before prompting, validates the session's checkout, filters conversation events by session, and accepts permission/question requests only for that session or verified descendants. Ordinary approval replies apply once; choosing full access explicitly changes that native session's permission rules as described above. Response completion is reconciled with streamed text; an interrupted event stream fails the run. See the official [server protocol](https://opencode.ai/docs/server/) and [permission semantics](https://opencode.ai/docs/permissions/).

Pi retains its own tool and project-trust behavior. Standard Pi tool execution does not have permission popups; extension `confirm`, `select`, `input` and `editor` requests are bridged to the panel, and unsupported extension UI requests are reported/cancelled. The panel states the native permission distinction. irori does not pass `--approve` or change trust settings to load project extensions. Project resources therefore depend on Pi's native trust configuration. Custom terminal widgets and the complete interactive Pi interface are not reproduced. See the official [Pi README](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) and [RPC protocol](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md).

Before a file tool would change lines the person wrote, Pi and OpenCode hear which through their own hook: irori starts a loopback listener per run and hands each CLI a script from irori's data directory (`pi -e`, OpenCode's `plugin` list in `OPENCODE_CONFIG_CONTENT`) that holds the `edit`/`write` call once with the notice. Codex offers no such channel. See [AUTHORSHIP](AUTHORSHIP.md).

All adapters share the existing single-run lock, process-tree cancellation, device-local scope/provider/checkout bindings and explicit reset. A failed resumed session retains its binding instead of silently creating a fresh conversation. Pi validates the exact saved file and header checkout before launch. Pi creates new session files lazily; command-only runs that produce no file are not marked saved. Existing native session files remain outside the KB, and ordinary reset detaches the irori handle without deleting native history. Conversation text redisplay after app restart remains open.

## Verified boundary

The final application build and 29 tests pass with all native control probes enabled. A plain `npm test` skips four opt-in native controls: one rclone probe and three OpenCode/Pi probes. Protocol fixtures explicitly stand in for provider/model output and are not native inference evidence.

- OpenCode 1.18.30: actual executable startup, authenticated server health, unauthorized-request rejection, Japanese checkout identity, native session create/read, event connection and shutdown. Uses disposable native state; no prompt or model request.
- Pi 0.85.1 (`@earendil-works/pi-coding-agent`): actual RPC state/command discovery and cancellation; a disposable native extension asks a real confirmation through the adapter without invoking a model. A fresh command-only run leaves no saved nonexistent session. A separately seeded native session is resumed in two fresh processes, retaining its exact path and denied-dialog messages. This establishes native control/session-file handling, not model conversation continuity.
- Explicit protocol fixtures: streamed Japanese including U+2028, permissions denied without automatic approval, extension inputs, multiple-choice replies, provider errors/crashes, cancellation and lock release, saved-handle restart/reset, failed resume without fallback, and foreign-session text exclusion.
- Actual Electron with explicit executable fixtures: select each new harness, deny a request, answer a question, observe completion, retain/reset session status across host restart. OpenCode's multiple selections remain separate answer strings. Existing editor/session/cloud UI regression scripts remain part of `npm run test:ui`.

Native controls can be repeated with `IRORI_TEST_OPENCODE_PATH`, `IRORI_TEST_PI_PATH` and optionally `IRORI_TEST_RCLONE_PATH` pointing at installed binaries when running `npm test`. These controls do not require provider login or inference. Locally downloaded binaries are ignored test tools, not bundled runtime dependencies or installer assets.

Remaining acceptance: actual OpenCode/Pi model turns using an authorized native account, note edits and native-model resume, real tool approval/denial where supported, login/version recovery, native Windows/macOS process cleanup, rules/skills/plugins/MCP by each provider's capabilities, GUI executable discovery and actual mounted-file reads. Native OpenCode/Pi model tests require separate opt-in; current `test:agents`/`test:lifecycle` remain Codex/Claude scripts. Cloud writes and pending-upload recovery are separate work and remain disabled.
