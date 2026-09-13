# Implementation reuse audit — 2026-09-13

Final outcome: [all audit items now have an implementation or recorded decision](REUSE-COMPLETION-2026-09-13.md).

Implementation follow-up: the user authorized the high-priority changes after this research. Git, SSE and shared UI reads are now implemented; see [the completed simplification slice and its validation](SIMPLIFICATION-2026-09-13.md). The prototype measurements and research-only status below are retained as historical evidence.

There are worthwhile opportunities. The clearest immediate improvement is to consolidate existing Git and asynchronous UI code. The strongest small dependency candidate is `eventsource-parser`. ACP is the most promising architectural option for reducing future provider-specific integration work, but its adapters need a compatibility trial before replacing the current harnesses.

This audit covers the working tree after the Git implementation, based on checkpoint `9c04abb`. It does not refactor production code or change application dependencies. Package trials and mutation fixtures were isolated; no model turns, cloud account operations or external Git pushes were performed.

## Scope and evidence

The implementation has 9,068 physical lines under `src/`, including 1,548 CSS lines. These are inventory counts, not a claim that those lines can be removed.

| Area                  | Physical lines | Existing reuse                                           |
| --------------------- | -------------: | -------------------------------------------------------- |
| App UI, including CSS |          4,575 | React, browser controls                                  |
| Native agents         |          1,229 | Claude Agent SDK, installed CLIs, cross-spawn, tree-kill |
| Host and storage      |          1,022 | Zod, Chokidar, Node filesystem                           |
| Cloud                 |            991 | Native rclone and its RC API                             |
| Git                   |            816 | Native Git                                               |
| Domain                |            322 | Zod and typed boundaries                                 |
| Editor                |            112 | Milkdown Crepe and CodeMirror                            |
| Other source          |              1 | Type declaration                                         |

Evidence combines source inspection, official documentation, published package inspection and disposable probes. [Recorded measurements](measurements/2026-09-13-reuse-audit.json) contain the probe output, package versions and source fingerprints. Application build/UI results from the preceding Git implementation remain historical evidence; the probes below are not a replacement for migration acceptance tests.

## Recommended order

| Priority | Target                             | Approach                                                        | Expected benefit                                                                 | Confidence                                                      |
| -------- | ---------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1        | Repeated Git metadata work         | Batch administrative-path discovery; reuse mutation results     | Measured reduction in native process launches; simpler orchestration             | High for the measured fixture                                   |
| 1        | Two Git subprocess implementations | Reuse one configurable, bounded runner                          | Remove the separate 40-line inspection helper while retaining inspection options | High from source inspection                                     |
| 2        | OpenCode SSE framing               | `eventsource-parser` 4.1.0                                      | Delegate a protocol parser and cover a reproduced missing line-ending case       | High from parser probes                                         |
| 2        | Cloud/Git/explorer async reads     | Shared hooks, or TanStack Query if adopted across these screens | Consolidate loading/error/polling/invalidation and duplicate reads               | Cache semantics probed; UI migration untested                   |
| 3        | Provider integration               | One ACP client, starting with OpenCode                          | Potentially replace multiple transport/event adapters                            | Architecture candidate; no native parity trial                  |
| 3        | OpenCode HTTP methods and types    | Matching official SDK 1.18.30, client-only                      | Remove handwritten route/type knowledge                                          | Package inspected; subscription readiness difference reproduced |
| 3        | Host request plumbing              | Existing Zod + a typed endpoint registry                        | Reduce contract drift and repeated dispatch declarations                         | Design candidate                                                |
| 4        | Metadata writes                    | `write-file-atomic`, narrowly scoped                            | Better write durability/cleanup, small local code saving                         | Source inspection only                                          |
| Later    | Diff and tree UX                   | CodeMirror Merge / Pierre Diffs; Headless Tree                  | Reuse features before implementing richer comparisons or keyboard navigation     | Documentation and package inspection only                       |

Do not sum whole-file sizes or these overlapping candidates into a projected deletion count. ACP and a separate OpenCode HTTP SDK migration are alternative directions for much of the same code. Actual net deletion should be measured in the migration diff.

## 1. Git: simplify the current implementation first

### Repeated administrative-path discovery is measurable

In [GitService](../src/git/service.ts), `gitFile()` spawns `git rev-parse --git-path` for each file. `operation()` does the same for five operation markers and reads `MERGE_HEAD` again. A normal snapshot therefore performs nine administrative-path lookups. `diff()` takes two snapshots; `stage()` takes four through its nested review and mutation flow.

The probe batches the seven distinct path names in one `rev-parse --path-format=absolute` invocation **per snapshot**. It still reads the index before and after the snapshot, checks HEAD, applies scope/path rules, and checks the reviewed version before staging. Each snapshot has its own path map; there is no indefinite cache and no assumption that `.git` is a directory. Git's own path resolution remains authoritative. [Git rev-parse documentation](https://git-scm.com/docs/git-rev-parse)

Seven measurements per case, Linux, Node 24.21.0, Git 2.34.1, a small warm repository with a local bare upstream:

| Operation | Current Git process launches | Batched prototype | Current median | Prototype median |
| --------- | ---------------------------: | ----------------: | -------------: | ---------------: |
| Status    |                           23 |                15 |      100.31 ms |         74.92 ms |
| Diff      |                           46 |                30 |      208.89 ms |        133.58 ms |
| Stage     |                           92 |                60 |      403.38 ms |        266.73 ms |

These are host-operation measurements, excluding renderer refreshes. Count reduction is the stronger result; timings are indicative, with baseline and candidate run sequentially rather than randomized. They do not predict performance on large repositories or Windows/macOS.

The probe checked identical status objects/version hashes, a Japanese filename, staged changes, blocked pre-staged `contents`, rejection after an edit invalidated a review, and linked-worktree status/merge markers. Administrative-directory relocation during an operation, hooks and the complete Git regression suite were not tested against this prototype.

### The renderer discards a result it already receives

`stage()`, `commit()`, `sync()` and conflict resolution return updated `GitStatus`. However, [GitPanel's `perform()`](../src/app/GitPanel.tsx) accepts `Promise<unknown>`, discards that result and always calls `gitStatus()` in `finally`. Some handlers additionally discard the return value inside an async closure.

Use a mutation wrapper that accepts returned status on success and refreshes on failure. Keep a separate read operation path for history/diff requests, and preserve busy/close guards and filesystem invalidation. For the measured fixture, the explicit extra status request costs another 23 processes today. Returning data through the existing API requires no dependency. A simple `92 + 23` accounting is not a full UI benchmark; watcher-driven work may also occur.

### Consolidate process handling and small collection operations

[Workspace inspection](../src/host/workspaces.ts) has a separate 40-line Git subprocess helper; [GitProcess](../src/git/process.ts) already implements bounded output, timeout and process cleanup. Move inspection onto the shared runner with explicit read-only, environment, timeout and output-limit options. Do not reuse the broad onboarding status query inside scoped Git operations: it would scan `contents`.

The staged-file reconciliation loop repeatedly calls `changes.some(...)`; a `Set` of known paths makes membership linear in the number of rows. This is a small data-structure improvement, not a reason to add a utility library.

### Why `simple-git` is conditional

`simple-git` 3.36.0 provides native Git command wrappers, status/log parsing and a queue. Its status parser passed the probe for Japanese, newline, glob-like and leading-dash filenames. It is a credible option if Git command coverage expands. [Simple Git](https://github.com/steveukx/git-js)

It does not replace irori's scope ownership, reviewed-version checks, transaction locks, backup/recovery, exact push destination or error redaction. Package inspection also found that cancellation calls `spawned.kill('SIGINT')`; that alone does not establish parity with irori's descendant cleanup. Its default concurrency is six, and its documented timeout is a rolling timeout. Even the literal `core.fsmonitor=false` configuration was rejected by the default unsafe-config guard in the probe. [Configuration guard](https://github.com/steveukx/git-js/blob/main/docs/PLUGIN-UNSAFE-ACTIONS.md)

**Recommendation:** consolidate and batch first. Compare actual net code size before choosing `simple-git`; do not describe its adoption as deleting all 711 lines of GitService. Replacing the native Git engine or adding a GitHub REST SDK would address a different layer than the local index/diff/merge functionality audited here.

## 2. Use a real SSE parser for OpenCode

[OpenCodeServer.readEvents()](../src/agents/opencode.ts) manually splits SSE frames and normalizes CRLF, but does not recognize CR-only lines. SSE permits LF, CRLF and CR. [HTML event-stream parsing standard](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream)

The probe fed the **actual existing reader** and `eventsource-parser` 4.1.0 identical synthetic JSON events, one byte at a time, including split Japanese UTF-8 characters and line boundaries:

| Line ending | Existing reader events | Library events |
| ----------- | ---------------------: | -------------: |
| LF          |                      1 |              1 |
| CRLF        |                      1 |              1 |
| CR          |                      0 |              1 |

The library also passed an explicit `maxBufferSize` overflow probe. It has no runtime dependencies and requires Node >=22.12; the pinned development Node and Electron's measured embedded Node 24.20.0 satisfy that requirement. Configure the limit explicitly, retain streaming UTF-8 decoding, JSON validation/error handling, abort cleanup and the current subscription readiness barrier. [eventsource-parser](https://github.com/rexxars/eventsource-parser)

This is a small code reduction with a concrete protocol benefit. It does not establish that the installed OpenCode server emits CR-only events or that a user session has failed this way.

## 3. Consolidate asynchronous UI reads

[Connections](../src/app/Connections.tsx) implements two-second polling plus separate drive/folder effects; [Startup](../src/app/Startup.tsx) repeats loading/error and stale-result guards; [LayerExplorer](../src/app/LayerExplorer.tsx) performs lazy directory reads; [GitPanel](../src/app/GitPanel.tsx) has its own mutation and query coordination.

A small shared resource hook is sufficient if this remains a handful of screens. If caching, polling and invalidation are standardized across all these panels, prefer `@tanstack/react-query` 5.102.8 over gradually inventing a local query framework. Its defaults need deliberate desktop settings: queries retry and refetch under conditions that are useful for web APIs but not always appropriate for local IPC. [TanStack Query defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)

An isolated `@tanstack/query-core` 5.102.8 probe demonstrated:

- Five concurrent reads of one key invoke the supplied operation once.
- Invalidating scope A does not invalidate scope B.
- `networkMode: 'always'` allows a local read while the online manager reports offline.
- Switching a query observer from A to B prevents a late A result replacing B.

Use keys including `scopeId`, path and relevant selection/version parameters. Invalidate from the existing file-change bridge. Root listings are already shared; do not count that as a new saving. Potential reuse for non-root directories depends on whether multiple consumers actually request the same key.

Keep editing drafts, conflict resolutions, permission prompts and mutation locks outside the query cache. Set `retry: false` for mutations; do not implement commit, push, save or agent launch as a refetchable query. Explicitly consider query retry/focus behavior too. The current HostAPI does not transport `AbortSignal`, so query cancellation must not be presented as cancelling native processes.

## 4. ACP can reduce provider-specific integration work

Today irori maintains Codex JSONL RPC, Claude SDK integration, OpenCode HTTP/SSE and Pi's distinct JSONL protocol. [The ACP TypeScript SDK](https://agentclientprotocol.com/libraries/typescript) offers typed protocol handling; published version 1.4.0 supports the fluent `client()` API. Its Zod peer dependency fits the existing stack. The older connection classes are deprecated for new integrations.

| Harness  | Existing ACP route                             | What must be checked for irori                                                                   |
| -------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| OpenCode | Native `opencode acp` over stdio               | Same config/account, existing session resume, questions, denial, cancellation                    |
| Codex    | `@agentclientprotocol/codex-acp` 1.11.0        | Native executable selection, app-server capability parity, handle migration                      |
| Claude   | `@agentclientprotocol/claude-agent-acp` 0.76.0 | SDK/runtime version, local settings, native executable selection, question/multi-select behavior |
| Pi       | `pi-acp` 0.0.33 community adapter              | Existing session-path mapping, extension UI, cancellation and capability omissions               |

OpenCode documents its native stdio entry point. The current Codex adapter starts app-server and permits a specific executable via `CODEX_PATH`; the Claude adapter uses the Agent SDK. Pi's adapter spawns `pi --mode rpc`, but documents incomplete MCP forwarding and no filesystem/terminal delegation. [OpenCode ACP](https://opencode.ai/docs/acp/), [Codex adapter](https://github.com/agentclientprotocol/codex-acp), [Claude adapter](https://github.com/agentclientprotocol/claude-agent-acp), [Pi adapter](https://github.com/svkozak/pi-acp)

Package-name/version details matter: the currently maintained Codex and Claude packages use the `@agentclientprotocol` namespace; old `@zed-industries` package examples resolve to different releases. The examined Claude adapter pins SDK 0.3.257, while irori uses 0.3.269. A shared protocol does not itself imply identical provider behavior or interchangeable saved session handles.

**Recommendation:** trial one reusable host-side ACP client with OpenCode first, because its native CLI already supplies the protocol. Then evaluate each adapter against the existing behavioral contract. Keep irori's scope/session ownership, permission UI, file-change reconciliation and child-process lifecycle. Advertise only implemented filesystem/terminal capabilities. ACP cannot enforce irori's ownership rules for native agent filesystem activity merely by being present. [ACP capability schema](https://agentclientprotocol.com/protocol/v1/schema)

No ACP native run was performed in this audit. Savings may be substantial across adapters, but are unmeasured; declaring all four harnesses migrated would be premature.

## 5. Official SDKs: use the right integration layer

### OpenCode HTTP SDK is available at the installed version

The installed CLI is 1.18.30, and `@opencode-ai/sdk` **1.18.30** exists. Its client-only API can replace handwritten routes and `any` event types while keeping irori's authenticated process supervisor. The package's `/v2/client` export is an entry point within the 1.x package; it must not be confused with the separate OpenCode 2.x `@opencode/client` package. [OpenCode SDK](https://opencode.ai/docs/sdk/)

A fake-fetch transport probe found zero fetches after `await client.event.subscribe(...)` and one after the first iterator `next()`. The stream is lazy. Preserve an explicit HTTP-header readiness barrier before sending a prompt; awaiting subscription construction is insufficient. Source inspection also found default reconnect behavior after stream errors and no equivalent of the current JSON/SSE size limits. Error sanitization, redirect rejection, bounded reads and cancellation need a retained adapter.

**Recommendation:** use its types/client if staying with HTTP. Compare that option with ACP before doing both migrations. The likely gain is stronger API typing and less protocol maintenance, not deletion of the entire OpenCode adapter.

### Codex: the existing app-server choice matches the feature set

OpenAI's documentation distinguishes SDK automation from app-server integration for custom clients handling authentication, history, approvals and streamed events. The current app-server choice fits irori. A lower-risk improvement is generating version-matched TypeScript protocol types with `codex app-server generate-ts`, while retaining the small transport and native behavior. Do not replace it with a generic model API to save lines. [Official OpenAI app-server documentation](https://learn.chatgpt.com/docs/app-server), [Codex SDK documentation](https://learn.chatgpt.com/docs/codex-sdk)

### Pi: the apparent client export is not a drop-in RPC client

The installed `@earendil-works/pi-coding-agent` 0.85.1 has a `./client` export with only a `source` condition and excludes `dist/client` from publication. The separate `@earendil-works/pi-client` 0.85.1 is published, but targets an **experimental service protocol**, not the existing `pi --mode rpc` wire format. It therefore does not directly replace PiRpc. Reassess it when that service protocol is a product choice; use the ACP trial to evaluate a less invasive reuse path. [Pi client source and documentation](https://github.com/earendil-works/pi/tree/main/packages/client)

Claude already uses the official Agent SDK. Its remaining code largely translates native events into irori's UI and owns lifecycle/session policy.

## 6. Smaller host and UI opportunities

| Target            | Concrete opportunity                                             | Boundary / recommendation                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JSON transport    | Reuse a bounded response reader between OpenCode and rclone      | rclone currently calls `response.text()` before checking size, so its limit does not bound buffering. Share decoding, retain service-specific redaction and authentication.               |
| Serial operations | A small shared queue helper for files/workspaces/cloud           | Preserve different scopes and busy counters. A promise queue library does not replace Git's multi-command transaction lock.                                                               |
| IPC               | A host-side typed endpoint/validator registry using existing Zod | Keep named allowlisted preload methods and sender validation. Avoid solving repetition by exposing generic renderer IPC or dropping runtime validation.                                   |
| Dialogs           | Extract the working native `<dialog>` wrapper from GitPanel      | Reuse focus/close behavior in Connections and other modal flows. Native modal dialog supplies browser focus/inert behavior; a UI kit is unnecessary solely for this.                      |
| Device metadata   | `write-file-atomic` 8.0.0                                        | Default file fsync and same-file write serialization can replace part of the 27-line local JSON module. Keep parent creation, 0600 mode, schema validation and read-modify-write locks.   |
| Native commands   | Evaluate `execa` 10.0.1 only after consolidating runners         | Helpful timeout/output/process APIs, but descendant cleanup, environment policy and provider readiness remain. This package has 12 direct dependencies; immediate net saving is unproven. |

Browser behavior is specified by the [HTML dialog standard](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element). Metadata and process capabilities are documented by [write-file-atomic](https://github.com/npm/write-file-atomic) and [Execa termination](https://github.com/sindresorhus/execa/blob/main/docs/termination.md).

`write-file-atomic` does not solve the separate external-writer check/rename race in document saves. File fsync also should not be represented as a complete filesystem crash-consistency guarantee. Its Node requirement is satisfied by both tested runtimes. Prefer this dependency for durability needs rather than claiming a major line reduction.

## 7. Reuse richer UI features when they are added

- **Diff/merge:** `@codemirror/merge` 6.12.2 can reuse the existing CodeMirror family for aligned comparisons and editable results. `@pierre/diffs` 1.4.2 offers patch rendering, split/unified layouts and conflict primitives, but adds Shiki and another rendering stack. The current patch display is small, so neither has a demonstrated immediate net saving. CodeMirror comparisons need original/new content where the HostAPI currently returns only a patch. Neither replaces native Git merge, version checks or durable conflict backups. [CodeMirror Merge](https://github.com/codemirror/merge), [Pierre Diffs](https://diffs.com/)
- **Explorer:** `@headless-tree/react` 1.7.0 is worth considering before adding full tree keyboard navigation, typeahead, async caching or virtualization. Its peer dependencies include `@headless-tree/core`; the React package is not the complete dependency footprint. Keep layer classification, five-pane arrangement and ownership rules. Drag/drop should not be enabled merely because the library provides it. [Headless Tree](https://headless-tree.lukasbach.com/)
- **Editor/cloud:** retain Milkdown + CodeMirror and native rclone. The editor wrapper is already only 103 lines; replacing its engine risks Markdown fidelity without a shown saving. rclone already supplies provider integrations; another Google client would duplicate a working integration layer rather than replace irori's attachment lifecycle and ownership logic. [rclone RC API](https://rclone.org/rc/)
- **Icons/styles:** a 51-line icon component and deliberate product styling are not major reuse problems. Focus on repeated behavior before adding a general UI or utility framework.

## Reproduction and limitations

The workspace-local probe is `.local/reuse-audit/probe.mts`; dependencies and lockfile are in the same ignored directory. Run it from the repository with `node_modules/.bin/node --import tsx .local/reuse-audit/probe.mts`. Its exact package versions and all successful measurements are preserved in the tracked evidence JSON. The scratch probe is not shipped as an application test; a fresh clone does not contain it.

The Git prototype overrides only snapshot path discovery on a separate service instance. The SSE probe invokes the existing reader against a synthetic stream. The query probe uses the query core without React. The OpenCode SDK probe uses fake fetch and no server. Initial probe failures exposed duplicate portable scope IDs in a linked-worktree fixture (fixed in the disposable fixture) and Simple Git's fsmonitor guard (reported above); neither was hidden as a passed compatibility test.

No production refactor, renderer migration, real provider acceptance, dependency vulnerability audit or bundle comparison was completed here. The next implementation should start with Git consolidation and a small parser/query change, with the required build/behavior/UI gates. ACP deserves a separate compatibility trial before expanding bespoke provider integrations further.
