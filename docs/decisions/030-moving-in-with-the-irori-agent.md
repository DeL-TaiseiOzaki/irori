# 030 — Moving in from another tool is a conversation with the irori agent

Date: 2026-10-09. Status: owner request; implemented for 0.1.91. Widens
decision 2 of [ADR 025](025-irori-agent-setup.md).

## Context

The owner wants people who use Obsidian, orca or another tool to move into
irori as smoothly as possible, and asked for it to be agentic rather than
rule-based: from irori mode, the irori agent makes the hibachis, connects the
folders and does the rest.

A first proposal fixed answers in advance (register vaults in place, keep
plain folders, declare rather than restructure) and asked the owner to choose
among them. The owner rejected that frame on 2026-10-09:

- Where a vault goes, whether a folder is Git, whether a vault sits inside
  Google Drive, and which parts become knowledge or contents differ from
  person to person, and the picture after the move may be nothing like the
  one before. Those are the person's answers, gathered by the agent.
- Code and other material that should not become a hibachi has to be absorbed
  by the agent too, for any tool, IDEs included.
- Reorganizing is part of the same hearing protocol.
- People moving in do not understand irori yet. The agent must understand irori
  and everything it can do — routines, creating and removing hibachis,
  connecting folders into contents, Git — and support the move as one who
  knows it.

Under ADR 025 the `irori` command could only add: register, clone, create and
connect. A move that the person shapes needs the rest of what irori holds on
their behalf: layer folders, names, categories, workspaces, connections taken
back and hibachis taken off the device.

## Decisions

1. **No migration rules in irori.** irori does not import a vault or a
   project. The irori agent reads what the person has (`obsidian.json`, a
   vault's `.obsidian/`, orca's `orca-data.json`, editors' recent folders,
   folders the person names) and decides nothing until it has asked.
2. **A standard skill holds the protocol, `move-to-irori`:** look (read only),
   ask in rounds with a suggestion and its reason for each question, write the
   agreed plan to `moves/<date>.md` in the irori agent's folder and wait for a
   yes, carry it out, report. Moving or copying folders, removing a hibachi,
   a new GitHub repository and rewriting notes each need their own yes. The old
   tool's files and settings are never changed unless asked.
3. **A standard skill says what irori is, `irori-guide`:** each capability
   and whether the agent does it with the command, by writing a file
   (`.irori/notes.json`, Git in the shell), or the person does it in irori
   (turning the hibachi agent on, the shared Schema, saving the environment,
   pressing 実行). It names what irori does not have (plugins, Canvas,
   Dataview, block references, scheduled jobs) so the agent does not promise
   them, and that `[[wiki links]]` and embeds are not followed, so it offers to
   convert them. `irori-setup` points at both.
4. **The command covers the settings and the start screen.**
   - `irori layer <hibachi> knowledge|contents <folder>`: the layer folder
     rename of ADR 024 — a folder that exists is taken as it is and nothing
     moves; otherwise the current one is renamed and links follow.
   - `irori layer <hibachi> contents <folder> --also`: an existing folder of
     the hibachi becomes contents beside the contents folder, in place and
     still tracked by Git (`FileService.declareContents`, checked as an
     incoming declaration is). This lets a vault's attachments or a project's
     code stay where they are and still not be knowledge.
   - `irori set <hibachi>` with `--name`, `--category`, `--knowledge-label`
     and `--contents-label`.
   - `irori workspace <name> [<hibachi>...] [--leave]`: makes the workspace if
     there is none of that name, adds the hibachis, or takes them out.
   - `irori disconnect <hibachi> <name>`: the connection goes; the folder stays.
   - `irori remove <hibachi> [--trash]`: off this device and every workspace,
     the folder kept or moved to the system trash, as the settings do. The
     host's trash refusals (a folder holding another hibachi, the irori agent's
     folder or irori's data) apply.
   - `irori list` shows each hibachi's category, knowledge and contents
     folders and connected folders, and the workspaces with their hibachis.
5. **Still no deletion.** No form deletes a file; `--trash` is the only one
   that moves a folder, and only to the trash. The skills ask for the person's
   yes before `remove`.
6. **Changes wait for the hibachi's own agent only.** As `connect` did, the new
   changes refuse while the hibachi's own agent or a sub-agent runs there, not
   for the irori agent's hold on the hibachis of its request. They also refuse
   during a Git operation or connection setup, and `remove` during a routine.

## Consequences

- One request can take a person from "I use Obsidian" to hibachis with chosen
  layers, connected folders and workspaces; changes to the notes themselves
  (links, frontmatter, today's note, instructions) come in the next request,
  when the new hibachis are handed to the irori agent.
- Folders set up before 0.1.91 get `irori-guide` and `move-to-irori` from the
  + on the irori agent's screen, as ADR 025 decided for missing skills.
- A contents folder added with `--also` cannot be taken back with the command
  yet.
- Not verified with a real CLI and a real vault; protocol fixtures and host
  tests only. orca's app data folder name on each platform is not checked;
  the skill tells the agent to look for `orca-data.json` rather than naming it.
