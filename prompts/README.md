# Prompts

Everything irori says to a CLI agent (Claude Code, Codex, OpenCode, Pi,
Hermes Agent) lives here, one file per situation. Code that gives an agent
words imports them from `prompts/` (`import { … } from '../../prompts'`) and
does not write its own. A new situation gets a file here and a row below.

What stays out: error messages that report a failure (a missing file, a bad
argument) stay with the code that raises them. So do the files and wire
formats irori writes for a CLI (a sub-agent definition's YAML or TOML
wrapping, hook scripts). The words inside those formats come from here.

Every prompt is English. Each file's header says when it is sent and through
which channel.

## The request

irori builds one request text per instruction. Its parts come in this
order; a part is left out when it does not apply.

| #   | Part                | File                                                                                      | Who gets it   | When                                                                                                                                                                                     |
| --- | ------------------- | ----------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Handed hibachis     | [irori-agent.ts](irori-agent.ts) `brainsPreamble` / `brainsCommandPreamble`               | irori agent   | The person hands it hibachis. The first form is for CLIs with file-defined sub-agents, the second for Pi and Hermes Agent (`hibachi` command). Each hibachi's comment count is included. |
| 2   | The `irori` command | [irori-command.ts](irori-command.ts) `iroriCommandPreamble`                               | irori agent   | Every irori agent request: the command is on its run's PATH on every CLI.                                                                                                                |
| 3   | Connected folders   | [connected-folders.ts](connected-folders.ts) `connectedFolders`, `handedConnectedFolders` | either agent  | The hibachi has folders connected in contents. A hibachi agent hears its own; the irori agent hears each handed hibachi's, in its line of part 1.                                        |
| 4   | Selected note       | [note.ts](note.ts) `selectedNote`                                                         | hibachi agent | The instruction goes with the open note.                                                                                                                                                 |
| 5   | The person's lines  | [person-lines.ts](person-lines.ts) `personLinesSummary`                                   | hibachi agent | The person ticks 人の行を伝える.                                                                                                                                                         |
| 6   | Comments            | [comments.ts](comments.ts) `commentsSummary` / `commentsPointer`                          | hibachi agent | The note has comments (summary). Otherwise, if the hibachi has comments at all, a pointer to them.                                                                                       |
| 7   | Selected sources    | [sources.ts](sources.ts) `selectedSources`                                                | hibachi agent | The instruction names source observations.                                                                                                                                               |
| 8   | Routine step        | [routine-step.ts](routine-step.ts) `stepPreamble`                                         | either agent  | The run is an agent step of a routine.                                                                                                                                                   |
| 9   | The person's words  | —                                                                                         | either agent  | Always, and always last.                                                                                                                                                                 |
| —   | Skill               | [skill.ts](skill.ts) `promptWithSkill`                                                    | either agent  | The person picks a skill. It wraps parts 1–9.                                                                                                                                            |

A hand-off from the irori agent through the `hibachi` command starts a
hibachi agent run. That run's words are
[hibachi-agent.ts](hibachi-agent.ts) `handedTask`, and they go through the
same assembly.

## Files irori writes for an agent

| File                                                              | What                                                                 | When                                                                                                                                          |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [hibachi-agent.ts](hibachi-agent.ts) `subAgentPrompt`             | The description and instructions of a hibachi's sub-agent definition | A request hands the hibachi to the irori agent on Claude Code, Codex or OpenCode and no definition exists. The person may edit it afterwards. |
| [irori-agent-starter.ts](irori-agent-starter.ts) `yourAiStarter`  | The irori agent's own `AGENTS.md`                                    | The person creates the irori agent's folder.                                                                                                  |
| [irori-agent-skills.ts](irori-agent-skills.ts) `iroriAgentSkills` | The irori agent's standard skills, `.agents/skills/<name>/SKILL.md`  | The person creates the irori agent's folder, or adds the missing ones on its screen. A present skill folder is never replaced.                |

## During a run

| File                                                                                                           | What                                                                                                 | Channel                                                                                                  |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [person-lines.ts](person-lines.ts) `personLinesEditNotice`, `personLinesHeld`                                  | An edit is about to change lines a person wrote                                                      | Claude Code: PreToolUse `additionalContext`. Pi and OpenCode: the reason their hook holds the call once. |
| [boundaries.ts](boundaries.ts) `outsideHibachi`, `handToSubAgent`, `outsideIroriAgent`                         | A write outside where that agent may write                                                           | Claude Code: PreToolUse `permissionDecisionReason`                                                       |
| [boundaries.ts](boundaries.ts) `permissionDenied`, `questionDeclined`                                          | The person declined a permission or a question                                                       | The SDK's or app-server's answer                                                                         |
| [irori-command.ts](irori-command.ts) `iroriCommandHelp`, `hibachiList`, `hibachiRegistered`, `folderConnected` | What the `irori` command answers: its help, the hibachis, and what a command registered or connected | The command's standard output, read by the irori agent in its shell                                      |
