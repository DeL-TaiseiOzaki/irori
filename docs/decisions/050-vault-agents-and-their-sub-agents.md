# 050 — A handed vault runs as its vault agent, and a folder's sub-agents work on any CLI

Date: 2026-10-18. Status: owner decision; implemented for 0.2.34.

Revises [ADR 014](014-ui-v5.md)'s sub-agent per vault, written by irori since
the owner's 2026-09-27 answers; [ADR 027](027-shared-schema.md) decision 7; and
[ADR 033](033-vaults.md) decision 4, which kept `irori call` for Pi and
Hermes Agent.

## Context

On Claude Code, Codex and OpenCode, irori wrote a `vault-<slug>` sub-agent
definition into the irori agent's folder for each handed vault. The irori
agent's CLI then ran it as its own sub-agent. A real check on 2026-10-18 (Claude
Code 2.1.295, Codex 0.160.0) showed what that sub-agent was:

- It worked in the irori agent's folder and inherited the irori agent's
  `AGENTS.md` and rules, including "do not edit a vault's files yourself".
- It loaded none of the vault's `.claude/rules`, `CLAUDE.md`, `.claude/skills`
  or hooks, and read the vault's `AGENTS.md` only because its definition said so.
- On Claude Code its tools left out Bash, yet the definition told it to use
  `irori move` and `irori trash`.

The owner said this is a problem, and set out the two cases:

- When the irori agent calls a vault agent as a sub-agent, that vault agent
  follows the Schema of its vault.
- When the vault agent calls its own sub-agents, they follow the definitions in
  the vault's Schema.

A vault may define these in `.claude/agents` or `.codex/agents`, and either
format must work whichever CLI runs. The owner also confirmed that a definition
in the vault's `.claude/agents` may be the vault agent's own definition. A
model named in a definition is used only on the CLI of that definition's format.

Orca, which runs the same CLIs side by side, uses no CLI's native sub-agents
for its workers. It starts each worker as a separate CLI process in that
worker's folder, which loads its own instructions and skills there.

## Decisions

1. **A hand-off is `irori call` on every CLI.** The irori agent's request names
   each vault, its vault agent `vault-<slug>` and how to hand it work with
   `irori call`, not with the CLI's own sub-agents (`brainsCommandPreamble`).
   irori starts the vault agent in the vault, where its CLI loads the vault's
   Schema itself, with irori's introduction (ADR 039), the shared Schema
   (ADR 027) and the task. irori no longer writes sub-agent definitions into the
   irori agent's folder, and the starter `AGENTS.md` says so.
2. **The hand-off runs in the irori agent's access mode**, not in the vault
   agent's starting mode. Its permission requests and questions show with the
   irori agent too, labelled with the vault. An answer in either place reaches
   the vault agent's run.
3. **A vault may define its own agent** as `vault-agent` in any of the three
   formats: `.claude/agents/vault-agent.md`, `.codex/agents/vault-agent.toml` or
   `.opencode/agents/vault-agent.md`. The one in the running CLI's format comes
   first. Its description goes on the vault's line for the irori agent, and its
   instructions go with each hand-off. Its model is used only when its format is
   the running CLI's (owner's answer); otherwise the irori agent's model stands.
4. **A folder's other definitions are its agent's sub-agents on every CLI.**
   irori reads `.claude/agents/*.md`, `.codex/agents/*.toml` and
   `.opencode/agents/*.md`. Each CLI loads its own format, and irori gives it
   the others without writing into the folder:
   - Claude Code: the Agent SDK's `agents`.
   - Codex: thread configuration roles, `agents.<name>.description` and
     `agents.<name>.config_file` with a role file in irori's data directory.
   - OpenCode: `agent` in `OPENCODE_CONFIG_CONTENT`.

   The CLI's own format wins a name. A translated definition carries its
   description and instructions. `vault-agent` is never one of the vault
   agent's own sub-agents (Claude Code is refused `Agent(vault-agent)`).
5. **Earlier `vault-*` definitions in the irori agent's folder are left in
   place and not used.** irori does not give them to another CLI, Claude Code
   is refused them, and the preamble says not to use the CLI's own sub-agents
   for a vault.
6. **The irori agent's long shell commands are not cut off.** Claude Code's
   default two-minute shell timeout would end a hand-off. The irori agent's
   Claude Code runs therefore have `BASH_DEFAULT_TIMEOUT_MS` and
   `BASH_MAX_TIMEOUT_MS` set to a day.
7. **The write boundary is one rule.** The irori agent and any sub-agent of its
   own write only in its folder and in the vaults' work folders. A refused write
   in a vault says to use `irori call`.

## Consequences

- A vault agent is the same agent whether the person talks to it or the irori
  agent hands it work. It has its vault's rules, hooks, skills (ADR 049) and
  sub-agents, and is no longer a sub-agent inside the irori agent's session.
- A hand-off is a separate run with its own CLI process, so it costs a process
  start. It is kept in that vault's conversation for the irori agent's
  conversation, as `irori call` hand-offs already were.
- Translated sub-agents lose their models and tool limits.
- Verified on 2026-10-18 with real CLIs through `npm run test:your-ai`, in
  standard mode:
  - Claude Code 2.1.295: Alpha's `AGENTS.md` was followed, as was Beta's own
    `vault-agent` definition written in Codex's format. A Codex-format
    sub-agent was used from Claude Code. Nothing was written into the irori
    agent's folder.
  - Codex 0.160.0: the same checks passed, a Claude-format sub-agent used from
    Codex among them; roles given as thread configuration were spawned.
- Not tried: OpenCode, Pi and Hermes Agent with real models; the full access
  mode on Claude Code, which this VM's root user cannot use.
