---
title: Synced folders
description: Use folders on your computer, such as those the Google Drive, Dropbox, Box, iCloud or OneDrive app keeps, as a vault's materials.
---

## How it works

Each service's own app keeps cloud folders in sync on this computer. irori shows a folder from there in a vault's Contents, edits its notes, and lets vault agents work on it. irori never connects to the cloud itself; the service's app does the syncing. Any other folder on this computer connects the same way. For GitHub repositories, see [Git and sharing](git.md#section-6).

## Before you start

Install the service's app and sign in.

| Service      | App                                                                                      | Usual location                                                      |
| ------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Google Drive | [Google Drive for desktop](https://www.google.com/drive/download/)                       | Mac: `~/Library/CloudStorage/GoogleDrive-…`, Windows: `G:\My Drive` |
| Dropbox      | [Dropbox](https://www.dropbox.com/install)                                               | `~/Dropbox`                                                         |
| Box          | [Box Drive](https://www.box.com/resources/downloads)                                     | `~/Box`                                                             |
| iCloud Drive | Built into macOS, [iCloud for Windows](https://support.apple.com/en-us/103232)           | iCloud Drive in Finder                                              |
| OneDrive     | Built into Windows, [for Mac](https://www.microsoft.com/microsoft-365/onedrive/download) | `~/OneDrive`                                                        |

Set the folder you use to keep its files on this computer as well, for example with Google Drive's **Mirror files** or the service's offline setting. Files that exist only in the cloud may not open until they are downloaded.

## Connect a folder

1. Open the vault's **Connect**.
2. Use **Choose folder** to pick a folder inside the synced folder.
3. Check the name shown in Contents and select **Register and connect**. Turn off **Allow editing** to connect it read-only.

The folder connects when a workspace holding its vault opens. It leaves Contents when irori quits, or when no open workspace tab or window holds that vault any more. The folder and its files stay where they are. On another computer, use **Choose folder again** to pick the same folder there.

If the folder is not there yet, for example when Google Drive for desktop starts after irori, the connection shows **Waiting for the folder** and connects by itself once the folder appears.

## Things to know

- Do not sync one folder with two services at once. It can cause conflicts or damaged files.
- A vault, or a folder that contains one, cannot be connected.
- Files deleted in irori go to the system trash. Where there is none (Google Drive for desktop's drive on Windows, a network folder), irori asks, then deletes them for good. The sync app passes the deletion to the cloud and to anyone the folder is shared with. Cloud history and trash are the service's own features.
- Agents can write to an editable connection too, and the sync app syncs what they write to the cloud. Even a read-only connection can be written by an agent in full access, shell commands, the terminal and other CLIs.
- Files an agent reads are sent to the AI provider of the CLI you use. See [AI agents](agents.md).
- A work account's administrator may restrict sync apps.

Connecting through your Google account directly has ended. See [Google Drive](drive.md) for earlier connections.

## Unregistered items

An item in a Contents folder that no connection names shows as **Unregistered** in the explorer. This happens, for example, when its connection was unregistered on another computer, or a Git pull replaced the vault's record of its connections. The vault's **Connect** lists these items under **Unregistered**.

- A link can be registered again. **Register as connection** connects it to the folder it leads to; when that folder is gone (**Link target missing**), **Choose folder and connect** connects it to a folder you choose. **Remove link** deletes only the link, never the folder it leads to.
- Anything else can go to the system trash with **Move to trash**.

While an agent runs in that vault, connections cannot be changed or removed, nor unregistered items removed, and the connection sheet says why. A new connection can still be added. Everything is available again once the run ends.
