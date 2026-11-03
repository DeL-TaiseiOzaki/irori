---
title: AI agents
description: Use local CLIs to read notes, revise them, and carry out work in your knowledge base.
---

## Choose a CLI

irori runs Claude Code, Codex, OpenCode, Pi, Hermes Agent, or the Antigravity CLI (`agy`) using the CLI and authentication on your computer. Install and authenticate the CLI first.

Choose a CLI and model in the AI panel. Model options come from the installed CLI. For Hermes Agent, enter the model name.

## Ask a vault agent

The vault agent is optional. Turn it on in **Settings → Agents**. Even while it is off, hand-offs from the irori agent and routines still run a CLI inside the vault, with the vault's agent configuration. irori shows it by its vault's name, such as “Research agent”. A vault named “irori” would read as the irori agent, so give it another name.

Open a note, write a request in the AI panel, and send it. The vault agent works with that vault's Schema and the selected note.

Try “Extract the decisions from these meeting notes” or “Read the materials and write a note with sources.” Review the text and [Git diff](git.md) afterward. Agents in different vaults can run at the same time.

## Check access

A new conversation starts in **Standard**, which follows the CLI's settings: Claude Code and Codex ask when needed, Pi asks for nothing, and the Antigravity CLI allows edits on its own. Switch to **Full access** where the CLI supports it; the choice returns to Standard after a restart or a workspace switch. Available modes differ by CLI.

In full access an agent reaches anything your user account can read or write. Through the `irori` command a vault agent reaches its own vault only, but that limit does not apply to the CLI's own tools. A read-only connection is read-only only to irori and to file edits by Claude Code and Codex in standard access; full access, shell commands, the terminal and other CLIs can still write there.

What an agent reads, notes and connected folders alike, is sent to that CLI's AI provider.

Permission requests and questions appear in the panel. Review and answer them there. Choose **Stop** to end work in progress.

## Continue working

Instructions sent while an agent is running enter its queue. See [conversations](conversations.md) for ordering and resuming.

Keep reusable instructions as [Schema skills](schema.md). Give work across vaults to the [irori agent](irori-mode.md).
