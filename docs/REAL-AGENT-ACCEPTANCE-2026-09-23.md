# Real native-agent acceptance, 2026-09-23

The owner authorized native model execution with the existing CLI accounts on
2026-09-23. This trial exercised the merged `aa0bbfe` application services
(0.1.26), with stronger acceptance scripts on `fix/real-agent-acceptance`.
The environment was Linux x64 with Node 24.21.0. Every note and irori device
record belonged to a newly created disposable fixture; no existing KB, account
configuration, or provider permission setting was changed.

## Observed results

| Native CLI | Saved-note edit and schema invariance | Conversation continuity | Interaction coverage |
| --- | --- | --- | --- |
| Codex 0.155.1, existing ChatGPT login | Passed: actual streamed model output, native tools and the requested Japanese-note marker; no schema hash changes | Passed: recreated host services and a fresh native process recalled a random conversation-only token, using the same saved handle and no file tools | Passed: one explicit approval denial left the complete note unchanged; cancellation after native activity released the lock in 0.40 seconds. Structured question remains unavailable in the native default mode used here |
| Claude Code 2.1.278, existing native login | Passed: actual Read/Edit tools, explicit approval and saved marker; no schema hash changes | Passed: recreated host services and a fresh native process recalled the token, using the same saved handle and no file tools | Passed: one Edit denial preserved the complete note, one AskUserQuestion received its answer, and active cancellation released the lock in 0.63 seconds; person-line hook evidence below |
| Pi 0.85.1 | Not run with a model: the previously downloaded CLI is outside ordinary PATH and `--list-models` reports no available models | Not established with a model | Existing protocol/native-control evidence remains separate |
| OpenCode 1.18.30 | Not run with a model: the previously downloaded CLI is outside ordinary PATH and native `auth list` reports zero credentials | Not established with a model | Existing protocol/native-control evidence remains separate |

The first read/edit trial took 33.2 seconds for Codex (five tool events, two
approvals) and 15.2 seconds for Claude (three tool events, one approval).
The schema baseline contained `.gitignore`, `.irori/scope.json`, `AGENTS.md`
and `CLAUDE.md`; every path and byte hash was unchanged after native execution.

A separate continuity trial changed a sentence marked as the person's work,
then reloaded `FileService` and `AgentService` from their persisted device
records. Its second request omitted the random token and all first-turn text.
Codex and Claude recalled it in 6.5 and 2.9 seconds respectively, without file
tools. This establishes native conversation continuity across recreated host
services and new native processes; it is not an installed Electron restart
or an owner-device acceptance result.

For Claude's marked-line edit, the actual SDK hook queried the authorship store
and the model explicitly described the affected line, its recorded human
origin, and the notice's observational nature. The appended paragraph produced
no additional notice. Codex has no equivalent pre-edit hook in this adapter;
its zero hook calls are an explicit capability boundary, not evidence that
such a notice was delivered. Pi/OpenCode's hooks still require authenticated
native model acceptance.

## Findings and limits

1. **The lifecycle script previously accepted absent gates.** It recorded zero
   approval/question requests and still exited successfully. It now requires
   actual request events, the unchanged original note after denial, the chosen
   answer after a structured question, and a cancelled run with its lock
   released after observed native activity. The read/edit script also requires
   streamed text and tool events, and its optional `--continuity` mode verifies
   the persisted handle and recalled token. Missing inference or missing gates
   must not be reported as successful acceptance.
2. **Codex default mode does not expose a structured question in this native
   configuration.** The installed `codex features list` reports
   `default_mode_request_user_input` as `under development` and `false`.
   The real response reported that `request_user_input` was unavailable and
   emitted no question event. A plain-text mention of both answer choices is
   not a completed question interaction. The adapter has a response handler
   for native `item/tool/requestUserInput`; this trial does not establish a
   renderer/handler defect. A supported plan-mode route and its UI remain
   follow-up work. The trial did not enable an experimental feature or change
   the native default.
3. **This container cannot start Codex's Linux sandbox namespace.** The native
   runtime requested approval before fixture-local shell reads/edits; the
   smoke harness approved only its selected fixture operations. A generic
   denial prompt initially stopped at the sandbox failure without emitting a
   user approval request, so that attempt is not denial-gate acceptance. The
   targeted denial trial emitted one approval request, refused it, and left
   the complete original note unchanged. Desktop sandbox behavior still requires
   native-device testing.
4. **Pi/OpenCode need native account setup before model acceptance.** No
   credentials were copied from another CLI and no login, account registration
   or model-default change was attempted. Pi's existing downloaded executable
   also requires the supported Node runtime: the system Node 20 cannot parse
   it, while Node 24.21.0 runs version/model discovery successfully. An executable
   outside the application's searched PATH is not ordinary app availability.

## Reproduction and validation

Run only with authorization to consume the native accounts' allowances:

```sh
npm run test:agents
npm run test:agents -- --continuity
npm run test:lifecycle
```

Both scripts accept an optional single agent name, for example
`npm run test:agents -- claude --continuity`. The default agents remain Codex
and Claude; this does not silently opt Pi/OpenCode into paid execution.

Raw provider events, native session handles, fixture paths and machine account
information are omitted from this tracked report. The ignored `test-results/`
files and native provider stores retain local diagnostic details.

The application build and the full non-provider `npm test` run passed:
229 tests, 222 passed and seven environment-dependent skips (three native
OpenCode/Pi controls, three rclone control/copy/account probes, and the
case-insensitive-filesystem fixture). No renderer or shipped runtime
code changed, so Electron UI/package tests were not repeated for this branch.
The build retains the existing large-chunk warning.

`test:agents -- --continuity` passed. The stricter `test:lifecycle` intentionally
exited nonzero because Codex emitted no structured question: the first trial
completed with a plain-text explanation, and the targeted rerun reached its
90-second deadline without a question event. Both agents passed explicit
denial and cancellation after native activity; Claude also passed the actual
structured question. The final fixture bytes were independently compared with
the complete original notes. This known native-mode limitation is not hidden
by treating a completed turn or a text-only question as a successful gate.

Actual Windows/macOS mounts, mounted-file agent access, expired-login recovery,
full transcript/history management, arbitrary native extensions/MCP and
installed-device restart remain outside this evidence. See
[the acceptance backlog](ACCEPTANCE.md) and [native harness boundaries](HARNESSES.md).
