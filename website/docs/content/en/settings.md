---
title: Settings
description: Open display, agent, routine, and account settings one part at a time.
---

## Finding a setting

Open **Settings** in the app to see its parts listed at the left, in framed groups. Choose a part to show only its settings on the right. Under each part's name is its current value, such as the theme and font or whether the vault agent is on. The part you had open shows again the next time you open the settings.

| Group | Part | What it sets |
| --- | --- | --- |
| Display | Language and theme | The interface language and the theme |
| Display | Notes | Markdown font, text size, line spacing, side margins |
| Display | What the window shows | The items on the window, such as the access, the model and the terminal |
| Agents | Shared | The access of a new conversation, the shared Schema, and the CLIs on this device |
| Agents | irori agent | Its working folder, its Schema, its screen |
| Agents | vault agent | Turning vault agents on or off, and each vault's Schema |
| Automation | Routines | The JavaScript and Python runtimes |
| Account and updates | Account, Updates | The environment saved on GitHub, and app updates |

A choice applies at once. The start screen's **Settings** leave out **Updates** (the start screen has **Check for updates** at its foot), and parts that need a workspace say "Set in a workspace".

## Language, theme, and notes

Under **Language and theme**, select **日本語** or **English**. This changes irori's interface text. It does not translate your notes or AI instructions. Choose the theme from **Match system**, **Hearth**, **Light**, or **Dark**.

Under **Notes**, choose the Markdown font (system, sans-serif, rounded, serif, textbook, or monospace), the text size (14 to 20 px), the line spacing, and the side margins. The sample at the top shows each choice at once. Display changes do not alter the Markdown files.

This documentation site also has an **English / 日本語** switch at the top right. It opens the corresponding section in the same article. The site's theme button is independent of the app's settings.

## What the window shows

irori's window shows what a note and a conversation need. A conversation's model, thinking level and access are chosen in one menu, opened from a button under the instruction box. Developer tools join the window only when turned on under **What the window shows**; an item turned on appears at once.

| Where | Item | At first | While it is off |
| --- | --- | --- | --- |
| Instruction box menu | Access | On | A new conversation starts in the access chosen under **Shared**. A conversation in full access shows it even when this is off |
| Instruction box menu | Model and thinking level | On | Runs with the last choice, or the CLI's default where none was made |
| Instruction box | Skill | On | No skill goes with a request |
| Instruction box | Share the person's lines | Off | The lines a person wrote are not told |
| Top of a conversation | Columns | Off | The buttons that add a column and hide the page are not shown. While the page is hidden, the button that shows it stays |
| Status bar | Branch | Off | — |
| Status bar | Terminal | Off | Ctrl+` opens and closes it. Its button shows while it is open |
| Status bar | Version | Off | **Updates** names it |

**Show all** puts every item on the window, and **Back to default** returns to the list above. The choice is part of the environment saved to GitHub.

## Agents

The Agents group has three parts: **Shared** for both agents, **irori agent** for the agent of the whole workspace, and **vault agent** for the agent inside each vault.

Under **Shared**, **Access of a new conversation** chooses whether new conversations of the irori agent and the vault agents start in **Standard** or **Full access**. It is Standard by default. With Full access, agents in new conversations run commands and change files without asking. Existing conversations keep their access, and each conversation can be switched. Routine steps follow each step's own setting. The choice is this computer's only and is not part of the environment saved to GitHub. The same part opens the **Shared Schema**, the instructions and skills every agent follows. **CLIs on this device** lists each CLI with its version, or as not found.

Under **irori agent**, choose the folder the irori agent works in for this workspace, and open its Schema and its screen. If the irori agent is not set up yet, **Set up** is there too.

Turn on the vault agent with the switch under **vault agent**. It is off by default. Off hides the vault agents' columns and Schema, but hand-offs from the irori agent and routines still run a CLI inside the vault, with the vault's agent configuration. While it is on, each vault's Schema opens from there.

## Updates and routines

**Updates** names the version you use; **Check for updates** looks for a new one. When one is available, choose **Update and restart**.

To use JavaScript or Python in [routines](routines.md), turn on **JavaScript** or **Python** under **Routines**. Turning Python on downloads uv, and "Downloading and preparing uv…" shows until it is done. Choose the AI CLI at the top of the [AI panel](agents.md), and the model, thinking level and access in the menu under the instruction box.
