---
title: Privacy and data handling
description: Understand where notes, Google Drive files, credentials, and AI conversations are stored or sent.
---

> **Review draft for the unreleased 0.1.62 candidate.** Publisher and contact details are confirmed. Final policy wording, effective date, HTTPS deployment, and Google's review remain pending. The protections described as candidate behavior below are not part of the published 0.1.61 preview. This page is public-release preparation; it is not a statement that Google has approved irori.

## Your notes and local data

irori is a desktop app. Notes and materials remain in the folders you open, and edits are written to those folders. Connecting a Git remote or a cloud folder adds the transfers you configure. Files are not uploaded to an irori account merely by opening a local hibachi.

Application data on this computer includes settings, folder and account metadata, search and graph indexes, AI conversation records, and copies of source materials retained for provenance. Those copies can include Google Drive file contents. Deleting the original file does not automatically delete every retained copy.

## Google Drive access

Google sign-in opens in your system browser. irori uses rclone on your computer to access Google Drive with OAuth access and refresh tokens. You do not enter your Google password into irori.

In the 0.1.62 candidate, before Google sign-in, browsing connected folders, or mounting Drive for the first time, irori asks you to confirm its Drive data-use explanation. The confirmation is recorded on this device and reused until reset or the explanation version changes. It is separate from the permission grant shown by Google.

The current connection requests the full Drive scope, `https://www.googleapis.com/auth/drive`, to list existing folders and read, create, change, or delete their files. This grant covers Drive files your account can access; it is broader than the folder you choose in irori. Choosing a folder limits the connection's working location. The read-only setting in irori does not narrow the OAuth grant held by the account.

Drive file contents, names, identifiers, and connection metadata are used to browse, display, edit, and upload your materials. Downloads and pending uploads can leave local cached copies, including after disconnection or quitting. See [Google Drive](drive.md) for connection and pending-upload controls.

## AI providers and other transfers

When you start an [AI agent](agents.md), irori sends your request and relevant context to the local CLI you selected. Depending on its access mode and your instructions, that CLI can read notes and connected Drive files and send their contents, tool results, or conversation context to an external model provider. Connecting Drive does not by itself start an AI request.

In the 0.1.62 candidate, before first execution with each CLI, irori asks you to confirm the explanation of AI transfers and history. This also applies to queued work, routine AI steps, and work delegated between agents. Terminals and routines have a separate confirmation for programs that can read accessible files and communicate with external services. These confirmations acknowledge the explanation; they do not approve every tool call, restrict individual network requests, or establish that a provider's handling complies with Google's rules.

The CLI and provider use your own authentication and account settings. Their terms determine server-side processing, retention, human access, and model-training use. Check those terms and settings before allowing access to sensitive data. Do not send Google Drive data to a service whose use conflicts with the [Google Workspace API user data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy), including general-purpose model training. Stopping or deleting a conversation in irori does not erase copies already received by a provider.

Git synchronization sends repository contents to the remote you configure. Update checks and downloads contact GitHub. The documentation website is hosted on GitHub Pages; visiting it sends ordinary web requests to that host. Documentation search runs in your browser, and the website stores the chosen theme in local storage.

## Storage and protection

Notes, Drive caches, retained source materials, and conversation history are local files. irori does not encrypt all of these files itself. Use your operating system's disk encryption and account protections, and include any backups in your data-handling decisions. Access granted to a CLI may include these files.

Drive credentials are separate from the notes you edit. Removing an account removes its saved rclone credentials, but disconnecting one folder does not remove the account or revoke Google's grant. Do not share application-data folders, credentials, or unredacted logs in a public issue.

The 0.1.62 candidate encrypts the rclone credential configuration, with its encryption key protected by the operating system's secure storage. Existing plaintext configuration is migrated when the cloud service starts; Google connection is unavailable if secure storage cannot be used. This protection is limited to the credential configuration, not the caches, source copies, notes, or conversation files above.

## Disconnecting and deleting

**Settings → Reset data use confirmations** clears the recorded confirmations so the next connection or run asks again. It does not stop active work, revoke Google access, or delete retained data.

1. Review pending uploads before disconnecting Drive. Retained pending changes can upload on reconnection; do not delete their cache before saving any changes you need.
2. Remove the folder connections that use an account before removing the account from irori.
3. Revoke irori's authorization in [your Google Account's third-party connections](https://myaccount.google.com/connections) to withdraw Google's grant. This does not delete local file copies.
4. Delete conversations through [History](conversations.md) to remove irori's saved conversation. The CLI's own history and a provider's server copies remain subject to their separate controls.

Disconnecting Drive, deleting a conversation, removing a hibachi, or uninstalling irori is not a complete data-erasure operation. There is no single control that removes every cache, retained source copy, CLI history, remote Git copy, and backup. For complete local removal, first preserve needed notes and pending edits, close irori and its CLIs, and review their application-data folders and backups before deleting them. Use Google and provider controls for copies held by those services.

## Publisher and privacy contact

Publisher: **Taisei Ozaki**. Privacy and support contact: [taisei.ozaki.lab@gmail.com](mailto:taisei.ozaki.lab@gmail.com). These details were confirmed on 2026-09-30. The final policy wording and effective date remain pending review; this document is still a review draft. The [public issue tracker](https://github.com/DeL-TaiseiOzaki/irori/issues) can receive non-sensitive bug reports; it is not a private channel for credentials or personal data.
