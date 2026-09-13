# Simplification implementation — 2026-09-13

This records the first implementation slice. The user subsequently requested completion of the remaining audit; see [the final ledger, changes and verification](REUSE-COMPLETION-2026-09-13.md).

Implemented the high-priority findings from the [reuse audit](REUSE-AUDIT-2026-09-13.md): shared Git execution, fewer metadata queries, direct reuse of mutation results, library SSE parsing and shared asynchronous UI reads. The user requested simple, understandable code; the implementation adds one small dependency and two focused helpers.

Production source decreased from 9,068 to 8,997 physical lines, a net reduction of 71 lines including the new helpers. These counts exclude tests, documentation and dependency code. More importantly, the repeated behavior now has one implementation and explicit callers. Changes remain in the working tree after checkpoint `9c04abb`.

## What changed

| Area            | Implementation                                                                                                                                   | Preserved behavior                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git execution   | [GitProcess](../src/git/process.ts) also serves repository inspection; the separate inspection runner was removed                                | Inspection-specific environment stripping, 8-second timeout and 1 MiB bound; ordinary Git keeps native auth/config, bounds, process-tree cleanup and sanitized errors |
| Git state       | [GitService](../src/git/service.ts) resolves the administrative directory once for the initial metadata reads; staged-path membership uses a Set | Native worktree layout, ownership and contents exclusion, reviewed versions, final HEAD and freshly resolved index verification                                       |
| Git UI          | [GitPanel](../src/app/GitPanel.tsx) consumes returned `GitStatus`; history reads no longer trigger a redundant status fetch                      | Explicit refresh, refresh after failed commands, mutation/close locks and conflict drafts                                                                             |
| Local HTTP      | [readJson](../src/host/http.ts) is shared by OpenCode and rclone                                                                                 | Streaming UTF-8 bytes, bounded buffering and reader cleanup; authentication and service-specific errors stay with the caller                                          |
| OpenCode events | [OpenCodeServer](../src/agents/opencode.ts) uses `eventsource-parser` 4.1.0                                                                      | Subscription readiness before prompting, JSON decoding, 8 Mi-character parser buffer limit, abort/disconnect behavior and session filtering                           |
| UI reads        | [useResource](../src/app/useResource.ts) serves Connections, registration inspection and lazy explorer descendants                               | Disabled reads, debounce, polling after completion, errors and rejection of late results from previous resources                                                      |

The SSE parser is the only new direct dependency and has no runtime dependencies of its own. The lockfile retains the older parser copies required by existing dependencies. TanStack Query, Simple Git and ACP were not needed for this implementation slice.

## Keeping the read helper small

`useResource(load, dependencies, options)` is for reads only. Dependencies identify the request; its result is displayed only for that request. Cleanup prevents an old request from publishing data or scheduling another poll. Polling waits until the current read settles. The helper returns only `data`, `error` and `loading`.

The helper does not retry writes, execute mutations, transport cancellation to native processes or create a global cache. Editing buffers, conflict resolutions and permission state remain explicit component state. Root explorer listings retain their existing shared, independently completing per-scope reads.

Connections uses the helper for setup, account/connection polling, drives and folders. Changing account clears the old selection and invalidates old reads. Registration keeps its 250 ms inspection debounce. Explorer descendants remain lazy and reload with the existing revision signal.

## Measured Git effect

Five interleaved baseline/current samples in the same Linux environment, using a tiny disposable repository and a local bare upstream. Preparation and renderer work are excluded. [Recorded samples and source fingerprints](measurements/2026-09-13-simplification.json)

| Host operation | Git processes before | After | Median before | Median after |
| -------------- | -------------------: | ----: | ------------: | -----------: |
| Status         |                   23 |    16 |     103.83 ms |     69.61 ms |
| Diff           |                   46 |    32 |     222.09 ms |    160.87 ms |
| Stage          |                   92 |    64 |     414.00 ms |    298.36 ms |

The earlier audit prototype used 15/30/60 processes. Production deliberately retains a fresh administrative-directory resolution for the final index check, so replacing a `.git` pointer cannot conceal an index change. Do not remove that check just to match the prototype counts. Successful UI mutations additionally avoid their former explicit status request; this table does not measure a complete UI interaction or watcher activity.

Process counts are reproducible for this fixture. Timings are indicative and do not establish large-repository or native-platform performance. The local reproduction script and pre-change source copy are ignored under `.local/`.

## Verification

- `npm run build`: passed; the existing large editor bundle warning remains.
- `npm test`: 46 passed, 0 failed; four opt-in native controls skipped.
- `xvfb-run -a npm run test:ui`: all five scripts passed.
- New stream regressions cover byte-fragmented Japanese, LF/CRLF/CR, comments, empty events, multiline JSON, malformed JSON and oversized-response cancellation.
- A linked-worktree regression checks its independent index and operation markers, and verifies that unstaging preserves working bytes without changing the original checkout.
- The cloud UI fixture holds an old account's folder response until the user has switched accounts and drives; the late result does not replace the current folder list.
- Existing Git tests continue to exercise stale reviews, partial staging, ownership, native hooks, merge recovery and exact-branch sharing against local remotes.

Detailed build/test/UI logs are ignored under `test-results/simplification-*.log`. No paid model turns or real cloud operations were used. Windows/macOS and live GitHub/native-provider acceptance remain separate from these checks.

## Subsequent architectural decision

The ACP trial and remaining audit items are now resolved in the [completion ledger](REUSE-COMPLETION-2026-09-13.md). The final implementation uses the matching OpenCode HTTP SDK and shared native JSONL, retaining existing provider capabilities. Rich diff/tree replacements were evaluated and rejected for the current feature set; they would introduce additional features and integration code.
