# 048 — The shared Schema takes every setting, and the irori agent's files travel with the environment

Date: 2026-10-18. Status: owner request; implemented for 0.2.26.

Builds on [ADR 027](027-shared-schema.md) (the shared Schema), [ADR 026](026-github-account-environment.md)
(the saved environment) and [ADR 043](043-routines-in-the-environment.md) (routines in it).

## Context

The owner asked whether **環境を保存** keeps the shared Schema. It did not: the
shared Schema is `.irori/shared/` in the irori agent's folder, and the
environment kept only that folder's repository URL, which most people's folder
does not have. ADR 027 had expected the shared Schema to travel "with the
account's environment", and it did not. The owner asked that the shared Schema
and everything of the irori agent be saved.

The owner also asked that the shared Schema offer the same settings as the other
Schemas. ADR 027 D2 had limited it to instructions and skills, leaving out
rules and hooks as one CLI's.

## Decisions

1. **The shared Schema takes the irori agent's settings:** instructions, skills,
   rules (`.claude/rules/*.md`) and hooks (`.claude/settings.json`), with the
   same forms. *Revises ADR 027 D2.*
2. **Shared rules are words for every agent.** irori sends them with the shared
   instructions to every CLI, whole while instructions and rules together stay
   within 32 KiB, otherwise as their files to read. A rule's front matter that
   names paths limits it to those files, as the words say. A vault's own rules
   still reach Claude Code alone, which reads them itself.
3. **Shared hooks are Claude Code's.** Every Claude Code run irori starts (the
   irori agent, a vault agent, a hand-off's sub-agents, a routine's agent step)
   gets the shared `hooks`, and nothing else from that file, as flag settings
   (the SDK's `settings`, `--settings`). They run beside the folder's own hooks.
   Other CLIs have no hooks from irori. Hooks not in Claude Code's shape are
   refused and the run says so.
4. **The irori agent's files are saved beside the environment,** as
   `irori-agent.json` in `irori-settings`: every file of its default folder
   (UTF-8 text as text, anything else as base64, with the executable bit),
   whether or not the folder is a repository. Left out: `.git`, `node_modules`,
   `routines/` (in `routines.json`), the vault sub-agent definitions irori writes
   per device (they name this device's vault folders, and irori writes them again
   where absent), `.claude/settings.local.json`, and links. Within GitHub's 1 MB
   limit the shared Schema goes first, then the Schema (`AGENTS.md`, `.agents/`,
   `.claude/`, `.codex/`, `.opencode/`), then the rest; what does not fit is
   named in the account section.
5. **Saving where the irori agent is not set up keeps the saved files.** Without
   an `AGENTS.md` on this device nothing is packed and `irori-agent.json` stays
   as it is, so a fresh device cannot wipe it.
6. **Restoring adds files.** **環境を復元** offers the irori agent's files when
   this device lacks some. A file absent here is written. A file irori set up
   and nobody changed since (the starter `AGENTS.md`, a standard skill as irori
   wrote it) gives way to the saved one. Any other file here stays, and the
   restore names it. A folder holding files but no `AGENTS.md` is not written
   into, as setting the irori agent up there would refuse it. The files come
   after the folder is cloned (when chosen) and before the routines, which need
   the irori agent set up.

## Consequences

- A new device gets the shared Schema and the irori agent's Schema and files from
  one restore, without the folder being a repository.
- Conversations and the folders a workspace chose for the irori agent (ADR 044)
  stay on the device.
- A file edited on two devices is not merged: the last save wins, and a restore
  never overwrites a file the person changed here.
- The shared rules make the shared request text longer. They are sent whole once
  per native session and after a change, like the instructions (ADR 027 D5).
