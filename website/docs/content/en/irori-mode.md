---
title: irori mode
description: See the workspace and ask for work that spans several vaults.
---

## See the whole workspace

Open **irori mode** from the left rail. **Map** shows the workspace's vaults in its order, four to a row. **Columns** places each one's AI, Schema, Knowledge, and Contents beside the others.

Change vault names, icons, and colors in [vault settings](workspaces.md#section-3).

## Ask the irori agent

The irori agent is the entry point for work across vaults. For example: “Compare my research notes with the team's plan and prepare a memo for our next meeting.”

It splits the request, hands work to the relevant vault agents, and brings the results together. Review questions and permission requests from handed work in the interface. Work handed to a [vault on an SSH host](ssh-hosts.md) runs on that host.

## Manage instructions and conversations

Choose a CLI and model for the irori agent as well. It starts in standard access. Edit its own Schema through the [same settings interface](schema.md).

Use [conversations and history](conversations.md) to separate jobs. With **Columns** turned on under **What the window shows** in the [settings](settings.md#section-3), **Add a column** runs another conversation beside the first, up to four. Each workspace keeps its own conversations and columns. For a defined procedure, open the left rail's **Routines** button below irori mode and [run it](routines.md).

## Set up vaults and move in

The irori agent can also set up vaults: clone your GitHub repositories as vaults, create new ones, register existing folders and connect synced folders. It can change layers, names and categories, make workspaces, disconnect folders, and remove a vault while keeping its folder.

Moving in from Obsidian, orca, an editor or a plain folder? Tell it so. It looks at what you have and asks, a few questions at a time, whether each part should become a vault, a vault's materials, or stay out. It writes the plan in its folder, waits for your yes, sets things up, and reports what came over and what did not.

irori asks you each time the irori agent registers an existing folder as a vault, connects a folder, changes a work folder, removes a vault or runs a routine. These procedures are in the irori agent's standard skills. A folder set up earlier gets the missing ones from **Add the standard skills** on the irori agent's screen.
