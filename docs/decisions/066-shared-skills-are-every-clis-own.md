# 066 — The shared Schema's skills are every CLI's own skills

Date: 2026-11-19. Status: owner request; implemented for 0.2.84.
Extends [ADR 058](058-every-schema-setting-reaches-every-cli.md) decision 4 and
[ADR 049](049-skills-for-claude-code.md) to Codex, OpenCode and the Antigravity
CLI. Keeps [ADR 027](027-shared-schema.md) decision 8 (the folder's own skill
wins a name both have).

## Context

The owner asked again whether what is set in the shared Schema reaches Codex and
the other CLIs, not Claude Code alone, and asked that no part be left half
delivered, such as rules reaching a CLI while skills do not.

A check on 2026-11-19 of 0.2.82, setting by setting and CLI by CLI:

| Shared Schema setting | Claude Code | Codex | OpenCode | Pi | Hermes Agent | Antigravity CLI |
| --- | --- | --- | --- | --- | --- | --- |
| Instructions | Words | Words | Words | Words | Words | Words |
| Rules | Words | Words | Words | Words | Words | Words |
| Hooks | Flag settings | irori's hooks | irori's plugin | irori's extension | Around the run, PostToolUse | irori's hooks folder |
| Skills | **Skills** (links) | Listed only | Listed only | **Skills** (`--skill`) | Listed only | Listed only |

Instructions and rules are words for every CLI, and every CLI runs the hooks.
Skills were not even: Claude Code and Pi took the shared skills as their own
skills, listed with their descriptions and run by name, while Codex, OpenCode and
the Antigravity CLI only heard them listed in the request with a path to read.
The folder's own `.agents/skills` those three find themselves, so a shared skill
was a lesser skill there than a vault's own: Codex could not take it as a
`$name` or `/name` skill item, and none of the three offered it on its own.

Each of the three has a way to take more skills, read from its source:

- **Codex** (`openai/codex` rust-v0.170.0, `29eb79e`; the same method in
  rust-v0.156.0, 0.160.0, 0.165.0 and 0.167.0): the app server's
  `skills/extraRoots/set` takes folders of skill folders
  (`SkillsExtraRootsSetParams.extraRoots`). They are user-scope roots whose
  links are followed (`ext/skills/src/host_roots.rs`,
  `ext/skills/src/loader/host.rs`), and every later turn's skill catalog
  includes them (`app-server/tests/suite/v2/host_skills.rs`). It is not an
  experimental method.
- **OpenCode** (`anomalyco/opencode` v1.19.6, `f4e363c`, and v1.18.30): the
  configuration's `skills.paths` adds folders scanned for `**/SKILL.md`, links
  followed (`packages/opencode/src/skill/index.ts`). A value in
  `OPENCODE_CONFIG_CONTENT` would replace the person's own `skills.paths`,
  because OpenCode merges arrays by replacing them (`mergeDeep` in
  `src/config/config.ts`). A plugin's `config` hook runs before anything else
  and may change the configuration ("Plugin can mutate config so it has to be
  initialized before anything else", `src/project/bootstrap.ts`).
- **The Antigravity CLI** ([customization discovery](https://antigravity.google/docs/customization-discovery/),
  read 2026-11-19): every workspace folder, a folder added with `--add-dir`
  among them, is searched for `.agents/skills/<name>/SKILL.md`. irori already
  relies on the same rule for its hooks folder (ADR 058).

Hermes Agent finds a project's skills only in a trusted Git checkout and takes
other skill folders only from the person's own configuration
(`skills.external_dirs`); irori does not change either, so Hermes keeps hearing
both the folder's and the shared skills listed.

## Decisions

1. **The shared skills are each CLI's own skills.** Beside the words, which
   stay (ADR 049 D4), irori gives the shared Schema's skills to every CLI as the
   CLI takes skills (`sharedSkillReach` in `src/domain/schema-reach.ts`):
   - Claude Code: links in an added folder (ADR 049, unchanged).
   - Pi: `--skill` per folder (ADR 058, unchanged).
   - **Codex:** a folder of links,
     `given-skills/<conversation>/.agents/skills` in irori's data directory, set
     with `skills/extraRoots/set` before the thread starts, resumes or forks, and
     again when Codex is started once more for its hooks' trust. Links serve:
     Codex names a skill by its real path, which its `workspace-write` sandbox
     does not let it change.
   - **OpenCode:** copies of the skill folders in the same place, added to the
     person's own `skills.paths` by irori's plugin (`IroriSkillPaths`, from
     irori's data directory), whose `config` hook appends the folder.
   - **The Antigravity CLI:** copies in the same place, with
     `given-skills/<conversation>` added as a workspace folder.
   - Copies, not links, for OpenCode and the Antigravity CLI: OpenCode allows any
     change in a skill's folder (`external_directory` allows every skill folder,
     `packages/opencode/src/agent/agent.ts`), and the Antigravity CLI's standard
     mode (`accept-edits`) changes a workspace folder's files without asking.
     Through a link either would change the shared Schema. A link inside a skill
     is copied as what it leads to; one that leads nowhere is left out.
   - Hermes Agent: listed, as before.
2. **The folder's own skill wins.** A shared skill is not given where the
   folder's `.agents/skills` has a folder of its name, a malformed, retired or
   unlisted one too, as the CLI may still load it. For OpenCode, nor where its
   `.claude/skills` or `.opencode/skills` has that name, as OpenCode reads those
   too and keeps one skill of a name.
3. **One place per conversation.** The folder is named by the conversation, not
   the run, so a skill's place is the same on every run of it: OpenCode writes
   each skill's place into its system prompt (`Skill.fmt`). It is made afresh
   for each run.
4. **Nothing is written into a vault or the irori agent's folder.** The folder
   is removed when the run ends; those of runs that did not end are removed when
   irori starts.
5. **A CLI that does not take them still hears them.** A Codex that refuses
   `skills/extraRoots/set`, or a folder irori cannot make, leaves the skills to
   the words, and the run says so in a status line.

## Consequences

- Every shared Schema setting now reaches every CLI the same way a vault's own
  does: instructions, rules and hooks as before, and skills as each CLI's own
  skills, except on Hermes Agent, where the vault's skills are listed too.
- Codex also takes a shared skill as a skill item when the request names it
  (`$name`, `/name`), and its sub-agents in the same app server see the skills.
  The composer's skill menu already offers the shared skills on every CLI
  (ADR 027 D8); Codex's own `/` list, read from an app server started without
  the extra root, does not repeat them.
- A skill changed during a run on OpenCode or the Antigravity CLI is a change to
  the copy, gone when the run ends.
- An independent review of the first version found that OpenCode could change
  the shared Schema through the links, that a malformed vault skill did not keep
  its name from the shared one, that a per-run place changed OpenCode's system
  prompt on every run, and that a link inside a copied skill stayed a link. All
  four are fixed as decided above, each with a test that fails without the fix.
- Not verified with real CLIs: the stand-ins in `tests/schema-reach.test.ts`
  follow each CLI's source as read above. Installing Codex or OpenCode was not
  possible in this session, and the Antigravity CLI needs a signed-in account.
  That the Antigravity CLI reads `.agents/skills` in an `--add-dir` folder is
  from its documentation only.
- Still uneven or not covered:
  - A vault on an SSH host gets no shared Schema at all on any CLI: neither its
    instructions, rules, skills nor hooks (ADR 061, "the shared Schema for runs
    there"). The guide now says so.
  - Hermes Agent hears skills listed, a vault's and the shared ones alike.
  - Hook events a CLI cannot run stay as ADR 058 D5 says: Hermes runs PostToolUse
    only after the call, and the Antigravity CLI has no compaction or sub-agent
    events.
  - A CLI's own sub-agents (Claude Code's agents, OpenCode's `task`) do not see
    irori's words, so they get the shared instructions and rules only when the
    agent passes them on.
  - A shared skill of the same name in the person's own skill folders
    (`~/.agents/skills`, `~/.claude/skills`, …), in a folder above the vault, or
    named otherwise in a malformed skill's front matter is not looked for; the
    skill reach view covers the person's folders for a vault's skills only.
