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

Antigravity CLI, 2026-10-19 (0.2.36): Google's Antigravity CLI (binary `agy`,
installed in `~/.local/bin` by its install script) is the sixth selectable CLI.
Each instruction runs one process: `agy --input-format stream-json
--output-format stream-json --disable-slash-commands --add-dir <checkout>`, with
one `{"event":"user","message":{"content":<prompt>}}` line on stdin, which is
then closed so the CLI runs that turn and exits. The prompt is never on the
command line. `--add-dir` makes the checkout the workspace: without it the
CLI's tools work in its own scratch folder. `--disable-slash-commands` keeps a
prompt starting with `/` from ending the session. `--model <id>` carries a
chosen model and `--conversation <id>` a saved conversation. Standard access is
`--mode accept-edits` (workspace edits; commands are refused, since a headless
run cannot ask) and full access `--dangerously-skip-permissions`. An attached
file's folder outside the checkout is added with another `--add-dir`. stdout
records are `init` (`conversation_id`), `step_update` (`conversation_id`,
`step_index`, `state`, `step_type`; `text_delta` on an `agent_response`,
`tool_info` on a `tool`) and one `result` (`status`, `response`, `error`,
`denied_actions`). A step of another conversation (a sub-agent's) is not shown.
`denied_actions` become a status line naming what was left undone. A `result`
whose `status` is not `SUCCESS`, a non-zero exit or no `result` fails the run;
without an earlier interactive sign-in the CLI ends at once and the panel says
to run `agy` once and sign in. Model ids come from `agy models`
(`<id>\t<label>` lines). Each id names its thinking level, and a mismatched
`--effort` stops the CLI, so no level is offered or passed. Sources: the
[headless documentation](https://antigravity.google/docs/cli/headless/), the
changelog `agy changelog` prints, `agy --help` of 1.4.2 (downloaded and checked
against the release manifest's SHA-512; no sign-in), and records captured from
agy 1.2.2 in [vicoa PR #74](https://github.com/vicoa-ai/vicoa/pull/74). Only the
protocol fixture exercises a turn: without a signed-in account here, 1.4.2 was
seen to fail sign-in at once in this mode, and nothing more. irori gives it no
person-lines hook and no sub-agents; the irori agent hands work over with
`irori call`.

Every CLI's composer offers its models in the conversation's menu (one button
under the instruction box since 0.2.63,
[ADR 059](decisions/059-the-window-shows-the-work.md); a pill of its own
before): "CLI の既定" passes no model, or a model the
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

Thinking level, 2026-10-18 (0.2.29): under the models, in the same menu since
0.2.63, 思考量 (既定 passes none) offers the levels the CLI gives for the chosen model,
read with the same `agentModels` list. Codex's `model/list` names each model's
`supportedReasoningEfforts` and `defaultReasoningEffort`, and the level goes as
`effort` on `turn/start`. Claude Code's `supportedModels()` names
`supportedEffortLevels` for a model with `supportsEffort` (none for one without),
and the level goes as the SDK's `effort` (`--effort`); when the list cannot be
read, `low`–`max` are offered. Pi takes `off`/`minimal`/`low`/`medium`/`high`/`xhigh`
for every model, sent as RPC `set_thinking_level` before each `prompt`.
OpenCode's levels are each model's variants in its own configuration, so one is
typed in and sent as the prompt's `variant`. Hermes Agent's `hermes chat` has no
level option, so no pill is shown and none is passed. A level must match
`^[A-Za-z0-9][\w-]{0,39}$`; one the newly chosen model does not take goes back to
the default. It is kept like the model (the irori agent's on the device), goes to
routine agent steps that use the panel's model, and to `irori call` hand-offs.
Codex 0.160.0's schema and Claude Agent SDK 0.3.269's types were read here; Pi,
OpenCode and Hermes are checked against fixtures only.

Run lifetime, 2026-09-27: runs end on completion, a stop or the CLI's exit; the
ten-minute (thirty for your AI) deadline is gone. Pi's `prompt` reply, which an
extension command can hold while the person answers its dialogs, has no deadline
of its own either. Other protocol replies keep their 45-second bound, and
OpenCode's prompt request was already unbounded.

Send now, 2026-11-04 (0.2.56, [ADR 056](decisions/056-send-now.md)): a
queued instruction sent now joins a Claude Code or Codex turn in progress.
Claude Code: every turn uses the Agent SDK's streaming input (`query` with an
async iterable; the request is the same first user message a string prompt
sends), a later message goes with `priority: 'next'`, which Claude Code takes
at the turn's next step, and the input closes at the turn's `result`; the SDK
then waits for the session state's `idle` before closing stdin, so words sent
just before the result are answered too. Codex: `turn/steer` with `threadId`,
`expectedTurnId` and a text input, refused once the turn has ended and for a
review or a compaction. Pi's RPC `steer` is not used yet: on 0.85 a steer that
arrives as the run settles is queued with no run to take it. OpenCode, Hermes
Agent and the Antigravity CLI take nothing mid-turn; there, as for an
instruction a run cannot take, the run stops and the instruction starts.
Protocol fixtures only; no real turn was steered.

Rewind and copy, 2026-11-05 (0.2.58, [ADR 017](decisions/017-conversation-history.md)
D6): each run's `done` line records where the CLI's session stood. Claude Code:
the session id from `system/init` and the `uuid` of the turn's last main
`assistant` or `user` message; a later turn passes `resume`, `resumeSessionAt`
and `forkSession` (`--resume-session-at=<uuid> --fork-session`), and saves the
forked session's id. Codex: the thread and the turn id from `turn/start` (or
`review/start`); a later turn calls `thread/fork` with `threadId`,
`lastTurnId`, `excludeTurns: true` and the same overrides as `thread/start`,
then `turn/start` on the new thread. The fork parameters were read from the
app-server documentation and codex-cli 0.160.0's binary strings
(`ThreadForkParams`), not from a run. Other CLIs get the conversation so far in
a fresh session. Protocol fixtures only.

## Schema reach (ADR 058)

Added 2026-11-07 (0.2.61, [ADR 058](decisions/058-every-schema-setting-reaches-every-cli.md)).
Every Schema setting reaches every CLI. The CLI loads a setting itself where
its source shows it does; otherwise irori gives it. `src/domain/schema-reach.ts`
holds the table, and `hookEvents` in the same file lists the hook events irori
runs per CLI. The facts below were read from source or documentation. No real
CLI was run; the protocol fixtures in `tests/schema-reach.test.ts` follow them.

| CLI | AGENTS.md | Knowledge folder AGENTS.md | `.claude/rules` | `.agents/skills` | Hooks | Compaction seen as |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | Reads it (2.1.277+). irori sets `instructionFiles: claude-md-and-agents-md` where a CLAUDE.md is, checks `InstructionsLoaded` each session and gives it through `UserPromptSubmit` when it was not loaded; with hooks off or an older version, as words | Loads it on a Read there | Reads them | Links from irori (ADR 049) | Its own | `system` `compact_boundary` |
| Codex | Root to cwd. irori raises `project_doc_max_bytes` to 1 MiB. irori gives it when `instructionSources` omits it or `AGENTS.override.md` is present | Never: irori names them | irori, as words | Reads them | Its own hooks, given per thread and trusted by hash; they hand each event to irori | `contextCompaction` item |
| OpenCode | Reads it (no limit) | Attached on a Read only: irori names them | irori, as words | Reads them | irori's plugin, which says it loaded | `session.compacted` |
| Pi | Reads it whatever the trust. irori gives it when `AGENTS.override.md` is present | Never: irori names them | irori, as words | `--skill` per folder from irori | irori's extension | `compaction_end` |
| Hermes Agent | Reads one context kind and cuts it (20,000 characters at least). A resumed session keeps its copy. irori gives a changed one, and gives it when `.hermes.md`, `HERMES.md` or `AGENTS.override.md` is present | Appended to tool results there | irori, as words | Only trusted Git projects: irori lists them | Around the run, and PostToolUse after the call | Not reported: words go whole every time |
| Antigravity CLI | Reads it and cuts at 24,000 bytes; irori says to read the whole file | Never: irori names them | irori, as words | Reads them | `.agents/hooks.json` in irori's `--add-dir` folder | Not reported: words go whole every time |

Hook events irori runs for a CLI other than Claude Code:

- **Around the run, on every such CLI:** SessionStart, UserPromptSubmit, Stop,
  SessionEnd and Notification.
- **PermissionRequest:** Codex and OpenCode, on the permissions they ask.
- **PostCompact:** Codex, OpenCode, Pi and Hermes, when irori sees a compaction.
- **PostToolUseFailure:** Pi and Hermes, on a call that failed.
- **SubagentStart:** Codex (its own hook) and OpenCode (before `task`).
- **PreToolUse and PostToolUse:**
  - Codex, OpenCode, Pi and the Antigravity CLI run them.
  - Hermes runs only PostToolUse, after the call. Its feedback goes in the next
    request.
- **PreCompact:**
  - Codex, OpenCode and Pi run it. Only Pi can stop a compaction.
  - Hermes and the Antigravity CLI cannot run it.
- **SubagentStop:**
  - Codex runs it through its own hook.
  - OpenCode and Hermes run it after a `task` or `delegate_task` call.
  - Pi and the Antigravity CLI cannot run it.
- **A missing event:** one that decides nothing is only named; for any other the
  person is asked before the run whether to go on without its hooks, and the
  answer is kept (`schema-hooks-without.json`) until those hooks change.
- **Handler fields:** `if`, `args`, `shell`, `async`, `asyncRewake`,
  `onFailure` and an `http` hook's `headers`/`allowedEnvVars` are read as Claude
  Code reads them; `prompt`, `agent` and `mcp_tool` hooks count as missing.

Tool calls are named and shaped as Claude Code's tools for the hooks
(`src/agents/tool-names.ts`): Pi's `bash`, OpenCode's `bash`, Hermes's
`terminal`, Antigravity's `run_command` and Codex's `Bash` are all `Bash`, and so
on.

Codex details (rust-v0.167.0 `codex-rs/hooks/src/engine/discovery.rs`;
`hook_hash` and `config_rules.rs`, unchanged since 0.160.0):

- **Where irori's hooks go:** the thread's `config.hooks`.
- **The trust key** is `/<session-flags>/config.toml:<event>:0:0`.
- **The hash** is the SHA-256 of the sorted JSON of
  `{event_name, matcher?, hooks:[{type, command, timeout, async:false}]}`,
  prefixed `sha256:`. The vectors in `core/tests/suite/hooks.rs` check it.
- **Why not `bypass_hook_trust`:** it would also run untrusted user and plugin
  hooks.

Sources, read on 2026-11-07:

- **Codex:** `openai/codex` rust-v0.167.0 (commit `086ccc8`) and rust-v0.160.0
  (`a956835`): `codex-rs/core/src/agents_md.rs`,
  `codex-rs/config/src/config_toml.rs`,
  `codex-rs/app-server-protocol/src/protocol/v2/{thread,item,plugin}.rs`, and
  `codex-rs/hooks/src/{lib.rs,engine/*}`.
- **OpenCode:** `anomalyco/opencode` v1.18.30 (`3104c142`) and v1.19.5
  (`810c0eba`): `packages/plugin/src/index.ts`,
  `packages/opencode/src/session/{instruction,compaction,tools}.ts` and
  `packages/opencode/src/tool/registry.ts`.
- **Pi:** `references/pi` at `8eb2bccf` (coding-agent 0.87.1):
  `packages/coding-agent/src/core/{extensions/types.ts,resource-loader.ts,trust-manager.ts,skills.ts,agent-session.ts}`.
- **Hermes Agent:** `references/hermes-agent` at `73688014`:
  `agent/prompt_builder.py`, `agent/skill_utils.py`,
  `agent/subdirectory_hints.py`, `agent/shell_hooks.py`,
  `hermes_cli/stream_json.py` and `hermes_cli/cli_single_query.py`.
- **Antigravity CLI:** `antigravity.google/docs/hooks/`,
  `/docs/customization-discovery/`, `/docs/rules/` and `/docs/skills/`.
- **Claude Code:** `code.claude.com/docs/en/hooks` and `/docs/en/memory`.

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
composer's selection to the starting mode: standard on every CLI (full access
where the CLI offered it from 2026-09-27 until November 2026; standard before);
a session saved under the other mode is not silently resumed with that label. Google OAuth and mounts remain read-only independently
of native agent access.

Install and configure the desired native CLI on the desktop's PATH. irori also searches the existing standard local binary locations. Authentication, model defaults, rules, skills and extensions remain with that CLI. The app displays detection/version status and uses the selected scope's canonical checkout as its working directory. It does not concatenate other spaces' rules. `.opencode/`, `.pi/`, `.agents/` and root `opencode.json`/`opencode.jsonc` are classified as schema; contents ownership still overrides classification.

| Adapter | Native transport | Interaction and persistence |
| --- | --- | --- |
| Codex | `codex app-server --listen stdio://` | Existing approval/question handling and scoped thread handles |
| Claude Code | Existing Agent SDK controlling the installed `claude` | Existing native settings, permission callbacks and session ID |
| OpenCode | `opencode serve` on a private authenticated loopback port | SSE text/tools, native permission replies and single/multiple-choice questions; native session ID |
| Pi | `pi --mode rpc` with LF-delimited JSON | Text/tools, native extension dialogs, native session file; requires Pi 0.85+ for settled-run handling |
| Hermes Agent | `hermes chat --query-file - --format stream-json`, one process per instruction | Text/tools from JSONL; no requests (one-shot); `--resume` session id |
| Antigravity CLI | `agy --input-format stream-json --output-format stream-json`, one process per instruction | Text/tools from JSONL; no requests (one-shot, refused actions reported); `--conversation` id |

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
