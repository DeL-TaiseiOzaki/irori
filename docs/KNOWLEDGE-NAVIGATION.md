# Source and artifact navigation

Development continuation after `1afe3bb`, 2026-09-14. This extends the device-local records described in [EDITING-AND-RECORDS](EDITING-AND-RECORDS.md). It does not update the published Windows installer.

## Search and navigation

Open a note, then choose **資料と成果物**. **記録を検索** filters the displayed runs and artifact registrations by recorded relative path, source/run/registration ID, source hash, scope or CLI. Matching ignores case and normalizes character width. The scope is the latest 100 runs and 100 artifact registrations for the active KB. This is record metadata search, not full-text KB search or a complete history archive.

Each source and registered artifact offers **現在の場所・関連記録**, **保持版を見る** and **別ファイルに復元**. Binary artifacts can use location and relationship navigation without a text preview. Artifact registrations remain explicitly manual associations. The detail view distinguishes runs that observed this exact hash from runs using another version of the same scoped source ID. Reverse links clear the current search, expand the target run and focus its summary; artifact registrations outside the run display window say so.

The host resolves the current path from the scoped source ID, rather than assuming that the historical path is still current. The detail view distinguishes matching bytes, changed bytes, missing files, inaccessible files/connections, and an unbound ID. **場所を再確認** refreshes the observation. **現在のファイルを開く** checks again and uses normal editor/external-file navigation, including saved-draft protection, workspace membership and active-agent scope guards. A referenced KB outside the current workspace must be added explicitly before navigation. Workspace Drive references retain their existing connection checks and read-only behavior.

## Explicit reconnection after a move

When the current registered path is missing, enter the new relative path in **同じスペース内の移動先** and choose **この移動先に再接続**. The operation changes only the private path/ID index. It does not move, rewrite or delete either file, or change historical run/artifact/outbox records.

Reconnection requires the same owning scope, an existing unique source ID, a missing current file, an unregistered destination, valid retained bytes and a destination matching the selected retained version's size and SHA-256. Directories, changed versions, occupied identities, traversal/absolute paths and aliases crossing scope boundaries fail. Destination size is checked against the existing 64 MiB source limit, contents are checked twice, and scope resolution is checked again before index persistence. An inaccessible connection is not treated as permission to assign a new identity. A surviving original file is treated as a copy, requiring a separate ID.

Repeated moves follow the current ID binding even when invoked from an older historical record. Reusing the original path after reconnection receives a separate ID on its next capture. The index uses the existing serialized atomic private writer and survives restart. Retained source bytes and original paths remain available independently of current file access. No multi-file transaction or filesystem snapshot is claimed; concurrent external writers can still race the final observation.

## Remaining D06 work

Identities and records remain device-local and indexed by scope; this is not portable shared KB identity/provenance or provider-native document identity. Application note moves reconnect the source ID. There is no automatic external rename detection, merging of already registered IDs, reconnection across KBs, or proof that matching bytes came from a physical move rather than a copy after deletion. A file replaced at the same still-bound path continues that path's existing ID. Local indexed text search and Markdown backlinks are implemented. Properties, cross-device provenance sharing, retained-history pagination/management and real generated-artifact/PPTX acceptance remain open. No note frontmatter is rewritten or private record exported into Git.

## Verification

Behavior regressions exercise repeated moves and restart, historical versions, reused paths, copies, wrong versions, occupied/unknown/duplicate IDs, unavailable files/connections, cross-KB aliases and invalid HostAPI paths. The Electron record-navigation suite uses real disposable files and persisted run/artifact records. It verifies normalized search, binary artifact links, workspace membership rejection, version-aware reconnection, reverse-link focus, editor navigation and history after host restart. Its binary fixture is not a generated PPTX or model-turn acceptance test.

Exact completed build, behavior, UI and remote packaging checks are recorded in [STATUS](STATUS.md) and [HANDOFF](HANDOFF.md). Google consent/mounts/uploads, native model execution and Windows/macOS device acceptance remain separate gates.
