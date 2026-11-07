---
title: Schema settings
description: Maintain AI instructions and reusable skills as ordinary files.
---

## Open settings

Schema appears only when the vault agent is on in **Settings → Agents**.

Select an item in a vault's **Schema** to open its form in the center. Use a group's add action to create an item. The folder icon switches to **Show as files**.

| Item         | Stored file                                         |
| ------------ | --------------------------------------------------- |
| Instructions | `AGENTS.md`                                         |
| Skills       | `.agents/skills/<name>/SKILL.md` and attached files |
| Rules        | `.claude/rules/*.md`                                |
| Hooks        | `hooks` in `.claude/settings.json`                  |

Rules and hooks are written in Claude Code's format, and they reach every CLI. Claude Code reads and runs them itself. For every other CLI, irori gives the rules in the request and runs the hooks with Claude Code's meaning. Some CLIs cannot run some hooks (Hermes Agent cannot stop a tool before it runs with PreToolUse); irori asks before running with such a hook. The Rules and Hooks sections of the settings say how each reaches every CLI.

## Create and use a skill

Give the skill a name, description, and instructions. Names use lowercase letters, digits, and hyphens and must match their folder. Attach any supporting text files.

Choose a skill in the AI panel before sending to include its instructions with that request. Filter by role or project when the skill defines them. Unreadable skills show **Check**.

## Share ordinary files

Settings are ordinary files inside the vault and can be shared through [Git](git.md). Edit the irori agent's Schema in the same way.

Hooks execute programs. Review the CLI and command before saving one. Deleting an item asks for confirmation. Only `.claude/settings.json` hooks are listed here. Other settings also run code: `env`, `apiKeyHelper`, `.mcp.json`, OpenCode and Pi plugins, and the `.claude` of connected folders. When a vault's ones change, irori lists them for you to confirm before an agent runs.
