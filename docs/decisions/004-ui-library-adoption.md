# ADR 004 — Second pass on library adoption in the renderer

Date: 2026-09-15. Status: accepted. Follows [ADR 003](003-ui-foundation.md).

## Context

ADR 003 moved the renderer's foundation onto tokens, lucide, resizable panes and
Base UI. This pass looked for the remaining places where the application does by
hand — or leaves undone — work that a library it already ships would do better.

## Decisions

1. **Assistant replies render as Markdown.** Agent output was displayed as one
   plain `<span>`, so lists, headings, tables and code blocks arrived as raw
   characters. `react-markdown` with `remark-gfm` renders them as elements.
   It builds React nodes and never injects raw HTML, which is the property that
   matters for untrusted model output; two component overrides go further and keep
   a reply from reaching the network or navigating the application — a link shows
   its target instead of following it, and an image becomes its description.
   `tests/fixtures/harnesses.mjs` gained a Markdown reply so `harness-ui-smoke`
   asserts the structure rather than the characters.
2. **The editor's own chrome speaks Japanese.** Crepe ships English copy for the
   slash menu, the placeholder, the link tooltip and the code-block panel
   (`Please enter…`, `Paste link…`, `Text / Heading 1 / Bullet List`). All of it is
   configuration, so `featureConfigs` now carries the Japanese labels. The same
   configuration hands the code block the token-driven CodeMirror theme from
   ADR 003, so code inside a note follows the application theme like the source
   view does.
3. **Mode switches are Base UI toggle groups.** The source-control view switch,
   the workspace note/source-control switch and the registration-mode switch were
   sets of buttons each tracking `aria-pressed` by hand. `ToggleGroup` owns the
   pressed value and adds roving focus and arrow-key movement. The rendered
   element is still a button with `aria-pressed`, so existing styles and tests
   apply unchanged.
4. **A render failure is recoverable.** There was no error boundary: a throw during
   render left an empty window. `react-error-boundary` wraps the application root
   and offers the error plus a retry that remounts the tree.

## Considered and not adopted

| Candidate                                                            | Why not                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TanStack Query for reads                                             | `useResource` (43 lines) already serialises requests by identity, cancels on unmount, and supports polling, and every call site is a plain host read. Query would add a dependency and a provider without removing complexity at the call sites; the intricate async code is in `GitPanel`'s mutations, which Query does not address. Worth revisiting if cross-panel invalidation appears. |
| TanStack Virtual for the conversation and file lists                 | No measured cost yet. Virtualising adds code and breaks find-in-page and simple assertions; revisit with a real long session.                                                                                                                                                                                                                                                               |
| A tree component (react-arborist and similar) for the layer explorer | Its data model and DOM would replace a working scope-aware tree and every explorer test. The gain is keyboard tree semantics, which can be added to the existing rows.                                                                                                                                                                                                                      |
| Base UI Tooltip for `title` attributes                               | Native `title` is one attribute; the tooltip parts are five elements per usage. More code for a small gain.                                                                                                                                                                                                                                                                                 |
| Base UI Toast for notices                                            | The 33 status and alert regions are contextual and persistent by design. Turning them into transient toasts would lose messages the user needs to act on.                                                                                                                                                                                                                                   |
| A diff library (diff2html, react-diff-view)                          | Current rendering is a few lines of line classification. A library becomes worthwhile when the note surface gains its own review UI, which is separate work.                                                                                                                                                                                                                                |
| electron-updater                                                     | The product deliberately checks manually and opens the browser; adopting an auto-updater is a product decision, not a refactor.                                                                                                                                                                                                                                                             |

## Verification

Build and typecheck pass. 132 behaviour tests run with 125 passed and seven
environment-gated skips. All twelve Electron UI suites pass under Xvfb, including
the new Markdown assertions in `harness-ui-smoke`. The Japanese slash menu was
checked in the running application.

`git-ui-smoke` is timing-sensitive in this container: it failed twice on a five
second expectation while the diff loaded under load, and passed on its own and in
a quiet full chain both times. The behaviour is unrelated to these changes — the
diff effect restarts whenever a file event bumps its revision — but it is worth
knowing before reading a red chain as a regression.
