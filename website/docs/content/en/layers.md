---
title: The three layers
description: Keep AI instructions, accumulated knowledge, and source materials distinct.
---

## Schema, Knowledge, and Contents

| Layer     | Role                           | Examples                          |
| --------- | ------------------------------ | --------------------------------- |
| Schema    | Instructions for AI (optional) | `AGENTS.md`, skills, rules, hooks |
| Knowledge | Notes you write and maintain   | Markdown, ontology CSV files      |
| Contents  | Materials your notes draw on   | PDFs, Office files, Google Drive  |

Read source materials and write your understanding in Knowledge. Schema appears only when the vault agent is on in **Settings → Agents**.

## How folders relate

The layers describe roles and presentation. They do not require every vault to have the same folder names. You can open existing notes without moving them.

Top-level hidden files and folders, and files such as `AGENTS.md`, belong to Schema. Contents locations follow the vault's declarations. Other knowledge files appear in Knowledge.

See [irori-templete](https://github.com/DeL-TaiseiOzaki/irori-templete) for a recommended structure. Creating a new vault does not automatically copy the entire template.

## What agents use

The optional vault agent works with that vault's Schema and notes. It can also use connected Contents within its access to the folder.

Give cross-vault work to the [irori agent](irori-mode.md). See [Schema settings](schema.md) for configuration and [Google Drive](drive.md) for connecting materials.
