# UI findings, 2026-09-15

Things noticed while moving the renderer onto shared primitives
([ADR 003](decisions/003-ui-foundation.md), [ADR 004](decisions/004-ui-library-adoption.md))
that are not part of either change. Recorded so they are decided deliberately
rather than rediscovered.

## 1. Reads dropped by shared guards — fixed

`RepositoryPanel` guarded every read with one `reads` counter and skipped its
status read on conditions that were not dependencies, so three different reads
could be dropped with nothing left to complete them.

- **A commit diff discarded by the changes view.** The changes effect depends on
  `[selection, revision, tab]` and `main.tsx` bumps `revision` on every host
  `files` event, so the burst a commit or merge produces invalidated the patch
  `showCommit` had already requested; the history view then kept showing
  `差分を読み込み中…`. CI reproduced it in
  [run 34949816519](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34949816519).
  A commit diff now has its own `commitReads` counter.
- **A status read skipped while a merge draft was unsaved.** That read returns
  early when `conflictDirty` is true, but `conflictDirty` was not in its
  dependency list, so a read skipped for that reason never happened: after the
  draft was resolved the panel kept reporting the old unresolved count. This is
  the intermittent `未解決 0 件` failure in `git-ui-smoke`. `conflictDirty` is now
  a dependency, so resolving the draft runs the read that was skipped.
- **A dropped click with no trace.** `perform()` returned silently when another
  operation was active. The buttons are disabled from state while the guard is a
  ref, so a click inside that window did nothing and said nothing; it now leaves
  a notice.

A file event also used to blank the diff being read. The review refreshes in
place now: only a different file, side or view replaces what is on screen. The
read still reports itself through `aria-busy`, which the panel actions and
`git-ui-smoke` wait on — dropping that signal made the suite fail every run,
which is how the missing status dependency was finally isolated.

Verified with six `git-ui-smoke` runs and the full twelve-suite chain.

Follow-up, 2026-09-16: a refresh of the file already being read no longer
restarts that read. It waits and queues a single repeat, which re-runs the effect
so the choice between a diff and a conflict is made from the state that exists by
then. `git-ui-smoke` writes a burst of file events over an open diff and asserts
the view keeps its content and ends on the newest bytes.

## 2. Links in an assistant reply — fixed

A reply's links open in the user's browser through a new `openUrl` host route.
The address is validated twice: `src/domain/links.ts` is the request validator, so
an invalid address never leaves the renderer's IPC boundary, and the host parses
it again before calling `shell.openExternal` rather than trusting that it did.
Only `http` and `https` with a host are accepted — `file:`, `javascript:`,
`data:`, `mailto:` and application schemes are refused, as is anything over 2048
characters. react-markdown already neutralises a script URL before it reaches the
page, so a bad link fails twice over. `tests/links.test.ts` covers the validator
and the preload allowlist entry, and `harness-ui-smoke` asserts a reply's link
carries its real address, that a `javascript:` link does not, and that
`openUrl` rejects one.

Opening is still a deliberate act by the reader: the click is theirs, the target
is in the tooltip, and nothing opens on its own.

## 3. Choosing light or dark — fixed, and it was not working at all

The sidebar now carries an appearance menu with system, light and dark. Getting
there turned up two faults behind the original note.

- **The renderer keeps nothing.** It is loaded from a file URL, where browser
  storage is not kept between sessions. A choice stored there — and the pane
  sizes from ADR 003, which used the same storage — was gone on the next launch.
  Both now live in the host's device record (`device-settings.json`), read before
  the first render.
- **The pane group was asked for the wrong layout.** `useDefaultLayout` builds its
  storage key from the panel identifiers it is given, while the group writes under
  the identifiers actually rendered. Passing the full list including the assistant
  meant reading one name and writing another, so a size never came back even
  within a session. The identifiers now describe what is on screen.
- **`prefers-color-scheme` could not be driven.** Setting Electron's
  `nativeTheme.themeSource` does not reach the media query on this Linux
  environment: the host reported `shouldUseDarkColors`, and the renderer still
  answered light, so a reader following a dark desktop would have seen the light
  palette. The renderer therefore resolves the choice itself and writes
  `data-theme`, which the stylesheet keys off; the host still sets
  `themeSource`, which owns the window chrome and native dialogs.

`ui-smoke` chooses dark, checks it applies, returns to system, chooses dark again,
drags the sidebar wider, and asserts both the theme and the width after a restart.
`tests/settings.test.ts` covers defaults, merging, a damaged record and the
validator's bounds.

## 4. Formatting is not gated — fixed for code

`npm run format:check` (`prettier --check src scripts tests`) runs in CI before
the build, and the two code files that had drifted — `src/editor/preservation.ts`
and `tests/connections.test.ts` — are formatted. The gate covers code only.
Fifteen files in the tree are not Prettier-clean; the rest are Markdown records
whose line breaks carry the history of past work, so `prettier --check .` is
still expected to fail and reformatting them would be churn.

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
