---
title: Synced folders
description: Use folders that the Google Drive, Dropbox, Box, iCloud or OneDrive app keeps on your computer as a hibachi's materials.
---

## How it works

Each service's own app keeps cloud folders in sync on this computer. irori shows a folder from there in a hibachi's Contents, edits its notes, and lets hibachi agents work on it. irori never connects to the cloud itself; the service's app does the syncing.

## Before you start

Install the service's app and sign in.

| Service | App | Usual location |
| --- | --- | --- |
| Google Drive | [Google Drive for desktop](https://www.google.com/drive/download/) | Mac: `~/Library/CloudStorage/GoogleDrive-…`, Windows: `G:\My Drive` |
| Dropbox | [Dropbox](https://www.dropbox.com/install) | `~/Dropbox` |
| Box | [Box Drive](https://www.box.com/resources/downloads) | `~/Box` |
| iCloud Drive | Built into macOS, [iCloud for Windows](https://support.apple.com/en-us/103232) | iCloud Drive in Finder |
| OneDrive | Built into Windows, [for Mac](https://www.microsoft.com/microsoft-365/onedrive/download) | `~/OneDrive` |

Set the folder you use to keep its files on this computer as well, for example with Google Drive's **Mirror files** or the service's offline setting. Files that exist only in the cloud may not open until they are downloaded.

## Connect a folder

1. Open the hibachi's **Connect** and choose **This computer**.
2. Use **Choose folder** to pick a folder inside the synced folder.
3. Check the name shown in Contents and select **Register and connect**.

The folder connects when its workspace opens and leaves Contents when irori quits or switches to another workspace. The folder and its files stay where they are. On another computer, use **Choose folder again** to pick the same folder there.

## Things to know

- Do not sync one folder with two services at once. It can cause conflicts or damaged files.
- A hibachi, or a folder that contains one, cannot be connected.
- Files deleted in irori go to the system trash. Cloud history and trash are the service's own features.
- Files given to AI are sent to the CLI you use and its provider. See [AI agents](agents.md).
- A work account's administrator may restrict sync apps.

[Google Drive sign-in](drive.md), which connects through your Google account directly, is for invited testers.
