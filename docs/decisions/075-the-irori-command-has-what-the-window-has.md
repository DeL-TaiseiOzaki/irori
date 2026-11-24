# 075 — The `irori` command has what the window has for setting up

Date: 2026-11-24. Status: owner request; implemented for 0.2.99.
Builds on [ADR 025](025-irori-agent-setup.md) (the irori agent sets vaults up
with the `irori` command), [ADR 031](031-agents-use-what-irori-does.md) (agents
use what irori does) and [ADR 074](074-the-irori-agent-makes-vaults-on-ssh-hosts.md).

## Context

After the irori agent could not make vaults on an SSH host (ADR 074), the owner
asked whether other features irori has were out of the irori agent's reach. The
HostAPI was compared with the `irori` command's forms. Leaving out what an
agent does in its own shell (files, Git, `gh`) and what stays with the person
by decision (secrets, a routine's review, restoring from irori's trash, the
environment on GitHub, device settings and permissions, signing in), these
window actions had no form: moving a note into another vault, copying with its
links kept, stopping a routine, adding the standard skills or renewing them,
renaming or deleting a workspace and grouping its vaults, renaming a connected
folder or changing whether agents may change it, the strays in contents, an
image as a vault's icon, and installing uv for routines. The owner asked for
all of them, simply.

## Decisions

Each form calls what the window's action calls, with its guards.

1. **`irori move` crosses vaults** into a folder of another vault's knowledge,
   as the explorer's move to a vault does (ADR 038): its comments and images
   go with it, links to and from it break, and the command says how many.
2. **`irori copy <path> <folder>`** copies as the explorer's paste does, never
   over an entry, keeping where a knowledge copy's links lead.
3. **`irori stop <routine>`** ends a run in progress, as 停止 does.
4. **`irori skills [--update]`** adds the standard skills the irori agent's
   folder lacks and names those that differ from this irori's;
   `--update` writes this irori's SKILL.md over them, after the person allows it.
5. **`irori workspace` takes `--rename`, `--delete`, `--group` and
   `--ungroup`.** Deleting leaves its vaults and waits for the person's 許可.
   A vault is in one group at most.
6. **`irori connection <vault> <name>`** renames a connected folder (unlinked,
   renamed and linked again) or makes it read-only or editable. A GitHub
   repository keeps the access it was connected with.
7. **`irori strays <vault>`** lists what contents holds that no connection
   names; `--adopt` registers a link as a connection, and `--remove` deletes a
   link or moves anything else to the system trash after the person allows it.
8. **`irori set --icon-image <file>`** sets a PNG, JPEG, GIF or WebP image of at
   most 2 MiB as the vault's icon, as its settings do.
9. **`irori install python`** downloads uv for routines' Python steps, after the
   person allows it.

`stop`, `skills` and `install` are the irori agent's; a vault agent has `copy`,
`connection` and `strays` for its own vault, as it has `move` and `connect`.

## Consequences

- What the person still does alone is unchanged: secrets, a routine's review,
  restoring from irori's trash, saving the environment on GitHub, agent
  permissions and device settings, signing in, updates and SSH's prompts.
- A renewed standard skill loses the person's edits to its SKILL.md; the
  command names the differing ones first and the person allows the rewrite.
