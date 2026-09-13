# UI direction — 2026-09-13

Workspace follow-up: applied the local frontend-design skill to the independent Drive section. Retain Graphite `#25282c`, Raised graphite `#303439`, Paper `#fafaf8`, Ink `#22292e`, Ember `#c88435` and Noto Sans JP/system typography. Keep left alignment, existing tree controls and a quiet document column; add a bounded full-width Drive section beneath the layer explorer rather than another modal navigation system. Category selection moves into optional display settings. The real Electron screenshot was reviewed at desktop size: both attachment names/statuses and the active note remain visible. [WORKSPACE-DRIVE](WORKSPACE-DRIVE.md) records behavior and regression evidence. No image assets or original five-pane reference were modified.

## Skills researched and used

- Anthropic [frontend-design](https://github.com/anthropics/skills/tree/34040c9c568585f6929bedeaad110ad08f079624/skills/frontend-design): selected for deliberate product-specific visual direction, typography, content and screenshot critique. Installed locally at that revision.
- Vercel [web-design-guidelines](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills/web-design-guidelines): selected for an implementation review of `src/app`, especially focus, naming, image dimensions, long content, scrolling and motion. Installed locally at that revision; current [review rules](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) were read before review.
- [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) was also considered. Its broader design-generation workflow was not needed for this focused pass on an existing desktop editor.

These are development aids installed in the agent's local skills directory, not runtime dependencies or instructions imposed on users' KBs.

## Plan and critique before implementation

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

## Implemented result and screenshot critique

The app now uses the graphite navigation and paper document tokens. Startup, workspace switching, five-pane headings, file selection, document/source controls, cloud forms and the assistant share the same typography and focus rules. The supplied PNG remains byte-identical. Decorative SVGs no longer pollute accessible button names. The welcome view provides a note-creation action; assistant suggestions fill and focus the composer and require the existing explicit run action to execute.

Screenshots of the real Electron renderer were inspected for startup, the five panes, document/assistant and cloud forms. This caught a squeezed provider selector and a form-selector specificity conflict; both were corrected. The assistant's provider name now gets a minimum usable width, with repository context on its own row. The reference's ownership geometry remains intact. Thin separators replace nested scope cards; amber marks only active ownership and key interactions.

## Guidelines review (`src/app`)

Resolved in this pass:

- `src/app/Icon.tsx`: decorative icons are hidden from assistive technology; existing icon-only actions retain explicit names.
- `src/app/Startup.tsx`, `src/app/main.tsx`: brand images have explicit dimensions; the main editor has a keyboard skip target.
- `src/app/style.css`: visible focus, readable secondary colors, long-name truncation, modal/pane scroll containment, explicit transition properties and reduced-motion handling.
- `src/app/style.css`: the provider selector retains readable width; radio controls keep their native size and whole-label hit area.

Existing follow-ups outside this visual pass (not a claim of complete accessibility conformance):

- `src/app/Startup.tsx:52`, `src/app/main.tsx:829`, `src/app/Connections.tsx:150`: dialogs still need unified focus trapping/return, Escape handling and consistent semantics across forms.
- `src/app/LayerExplorer.tsx:58`: directory reads are lazy/bounded, but large expanded trees still need measured virtualization and keyboard tree navigation.
- `src/app/style.css`: startup adapts to narrow viewports; the five-pane editor remains a desktop interface with horizontal overflow on very small screens.

## Verification

- `npm run build`: passed; existing dependency annotation and bundle-size warnings remain.
- `npm test`: 30 passed, 0 failed, four opt-in native probes skipped.
- `xvfb-run -a npm run test:ui`: all four scripts passed after the final style corrections; no renderer page errors reported. Includes editing/saving, cloud management fixtures, harness protocol fixtures, ownership/dirty-switch protection and suggestion fill/focus without a run.
- `git diff --check` and formatting checks: passed.
- Ignored screenshot evidence: `test-results/irori-startup.png`, `irori-layered-explorer.png`, `irori-cloud-connections.png` and `irori-modern-vm.png`.

The live VM viewer was rebuilt/restarted with existing sample notes retained. No model inference, Google authentication or actual cloud mounting was performed for this UI change. No deployment or release is implied.
