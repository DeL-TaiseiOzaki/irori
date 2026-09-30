---
title: The three layers
description: Keep AI instructions, accumulated knowledge, and source materials distinct.
---

## Schema, Knowledge, and Contents

| Layer     | Role                                  | Examples                          |
| --------- | ------------------------------------- | --------------------------------- |
| Schema    | Instructions and settings for AI work | `AGENTS.md`, skills, rules, hooks |
| Knowledge | Notes you write and maintain          | Markdown, ontology CSV files      |
| Contents  | Materials your notes draw on          | PDFs, Office files, Google Drive  |

Read source materials, write your understanding in Knowledge, and keep working instructions in Schema.

## How folders relate

The layers describe roles and presentation. They do not require every hibachi to have the same folder names. You can open existing notes without moving them.

Top-level hidden files and folders, and files such as `AGENTS.md`, belong to Schema. Contents locations follow the hibachi's declarations. Other knowledge files appear in Knowledge.

See [irori-templete](https://github.com/DeL-TaiseiOzaki/irori-templete) for a recommended structure. Creating a new hibachi does not automatically copy the entire template.

## What agents use

A hibachi agent works with that hibachi's Schema and notes. It can also use connected Contents within its access to the folder.

Give cross-hibachi work to the [irori agent](irori-mode.md). See [Schema settings](schema.md) for configuration and [Google Drive](drive.md) for connecting materials.
