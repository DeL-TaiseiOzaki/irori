---
title: Google Drive
description: Connect Drive folders as hibachi materials to read and update them.
---

## Connect a folder

1. Open the destination hibachi and choose **Connect** or **Cloud connections**.
2. Register a Google account and sign in using the system browser.
3. Choose a folder in My Drive or a shared drive.
4. Check its local name and access mode, then connect it.

Windows requires [WinFsp](https://winfsp.dev/rel/). The connected folder appears in the hibachi's Contents.

## Read and edit

New connections are editable; you can switch them to read-only. An account registered earlier with read-only permissions may need reauthentication through **Allow writing**.

Edit Markdown in irori. Read other formats using the [viewers](files.md) and edit them in their original apps. Hibachi agents can also use mounted materials within their access settings.

## Check pending uploads

Changes are uploaded to Drive. **Pending uploads** are changes saved locally whose upload has not finished. Check the connection's state and the reason it shows.

Review the choices shown when disconnecting or quitting with pending uploads. Retained changes upload when that folder reconnects. See [troubleshooting](troubleshooting.md) for conflicts or expired authentication.

> Drive connections and editing are preview features. Acceptance checks on installed Windows and Mac apps are ongoing. Try copied materials first.
