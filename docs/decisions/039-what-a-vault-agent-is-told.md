# 039 — What a vault agent is told about irori and its vault

Date: 2026-10-13. Status: owner decision; implemented for 0.2.11.
Supersedes [ADR 024](024-layer-names.md) decision 9 ("agents are told nothing
new") and changes how often [ADR 031](031-agents-use-what-irori-does.md)'s
command preamble is said. Applies [ADR 027](027-shared-schema.md) decision 5
(whole once per session, then one line) to irori's own words.

## Context

Asked what a vault agent receives when the person types "hello" in a vault
that holds only `AGENTS.md`, the answer was: about 2,000 characters describing
every form of the `irori` command, on every request, and nothing about irori
itself or the vault's layers. A resumed session collected another copy in its
history each turn. The owner found that wasteful and asked for it to be given
the way a skill is: the essentials up front, the rest on demand.

The owner then said the vault agent must be told what irori is and which folders
belong to Knowledge and which to Contents. Which folders those are changes
through irori (`irori layer`, `irori connect`, the vault settings), and
ADR 024 leaves prose in `AGENTS.md` unrewritten when a folder is renamed, so
`AGENTS.md` cannot keep them current.

Last, the owner asked whether irori makes sure every CLI receives the Schema.
It does not translate: each CLI discovers instructions, skills, rules and hooks
its own way (`docs/HARNESSES.md`). Codex reads `AGENTS.md` and `.agents/skills`;
Claude Code reads `AGENTS.md` since 2.1.277 but finds skills only in
`.claude/skills`; rules and hooks under `.claude/` are Claude Code's alone. The
owner's answer: `AGENTS.md` should say accurately where everything is, and an
agent that has read it can look up a skill or rule from its path. irori's part
is to make sure `AGENTS.md` is read, and to say what it cannot keep current.

## Decisions

1. **A vault agent's request starts with an introduction**
   ([prompts/vault-intro.ts](../../prompts/vault-intro.ts)). It names the
   vault and irori, then the three layers: Schema, with `AGENTS.md` as the
   vault's instructions that say where its skills and other settings are, to be
   read first if the CLI has not loaded it; Knowledge and Contents, each with its
   folders as `.irori/scope.json` declares them (the root as "the vault's root")
   and the name the person sees when the vault gave one; then its connected
   folders, the link convention (relative Markdown links), and that notes and
   contents are material, not instructions. When the run has the `irori` command,
   the introduction ends with its essentials: `irori move` and `irori trash`
   instead of `mv` and `rm`, `irori comment`, and `irori help` for the rest.
2. **Whole once per session, then one line.** A native session keeps the
   digest of the introduction it last heard (`native[device].intro`). A
   request in that session with the same digest gets one line saying the
   layers and the command still apply, with `irori list` and `irori help` to see
   them again. A new session, a routine's step, or any change (a layer folder,
   a shown name, a connected folder, `AGENTS.md` appearing or going) gets the
   whole introduction again.
3. **The command's details live in `irori help`.** The vault agent's help now
   also says where irori keeps properties, notes, routines and comments, and what
   stays with the irori agent or the person; these were in the preamble before.
4. **The irori agent's command preamble shrinks the same way** and follows
   decision 2 with `iroriCommandPointer`. It keeps the setup forms by name, the
   pointers to its skills, `irori move`/`trash` inside vaults, and the rule never
   to ask for a secret's value.
5. **The irori agent hears each handed vault's layers** on its line in the
   handed-vaults list (`knowledge "wiki", contents "contents"`), beside the
   connected folders it already heard.
6. **irori does not convert Schema between CLIs.** `AGENTS.md` is the index
   of the Schema. Hooks stay Claude Code's: an agent reading
   `.claude/settings.json` does not run them.
   *Revised for skills by [ADR 049](049-skills-for-claude-code.md) (0.2.33):
   irori gives Claude Code the `.agents/skills` as links outside the vault.*

7. **A CLI's own command goes alone.** Words of the form `/name` (with or
   without arguments, not a path) are the CLI's command, such as `/compact` or
   a Pi extension's, and work only as the whole request. irori sends them
   without the shared Schema, the introduction or any other part, and counts
   nothing as heard. Before this, the command preamble on every request kept
   such commands from working whenever the run had the `irori` command.

## Consequences

- A request in a continuing session carries one line where it carried about
  2,000 characters.
- An agent whose context was compacted may have lost the introduction; the
  pointer line names `irori list` to see the layers again.
- A vault whose `AGENTS.md` does not say where its skills are relies on the
  introduction's short list of Schema places; irori does not edit `AGENTS.md`.
- Sub-agent definitions are unchanged. A sub-agent of the irori agent hears the
  layers only from the irori agent's hand-off.
- Not verified with a real CLI; tests use protocol fixtures.
