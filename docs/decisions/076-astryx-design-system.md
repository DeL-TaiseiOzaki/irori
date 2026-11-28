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

| Stage | What changes                                                                    |
| ----- | ------------------------------------------------------------------------------- |
| 1     | Tokens, Figtree, radii, the elevated stage, the focus ring (0.3.3)              |
| 2     | Controls become Astryx components (decision 7)                                  |
| 3     | Overlays, the settings sheet and ⌘K move to Astryx; Base UI leaves (decision 8) |
| 4     | irori's own parts redrawn after Astryx's anatomy (decision 9); the website      |

Each stage is its own pull request, released and checked on its own. UI smokes
that select by the old structure are rewritten for the new one without
weakening what they prove.

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
