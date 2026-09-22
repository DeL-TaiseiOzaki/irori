# ADR 007 — ObsidianUI components in the desktop renderer

Date: 2026-09-22. Status: accepted for the first adoption.

## Context

The owner requested ObsidianUI in irori. Its [installation guide](https://www.obsidianui.dev/docs/installation)
starts with a new Next.js application, but its component pages also support
manual source installation. irori already has a React 19 / Vite renderer,
semantic light/dark tokens and Base UI controls ([ADR 003](003-ui-foundation.md),
[ADR 004](004-ui-library-adoption.md)). The selected components use browser React
and need no Next.js runtime.

## Decision

Copy and adapt two components into `src/app/obsidian/`, following the official
manual installation path. The source is owned and reviewed in irori after copying;
there is no ObsidianUI runtime package or connection to the documentation site.

- **Magnet Tabs** supplies a moving selection marker and a separate hover
  background. It serves the workspace note/source-control switch, Git's
  changes/history switch and the folder/clone registration switch. The upstream
  clickable list items become the existing Base UI toggle buttons, retaining
  roving keyboard focus, `aria-pressed`, native disabled states and each caller's
  save/busy guards. Each mounted group has a unique animation ID. Selection stays
  controlled by the caller, including when saving must finish before switching.
- **Arrow Fill Button** supplies the clipped fill and arrow transition on the
  registration submit, workspace submit and welcome-screen new-note actions.
  A native button preserves form submission and disabled behavior. Labels are
  strings; their decorative duplicate is hidden from assistive technology.

The visual plan keeps the note as the large quiet surface, with movement limited
to an action's response: compact, left-aligned view switches and a rounded primary
action. Existing tokens supply paper (`#fafaf8`), surface (`#ffffff`), ink
(`#22292e`), navigation (`#25282c`), muted text (`#626b75`) and ember (`#c88435`),
with their existing dark equivalents. The Noto Sans JP/system font stack and
pane layout stay consistent across the application. Components reference semantic
tokens, never these literal values.

Only `motion` 13.4.0 is added. Tailwind utility strings become component-scoped
CSS; the arrow button's class joining needs neither `clsx` nor `tailwind-merge`.
There is no Tailwind reset, shadcn initialization, MCP setup or framework migration.
Later source updates require reviewing the upstream changes against these local
adaptations; a registry installer must not overwrite them blindly.

Reduced motion uses static tab decorations and removes button transitions.
The tab group subscribes to the media query so changing the OS preference while
the app is open takes effect immediately; Motion 13.4's `useReducedMotion` hook
only snapshots the preference at mount. Decorations cannot receive pointer events.

Apple Spotlight is deferred: its source is a fixed-results demo, and a command
palette needs its own behavior and keyboard contract. Animated galleries, cursors
and backgrounds have no job in this note-editing surface.

## Source and license

Inspected on 2026-09-22:

- [Magnet Tabs documentation](https://www.obsidianui.dev/docs/magnet-tabs) and
  [registry source](https://www.obsidianui.dev/r/magnet-tabs.json).
- [Arrow Fill Button documentation](https://www.obsidianui.dev/docs/arrow-fill-button)
  and [registry source](https://www.obsidianui.dev/r/arrow-fill-button.json).
- [Official repository at 21d9198](https://gitlab.com/Atharvsinh-codez/ObsidianUI/-/tree/21d9198d14fd663f809cbea9fe124efc9576c003),
  files under `src/components/block/`.

The full MIT notice, copyright 2026 ObsidianUI, is retained in
[THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md), which the existing packager ships.
Motion and its dependencies retain their package licenses.

## Verification

The existing Electron suites exercise all adoption points. Focused additions to
`ui-smoke` and `git-ui-smoke` cover keyboard movement and activation, retaining a
selection when pressed again, disabled registration, unchanged form submission,
live reduced-motion changes, and rendered light/dark screens. Registration's
input sets native `autofocus` before `showModal()` so it receives initial focus;
React's early focus attempt on a closed dialog otherwise leaves Base UI's first
item focused before its index is assigned, consuming the first arrow press. The
application build, behavior tests and full renderer suites remain required.
