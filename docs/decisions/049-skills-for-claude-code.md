# 049 — irori gives Claude Code the skills in `.agents/skills`

Date: 2026-10-18. Status: owner decision; implemented for 0.2.33.
Revises [ADR 025](025-irori-agent-setup.md) decision 7 and
[ADR 039](039-what-a-vault-agent-is-told.md) decision 6 for skills.

## Context

irori writes every skill to `.agents/skills/<name>/SKILL.md`: a vault's skills
from the Schema settings, the irori agent's standard skills, and the shared
Schema's. Codex, OpenCode and Pi read that folder. Claude Code reads a folder's
skills only from `.claude/skills` ([SKILLS](../SKILLS.md#reach)), and this was
known from 2026-09-21. ADR 025 and ADR 039 left Claude Code to find the skills
through `AGENTS.md`, which irori does not write skill entries into.

A real check on 2026-10-18 (Claude Code 2.1.295) confirmed what this means: a
vault agent on Claude Code did not list the vault's `.agents/skills`, and when
asked to run one it took a same-named `.claude/skills` skill instead. The owner
said irori has to absorb this difference itself.

Orca, which runs the same CLIs, keeps one copy in `.agents/skills` and links
`.claude/skills/<name>` to it inside the project. In a vault, such links would
be changes Git shows on every device, and Git on Windows checks symbolic links
out as plain files unless `core.symlinks` is on. The owner chose to keep the
links out of the vault.

## Decisions

1. **Each Claude Code run gets a folder of links.** Before a Claude Code run
   (a vault agent, the irori agent, a routine's agent step, a vault agent called
   with `irori call`), irori makes `claude-skills/<run>/.claude/skills/<name>` in
   its data directory. Each entry is a link to one skill folder: a directory
   symbolic link, or a junction on Windows. The folder is passed to Claude Code
   as an additional directory, so Claude Code reads its `.claude/skills` beside
   the working folder's own.
2. **Which skills.** First the run folder's own `.agents/skills`, as irori lists
   them; then the shared Schema's. A name the folder has wins over the shared
   Schema's (ADR 027 D8). A name in the folder's `.claude/skills` is left to
   Claude Code, and a name the folder retired is not taken from the shared
   Schema either.
3. **Nothing is written into a vault or the irori agent's folder.** The links
   are removed when the run ends. Links left by a run that did not end (a crash)
   are removed when irori starts again.
4. **The words stay.** The shared Schema's skill list is still in every request,
   for every CLI, and the instructions still say where the skills are. If
   irori cannot make the links, the run goes on and says so.
5. **The skill reach view says "irori gives it"** for Claude Code, instead of
   "does not read it".

## Consequences

- Inside irori, a skill made in the settings is a Claude Code skill: listed
  with its description and run with the Skill tool or `/name`.
- Outside irori, Claude Code still does not see `.agents/skills`.
- The additional directory gives Claude Code access to the linked folders,
  among them the shared Schema's skills. A vault agent in the standard mode
  therefore reads a shared skill's files without asking.
- A personal skill of the same name in `~/.claude/skills` is expected to win,
  as it does over project skills. This was not tried with a linked skill.
- Verified with a real Claude Code 2.1.295 in standard mode. The vault's and
  the shared Schema's skills were listed and run, the run resumed in a new
  session's folder of links, and no links were left. Windows junctions were not
  tried on a Windows machine.
