# 033 — Hibachis are vaults

Date: 2026-10-11. Status: owner decision; implemented for 0.1.98. Renames the
term set on 2026-09-27 (a brain is a hibachi) used since
[ADR 014](014-ui-v5.md) and [ADR 021](021-optional-hibachi-agent-and-agent-dock.md).

## Context

The owner wanted a name that says what a hibachi is: one knowledge base,
counted one by one, with its own agent. Pod was considered and dropped. A
vault is the folder of notes, as in Obsidian, which people moving in from
Obsidian (ADR 030) already know. A workspace stays a workspace: it is only a
combination of vaults, and one vault can be in several.

## Decisions

1. **A hibachi is a vault** everywhere: the app's words in both languages, the
   website, the agents' prompts, the `irori` command, code identifiers and
   documentation. Japanese copy keeps vault in Latin letters and reads
   naturally (「vault map」, not 「vault の地図」). Earlier ADRs and release notes
   keep the old name as a record.
2. **A vault's agent is called after its vault**: the Research vault's agent is
   "Research agent" wherever the vault is known. Where no vault is named
   (settings, help, documentation) it is "the vault agent". A vault named
   "irori" would read as the irori agent; the user documentation says so and
   nothing refuses the name.
3. **Nothing keeps the old name as an alias.** `irori run --hibachi` is
   `--vault`, sub-agents are `vault-<name>`, the standard skills are
   `add-vaults` and `new-vault`, and `routine.yaml` says `vaults:` and
   `agent: vault`.
4. *Revised by [ADR 050](050-vault-agents-and-their-sub-agents.md) (0.2.34):
   every CLI hands a vault's work with `irori call`.*
   **A hand-off on Pi and Hermes Agent is `irori call <vault> "<task>"`.** The
   separate `hibachi` command is gone; a `vault` command would have hidden
   HashiCorp Vault's CLI on the run's `PATH`, so the hand-off joined the
   `irori` command, which every agent run already has. A vault agent, or the
   irori agent on a CLI with file-defined sub-agents, is refused with the
   reason.
5. **What an earlier irori wrote is renamed, once per device, at start**
   (`src/host/vault-rename.ts`, marker `vault-migrated.json`): the device
   settings' `hibachiAgent`, conversation records (`owner.kind`, `hibachis`),
   routine run labels, and in the irori agent's folder the sub-agent
   definitions (`hibachi-<name>` files and the names in them), the two renamed
   standard skill folders, and the word in its `AGENTS.md` and standard skills.
   A failed step leaves no marker, so the next start repeats them all.
6. **What reaches the device later is renamed when read:** an environment
   saved on GitHub before this version, and a `routine.yaml` with the old keys,
   which irori rewrites in place. A routine the person had confirmed stays
   confirmed, since irori made the change.

## Consequences

- A rewritten `routine.yaml` shows as a change in its vault's Git status.
- Comments an agent wrote before keep "(hibachi agent)" as their author line;
  they are the person's records and are not rewritten.
- An older irori cannot read records or routines this version renamed.
