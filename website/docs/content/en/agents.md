---
title: AI agents
description: Ask local CLIs to read and revise notes, and see what agents reach and can do in irori.
---

## Choose a CLI

irori runs Claude Code, Codex, OpenCode, Pi, Hermes Agent, or the Antigravity CLI (`agy`) using the CLI and authentication on your computer. Install and authenticate the CLI first.

Choose a CLI at the top of the AI panel. Choose the model and thinking level in the menu opened from the button under the instruction box, which names the model in use; without a choice the CLI's default model runs. Model options come from the installed CLI. For Hermes Agent, enter the model name. Each CLI's version is under **CLIs on this device** in **Shared** of the settings.

## Ask a vault agent

The vault agent is optional. Turn it on in **Settings → Agents → vault agent**. While it is off, the AI panel beside a note is the irori agent, and hand-offs from the irori agent and routines still run a CLI inside the vault, with the vault's agent configuration. While it is on, the mark at the start of a column's header switches that column between **vault agent** and **irori agent**. irori shows a vault agent by its vault's name, such as “Research agent”. A vault named “irori” would read as the irori agent, so give it another name.

Open a note, write a request in the AI panel, and send it. The vault agent works with that vault's Schema and the selected note.

Try “Extract the decisions from these meeting notes” or “Read the materials and write a note with sources.” Review the text and [Git diff](git.md) afterward. Agents in different vaults can run at the same time.

## Check access

A new conversation starts in **Standard**, which follows the CLI's settings: Claude Code and Codex ask when needed, Pi asks for nothing, and the Antigravity CLI allows edits on its own. Switch to **Full access** where the CLI supports it. Switch per conversation under **Access** in the same menu as the model. A conversation in full access says so on the button. Access belongs to each conversation: one you switch keeps that access for its later instructions, after a restart too, while other conversations keep theirs. The access a new conversation starts in is chosen under **Access of a new conversation** in **Shared** of the [settings](settings.md) (Standard by default). Available modes differ by CLI.

In full access an agent reaches anything your user account can read or write. Through the `irori` command a vault agent reaches its own vault only, but that limit does not apply to the CLI's own tools. A read-only connection is read-only only to irori and to file edits by Claude Code and Codex in standard access; full access, shell commands, the terminal and other CLIs can still write there. A conversation in full access also uses configuration that runs without asking, such as hooks, MCP servers, plugins and project settings, without a question, and its log names what it used. A conversation in standard access asks about such configuration the first time and again after it changes.

What an agent reads, notes and connected folders alike, is sent to that CLI's AI provider.

Permission requests and questions appear in the panel. Review and answer them there. Choose **Stop** to end work in progress.

## Continue working

Instructions sent while an agent is running enter its queue. See [conversations](conversations.md) for ordering and resuming.

Keep reusable instructions as [Schema skills](schema.md). Give work across vaults to the [irori agent](irori-mode.md).

## Write an instruction

The instruction box takes up to 32,000 characters.

Type `/` in an empty instruction box to list what the CLI offers in this folder. Claude Code lists its commands and skills and runs them as in its terminal. Codex lists its skills with `/compact`, which summarizes the conversation so far, and `/review`, which reviews the uncommitted changes or follows the words after it; `$name` in your words also uses a Codex skill. Choose with the arrow keys and Enter, or keep typing to narrow the list. Other CLIs show no list.

**Attach files** (the paperclip) adds files to an instruction, up to 10 of 25 MB each. You can also drop files on the instruction box or paste an image, and send files without any words. Every CLI is told where each file is; Claude Code, Codex, OpenCode and Pi also see images as pictures. Attached files are kept on this device and deleted with their conversation.

**Dictate** (the microphone) starts the system's dictation in the instruction box: dictation on macOS, voice typing on Windows. irori records nothing itself. It is not offered on Linux.

## Answers and file links

When an agent asks a question, each option shows what it means. A question that takes several answers shows checkboxes, and **Other** takes an answer in your own words where the CLI allows one. A single question with one answer is sent as soon as you choose an option. Questions from MCP servers reach you the same way through Claude Code and Codex.

Choose a file path in a reply to open the file. A path with a line, such as `note.md:12`, opens at that line. A bare name such as `topic.md` is looked for in the workspace's vaults, their connected and work folders, and the irori agent's folder; when several files match, each is offered. A file irori cannot show, such as a program or an archive, is shown in its folder in the system's file manager rather than opened. A path outside those folders says it was not found.

## The `irori` command and the work folder

A vault agent has the `irori` command for its own vault. With it, the agent moves or renames notes, with the links into them and their comments following, and puts notes in irori's trash. It leaves [comments](comments.md) for you, signed with its name, and resolves them. It updates the indexes and changes the vault's name, category, color, icon, layers, connected folders and work folder. irori asks you before an agent connects a folder or changes the work folder.

Registering, grouping and removing vaults and starting routines stay with the [irori agent](irori-mode.md). Secret values, a routine's first review, accounts and updates stay with you.

Each vault has a work folder where its agents keep scratch files, intermediate results, downloads and trial scripts instead of the system's temporary folder. By default it is `work` in the vault's contents, kept out of Git, and Contents shows it as `work`. The irori agent may also write in the work folder of a vault it hands work to. To use another folder on this device, open **vault settings** and choose **Choose a folder** under **Work folder**. **Use the default** goes back, and **Open** opens the folder in the system's file manager.
