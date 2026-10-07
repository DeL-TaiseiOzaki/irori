# 027 — A shared Schema every agent follows, set from the settings

Date: 2026-10-07. Status: owner request; implemented for 0.1.80.

## Context

The owner asked how to give one Schema to every hibachi agent, not only the
irori agent. irori had no such place: each hibachi agent reads its own
hibachi's `AGENTS.md` and `.agents/skills`, the irori agent reads its own
folder, and the only ways to reach all of them were copying the same text into
every hibachi or writing each CLI's user-level file (`~/.claude/CLAUDE.md`,
`~/.codex/AGENTS.md`, …), which also reaches every session outside irori.

The owner then asked for a Schema shared by every kind of agent irori runs,
and chose:

- to keep it inside the irori agent's folder, so it travels with that folder's
  repository and with the account's environment (ADR 026);
- to share instructions and skills;
- to set it from the settings screen rather than by preparing files, with
  irori saving it as Schema files in that folder, as Obsidian keeps a vault's
  settings in `.obsidian`;
- to reach every hibachi's own Schema from the same settings screen too
  (answer (b): edit them there, not copy the shared Schema into each hibachi).

## Decisions

1. **The shared Schema is a folder in the irori agent's folder,**
   `.irori/shared/`, laid out like a hibachi's Schema: `AGENTS.md` for the
   instructions and `.agents/skills/<name>/SKILL.md` for the skills. It needs
   the irori agent's folder to be set up. irori makes the folder when the
   settings first open it; the files are written only through the forms.
2. **Instructions and skills only.** Claude Code's rules and hooks are one CLI's
   and are not shared; the host refuses them in that folder
   (`SchemaFolder.settings`). Its `AGENTS.md` can be emptied but not deleted, as
   the irori agent's own.
3. **Settings → Schema opens every Schema.** One dialog lists the shared
   Schema (共通), the irori agent and, while hibachi agents are on (ADR 021),
   each hibachi of the workspace, and edits the chosen one with the existing
   Schema forms. The shared Schema's id for the host is a fixed UUID
   (`sharedSchemaId`), since every host request checks a space id as one. A
   hibachi's Schema is locked while a run, a Git operation or a connection
   holds it, the irori agent's while it runs.
4. **Every request carries it.** irori puts the shared Schema first in the
   request text of every agent it runs: a hibachi agent, the irori agent, a
   hand-off through the `hibachi` command and a routine's agent step, on every
   CLI ([prompts/shared-schema.ts](../../prompts/shared-schema.ts)). It gives the
   instructions and each skill's name, description and file. Instructions over
   32 KiB are pointed at instead of sent.
5. **Whole once per session, then one line.** A native session keeps the
   digest of the shared Schema it last heard (`native[device].shared`). A
   request in that session with the same digest gets one line saying the
   shared Schema still applies; a new session, a change, or a session that
   predates it gets the whole text again.
6. **The folder's own Schema wins.** The words say the shared Schema applies
   beside the Schema of the folder the agent works in, and that the folder's
   wins where they differ.
7. **Sub-agents hear it too.** A hibachi's sub-agent does not see its parent's
   request, so a new definition irori writes names the shared Schema's
   `AGENTS.md` and skills, and the irori agent is told to pass the shared
   Schema on with each hand-off, which covers definitions written earlier.
8. **Shared skills in each composer.** A hibachi's composer offers the shared
   skills after its own, marked (共通 / shared); the hibachi's own skill wins a
   name both have. A run that names a skill its own Schema lacks takes the
   shared one, and the skill's words say where it came from.

## Consequences

- One edit in the settings reaches every agent's next request on every CLI,
  without copying files into hibachis or touching CLI user settings.
- The shared Schema is in the irori agent's folder, not in the hibachis: a
  hibachi cloned elsewhere, or opened by a CLI outside irori, does not carry it.
- A hibachi agent in a standard access mode may be asked before it reads a
  shared skill's file, which is outside its folder. A skill picked in the
  composer is sent whole and needs no read.
- The whole text goes again after a native session is compacted only when the
  shared Schema changes; the one line names the folder so the agent can read it
  again.
