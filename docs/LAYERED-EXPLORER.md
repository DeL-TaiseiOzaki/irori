# Layered explorer

Implemented 2026-09-13, following the user's original LayeredKB UI reference (`LayeredKB-vscode-extention/images/image2.png`). The reference repository and image are not modified.

The workspace's left navigation now has three rows and five panes:

| Position | Pane | Contents |
| --- | --- | --- |
| Top, full width | SCHEMA LAYER | Each selected repository's agent instructions and configuration, grouped by its owning space |
| Middle, left | MY KNOWLEDGE BASE | Personal spaces' notes and local files |
| Middle, right | TEAM KNOWLEDGE BASES | Separate team and organization spaces; organization badges remain visible |
| Bottom, left | MY CONTENTS | Personal spaces' declared contents roots and cloud aliases |
| Bottom, right | TEAM CONTENTS | Team and organization spaces' declared contents roots and cloud aliases |

Each pane scrolls independently and can collapse. Scope groups and directories also collapse. The current document is highlighted by both scope ID and path. Root listings are fetched once per space and shared by its panes; descendants load when expanded. The host's existing layer classification and ownership checks remain authoritative. A nested contents root, including one beneath `schema`, appears only in the contents pane. No recursive mount scan or physical repository reorganization is introduced.

Schema groups preserve per-repository ownership; the displayed instructions are not concatenated, copied or hoisted into a shared native configuration. Selecting a note changes the editor and agent context to its owning space. Unsaved work and running agents retain their existing switching guards. A failed read does not change the active space while leaving another space's document displayed.

Each KB group has a note creation action; each contents group has an account/connection action targeting that space. User-defined cloud aliases and disconnected states remain visible without a mounted filesystem. Existing rich/source editing, conflict handling, session controls and the four native harness adapters remain available. At narrower desktop widths the AI panel overlays the right side to keep its controls accessible.

Verification: build and behavior tests pass; `npm run test:ui` now includes `scripts/layers-ui-smoke.ts`. Its disposable four-space fixture checks five-pane placement, schema isolation, nested contents precedence, same-name note ownership, dirty-switch protection, actual file preservation, agent context, cloud-action targeting and pane collapse. The existing editor, cloud and harness smoke scripts also pass. Screenshots and raw evidence remain in ignored `test-results/`; these UI checks do not perform model inference or mount a real Google Drive.

Final checks for this change: 30 behavior tests passed and four opt-in native control probes were skipped; all four UI scripts passed, including the narrower-window AI panel check. The Linux VM preview was normally closed to flush drafts and restarted on loopback port 6080. Browser login and the new layout in the saved sample workspace were inspected successfully. The regenerated password remains device-local in `.local/vm-preview/password`.
