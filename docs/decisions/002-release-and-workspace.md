# ADR 002 — Release targets, workspace ownership and ontology presentation

Date: 2026-09-13. Status: product decisions confirmed by the user; workspace-level new connections implemented, remaining product features and legacy transfer pending.

These decisions supersede unresolved Q01/Q02 and conflicting earlier product proposals. Historical specifications in the parent workspace are not the current implementation contract.

## License and acceptance devices

irori is MIT licensed. Dependency and native-provider terms remain their respective upstream terms. Native acceptance devices are Windows 11 on Ryzen 9 (x64) and a MacBook M5 Pro (arm64). The exact macOS version and tested minimum OS versions still need recording from those devices. Linux is an engineering test platform.

Intel Macs are out of scope. On 2026-09-16 the owner decided irori will not target them, superseding the earlier position that an Intel download was merely awaiting acceptance evidence. The Mac build is Apple silicon only: there is no Intel package job, no download slot in the website manifest and no acceptance path. Reintroducing one is a new product decision, not a matter of collecting evidence.

## Q01 — CSV editing and readable ontology graphs

CLI agents build the ontology in collaboration with people. irori presents it: basic CSV editing, links from CSV records to notes, and graph visualization with hierarchy and subgraph grouping. Ontology construction is primarily the native agent's responsibility, not a separate irori ontology-building engine.

Preserve unknown CSV columns and existing IDs. Do not assume every CSV is ontology. A declared column mapping can express node IDs/labels/note links and relation endpoints without requiring a bulk rewrite into one hard-coded ontology schema. Hierarchy and subgraph visibility are required presentation features, not implicitly deferred graph features.

Implemented in [ONTOLOGY](../ONTOLOGY.md): CSV table/source mode, explicit field mapping, parent hierarchy/descendant and group filters, graph controls, linked notes and preparation of a native-agent setup request. Immutable source versions and note/artifact/run identity remain D06 work; CSV revision fingerprints do not complete provenance.

## Q02 — Workspace joins independent repositories and cloud folders

A workspace can attach multiple GitHub KB repositories in arbitrarily named folders and multiple specifically selected Google Drive folders. Multiple accounts are allowed for both services. Google Drive connections are independent of GitHub repositories. Users must not have to reason about personal/team/organization classification to connect them.

Superseded 2026-09-25 by [ADR 013](013-drive-folders-in-kbs.md): Drive folders belong to KBs again, and a workspace's own connections are moved into a KB. Until then: new Drive connections belonged directly to a workspace and persisted independently of KB membership; empty workspaces are supported and category selection is optional. Existing KB-owned declarations and bindings remain in place and usable; explicit legacy-transfer tooling is still pending. See [storage, compatibility and validation](../WORKSPACE-DRIVE.md). Do not relocate existing user data automatically. Git credentials remain managed by native Git helpers; multiple-account onboarding needs explicit acceptance.

KB scope identity, independent native rules, explicit context selection and protection against silent cross-repository sharing remain. A workspace does not merge repositories or their instruction files. Preserve real CLI-readable selected-folder attachments and the separation of Git publication from cloud transfer. Any portable shared cloud/source references must avoid publishing device bindings or credentials through a KB without an explicit action.

## Release effect

Keep full first-release requirements, including cloud writes/recovery, versioned provenance and the newly clarified CSV/graph experience. No limited beta or public deployment has been authorized by these decisions. Build/test/commit/push remain authorized. OAuth/signing account changes and model execution require their separate authorization and resources.
