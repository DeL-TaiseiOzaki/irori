---
title: Vaults and workspaces
description: Open folders for your knowledge and combine them into a working environment.
---

## Add a vault

A **vault** is one knowledge base. You can open an existing Markdown folder or Git repository in its current location.

There are four ways to add one.

| Method             | Action                                                                       |
| ------------------ | ---------------------------------------------------------------------------- |
| Use a local folder | **Open a KB folder**, or **Add vault → Existing folder**                   |
| Clone from GitHub  | **Clone from GitHub**, then enter a URL, parent folder, and new folder name  |
| Create a new one   | **Create new**, then choose the parent folder, folder name, and display name |
| On an SSH host     | **From an SSH host**, then choose a folder there ([vaults on SSH hosts](ssh-hosts.md)) |

A new vault starts as a Git repository. You can also choose to [publish it to GitHub](git.md#section-4).

## Create a workspace

A workspace is a selection of vaults to use together. Select them on the startup screen, name the workspace, and choose **Create workspace**.

For example, open personal notes, team meeting records, and organization materials together. Each folder and Git history stays independent. Use [irori mode](irori-mode.md) to see the whole workspace.

## Adjust names and appearance

In **vault settings**, change its name, category, icon, and color. Pick personal, team or organization as the category, or type a name of your own, such as `Lab`. Categories other vaults of the workspace use are offered too. The category is kept in `.irori/scope.json`, so everyone who opens the knowledge base sees it. Changing appearance does not move files.

In the left rail, right-click a vault and choose **New group** or **Move to "…"** to gather vaults into groups. Click a group to close or open it, and right-click it to **Rename** or **Ungroup** it. A closed group still shows a vault whose agent is working or waiting for approval. Groups are kept for each workspace on this computer.

**Remove vault** in **vault settings**, or a vault's remove button on the start screen, takes the vault off this computer and out of every workspace. The folder stays unless you choose **Also move the folder to the trash**; adding the kept folder again brings the same vault back. Removing a workspace registration leaves your note folders intact. See the [three layers](layers.md) before reorganizing a vault's contents.

## Several workspaces and windows

Workspaces open as tabs along the top of the window, several at once. **+** at the end of the tabs (**Open a workspace**) shows the start screen, and a workspace opened there becomes a new tab. One already open comes back where you left it: the same vault, note and view.

Agents keep running in tabs not on show. A tab shows a dot while an agent in it runs or waits for permission. Closing a tab stops the agents only that tab has open, so irori asks first.

**File › New Window** (Ctrl/Cmd+Shift+N) opens another window. On Windows the File menu opens from the title bar's **Menu** button; on macOS the Dock menu has it too. Each window has its own tabs, and closing one does not stop what another window has open.

## Two vaults side by side

**Open a vault beside** at the top of the vault panel opens another vault of the workspace next to it. Its name switches to a different vault, and **Close the vault beside** (×) closes it.

Drag a note, file or folder from one Knowledge onto a folder of the other to move it. When links between it and the notes that stay would break, irori says how many and asks first. Images pasted into a note go with it, as do its comments. Opening a file in the vault beside brings that vault to the main panel, and the two trade places.
