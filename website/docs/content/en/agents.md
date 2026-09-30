---
title: AI agents
description: Use local CLIs to read notes, revise them, and carry out work in your knowledge base.
---

## Choose a CLI

irori runs Claude Code, Codex, OpenCode, Pi, or Hermes Agent using the CLI and authentication on your computer. Install and authenticate the CLI first.

Choose a CLI and model in the AI panel. Model options come from the installed CLI. For Hermes Agent, enter the model name.

The selected CLI may send requests, notes, and connected Drive materials to its model provider. Check that provider's terms, retention, and training settings before granting access. See [Privacy and data handling](privacy.md).

Before first execution with each CLI, irori asks you to confirm the data-use explanation. The same check covers queued work, routine AI steps, and delegated work. It is separate from that CLI's tool permissions and does not establish provider compliance.

## Ask a hibachi agent

Open a note, write a request in the AI panel, and send it. The hibachi agent works with that hibachi's Schema and the selected note.

Try “Extract the decisions from these meeting notes” or “Read the materials and write a note with sources.” Review the text and [Git diff](git.md) afterward. Agents in different hibachis can run at the same time.

## Check access

A hibachi agent starts with **Full access** when the CLI supports it. Choose **Default** to follow the CLI's settings and approval requests. Available modes differ by CLI.

Permission requests and questions appear in the panel. Review and answer them there. Choose **Stop** to end work in progress.

## Continue working

Instructions sent while an agent is running enter its queue. See [conversations](conversations.md) for ordering and resuming.

Keep reusable instructions as [Schema skills](schema.md). Give work across hibachis to the [irori agent](irori-mode.md).
