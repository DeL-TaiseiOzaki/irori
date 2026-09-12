# Acceptance matrix and implementation backlog

Date: 2026-09-12. The first note/agent slice is implemented; no phase or full release is implicitly marked complete. Product source: KB_design/docs/irori/{SPEC,BUILD-PLAN,DECISIONS,IMPLEMENTATION-HANDOFF}. Those documents describe the entire intended product.

| Requirement | Current evidence | Remaining acceptance work |
|---|---|---|
| R01 Windows/Mac installed app | Linux Electron executable/test build only | Native Windows + actual MacBook builds, supported OS/CPU matrix, signed/notarized installers and updates |
| R02 Lightweight, responsive | On-demand editor/SDK/CLI; local measurement published | Current Linux RSS exceeds proposed budget. Compare Tauri using the same workload, optimize, establish native latency/p95/total memory measurements |
| R03 Notion-like Markdown editing | Crepe rich text/table display/edit, source mode, no-op preservation, dirty conflicts | Native Japanese IME, slash/block movement/table UX fixtures, undo/redo, broad dialect preservation, search/backlinks/properties/rename |
| R04 Actual Claude Code and Codex | Both selectable in normal panel; real native-account note reads/edits; streaming, approvals, cancel | Codex real structured question/denial gates, restart-resume, expired login recovery, native skills/MCP parity, generic agents, supported-version failure UX |
| R05 Optional terminal, terminal-free ordinary flow | Note and both agent journeys need no shell entry | xterm.js + platform PTY, resize, Unicode, Ctrl-C and child cleanup on both OSes |
| R06 Personal + multiple teams + organization | Five-space isolation test, explicit categories, UUID scope identity, independent local bindings | Existing-checkout mapping preview/import, offline space UI, remove/rebind UI, repo clone onboarding, scale fixture |
| R07 GitHub + multiple Drive folders/shared drives | Per-space contents declarations; unverified contents is blocked | Git status/fetch/diff/history/commit/push using existing Git/helpers, conflict UI, selected-folder rclone onboarding, shared drives/accounts, independent Git/cloud recovery |
| R08 Per-space ontology/notes/artifacts | Notes and three-layer ownership foundation | Q01 ontology UX/schema remains open; preserve unknown CSV columns, stable entity IDs, ontology-note links, registered sources/outputs |
| R09 Versioned many-to-many lineage | Not implemented; do not infer evidence from model prose | Durable note/entity/artifact/run IDs, immutable version associations, exact source hashes/Git blobs, explicit snapshots of dirty sources, real PPTX recipe, cards and reverse links, manual/partial evidence labels |
| R10 Arbitrary formats | All entries navigable, bounded UTF-8 editor, explicit external-open confirmation | Contents-backed files after mount verification, image/PDF preview, provider-native Docs links, external-open native-platform test, collision handling |
| R11 LayeredKB model | Ownership before three-layer classification; nested roots excluded; contents overrides; aliases rejected; native rules kept per root | Folder identity validation, actual mount detection, reference resolution states, scoped note/artifact identity, explicit curation with source provenance |
| R12 Reuse | React/Electron/Crepe/CodeMirror/SDK/Chokidar/cross-spawn/tree-kill/Zod; upstream scenario credits | Git/rclone/xterm/PTY/file-generation library integration, distribution licensing and dependency inventory for installers |

## Sequenced work after this slice

1. Close agent and editor gates: obtain a real Codex user-input request and a real deny response; test resume failure, native rules/skills/MCP with fixture-only servers, GUI PATH on Windows/Mac, and Japanese IME. Add scope-bound persisted session handles and explicit reset/recovery.
2. Revisit desktop host with measured complete workflow; current Linux figures do not meet the proposed app-only budget. Keep shared `HostAPI` frontend and reusable Node services. Build a Tauri sidecar harness, not a second full application.
3. Complete file safety/scale: late external-write race strategy, richer merge/review, durable draft pruning, 15,118-file/five-space fixture, mount/depth-aware invalidation, offline registration bindings in the UI, stable note IDs, existing-vault mapping preview. Strengthen source fallback for all unsupported constructs and editor load errors.
4. Implement ontology after Q01; leave placement policy Q02 replaceable. Add note search/rename/backlinks and explicit selected-source context.
5. Wrap Git and rclone; each mount is exactly one selected folder, including shared-drive subfolders. Verify identity, do not create local fallback directories, retain pending bytes across restart. Never interpret disconnected as deleted or local save as shared.
6. Implement optional terminal and versioned output provenance. Produce a real PPTX from two observed note versions with an existing generation library/skill, retain every generation's source-version/run relationships, provide manual partial-evidence registration, and exercise cloud/Git failures independently.
7. Complete clean-device onboarding, signing/updating, accessibility, non-engineer task trial, provider distribution/auth review and backup/export documentation.

## Invariants retained for later phases

- Explicit space category and stable scoped IDs; paths locate and hashes version data.
- Nested declared scopes own themselves; contents registration forbidden even via realpath aliases, in either registration order.
- Scope rules are never hoisted or concatenated across spaces. Native ancestor discovery is not overridden.
- Declared contents always bypasses extension classification. Its directory contains only selected-folder attachments; ordinary local bytes there are an anomaly.
- Portable facts/lineage are tracked by the owning KB; paths, credentials, observations, full transcripts and caches are device-local.
- Clouds and Git are separate recoverable operations; pending bytes survive restart. Disconnection proves neither absence nor deletion.
- Every output version retains its producing run and source versions. Identical output hashes do not collapse distinct generation history.
- Cross-scope disclosure requires explicit selection; basic contents-to-note curation retains its source reference.

Q01 (ontology interaction) and Q02 (repository placement policy) remain unanswered. Neither blocked the implemented slice. This repository does not invent the answers.
