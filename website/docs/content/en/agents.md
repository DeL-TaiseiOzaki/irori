---
title: AI agents
description: Use local CLIs to read notes, revise them, and carry out work in your knowledge base.
---

## Choose a CLI

irori runs Claude Code, Codex, OpenCode, Pi, or Hermes Agent using the CLI and authentication on your computer. Install and authenticate the CLI first.

Choose a CLI and model in the AI panel. Model options come from the installed CLI. For Hermes Agent, enter the model name.

## Ask a hibachi agent

Open a note, write a request in the AI panel, and send it. The hibachi agent works with that hibachi's Schema and the selected note.

Try “Extract the decisions from these meeting notes” or “Read the materials and write a note with sources.” Review the text and [Git diff](git.md) afterward. Agents in different hibachis can run at the same time.

## Check access

A hibachi agent starts with **Full access** when the CLI supports it. Choose **Default** to follow the CLI's settings and approval requests. Available modes differ by CLI.

Permission requests and questions appear in the panel. Review and answer them there. Choose **Stop** to end work in progress.

## Continue working

Instructions sent while an agent is running enter its queue. See [conversations](conversations.md) for ordering and resuming.

Keep reusable instructions as [Schema skills](schema.md). Give work across hibachis to the [irori agent](irori-mode.md).
