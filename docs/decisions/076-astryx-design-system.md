# 076 — Astryx is irori's design system

Date: 2026-11-28. Status: owner request and decisions; the foundation is
implemented for 0.3.3, and the rest follows in stages. Revises the visual
system of [ADR 053](053-priority-and-colour-roles.md) (decision 1's flat chrome
without radius, and the hue of the focus role) and
[ADR 014](014-ui-v5.md) decision 7 (Geist). The levels, the roles of ADR 053
and every function stay as they are.

## Context

The owner asked to bring in the UI design of
[Astryx](https://github.com/meta/astryx), Meta's open-source design system,
throughout irori, without changing irori's functions much.

The survey (Astryx 0.7.17, 2026-11-28) found:

- **Packaging.** Astryx is MIT licensed and in beta (0.x), with a breaking
  minor release every three to five weeks. Its React 19 components are written
  in StyleX and shipped as static CSS (`astryx.css`, about 311 KB, about 47 KB
  gzipped). A theme is a set of CSS custom properties.
- **Primitives and runtime.** Its overlays are its own, built on the native
  `popover`, `<dialog>` and CSS anchor positioning; Base UI is not used. It
  inserts a few `<style>` elements at run time, which irori's renderer CSP
  allows (`style-src 'self' 'unsafe-inline'`), and fetches nothing remote.
- **Theme and language.** The neutral theme bundles Figtree, which has Latin
  letters only, and names lucide icons. Its Japanese strings are about half
  translated.
- **What it lacks.** It has nothing for what an IDE's core needs: tabs that
  close and reorder, a tree with controlled expansion, dragging and renaming,
  a status bar, a terminal, or the editor.

## Decisions

1. **Astryx's tokens are irori's values.** The roles of ADR 053 stay, and each
   role in `src/app/tokens.css` names an Astryx token instead of holding a
   colour of its own. `scripts/astryx-tokens.ts` writes
   `src/app/astryx-tokens.css` from the installed `@astryxdesign/core` and
   `@astryxdesign/theme-neutral`. That file holds core's tokens with the
   neutral theme's values, plus both sides of each `light-dark()` colour as
   `--light-…` and `--dark-…`. `tests/astryx-tokens.test.ts` keeps the file
   equal to what the installed packages give. The theme's own stylesheet is
   not imported: its scope styles every heading and paragraph, which would
   override the note's type. irori's brand ember is the one value Astryx does
   not give.
2. **The type is Figtree** (owner, 2026-11-28), from the neutral theme's own
   `fonts.css`. Japanese falls to Noto Sans JP or the system's Japanese face.
   Code and the terminal keep the bundled Geist Mono, because the neutral
   theme's `ui-monospace` is not available on Linux or Windows. The window's
   text stays at 13 px, now set on the body. The root keeps the browser's
   16 px, since Astryx gives its spacing, radii and type in rem.
3. **Hearth stays** (owner, 2026-11-28). In Hearth the chrome takes Astryx's
   dark side and the paper stage its light side. Light is Astryx's light theme
   throughout. Dark is Astryx's dark theme throughout, with the stage on its
   lighter surface. The window controls (`windowChrome`) take Astryx's body
   and secondary text.
4. **Astryx's shapes** (owner, 2026-11-28).
   - Controls and rows take `--radius-element`.
   - Menus, popovers, dialogs and cards take `--radius-container`.
   - Small marks take `--radius-inner`.
   - The agent's instruction box and the person's messages take Astryx's chat
     geometry (`--radius-chat`, and the compact bubble's container radius).
   - The stage is Astryx's elevated surface: its corners are rounded off the
     chrome, and the hairlines beside it give way to its edge. They show only
     as the focus colour when a handle is reached.
5. **Focus is Astryx's ring** (owner, 2026-11-28). The focus role is Astryx's
   accent, which in the neutral theme has no hue: ink on paper, paper on
   graphite. `--focus` is resolved where it is drawn, so a ring takes the side
   of the surface it is on. A chosen option and the column being edited take
   the same accent, with `--color-accent-muted` as their fill.
6. **Vault colours are Astryx's hues** under their existing names:
   - 石 Stone → gray
   - 藍 Indigo → blue
   - 苔 Moss → green
   - 青磁 Celadon → teal
   - 藤 Wisteria → purple
   - 桜 Sakura → pink
   - 砂 Sand → yellow
   - 白 White → the light surface

   Orange stays out of the set, since it is the brand. Layers keep their
   identity: Schema is Astryx's purple text and Contents its teal.

### Later stages

7. **Astryx's components replace irori's own where Astryx does the same
   thing**: buttons, icon buttons, switches, checkboxes, text fields,
   segmented controls, badges, keys, spinners and empty states.
8. **Overlays move together.** Astryx's overlays sit in the top layer, so
   menus, context menus, popovers, dialogs and the settings sheet move from
   Base UI to Astryx in one stage, never mixed in one overlay stack. The search
   (⌘K) becomes Astryx's command palette. Base UI goes when nothing uses it.
9. **irori keeps its own IDE parts**, drawn after Astryx's anatomy with its
   tokens: the tree (after `TreeList`), the tabs, the rail (after `SideNav`),
   the status bar, the terminal, the editor, the session board and the
   Overview map.
10. **Astryx is pinned exactly.** A newer Astryx comes in on purpose:
    `astryx upgrade` for its codemods, then `tsx scripts/astryx-tokens.ts`.
    `astryx init` is not run, because it writes `AGENTS.md` and `CLAUDE.md`.

## Stages

| Stage | What changes                                                                                                |
| ----- | ----------------------------------------------------------------------------------------------------------- |
| 1     | Tokens, Figtree, radii, the elevated stage, the focus ring (0.3.3)                                          |
| 2     | Buttons and icon buttons become Astryx's (0.3.4)                                                            |
| 2b    | Switches, checkboxes, text fields, segmented controls, badges, keys, spinners and empty states (decision 7) |
| 3     | Overlays, the settings sheet and ⌘K move to Astryx; Base UI leaves (decision 8)                             |
| 4     | irori's own parts redrawn after Astryx's anatomy (decision 9); the website                                  |

Each stage is its own pull request, released and checked on its own. UI smokes
that select by the old structure are rewritten for the new one without
weakening what they prove.

## Stage 2: buttons (0.3.4)

1. **The adapters** in `src/app/controls.tsx` are how irori uses Astryx's
   `Button`.
   - `Button` shows its `label` (or `children` beside it, such as a count)
     and is named by the label.
   - `IconButton` shows only its icon. Its label is its name and, unless a
     `title` is given, its hint.
   - Both keep irori's habits: `disabled`, a native `title` (ADR 004), and
     any attribute a Base UI trigger hands its button, so
     `Menu.Trigger render={<IconButton …/>}` works.
   - The default size is Astryx's small (28 px), since the window is dense.
2. **The old families map onto Astryx variants.**

   | irori class                                  | Astryx variant |
   | -------------------------------------------- | -------------- |
   | `icon-button`, `stage-button`                | ghost          |
   | `primary`, `primary-button`, `solid-button`  | primary        |
   | `panel-button`, a framed `stage-text-button` | secondary      |
   | `stage-text-button`                          | ghost          |

   Their CSS is gone. A rule that only placed one of them (a commit button's
   full width) now names `.astryx-button`.

3. **Cascade layers.** `src/app/layers.css` orders the layers as
   `irori-defaults, reset, astryx-base, astryx-theme`. irori's element
   defaults (`:where(button)`, `:where(input)`, …) sit in `irori-defaults`,
   under Astryx's components. irori's component rules stay unlayered.
4. **Rules for irori's own buttons leave Astryx's alone.** A rule that styles
   the buttons inside one of irori's parts (`.rail button`, …) selects
   `button:not(:where(.astryx-button))`. This keeps its specificity, and
   Astryx's buttons placed there keep their own look.
5. **Three states Astryx has no part for** are drawn with its tokens in
   `shell.css`.
   - A `danger` button takes its error text.
   - A pressed toggle takes its pressed overlay.
   - A file input's face (`.file-button`) takes the look of its secondary
     button.
6. **The loading live region is hidden.** Each Astryx button carries a polite
   live region for its loading state. irori never shows that state, so the
   region is hidden (`display: none`) and the notices irori announces stay
   the window's only status regions.
7. **What changes in behaviour.**
   - Astryx marks a disabled button `aria-disabled` and swallows its clicks,
     instead of setting `disabled`.
   - An icon button with no hint before now shows its name as one.
   - Astryx's `Button` defaults to `type="button"`, so every button that
     submitted a form says `type="submit"`.

## Stage 2b: the other controls (0.3.6)

1. **Checkboxes and switches are Astryx's** (`CheckboxInput`, `Switch`). Each
   is named by the words that named it before, so the smokes find it.
   - The settings rows keep their visible title, which names the switch
     through `aria-labelledby`, and a press on it still turns the switch.
   - The restore list's checkboxes take what was the second half of their
     name ("On this device", the repository) as their description.
   - Left as they were: the vault chips at the start, and the person's-lines
     chip in the instruction box. Both are irori's own parts (stage 4).
2. **Segmented choices are Astryx's segmented control.**
   - `Segmented` in `controls.tsx` replaces the ObsidianUI Magnet Tabs (and
     its `motion` dependency) in seven places: the vault's Files | Changes,
     Git's Changes | History, irori mode's layout and agents, the routine
     editor's Form | YAML, and how a repository is added.
   - It is a radio group: one tab stop, and an arrow key moves both the
     focus and the choice. Base UI's toggle group moved the focus only. The
     smokes now check the radio contract.
   - A count that sat in a badge beside a choice is part of its words
     ("変更 1").
3. **Keys, counts, running marks and empty pages are Astryx's.**
   - Shortcut hints are `Kbd` (`mod+k` shows ⌘ or Ctrl by system).
   - The vault home's and the session board's counts are a neutral `Badge`.
   - The running marks of routines, agents, hosts and the irori agent are
     `Spinner`. These are `aria-hidden`, since the words beside them say the
     state.
   - Four empty pages are `EmptyState`: Git not set up, no Git repository,
     no ontology, and no vault in the workspace.
4. **Fields keep irori's markup and take Astryx's look.** Astryx's
   `TextInput` is a whole field, with its own label and status. irori's 69
   inputs, 9 text areas and 19 selects sit in their own labels and layouts.
   They now draw Astryx's input in the `irori-defaults` layer, with its
   tokens:
   - the emphasized border on the surface;
   - the accent border and muted ring while written in;
   - a faint ring under the pointer;
   - half opacity when disabled;
   - the `md` element height.

   irori's own special fields keep their rules: the instruction box, search
   and inline rename.

## Consequences

- ADR 053 decision 1's "no island radius, gap or shadow" no longer holds for
  the stage, and the rectilinear 6–10 px radii of 0.3.0 give way to Astryx's
  scale. The roles of decision 2 hold, now with Astryx's values: a normal
  outcome still takes no colour.
- The focus role has no hue, so a chosen option or a drop target is told by
  the accent, its muted fill and the ring.
- Stage 1 ships only the neutral theme's `fonts.css` with Figtree's woff2
  files, so `@astryxdesign/theme-neutral` is its one runtime dependency;
  `@astryxdesign/core` is a development dependency that the token script reads.
  Stage 2 makes core and its peer `@stylexjs/stylex` runtime dependencies when
  Astryx's component CSS and JavaScript are first bundled (the package smoke
  requires every runtime dependency to be in the bundle's notices).
- The download website keeps the earlier palette until stage 4.
