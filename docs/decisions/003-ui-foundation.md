# ADR 003 — UI foundation on design tokens and third-party primitives

Date: 2026-09-15. Status: accepted for the renderer's foundation; no product behaviour change.

## Context

The renderer had grown its own UI layer. `src/app/style.css` held 2,034 lines with
eight CSS variables and more than sixty literal colours, so a palette change meant
tracking every screen by hand and no second theme was possible. Icons were
hand-written SVG path data, the assistant settings popover was a `<details>`
element with its own Escape and focus-restoration handlers, pane widths were four
hard-coded `grid-template-columns` variants plus an overlay fallback, and the three
embedded surfaces — Crepe, CodeMirror and xterm — each carried a separate palette
that the application could not reach.

## Decision

Keep the products' own design language and behaviour; replace the machinery under it.

1. **Semantic tokens.** Every colour resolves through a role (`--surface-sunken`,
   `--nav-text`, `--ember-ink`, `--danger-wash`, …) defined once in `:root`. No
   literal colour remains outside the token block.
2. **A real dark palette.** `@media (prefers-color-scheme: dark)` redefines the
   same roles as a second designed set, guarded by `:root:not([data-theme='light'])`
   so an explicit choice can win later. The sidebar stays darker than the note in
   both themes, so hierarchy survives the switch. `color-scheme` follows, which
   also settles native controls and scrollbars.
3. **Embedded surfaces follow the tokens.** All seventeen Crepe colour variables
   are mapped onto tokens instead of the shipped `frame` greys. CodeMirror gets one
   `EditorView.theme` and one `HighlightStyle` whose values are `var(--token)`, so
   the source view repaints with the theme and needs no JavaScript switch. xterm
   paints on a canvas and cannot read CSS variables, so `TerminalPanel` resolves the
   tokens once and reapplies them on `prefers-color-scheme` changes.
4. **lucide-react for icons.** `Icon` keeps its role-named API (`name="branch"`);
   the drawings now come from the library, so a new icon is a named import.
5. **react-resizable-panels for layout.** The sidebar, workspace and assistant
   panes, and the terminal split, are resizable and remember the size the user
   chose. The grid variants and the narrow-window overlay are gone.
   Corrected 2026-09-16: as first written, that memory did not work. The layout
   went to browser storage, which a file URL does not keep between sessions, and
   the group was given a fixed list of panel identifiers, so a layout saved for
   the panes on screen was looked for under the name of a different set. Sizes
   now live in the device record and the identifiers describe what is rendered.
6. **Base UI for popup behaviour.** The assistant settings popover and the
   source-control overflow menu are Base UI `Popover` and `Menu`. Anchoring,
   outside dismissal, Escape and focus restoration are no longer hand-written. The
   Git menu portals into the source-control aside rather than the document body so
   it stays inside the panel it acts on.

### Component library comparison

| Candidate            | What it gives                                                                      | Cost here                                                                                           | Outcome     |
| -------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------- |
| Base UI 1.8 (MIT)    | Unstyled, accessible behaviour for 40+ components as an npm package; tree-shakable | Keeps the existing CSS and the hearth palette; only behaviour is imported                           | **Adopted** |
| Radix Primitives     | The same behaviour layer, long-established                                         | Development has moved to Base UI, and irori has no Radix code to preserve                           | Not adopted |
| shadcn/ui + Tailwind | Polished defaults, fastest route to a generic modern look                          | Requires Tailwind and rewriting the whole stylesheet, and dilutes the product's own visual identity | Not adopted |

### Kept deliberately

The native `<dialog>` wrapper in `Dialog.tsx` stays: `showModal()` already provides
the top layer, focus trapping and Escape, and it is the platform primitive rather
than a hand-rolled one. Milkdown/ProseMirror stays as the editor engine; the
Markdown round-trip work in `src/editor/preservation.ts` — literal blocks, block
preservation, encoding and search position mapping — is the reason to stay on a
Markdown-first engine rather than a block-model one.

## Verification

Production build and typecheck pass. 132 behaviour tests run with 125 passed and
seven environment-gated skips, and all twelve Electron UI suites pass under Xvfb
with real note editing, source control, terminal, search, ontology and update flows.

The source-control overflow entries are menu items now, so `git-ui-smoke` queries
them by the `menuitem` role and reopens the menu for the second entry, because a
menu closes on selection. The assertions themselves are unchanged.

## Follow-ups, not included here

Splitting the assistant panel into conversation and activity surfaces, showing
agent edits as a reviewable diff in the note, and a ⌘K command palette are product
behaviour changes and belong to their own work.
