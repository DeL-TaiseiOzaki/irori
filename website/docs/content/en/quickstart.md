---
title: Quickstart
description: Open a vault, write your first note, and ask AI to take the next step.
---

## Prepare

[Install irori](installation.md) and [Git](https://git-scm.com/downloads). If you want to use AI, install your preferred CLI and sign in before using it in irori.

Try a copy of your notes or an empty folder first to get familiar with the interface and saving.

## Open a vault and write

1. Choose **Open a KB folder** on the startup screen and select your notes folder.
2. Check its name in the registration screen and open the folder.
3. Open a Markdown file in **Knowledge** on the left, or add a note to start a new one.
4. Write a heading and some text. Changes save automatically.

To work with several vaults, select them on the startup screen and create a workspace. See [vaults and workspaces](workspaces.md).

![A note beside the AI panel](screens/note.webp)

## Ask AI to continue

Keep the note open and choose **irori agent** in the bar above it to open the agent panel beside the note. While the vault agent is off, as it is at first, this panel is the irori agent, which works across the workspace. If it is not set up yet, choose **Set up the irori agent** first. Choose a CLI at the top of the panel; the menu under the instruction box changes the model. For example, send “Summarize this note and add the next things to investigate.”

Permission requests and questions appear in the panel. Review the note and its [changes](git.md) after the agent finishes. For work across knowledge bases, use [irori mode](irori-mode.md).

> To work with the vault agent inside each vault instead, turn it on in **Settings → Agents → vault agent**; the button in the bar then reads **vault agent**. A new conversation starts in standard access. Agents can change files; check the access in the menu under the instruction box before running one. See [access modes](agents.md#section-3).
