# Independent workspace Drive connections

Date: 2026-09-13. Implementation of the workspace ownership part of [ADR 002](decisions/002-release-and-workspace.md). Written as a read-only cloud preview; from 0.1.35 a connection can be editable, as [ADR 012](decisions/012-drive-editing.md) describes. From 0.1.37 Drive folders belong to KBs again ([ADR 013](decisions/013-drive-folders-in-kbs.md)); the workspace connections described here are moved into a KB from its connection dialog.

## Ordinary flow

Create/open a workspace with any number of existing KB repositories, including none. Use **クラウド接続** in the header or **接続** in its **Google Drive** section to register accounts and selected folders directly with that workspace. Accounts are reusable across workspaces; folder attachments are independent per workspace. Changing the selected KB, renaming a workspace, or editing its KB membership does not change those attachments.

The existing GitHub clone flow retains a user-chosen folder name and native Git authentication. Registration's category selector is now under optional display settings. Independent GitHub account login/onboarding still needs native acceptance; irori does not replace Git's credential helpers with a new account store.

Connected files use the same bounded UTF-8 reader in read-only source mode or a confirmed external open. A missing/unverified mount cannot fall back to ordinary local bytes. Raw cloud documents retain workspace identity; they are not silently supplied to the active KB's agent conversation. Explicit multi-source selection and source-version provenance remain D06 work.

## Storage and compatibility

New attachments live under the host's device-data directory:

```text
workspace-cloud/<workspaceId>/
  .irori/cloud-mounts.json
  contents/<selected-folder-name>/
```

This root is an actual filesystem location for managed mountpoints, outside every KB repository. It is not a fabricated Git repository or a registered knowledge space. The workspace UUID owns these declarations; the legacy `scopeId` field on the shared cloud wire/record format now identifies either the workspace or a legacy KB owner. Account/root bindings and credentials remain device-local. The new declaration stores folder IDs and relative names, with no credential, account-binding ID or absolute machine path. Sharing source references through a KB will require an explicit provenance/publication flow; device workspace declarations are not automatically pushed through a repository.

`WorkspaceCloudStorage` supplies the existing cloud service's small storage boundary. Native rclone account/folder/mount logic remains shared. The normal file service and workspace cloud reader reuse the same text decoding/limits; the explorer reuses the existing lazy tree component. Root/metadata aliases are rejected, and KB registration cannot take ownership of a workspace's cloud storage. UUID ownership is independent of display names.

Existing `.irori/cloud-mounts.json` records inside KBs and their device bindings are kept in place. Their original contents panes still expose their management controls and reconnect them when the KB belongs to the opened workspace. No startup migration moves files, changes folder IDs, deletes declarations or reconnects a folder under a new path. Explicit transfer of a legacy attachment to workspace ownership remains a migration tool to implement; users can already create independent connections for new workspaces.

Removing a workspace with direct Drive attachments is rejected until those attachments are explicitly unregistered. The check and removal run in the cloud queue, preventing a concurrent registration from being orphaned. Removing an attachment or a profile preserves existing local bytes and all remote files. Account removal continues to inspect all device bindings, including offline KB bindings.

## Verification

- Build passed; 60 behavior tests passed with the existing rclone/OpenCode/Pi native controls enabled, zero failed/skipped, no model inference or Google account use.
- The five existing UI suites passed. The sixth workspace Drive journey passed with an explicit protocol fixture: empty workspace, two accounts, connection persistence after KB membership change, deletion guard, restart, separate-workspace isolation and unchanged KB note bytes.
- Service tests cover legacy declaration compatibility, workspace/KB separation, stable mount IDs, preserved local anomaly bytes, blocked unmounted reads, root alias rejection and rejection of a KB inside workspace cloud storage.
- The screenshot in ignored `test-results/irori-workspace-drive.png` was reviewed: the independent Drive section remains visible below the existing layer explorer; note editing, ownership and connection controls fit the desktop window. It is not evidence of successful provider mounts.

Remaining: explicit legacy-transfer tooling, workspace-reference sharing/export, mounted-file context selection, durable uploads/recovery, actual Google consent and native mounts, native multiple-account GitHub setup, ontology/provenance, and Windows/Mac installed-device acceptance. The live VM preview was not restarted; its samples/device data remain untouched.
