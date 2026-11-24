---
title: The three layers
description: Keep AI instructions, accumulated knowledge, and source materials distinct.
---

## Schema, Knowledge, and Contents

| Layer     | Role                           | Examples                                                                             |
| --------- | ------------------------------ | ------------------------------------------------------------------------------------ |
| Schema    | Instructions for AI (optional) | `AGENTS.md`, skills, rules, hooks                                                    |
| Knowledge | Notes you write and maintain   | Markdown, CSV tables                                                                 |
| Contents  | Materials your notes draw on   | PDFs, Office files, folders on this computer or from a sync app, GitHub repositories |

Read source materials and write your understanding in Knowledge. Schema appears only when the vault agent is on in **Settings → Agents → vault agent**.

## How folders relate

The layers describe roles and presentation. They do not require every vault to have the same folder names. You can open existing notes without moving them.

Top-level hidden files and folders, and files such as `AGENTS.md`, belong to Schema. Contents locations follow the vault's declarations. Other knowledge files appear in Knowledge.

Under **Layers** in the vault's settings, each of Knowledge and Contents has a name shown on screen (**Shown as**) and a **Folder**. With **The vault's root** for Knowledge, notes sit at the top of the repository beside `AGENTS.md`.

## Choosing a vault's layers

Not every vault is a knowledge base with materials. Under **Layers** in the vault's settings, **The layers this vault has** turns Knowledge and Contents on or off. Every vault has Schema.

| Layers                        | For example                                   |
| ----------------------------- | --------------------------------------------- |
| Schema + Knowledge + Contents | A knowledge base with its materials (default) |
| Schema + Knowledge            | Notes or ideas alone                          |
| Schema + Contents             | A workspace for code or other work, no notes  |

These are examples, not kinds: choose the combination that fits how you use the vault.

A layer you leave out is not shown, takes no new notes or connections, and is not described to the vault's agent. No file moves, and turning the layer on again brings it back as it was. Without Knowledge, the vault's files outside Contents appear with Schema, in its file view. Disconnect a vault's folders and repositories before leaving Contents out. Code is Contents when its folder or GitHub repository is connected there; files kept at the vault's own top level appear with Schema.

An agent makes the same choice with `irori set <vault> --layers schema,contents`.

## Renaming a layer's folder

Renaming a folder moves it and updates what points into it: links in the vault's notes, comments, drafts and connected folders. If links in some files could not be updated, irori says how many. The names are kept in the vault's `.irori/scope.json`, so everyone who opens the vault sees the same ones, and a change pulled from another computer applies at once.

See [irori-templete](https://github.com/DeL-TaiseiOzaki/irori-templete) for a recommended structure. Creating a new vault does not automatically copy the entire template.

## What agents use

The optional vault agent works with that vault's Schema and notes. It can also use connected Contents within its access to the folder. The work folder, where agents keep scratch files and results, shows in Contents as `work`; see [AI agents](agents.md).

Give cross-vault work to the [irori agent](irori-mode.md). See [Schema settings](schema.md) for configuration, and [synced folders](sync-folders.md) and [GitHub repositories in Contents](git.md#section-6) for connecting materials.
