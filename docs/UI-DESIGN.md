# UI direction

## v5 — brains, your AI and each brain's AI (2026-09-25)

The owner approved the v5 design and switched irori to it entirely; see
[ADR 014](decisions/014-ui-v5.md) for the decisions. The owner's private design
canvas (English and 日本語 pages, 13 artboards each) is the visual reference.
Everything below this section is the history of the earlier layout.

- **Levels.** Overview (the workspace's brains) → Brain (one brain's Schema,
  Knowledge and Contents, its home, changes, graph and records) → Note.
- **Shell.** A 64 px rail on the graphite backdrop holds the irori mark (back to
  the workspace choice), the Overview entry, the workspace's brains in their
  order as 40 px tiles, adding a brain, search and settings. Islands sit on the
  backdrop with 8 px gaps and a 14 px radius: the brain panel (280 px), the
  paper stage and the brain's AI panel (352 px), all resizable and remembered on
  the device. A 28 px status bar carries the workspace, the current brain, its
  branch, Drive uploads, the AI summary across brains, the terminal toggle and
  the version.
- **Overview.** The rail's map button shows every brain of the workspace
  instead of one brain's islands, which stay mounted underneath. **地図** lays
  brains out in rows by category (`src/domain/overview.ts`, replaceable) with
  reference lines between brains and a **Brain の AI** island (state, request,
  stop, resume, send); **並列** shows AI / Schema / Knowledge / Contents per
  brain. Each brain's AI runs independently of the one on show.
- **Tokens.** `src/app/tokens.css` holds the three themes (hearth, light, dark)
  with the canvas's exact values: chrome (`--bg --panel --raised --raised-2
  --field --hair* --tx*`), stage (`--stage* --card --rule* --ink*`), the AI's
  ember (`--ember* --on-ember`), layer colours (`--schema --know --cont` and
  their `-ink` forms) and the eight brain colours (`--t-*`). The names used
  before v5 remain as aliases for components not yet restyled.
- **Type.** Geist and Geist Mono are bundled as variable woff2 files; Japanese
  uses Noto Sans JP when installed and the system Japanese font otherwise. The
  reader's Markdown font setting still applies to notes.
- **Colour roles.** Ember is only for the AI: sparkles, running and waiting
  states, send and allow. Other primary actions are solid (paper on graphite,
  ink on paper). Layers are told apart by icon colour only.
- **Motion.** Hover and press 140 ms, tabs and chips 200 ms, panels and sheets
  320 ms on `cubic-bezier(.2,.8,.2,1)`; ambient loops (the running ring, the
  waiting halo, glows) stop under reduced motion.

## Before v5

### UI direction — 2026-09-13

Palette update, 2026-09-15: the colours below are still the product's direction,
but they are no longer written into the stylesheet. Every colour now resolves
through a semantic token, and a second designed palette follows the operating
system theme — see [ADR 003](decisions/003-ui-foundation.md) for the roles and
[ADR 004](decisions/004-ui-library-adoption.md) for the editor chrome that follows
them. Read the token block in `src/app/style.css` for current values, and
[UI findings](UI-FINDINGS-2026-09-15.md) for what is still open.

The [0.1.4 daily-workflow follow-up](DAILY-WORKFLOW.md) supersedes the earlier
assistant and Git sheet layout. It retains the palette and typography while
moving session/CLI diagnostics into an optional menu, placing reference chips
and agent selection by the composer, and introducing a nonmodal source-control
sidebar. Final Electron screenshots were inspected for both the assistant and
source control beside a document. Completed request notices use compact text;
the editable document remains mounted while reviewing a Git diff.

Ontology follow-up: retain the existing Paper/Ink/Ember palette and typography, with a wide native dialog for optional graph exploration. Parent links use solid ember lines; general relations use dashed gray arrows. Group and descendant filters, visible totals, zoom/fit controls and a semantic entity/note table provide multiple ways to navigate. CSV editing stays in the existing source editor with a separate paginated table projection. The actual Electron screenshot (`test-results/irori-ontology.png`, ignored) was inspected: labels, filter controls, selected-node note action and entity table are legible; longer tables scroll. The dialog restores focus, and the UI test verifies graph/table/note and agent-request paths. No generated image or custom canvas engine is used.

Workspace follow-up: applied the local frontend-design skill to the independent Drive section. Retain Graphite `#25282c`, Raised graphite `#303439`, Paper `#fafaf8`, Ink `#22292e`, Ember `#c88435` and Noto Sans JP/system typography. Keep left alignment, existing tree controls and a quiet document column; add a bounded full-width Drive section beneath the layer explorer rather than another modal navigation system. Category selection moves into optional display settings. The real Electron screenshot was reviewed at desktop size: both attachment names/statuses and the active note remain visible. [WORKSPACE-DRIVE](WORKSPACE-DRIVE.md) records behavior and regression evidence. No image assets or original five-pane reference were modified.

### Skills researched and used

- Anthropic [frontend-design](https://github.com/anthropics/skills/tree/34040c9c568585f6929bedeaad110ad08f079624/skills/frontend-design): selected for deliberate product-specific visual direction, typography, content and screenshot critique. Installed locally at that revision.
- Vercel [web-design-guidelines](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills/web-design-guidelines): selected for an implementation review of `src/app`, especially focus, naming, image dimensions, long content, scrolling and motion. Installed locally at that revision; current [review rules](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) were read before review.
- [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) was also considered. Its broader design-generation workflow was not needed for this focused pass on an existing desktop editor.

These are development aids installed in the agent's local skills directory, not runtime dependencies or instructions imposed on users' KBs.

### Plan and critique before implementation

irori is a writing workspace joining independent repositories and cloud materials. Preserve the user's three-row/five-pane map and the chosen folded-paper/flame icon. The memorable element is the paired personal/team navigation, with a quiet document surface beside it.

| Token           | Value     | Purpose                                             |
| --------------- | --------- | --------------------------------------------------- |
| Graphite        | `#25282c` | Navigation background, echoes the icon's black tile |
| Raised graphite | `#303439` | Selected workspace and navigation interaction       |
| Paper           | `#fafaf8` | Quiet writing surface                               |
| Ink             | `#22292e` | Text on light surfaces                              |
| Ember           | `#c88435` | Restrained flame-derived accents and active markers |
| Rule            | `#dfe3e5` | Light-surface structure                             |

Typography: use locally available Noto Sans JP with system fallbacks for Japanese UI and documents; a compact scale of 12/13/14/16/24/32 px. Use readable secondary text, tabular numbers only where useful, and comfortable document line-height. No downloaded font or decorative display face is required for writing work.

Layout: left-aligned compact navigation, a broad readable document column, and an optional right assistant sheet. Startup uses a narrow graphite introduction beside saved workspaces and repository selection.

```text
┌─────────────────────┬────────────────────────┬───────────────┐
│ irori / workspace   │ scope › selected note  │ assistant     │
│ Schema              ├────────────────────────┤ provider      │
├──────────┬──────────┤ document / source      │ conversation  │
│ Personal │ Teams    │                        │               │
│ notes    │ notes    │       document         │               │
├──────────┼──────────┤                        │               │
│ Personal │ Teams    │                        │ prompt        │
│ sources  │ sources  │ save state             │               │
└──────────┴──────────┴────────────────────────┴───────────────┘
```

Critique: a dark panel with an arbitrary neon accent would be generic. Use the supplied icon's restrained amber instead, preserve a light writing area, and spend visual contrast on repository ownership and the selected note. Remove redundant nested card borders and all-caps captions; keep borders where they separate the five functional panes. Use a small consistent set of decorative SVG interface icons, visible keyboard focus and reduced-motion handling. Preserve actual states and permission wording rather than inventing activity statistics or fake cloud connectivity.

### Implemented result and screenshot critique

The app now uses the graphite navigation and paper document tokens. Startup, workspace switching, five-pane headings, file selection, document/source controls, cloud forms and the assistant share the same typography and focus rules. The supplied PNG remains byte-identical. Decorative SVGs no longer pollute accessible button names. The welcome view provides a note-creation action; assistant suggestions fill and focus the composer and require the existing explicit run action to execute.

Screenshots of the real Electron renderer were inspected for startup, the five panes, document/assistant and cloud forms. This caught a squeezed provider selector and a form-selector specificity conflict; both were corrected. The assistant's provider name now gets a minimum usable width, with repository context on its own row. The reference's ownership geometry remains intact. Thin separators replace nested scope cards; amber marks only active ownership and key interactions.

### Guidelines review (`src/app`)

Resolved in this pass:

- `src/app/Icon.tsx`: decorative icons are hidden from assistive technology; existing icon-only actions retain explicit names.
- `src/app/Startup.tsx`, `src/app/main.tsx`: brand images have explicit dimensions; the main editor has a keyboard skip target.
- `src/app/style.css`: visible focus, readable secondary colors, long-name truncation, modal/pane scroll containment, explicit transition properties and reduced-motion handling.
- `src/app/style.css`: the provider selector retains readable width; radio controls keep their native size and whole-label hit area.

Existing follow-ups outside this visual pass (not a claim of complete accessibility conformance):

- `src/app/Startup.tsx:52`, `src/app/main.tsx:829`, `src/app/Connections.tsx:150`: dialogs still need unified focus trapping/return, Escape handling and consistent semantics across forms.
- `src/app/LayerExplorer.tsx:58`: directory reads are lazy/bounded, but large expanded trees still need measured virtualization and keyboard tree navigation.
- `src/app/style.css`: startup adapts to narrow viewports; the five-pane editor remains a desktop interface with horizontal overflow on very small screens.

### Verification

- `npm run build`: passed; existing dependency annotation and bundle-size warnings remain.
- `npm test`: 30 passed, 0 failed, four opt-in native probes skipped.
- `xvfb-run -a npm run test:ui`: all four scripts passed after the final style corrections; no renderer page errors reported. Includes editing/saving, cloud management fixtures, harness protocol fixtures, ownership/dirty-switch protection and suggestion fill/focus without a run.
- `git diff --check` and formatting checks: passed.
- Ignored screenshot evidence: `test-results/irori-startup.png`, `irori-layered-explorer.png`, `irori-cloud-connections.png` and `irori-modern-vm.png`.

The live VM viewer was rebuilt/restarted with existing sample notes retained. No model inference, Google authentication or actual cloud mounting was performed for this UI change. No deployment or release is implied.
