# 031 — Agents do through irori what the person does in irori

Date: 2026-10-11. Status: owner decision; implemented for 0.1.95. Extends
[ADR 025](025-irori-agent-setup.md) and [ADR 030](030-moving-in-with-the-irori-agent.md).

## Context

The owner asked whether the irori agent and the hibachi agents can use
everything irori offers, and said they should. A review of what agents are
given (`prompts/`) against the HostAPI found that they could not:

- The irori agent could set hibachis up (ADR 025, ADR 030), but the hibachi
  agent had no `irori` command and was told nothing about irori.
- Neither could move or rename a note the way irori does. `mv` breaks the
  relative links into the note, leaves its comments under `.irori/comments/`
  behind, and drops the device's material IDs and person-line records.
- Neither could leave or resolve a comment, update the graph and folder
  indexes (**索引を更新**), or set a hibachi's color or icon.
- A hibachi agent could write a routine file but not check it.

## Decisions

1. **The principle.** What the person can do in irori's screens, an agent can
   do through irori. The exceptions stay with the person on purpose: a secret's
   value, a routine's first review (ADR 016), accounts and environment saving,
   updates, and the agents' own permissions and on/off switch.
2. **Every hibachi agent run has the `irori` command,** served like the irori
   agent's. It reaches only its own hibachi (`SetupContext.hibachi`). It refuses
   the forms that register, group or remove hibachis or start routines
   (`clone`, `create`, `add`, `workspace`, `remove`, `run`), and refuses another
   hibachi named by name or reached by a path. `.` names its own hibachi from its
   folder. Its changes to its own hibachi go ahead during its own run; they still
   wait for Git operations and connection setup.
3. **Note forms for both agents.**
   - `irori move <note> <path or folder>` is the explorer's move with link
     rewriting (`moveNoteCarrying`, shared with the HostAPI): links into the
     note, its comments, images beside it, material IDs and person-line
     records follow. It only handles Markdown notes in knowledge.
   - `irori trash <note>` puts a note in irori's own trash, which the person
     restores from.
   - `irori comment` leaves a comment signed `<CLI> (hibachi agent)` or
     `<CLI> (irori agent)`. `irori resolve <file> <id>` removes one and refuses
     an id the file does not hold.
   - `irori index [<hibachi>]` writes the graph and folder indexes, as the
     button does.

   The irori agent may name any hibachi. Claude Code, Codex and OpenCode
   sub-agents share its command.
4. **`irori set` takes `--color` and `--icon`.** The icon is a glyph name or one
   or two characters. An image icon stays in the settings, which choose the file.
5. **Agents are told.**
   - A hibachi agent's request carries `hibachiCommandPreamble`, which covers
     the forms it has and what irori keeps in files: properties, today's note,
     routines, Schema, and relative links.
   - The irori agent's preamble, `irori-guide`, and new sub-agent definitions
     say to prefer `irori move`/`trash` over `mv`/`rm`. Existing definitions
     are not rewritten.

## Consequences

- A hibachi agent can reorganize its notes without breaking links, answer the
  person's comments, keep indexes current, and set its hibachi up.
- Sub-agent definitions written before 0.1.95 do not mention the note forms.
  The irori agent's preamble says them on every request.
- Not verified with a real CLI; tests use protocol fixtures and host stubs.
