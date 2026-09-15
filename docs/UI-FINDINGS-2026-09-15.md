# UI findings, 2026-09-15

Things noticed while moving the renderer onto shared primitives
([ADR 003](decisions/003-ui-foundation.md), [ADR 004](decisions/004-ui-library-adoption.md))
that are not part of either change. Recorded so they are decided deliberately
rather than rediscovered.

## 1. A file event restarts an in-flight diff read

`RepositoryPanel`'s review effect depends on `[selection, revision, tab]`, and
`main.tsx` bumps `revision` on every host `files` event. Opening a diff therefore
starts a read, and any file event — including the burst a merge or checkout
produces — increments `reads.current`, discards the response that is on its way
and starts another. While that repeats, the panel keeps showing
`差分を読み込み中…`.

This is why `git-ui-smoke` fails intermittently in the development container on a
five second diff expectation, and passes on its own. The test is not wrong: the
panel really has not produced the diff yet. CI has passed every run so far.

The fix is not simply a longer timeout. A read for an unchanged target should be
allowed to finish, with one refresh queued behind it, instead of being restarted
per event; and a refresh should keep the current diff visible rather than
clearing it. That deserves a reproduction test that emits a file-event burst
during a read, so it is left as its own change.

## 2. Links in an assistant reply are inert

`AgentMarkdown` renders a Markdown link as text with its target in the tooltip,
because there is no validated way to open a URL: `HostAPI` exposes
`openExternal(scopeId, path)` for files in a space and fixed help/update pages,
not arbitrary URLs from model output. Opening one would need a host route that
accepts `http`/`https` only, rejects everything else, and is reviewed as a
security boundary. Until then the target is visible but not clickable.

## 3. The dark palette follows the operating system only

The tokens support an explicit choice — every dark rule is guarded by
`:root:not([data-theme='light'])` — but nothing in the application sets
`data-theme`, so a user cannot pick light or dark independently of the OS, and
cannot keep irori light on a dark desktop. Adding it is a settings surface, not
a palette change.

## 4. Formatting is not gated

`npm run build`, `npm test` and `npm run test:ui` run in CI; Prettier does not.
On `main`, `src/editor/preservation.ts` and `tests/connections.test.ts` are not
Prettier-clean, so `npx prettier --check src scripts tests` fails on a tree with
no local changes. Either add a check step and format those two files, or drop the
expectation that the whole tree is formatted. Reformatting them as a side effect
of unrelated work is what the contributor contract asks us not to do.

## 5. `docs/UI-DESIGN.md` predates the token system

It presents the palette as literal hex values, which is no longer where colours
live, and it describes no second theme. Its layout and typography direction still
hold. A pointer to the ADRs was added rather than rewriting the design history.

## Not worth recording as issues

- `npm test` reports 132 tests with seven skips here and fewer skips in CI; the
  skips are the real-provider and rclone paths, which CI supplies.
- The panes have no reset-to-default action. The window's 980 px minimum width is
  wider than the three panes' minimums (260 + 360 + 280 plus separators), so no
  window size can squeeze them out.
