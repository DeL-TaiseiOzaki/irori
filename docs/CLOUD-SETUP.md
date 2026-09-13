# Cloud connection development preview

Date: 2026-09-13. The first onboarding and read-only connection implementation is available locally. Actual Google consent and successful native mounts remain acceptance gates; this is not a released cloud-sync feature.

## Setup and ordinary flow

The developer/distributor supplies an installed rclone executable on the host's PATH, or sets `IRORI_RCLONE_PATH` to that executable. Supply both `IRORI_GOOGLE_CLIENT_ID` and `IRORI_GOOGLE_CLIENT_SECRET` from the irori desktop OAuth application in the host environment before starting Electron. These values are not renderer inputs and are removed from native agent child environments. Never commit them or provider tokens. Packaging the executable/prerequisites and deploying the OAuth application are still release work.

The current host checks rclone's advertised mount types. Linux additionally requires `/dev/fuse`; Windows checks for WinFsp; macOS selects the advertised `nfsmount` route. These are preliminary diagnostics, not successful native-platform acceptance. Missing mount support still allows folder registration for an authenticated account. Missing OAuth application configuration disables account creation with an explanation.

1. Register existing checkouts/KB folders at startup and save a named selection of spaces. Existing checkouts keep their location and independent histories.
2. Open a space's **クラウド接続** screen, name an account and sign in using the system browser. irori answers supported native rclone configuration questions and manages its own configuration.
3. Select the account, My Drive/shared drive, and a particular folder. Same-name siblings retain different provider IDs. Enter **contents内のフォルダ名**, review the path and register. Access is read-only in this slice.
4. Connect, retry or disconnect each attachment independently. Opening a saved workspace reconnects its bound attachments. Switching workspaces disconnects scopes no longer selected. Local editing remains available if a cloud fails.
5. After disconnection, use **名前を変更** to change the local mount name or **登録を解除** to forget an attachment. These operations retain the provider's folder and user-created local bytes. Only an empty, identity-verified irori placeholder is removed. **アカウントの登録解除** removes unused irori credentials; bindings from other or offline spaces prevent removal until explicitly removed or rebound.
6. Startup workspace cards provide **編集** and **登録を削除**. Editing preserves offline scope IDs unless explicitly deselected; deleting a profile keeps the registered KBs, notes and cloud declarations.

No Google account or real Drive folder was connected during implementation. Tests use explicitly labeled protocol fixtures and disposable KBs; the separate native rclone probe needs no Google login and stops before consent.

## Ownership and failure handling

Portable `.irori/cloud-mounts.json` records hold the scope/mount UUIDs, provider folder and parent IDs, optional shared-drive ID, contents root, user-chosen name and read-only intent. Device data holds workspace selections, display-only account metadata, root-specific account bindings, and rclone's credential-bearing `rclone/rclone.conf`. The host does not read or alter the user's ordinary rclone configuration. On POSIX the managed config is mode 0600; this is file protection, not credential-vault encryption. Windows ACL/keychain integration remains open.

The rclone RC listener uses loopback, random per-process authentication and child PID verification. Only typed domain operations cross IPC. Raw RC configuration, endpoints, logs and error bodies are not sent to the renderer. Interrupted authentication becomes incomplete; cancellation stops the job and removes the unfinished account's remote. Authenticated accounts can be removed only when no device binding references them, including bindings for offline scopes. This deletes the irori-owned rclone remote, not the Google account or remote files.

Folder verification re-lists the stored parent and matches the exact folder ID. Renaming a Drive folder within that parent preserves its selected local name; moving it to another parent requires reselection/rebinding work. Mount verification requires the service's mount listing, expected remote identity, a changed filesystem device and stable target identity. An ordinary empty directory is never accepted as a mounted remote. Reads remain blocked without a verified live mount; the app rejects all cloud saves.

Registration does not create mount directories. Before mounting, occupied paths, symlinks and case/Unicode-equivalent names are rejected. On POSIX, an irori-owned empty placeholder is tracked by device/inode and left mode 000 when disconnected. Existing user bytes are preserved. These permissions do not restrain root or external privileged programs; native crash/unmount and OS behavior require testing. Concurrent external edits still have a narrow final-check/rename race; no multi-instance lock or power-loss durability is claimed.

## Verification and remaining work

At the cloud milestone, the build and 21 behavior tests passed with the opt-in native rclone probe enabled; subsequent harness evidence is in [HARNESSES](HARNESSES.md). Without `IRORI_TEST_RCLONE_PATH`, that one test is skipped. New tests exercise user names, collisions, occupied paths and aliases, account/scope isolation, restart persistence, exact folder IDs, rejected false mount reports, OAuth errors/cancellation, Git inspection and workspace profiles. A downloaded rclone v1.75.1 Linux binary was checked against the official archive SHA256 and used to verify authenticated RC startup, unauthorized-request rejection, native configuration questions and shutdown. It is a local ignored test tool, not a bundled distribution dependency.

The actual Electron UI smoke includes a separate explicit rclone protocol fixture: two spaces, two accounts, duplicate Drive names distinguished by ID, My/shared drive selection, Japanese/spaced aliases, duplicate-name rejection and restart persistence. This fixture cannot mount and is not cloud-provider evidence. The original editor/session UI checks remain part of `npm run test:ui`.

Remaining: Google consent/expiry and native Windows/macOS/FUSE mounts; network interruption, host crash and unmount recovery; mounted-file reads through every native harness; mount-aware external refresh; packaged prerequisites and clean-device OAuth setup; moved-folder recovery. Write access must wait for independently observable uploads, durable per-connection caches and pending-write recovery. Git clone/fetch/commit/push and conflict review are implemented with native disposable-repository evidence; live GitHub/native-platform acceptance remains open. OpenCode/Pi adapters are now implemented; their model and mounted-file acceptance remain separate gates.
