# 025 — The irori agent sets up hibachis, with standard skills

Date: 2026-10-05. Status: owner request; implemented for 0.1.71. Decision 2
is widened by [ADR 030](030-moving-in-with-the-irori-agent.md): the command
also changes and takes back what irori holds.

## Context

The owner described irori's customer journey as: download irori; keep a
working folder on the computer; keep knowledge on GitHub and materials in a
cloud folder; connect both to irori; start working. Every step after the
download was done by hand in irori's own dialogs: **GitHub から取得** for each
repository, a workspace edited on the start screen, and a folder connection
in each hibachi's 接続先.

The owner asked for the irori agent to do that work: for example, given a list
of GitHub repositories, it makes them hibachis. The irori agent should come
with standard skills for such work already in place.

The irori agent already ran with full access on every CLI and could run `git`
and `gh` itself. What it could not do was the part only irori holds:
registering a folder as a hibachi on this device, adding it to a workspace,
and connecting a folder into a hibachi's contents. Those live in irori's data
directory and in the window's state.

## Decisions

1. **An `irori` command on every irori agent run.** Like the `hibachi`
   command (Pi, Hermes Agent), irori puts a launcher on the run's PATH that runs
   irori's own runtime as Node and asks irori over a loopback URL with a random
   token, kept only in that run's environment (`IRORI_COMMAND`). Unlike it, the
   command is offered on every CLI, since registration is irori's on all of
   them. Both commands share one bridge (`src/agents/command-bridge.ts`).
2. **It only adds.** `irori list`, `irori clone <GitHub URL or owner/name>`,
   `irori create <folder>`, `irori add <folder>` and
   `irori connect <hibachi> <folder>`. Nothing is removed, renamed or replaced.
   Clones and new hibachis go only into new folders; a repository or folder
   already registered just joins the workspace, so a list can be given twice.
3. **Hibachis join the workspace the request came from.** An irori agent
   request carries its workspace's id (`StartRun.workspace`, refused for a
   hibachi agent); a routine's irori agent step carries the routine's. The
   window takes the saved workspace in at once (`hibachis` event).
4. **New folders wait for no run.** irori's Git operations otherwise wait for
   every run to end, and the irori agent's own run is one. A clone, a new
   hibachi's folder and its first commit are in a folder no run can reach, so
   they go ahead (`duringRuns`). Connecting a folder waits only for the
   hibachi's own agent, not for the irori agent's hold.
5. **New hibachis go beside the irori agent's folder** (`~/irori` by default)
   unless the command names a parent folder. Relative paths are taken from the
   agent's working folder, and `~` is the home folder.
6. **Standard skills in the irori agent's folder.** `irori-setup` (the whole
   journey), `add-hibachis`, `new-hibachi` and `connect-folder`, as
   `.agents/skills/<name>/SKILL.md` (`prompts/irori-agent-skills.ts`). They are
   written when the folder is set up. A folder set up earlier gets the missing
   ones from a button on the irori agent's screen, never on its own, so a skill
   the person deleted stays deleted until they ask. A present skill folder is
   never replaced.
7. **Discovery through the instructions, not per-CLI copies.** Claude Code does
   not read `.agents/skills` ([SKILLS](../SKILLS.md#reach)). Rather than a
   second copy in `.claude/skills`, every irori agent request names the command
   and says the procedures are in the folder's `.agents/skills`; the starter
   `AGENTS.md` says the same. The person can also choose one in the composer.

## Consequences

- The irori agent can carry the journey from a list of repositories to a
  workspace of hibachis with their cloud folders, and report what failed.
- `new-hibachi` starts a hibachi with `irori create` and, when the person wants,
  puts it on GitHub with `gh repo create --source`. It does not use
  `irori-templete`: the owner decided on 2026-10-05 not to use the template yet.
- A hibachi registered during a request is handed to the irori agent from the
  next request; in the same request its folder is reachable only through the
  shell.
- Codex in the standard mode runs commands in its sandbox, which may refuse the
  loopback connection the command needs, as it may for the `hibachi` command.
