---
title: Schema settings
description: Maintain AI instructions and reusable skills as ordinary files.
---

## Open settings

Schema appears only when the hibachi agent is on in **Settings → Agents**.

Select an item in a hibachi's **Schema** to open its form in the center. Use a group's add action to create an item. The folder icon switches to **Show as files**.

| Item         | Stored file                                         |
| ------------ | --------------------------------------------------- |
| Instructions | `AGENTS.md`                                         |
| Skills       | `.agents/skills/<name>/SKILL.md` and attached files |
| Rules        | `.claude/rules/*.md`                                |
| Hooks        | `hooks` in `.claude/settings.json`                  |

Rules and hooks use Claude Code's mechanisms. They do not have identical effects in every CLI.

## Create and use a skill

Give the skill a name, description, and instructions. Names use lowercase letters, digits, and hyphens and must match their folder. Attach any supporting text files.

Choose a skill in the AI panel before sending to include its instructions with that request. Filter by role or project when the skill defines them. Unreadable skills show **Check**.

## Share ordinary files

Settings are ordinary files inside the hibachi and can be shared through [Git](git.md). Edit the irori agent's Schema in the same way.

Hooks execute programs. Review the CLI and command before saving one. Deleting an item asks for confirmation.
