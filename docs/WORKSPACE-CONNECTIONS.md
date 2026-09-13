# Workspace connections and native harnesses

Date: 2026-09-13. Status: product direction confirmed; the initial startup/account/folder UI and read-only rclone connection code are implemented. [CLOUD-SETUP](CLOUD-SETUP.md) distinguishes fixture/native-RC evidence from outstanding Google consent and native mount acceptance. The broader architecture below includes future work; writable cloud recovery remains unimplemented. OpenCode/Pi adapters are now implemented with native-control/fixture evidence in [HARNESSES](HARNESSES.md), while real model-turn acceptance is still open.

## Product priority

The user's central requirement is a working environment joining multiple local GitHub checkouts and multiple selected cloud folders. Native coding harnesses work on the resulting filesystem. Storage onboarding is a primary product journey and must not remain behind ontology, artifact generation or additional editor polish in the backlog.

Confirmed requirements from the latest conversation:

- Preserve the native Codex and Claude Code experience, including native configuration and extensions rather than only basic chat.
- Add OpenCode and Pi as explicitly requested harness integrations.
- Provide an Obsidian-like startup selection and setup journey for local checkouts and cloud accounts.
- Manage rclone configuration inside irori so users select an account and a particular Drive folder without writing configuration files or mount commands.
- Present several selected folders beneath a common contents area, accessible to ordinary local harness file tools.
- Let the user choose each actual mountpoint folder name inside contents, independently of the selected Google Drive folder's name. This is a filesystem name, not only a sidebar label.

The initial UI uses a named selection of existing scopes and their connections. This is a reversible UI choice, not a confirmed physical-layout policy. Q02 remains open: existing checkouts retain their location. Pi is provisionally interpreted as `badlogic/pi-mono`'s coding agent.

## Proposed ordinary journey

1. **Choose a workspace.** Show recent entries, repository availability and cloud connection state. Offer creation/registration. Do not wait for every cloud to connect before allowing local work.
2. **Add repositories.** Choose one or more existing local checkouts. Inspect each actual Git root, remote identity, branch and local changes; show personal/team/organization ownership. A subsequent clone path uses native Git authentication. Never initialize a new parent Git repository or relocate an existing checkout implicitly.
3. **Add a cloud account.** Choose Google Drive, name the account for display and complete consent in the system browser. Reuse that account connection for several folder selections. Account authentication and workspace membership are distinct records.
4. **Choose folders.** Browse My Drive or an accessible shared drive, then its folders. Display the account, drive, folder and owning KB together. Select a folder, enter its user-chosen mountpoint folder name in **contents内のフォルダ名**, and choose read-only or read/write intent. Preview the resulting `contents/<chosen-name>/` path before registration. The Drive name may be offered as an editable suggestion, never a fixed mapping. Repeat across accounts and repositories.
5. **Connect.** Check native prerequisites and folder identity, create the selected-folder mount, and verify the mounted endpoint. Display a usable local path only after success. Offer retry/re-authentication for an individual failed connection.
6. **Choose a harness and open.** Detect installed executables and native login/setup needs. Start the chosen native harness in the owning KB. Ordinary editing and harness use require no terminal command entry.

On later startup, reopen the chosen collection and reconnect its enabled attachments. Connection failures do not disable local notes or unrelated accounts. Disconnect and account removal must preserve pending cloud writes until the user resolves them.

## Ownership and filesystem layout

A workspace is a selection of scopes and their connections, not another Git repository and not a reason to concatenate their rules. Each scope remains the owner of its schema, Knowledge_Base and contents. A cloud attachment belongs to one scope; access from another scope is an explicit selection.

Example only, with new checkouts placed under an optional common parent:

```text
Work/
  personal-kb/                 # independent GitHub checkout
    schema/
    Knowledge_Base/
    contents/                 # ignored by this repository's Git
      research/               # selected folder from Google account A
      reference-material/     # selected folder from Google account B
  team-kb/                    # another independent GitHub checkout
    schema/
    Knowledge_Base/
    contents/
      shared-documents/       # selected subfolder of a shared drive
      deliverables/           # another selected cloud folder
```

Use separate named attachment points under `contents`, with one selected folder per mount. Preserve folder/account identity and independent lifecycle for each attachment. Do not flatten objects from different accounts into an ambiguous merged namespace. Existing checkouts elsewhere can retain the same per-scope layout without being moved to this example parent.

### User-chosen mountpoint names

The example names above are illustrative, not reserved names or required categories. A Drive folder named `Research Documents 2026` can be mounted at `contents/調査資料/` if that is what the user chooses. Support Japanese and spaces in valid folder names. Persist the chosen relative attachment path in the owning KB's portable declaration, so reconnection uses the same name. Keep the stable mount ID and provider folder ID separate from that name; renaming the source folder in Drive does not automatically rename the local attachment.

Validate the name before registration: require one nonempty folder-name component, reject path separators, traversal and names incompatible with supported platforms, and detect case/Unicode-equivalent collisions with other attachments or existing entries. Do not silently replace characters, append a numeric suffix, hide existing local bytes or reuse an occupied path. Explain the conflict next to the field and let the user choose another name. Validate again immediately before mounting, since the filesystem may have changed after the preview.

Filesystem visibility lets different harnesses use their own file tools. It does not promise that every sandbox permits every mount, nor that every binary format can be parsed by every model. Test actual reads and output writes through each supported native harness, including Windows/macOS permission boundaries. Google-native Docs/Sheets/Slides need provider links or explicit exported representations; an exported file is not an editable local copy of the native document.

## Proposed data boundaries

| Record | Contents | Authority |
|---|---|---|
| Workspace selection | Stable workspace ID, name, scope membership, enabled connection IDs | Device-local initially; shared collection policy remains open |
| Scope/repository | Existing scope UUID, ownership category and portable connection declarations | Owning KB |
| Cloud declaration | Stable mount ID, provider, selected folder ID, optional shared-drive ID, user-chosen relative attachment path, requested capabilities | Owning KB; explicitly registered by the user |
| Account binding | Local account ID, provider's authenticated identity, native remote reference | Device-local; never a shared account token |
| Mount binding | Scope/mount IDs, local account ID, canonical checkout path, stable cache location | Device-local |
| Observations | Authentication, folder verification, process/mount identity, connectivity, pending writes and last remote confirmation | Device-local and refreshed; not portable truth |

Display names do not identify accounts or folders. Rebinding must check provider IDs, and folder selection must not silently pick one of several same-name objects. The OAuth grant may cover more than the mounted subtree: choosing a folder is not itself an OAuth permission boundary.

## Rclone integration

Use a supervised native rclone service behind the typed host boundary. Its control endpoint, if used, is authenticated and loopback-only, with a per-launch secret retained by the host. The renderer gets domain operations such as account setup, folder browsing and attachment connection, never arbitrary remote-control methods or raw configuration. rclone exposes non-interactive configuration questions and remote-control operations for configuration and mount management; these make a guided UI feasible. [Configuration protocol](https://rclone.org/commands/rclone_config_create/), [remote-control API](https://rclone.org/rc/).

irori maintains its own managed configuration and preserves unrelated user rclone configuration. Tokens remain in protected device storage consumed by rclone; never expose a configuration dump in IPC, logs, Git, evidence or agent prompts. Serialize account-configuration changes; cancelling consent must leave an explicit incomplete state that can be retried or removed.

The Drive backend supports selecting a root by folder ID and enumerating shared drives. Use these identities rather than mutable display paths. Its current documentation also announces retirement of the shared OAuth client during 2026. The distribution design therefore needs an irori-controlled OAuth application; asking ordinary users to create Google Cloud projects does not meet the desired onboarding. [Drive backend and OAuth client guidance](https://rclone.org/drive/).

Use a supported installed-application OAuth flow in the external browser. Resolve the app's OAuth registration, consent presentation and required verification as release engineering. Choose Drive scopes against actual existing-folder reads/writes; do not assume a narrow per-file scope grants arbitrary folder-tree access. [Google desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [Drive authorization scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

Windows needs WinFsp for rclone folder mounts. macOS needs a tested supported mount route; evaluate `nfsmount` and FUSE alternatives. Package or guide installation of prerequisites through the native installer/setup flow, including any real OS approval. Google Drive for desktop itself is not a required dependency of this rclone design. [Mount prerequisites](https://rclone.org/commands/rclone_mount/), [NFS mount route](https://rclone.org/commands/rclone_nfsmount/).

Use persistent, distinct VFS cache locations keyed to connection identity. rclone documents recovery of unfinished uploads with matching configuration and warns against overlapping processes sharing a VFS cache. A cache-size target is not a hard storage bound. Build lifecycle/transfer observations and a recoverable shutdown path before allowing normal output writes. [VFS caching and recovery](https://rclone.org/commands/rclone_mount/#vfs-file-caching).

Connection state and transfer state are independent:

```text
Connection: unconfigured → authorizing → verifying → mounting → available
                                      ↘ unavailable / identity-mismatch
Transfer:   clean → pending → uploading → remote-confirmed
                         ↘ failed / retry-pending
```

An empty mountpoint directory is not proof of a mount. A running rclone process is not proof of the expected remote identity. Losing a mount must not cause an ordinary local fallback directory to receive writes. Offline files are not deleted files. Git commit/push status and Drive transfer status remain separate in the UI.

## Native harness integration

Keep a capability-aware adapter per harness rather than translating all of them into the currently supported Codex/Claude subset. The following are integration directions, not completed acceptance evidence:

| Harness | Integration direction | Native behavior to preserve and verify |
|---|---|---|
| Codex | Existing native app-server adapter | Project/ancestor rules, skills, MCP, model/settings selection, approvals, structured input, session continuation and cancellation |
| Claude Code | Existing native CLI controlled by its SDK | User/project/local settings, rules, skills, MCP, hooks where supported, tool permissions, questions, session continuation and cancellation |
| OpenCode | Native local server/API, with an authenticated host-owned connection; assess its ACP route where useful | Native project configuration, agent/model selection, permissions, tools/skills/MCP, events and session lifecycle |
| Pi | Native `pi --mode rpc`; inspect the selected installed version before implementation | Its own providers, skills, extensions, session files, streaming, abort and extension UI requests |

OpenCode exposes a native HTTP server and authentication settings. Pi documents JSONL RPC and an extension dialog protocol, but also explicitly leaves permission prompts and MCP integration to extensions. Do not claim that Pi has the same built-in approval or MCP model as Codex/Claude, or that all TUI extensions can render through RPC. Record supported, unsupported and unverified capabilities visibly. [OpenCode server](https://opencode.ai/docs/server/), [Pi coding-agent documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md), [Pi RPC and extension UI](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md).

Treat native parity as an executable acceptance matrix, not a promise of pixel-identical native terminal interfaces. Use disposable fixtures to verify rule loading, skills/extensions, fixture MCP where applicable, permissions, question handling, cancel, restart/resume, and selected cloud-file reads/output writes for each harness. Native accounts and permission policies remain owned by that harness.

## Revised delivery sequence

1. Establish startup collection/registration, repository inspection and the portable cloud declaration/device-binding split. Resolve the startup selection unit without forcing physical repository relocation.
2. Deliver actual account consent and lazy folder/shared-drive selection with user-chosen mountpoint names and a path preview; validate two accounts, Japanese/space-containing names, duplicate or occupied paths, name retention after restart and source-folder rename, cancellation and expired consent.
3. Deliver selected-folder mount supervision and identity verification on native Windows/macOS. Start with a verified read path, then recoverable writes, remote confirmation and reconnect. Exercise two independent connections and failure of one while the other remains usable.
4. Exercise Codex and Claude on those real mounted paths and close native parity gaps. Complete real model-turn and capability acceptance for the newly implemented OpenCode/Pi adapters. Preserve each scope's native rules and explicit cross-scope context choices.
5. Complete reviewed Git sharing and independent Git/cloud failure recovery. Then proceed with remaining editor, ontology, terminal, artifact and release gates from ACCEPTANCE.

The initial design follow-up found no installed rclone or `/dev/fuse`. Implementation subsequently downloaded and checksum-verified a local ignored rclone v1.75.1 test binary and exercised real authenticated RC/config-question/shutdown behavior. `/dev/fuse` and deployment OAuth credentials remain absent; Google consent and native mounts have not been run. Unverified contents access remains blocked. See [CLOUD-SETUP](CLOUD-SETUP.md) for the implemented read-only subset and remaining gates.
