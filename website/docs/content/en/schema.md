---
title: Schema settings
description: Maintain AI instructions, skills, rules, hooks and sub-agents as ordinary files, for one vault or for every agent.
---

## Open settings

A vault's Schema appears only when the vault agent is on in **Settings → Agents → vault agent**.

Select an item in a vault's **Schema** to open its form in the center. Use a group's add action to create an item. The folder icon switches to **Show as files**. There, rename a file or folder with F2 or **Rename** from its menu, and delete it to the system trash with **Delete** or the Delete key. `.irori` and `.git` stay as they are, with everything in them.

| Item         | Stored file                                         |
| ------------ | --------------------------------------------------- |
| Instructions | `AGENTS.md`                                         |
| Skills       | `.agents/skills/<name>/SKILL.md` and attached files |
| Rules        | `.claude/rules/*.md`                                |
| Hooks        | `hooks` in `.claude/settings.json`                  |

Rules and hooks are written in Claude Code's format, and they reach every CLI. Claude Code reads and runs them itself. For every other CLI, irori gives the rules in the request and runs the hooks with Claude Code's meaning. Some CLIs cannot run some hooks (Hermes Agent cannot stop a tool before it runs with PreToolUse). irori asks once before running with such a hook, and keeps the answer until the hooks change. Hooks of an event that stops nothing, such as PostCompact, are only named.

## Create and use a skill

Give the skill a name, description, and instructions. Names use lowercase letters, digits, and hyphens and must match their folder. Attach any supporting text files.

Choose a skill in the AI panel before sending to include its instructions with that request. Filter by role or project when the skill defines them. Unreadable skills show **Check**.

An agent also finds the skills in `.agents/skills` without a choice, on every CLI: Codex, OpenCode and the Antigravity CLI read them themselves, irori gives them to Claude Code and Pi, and irori names them in the request for Hermes Agent. **Check reach** beside **Skills** on the Schema card of a vault's home shows how each skill reaches each CLI, and whether a personal skill of the same name takes priority.

## Share ordinary files

Settings are ordinary files inside the vault and can be shared through [Git](git.md). Edit the irori agent's Schema in the same way.

Hooks execute programs. Review the CLI and command before saving one. Deleting an item asks for confirmation. Only `.claude/settings.json` hooks are listed here. Other settings also run code: `env`, `apiKeyHelper`, `.mcp.json`, OpenCode and Pi plugins, and the `.claude` of connected folders. When a vault's ones change, irori lists them for you to confirm before an agent runs.

## Shared Schema

The **Shared Schema** holds instructions, skills, rules and hooks for every agent irori runs: the irori agent, each vault agent and the agent steps of routines, on every CLI. It does not yet reach the agent of a [vault on an SSH host](ssh-hosts.md). Open it from **Shared Schema** in **Settings → Agents → Shared**; it needs the irori agent set up. Where a vault's or the irori agent's own Schema says otherwise, its own wins.

Shared skills appear in the skill menu marked (shared). Every CLI gets them as skills of its own (Hermes Agent alone hears them listed in the request). A skill of the same name in the vault or the irori agent's Schema is used instead. irori keeps the Shared Schema in `.irori/shared/` of the irori agent's default folder, even when a workspace chooses another folder for the irori agent. It is part of the [environment saved on GitHub](settings.md#section-6).

## Sub-agents

A vault can define sub-agents in the formats of three CLIs: `.claude/agents/*.md`, `.codex/agents/*.toml` and `.opencode/agents/*.md`. irori reads all three, so the vault agent can use them whether it runs on Claude Code, Codex or OpenCode. A model a definition names is used only on that definition's own CLI.

A definition named `vault-agent` describes the vault's own agent. The irori agent sees its description, and the vault agent follows its instructions for the work the irori agent hands it.
