# 040 — A CLI's own commands and skills, typed as `/name`

Date: 2026-10-13. Status: owner decision; implemented for 0.2.12.
Builds on [ADR 039](039-what-a-vault-agent-is-told.md) decision 7 (a CLI's own
command goes alone).

## Context

The owner asked whether what Claude Code, Codex and the other CLIs already
offer — their commands and skills — can be used through irori. irori starts
each CLI without limiting its tools, so the CLI loads the person's skills, MCP
servers and bundled skills as it would in a terminal, and the agent may use a
skill on its own. Calling one by name was another matter:

- Claude Code runs `/name` at the start of a request (a command, a bundled or
  personal skill, a plugin's `/plugin:skill`), once ADR 039 stopped irori's
  words from preceding it.
- Codex's app server takes no `/name` in a turn's text. Compaction and review
  are methods (`thread/compact/start`, `review/start`), and a skill is named
  with a `skill` input item, which its own composer adds for `$name`.
- The composer offered the vault's and the shared Schema's skills, never the
  CLI's, so a person had to know a name to type it.

The owner asked for both: Codex's commands and skills working through irori, and
the composer offering what the CLI has when `/` is typed.

## Decisions

1. **The host lists a folder's commands** (`agentCommands`, `src/agents/commands.ts`).
   Claude Code's come from `supportedCommands()` of a session in the owner's
   folder that is sent no message (the way models are already read), with the
   person's, the project's and local settings. Codex's are `compact` and
   `review`, which irori runs, then the enabled skills its app server's
   `skills/list` gives for the folder. Nothing generates text. A list is kept
   a minute per CLI version and folder, so a new skill shows up soon. OpenCode,
   Pi and Hermes Agent are not asked; their lists are empty.
2. **The composer offers them while the request is `/` and part of a name**
   (`src/app/CommandMenu.tsx`): names that start with what was typed first, a
   skill marked as one. Arrows choose, Enter or Tab puts `/name ` in the box,
   Escape closes the list. A click chooses too.
3. **On Codex, irori turns `/name` into what its app server takes.**
   - `/compact` compacts the native session. With none yet, irori says there
     is nothing to summarize and does not ask Codex.
   - `/review` reviews the uncommitted changes, `/review <words>` reviews by
     those words, inline in the same session. The findings Codex gives when it
     leaves review mode are the run's answer.
   - `/skill <words>` sends a `skill` item and `$skill <words>`; `$skill` among
     other words sends the item beside the whole request. Only skills
     `skills/list` names are sent as items.
   - Any other `/name` goes as words.
4. **Claude Code takes `/name` as it is.** irori sends it alone (ADR 039).

## Consequences

- Reading Claude Code's list starts a `claude` process in the folder each
  minute the list is opened, and MCP servers it starts with. No model runs.
- Codex's TUI commands other than these two, and Claude Code's interactive-only
  ones, do nothing useful through irori.
- The vault's own skills in `.agents/skills` stay in the skill picker; Claude
  Code lists only those it finds itself (`.claude/skills`, the person's, bundled).
- Not verified with a real CLI: Codex's behaviour with these items and methods,
  and Claude Code's list, are tested against protocol fixtures.
