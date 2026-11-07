# 057 — Every Schema setting reaches every CLI

Date: 2026-11-07. Status: owner request; implemented for 0.2.60.

Revises [ADR 027](027-shared-schema.md) decisions 4 and 5,
[ADR 039](039-what-a-vault-agent-is-told.md) decisions 2 and 6,
[ADR 048](048-shared-schema-settings-and-irori-agent-files.md) decisions 2 and 3,
and, for Pi and Hermes Agent, [ADR 049](049-skills-for-claude-code.md).

## Context

The owner asked whether the shared Schema and each vault's Schema, entered in
the settings, reach every CLI agent, and how. A check on 2026-11-07 found that
they did not:

1. A vault's rules, and the irori agent's own, reached Claude Code alone. Only
   the shared rules went to every CLI as words (ADR 048 D2).
2. Hooks, shared or a folder's own, ran on Claude Code alone (ADR 048 D3). The
   settings screen did not say so.
3. irori recorded that a native session had heard the shared Schema and the
   introduction as soon as the session was created or resumed, before the CLI
   took the request. When that request then failed or was stopped, the next one
   in the session got only the line saying the shared Schema "given earlier
   still applies", though it had never been given.
4. Further gaps:
   - Codex keeps 32 KiB of AGENTS.md and cuts the rest without a word, possibly
     inside a UTF-8 character.
   - Claude Code reads AGENTS.md only where no CLAUDE.md is in the folder or
     above it.
   - Codex, Pi and the Antigravity CLI never load the AGENTS.md of a knowledge
     folder, which the settings can write.
   - Pi and Hermes Agent find a project's `.agents/skills` only in a trusted
     project; Hermes also needs a Git checkout and the user's configuration.
   - Hermes keeps the system prompt a session began with, so a changed AGENTS.md
     is not seen on `--resume`, and a `.hermes.md` hides AGENTS.md.
   - A compaction could take the shared Schema or the introduction out of a
     session while irori went on sending the one line.

The owner answered that all of it must be fixed, and that 1 to 3 are fatal.

## Decisions

1. **Every Schema setting reaches every CLI irori runs:** the instructions,
   skills, rules and hooks of the shared Schema, of a vault and of the irori
   agent. Where a CLI's source shows it loads a setting itself, irori leaves it
   to the CLI; otherwise irori gives it. [`src/domain/schema-reach.ts`](../../src/domain/schema-reach.ts)
   is the table, and [HARNESSES](../HARNESSES.md#schema-reach-adr-057) gives its
   sources.
2. **A folder's rules reach every CLI.** Claude Code reads `.claude/rules`
   itself. Every other CLI hears them in the request
   ([prompts/folder-schema.ts](../../prompts/folder-schema.ts)). They go whole
   while they fit in 32 KiB, otherwise by their files, with the shared rules'
   wording on `paths` front matter. They are said once per session, like the
   shared Schema (digest `schema`), and a session hears when they are gone.
3. **Instructions:**
   - **Claude Code.** From 2.1.277 on, where a CLAUDE.md is in the folder or
     above it, Claude Code is told to read AGENTS.md beside it:
     `pluginConfigs["cc-plugin-agents-md@builtin"].options.instructionFiles =
     "claude-md-and-agents-md"` in its flag settings. An older Claude Code is
     given AGENTS.md as words.
   - **Codex.** It keeps up to 1 MiB of AGENTS.md (`project_doc_max_bytes`). An
     AGENTS.md missing from the thread's `instructionSources` goes as words.
   - **A file read instead.** Where the CLI would read another file in its
     place, irori gives AGENTS.md: `AGENTS.override.md` for Codex, Pi and
     Hermes, and `.hermes.md` or `HERMES.md` for Hermes.
   - **Partial reads.** Where a CLI keeps only part of AGENTS.md (the
     Antigravity CLI 24,000 bytes, Hermes at least 20,000 characters), the agent
     is told to read the whole file.
   - **Stale copies (Hermes).** A Hermes session that goes on after AGENTS.md
     changed hears it again (digest `instructions`).
   - **Knowledge folders.** Their AGENTS.md files are named, to be read before
     working there. Claude Code and Hermes are left out of this; they load those
     files themselves.
4. **Skills:**
   - **Pi.** It is given each skill folder with `--skill`: the folder's own,
     then the shared Schema's whose names the folder lacks. Pi loads `--skill`
     whatever the project's trust.
   - **Hermes.** It hears the folder's skills listed, as the shared ones are.
   - **Claude Code.** Its links stay (ADR 049).
5. **Hooks run on every CLI, with Claude Code's meaning.** Claude Code still
   runs a folder's own hooks and gets the shared ones as flag settings (ADR 048).
   For every other CLI, irori runs both itself
   ([src/agents/schema-hooks.ts](../../src/agents/schema-hooks.ts)).
   - **Claude Code's semantics:**
     - The same standard input, matchers, exit codes and JSON fields.
     - The same timeouts: 600 s, 30 s for UserPromptSubmit, and a 1.5 s budget
       for SessionEnd.
     - `CLAUDE_PROJECT_DIR`, the folder as working directory, hooks run in
       parallel, and a command named twice runs once.
     - `command` and `http` hooks run. A `prompt` or `agent` hook, which needs a
       model, is reported as not run.
   - **Tool names.** A tool call is named and shaped as Claude Code's tool of the
     same kind ([src/agents/tool-names.ts](../../src/agents/tool-names.ts)), and
     a matcher is also tried on the CLI's own name. `apply_patch` is matched as
     an edit or a write, with the files its patch names.
   - **Around every run, on every CLI:**
     - SessionStart (`startup`, `resume` or `compact`) and UserPromptSubmit run
       before the request goes. Their context goes in the request text. A block
       stops the instruction, and nothing is sent.
     - Stop runs after a turn. A block sends its reason as the next request in
       the same session, at most 8 times in a row, as in Claude Code.
     - SessionEnd runs when the run ends.
     - Notification runs when the person is asked something.
   - **Tool events, per CLI:**
     - **Pi and OpenCode.** An extension (`-e`) or a plugin
       (`OPENCODE_CONFIG_CONTENT`) from irori's data directory hands irori each
       call. PreToolUse can stop a call, with a reason the model reads, or change
       its input. PostToolUse adds to the result. PreCompact runs too, and on Pi
       it can stop a compaction.
     - **Codex.** It gets hooks of its own in the thread's configuration, each
       handing its event to irori.
       - Each hook is trusted by its own hash in `hooks.state`, computed as
         Codex computes it. irori does not use `bypass_hook_trust`, which would
         also run every untrusted hook in the user's own configuration and
         plugins.
       - Before any turn, `hooks/list` must show irori's hooks trusted and
         enabled. When Codex fingerprints them otherwise, irori starts it once
         more with the trust Codex reported. If they are still not trusted,
         nothing is sent.
     - **The Antigravity CLI.** It reads `.agents/hooks.json` in a folder irori
       makes in its data directory and adds with `--add-dir`.
       - PostToolUse feedback goes before the next model call (PreInvocation).
       - A tool call before irori has heard from those hooks stops the run.
     - **Hermes Agent.** It reports a call to irori only once the call has run.
       - Its PostToolUse hooks run then, and what they say goes with the next
         request.
       - PreToolUse and PreCompact cannot run there.
   - **Events a CLI cannot run.** The person is asked before the run whether to
     go on without them. A routine step, which no one answers, does not run.
   - **Approval.** The shared Schema's hooks and the folder's are approved like
     other configuration that runs without asking (ADR 009) before irori runs
     them.
   - **Fail closed.** A call irori's script cannot ask about does not run: a hook
     may be a guard.
6. **A session has heard what its CLI took.**
   - **When digests are recorded.** The digests of what a request gave are
     recorded only once the run shows the CLI took it: it answered, used a tool
     or asked. A session the CLI starts anew or forks has heard nothing.
   - **Compactions.** A compaction during a run forgets everything heard, and
     the next request gives everything whole again. Compactions are seen as:
     Claude Code's `compact_boundary`, Codex's `contextCompaction` item,
     OpenCode's `session.compacted`, Pi's `compaction_end`, and a new Hermes
     session id.
   - **CLIs that do not report compactions.** Hermes, which compresses in place,
     and the Antigravity CLI hear irori's words whole on every request.
   - **Removed parts.** A session that heard something now gone hears that it
     is gone.
7. **The settings say how.** Under Rules and Hooks, the Schema settings say how
   each reaches every CLI, built from the table. The skill reach view says irori
   gives Pi the skills and names them to Hermes.

## Consequences

- One edit in the settings reaches the next request of every CLI. A CLI that
  cannot run a hook event says so before it runs.
- Costs:
  - Hermes and Antigravity requests carry irori's words whole every time.
  - Hooks run in irori's process tree.
  - A Stop continuation starts a one-shot CLI again.
  - A Codex run may start the app server twice, when Codex fingerprints irori's
    hooks otherwise than irori computed.
- Not verified with real CLIs. The protocol fixtures follow each CLI's source:
  Codex rust-v0.167.0 and 0.160.0, OpenCode v1.18.30 and v1.19.5, Pi 0.87.1, and
  Hermes Agent `73688014`. For the Antigravity CLI they follow its documentation.
  Codex's own test vectors check the trust hash.
- Inferred, not documented: that the Antigravity CLI reads `.agents/hooks.json`
  from a folder added with `--add-dir`. If it does not, a run with tool hooks
  stops before its first tool call.
- On Windows, hooks run in Git Bash when it is installed, otherwise in cmd.exe.
  Codex's Windows trust key is unverified there: `hooks/list` refuses the run,
  or the second start corrects it.
- OpenCode's 2.x line, with its new plugin API, is not covered.
