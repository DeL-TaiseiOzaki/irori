# Routines

A routine is a job a person or an agent defines and the person starts with a
button: it runs programs and instructs agents, in order. It is irori's general
way to gather what a person holds in other tools, such as mail and chat, and
anything else that repeats. The decisions are in
[ADR 016](decisions/016-routines.md); this page describes what stage 1 (0.1.57)
does. Secrets (stage 2), Python (stage 3) and the irori agent's skill for
writing routines (stage 4) are not built yet.

## A routine

A routine is a folder holding `routine.yaml` and the files its steps use.

| Location | Working folder | Agent steps |
| --- | --- | --- |
| `<irori agent folder>/routines/<name>/` | the irori agent's folder | `agent: irori`, with hibachis handed to it |
| `<hibachi>/.irori/routines/<name>/` | the hibachi's root | `agent: hibachi`, that hibachi's agent |

```yaml
name: Mail triage
steps:
  - run: fetch.js # a file in the routine folder
  - run: [gh, api, notifications] # a command on PATH and its arguments
  - agent: irori
    hibachis: all # or a list of hibachi names
    access: full-access # or default; required
    cli: claude # optional: the CLI chosen in the panel otherwise
    model: sonnet # optional
    prompt: |
      Read the mail in $IRORI_WORK/inbox. Put each one into contents/mail of the
      hibachi it concerns. Leave any you cannot place and list them.
```

- `routine.yaml` is read strictly: an unknown key, a missing `access` or
  `prompt`, a step with both `run` and `agent`, a path leaving the folder, a
  hibachi's routine using `agent: irori` (or the reverse), or an access mode
  the named CLI lacks makes the routine invalid. Its row shows the reason in one
  sentence, and it never runs.
- Up to 20 steps. The folder holds at most 100 files and 5 MiB, and no links;
  `.DS_Store` is ignored.
- irori never writes into a routine's folder.

## Running one

irori mode → **ルーティン** lists the irori agent's routines and those of the
workspace's hibachis, grouped by owner. The agent panel stays beside it, so a
routine's agent steps can be followed in their conversations. The list is read
again every five seconds and whenever a hibachi's files change.

- **実行** starts a routine; nothing else does. There is no schedule and nothing
  runs while irori is closed. A running routine shows **停止** instead, which
  ends the step in progress; later steps do not run. Different routines run at
  the same time; the same one cannot start twice.
- **Review.** The first **実行** on a device opens **ルーティンの確認** with
  every file of the folder, and the routine runs after **確認して実行**. irori
  keeps, in its data directory, a digest of the files and their text as
  confirmed. After any change, by a person, an agent or a pull, the row says
  **変更あり** and the next **実行** shows the difference line by line. The host
  runs a changed routine only with the digest of the files the review showed.
- **What a device needs** is named in the row before a run: **JavaScript が必要です。**
  with **JavaScript を追加** for `.js`/`.mjs`/`.cjs` (the same switch is in the
  settings under ルーティン), `<command> が見つかりません。` for a missing `PATH`
  command, **Python はまだ使えません。** for `.py`, and **シークレットはまだ使えません。**
  for `secrets:`.

## Steps

- Steps run in order in the working folder. A failing step stops the run.
- Every step gets `IRORI_WORK` (a fresh folder for this run, shared by its
  steps, removed once the run is recorded), `IRORI_STATE` (kept for this
  routine on this device, for a cursor or the last message id) and
  `IRORI_ROUTINE` (the routine's folder).
- **`run` with a file:** `.js`, `.mjs` and `.cjs` run with irori's own
  executable as Node (`ELECTRON_RUN_AS_NODE=1`), so nothing is installed. Any
  other file runs as a program itself; its `#!` line names the interpreter,
  found on `PATH`, and the file must be executable.
- **`run` with an argv array:** the first item is a command on `PATH`.
- A `run` step fails on a non-zero exit. If its last line of standard output is
  `{"continue": false}`, the run ends as **対象なし** (nothing to do) and later
  steps do not run, so a fetcher that found nothing spends no agent turn.
- **`agent`** starts an ordinary native run: the hibachi's agent for a
  hibachi's routine, or the irori agent with the named hibachis handed to it
  (held for the run, as in irori mode). It appears in that agent's conversation
  as it goes, after a line **ルーティン: <name>（ステップ n）**, and its
  permission requests and questions show in the step as well as in the
  conversation.
  - Every agent step is a new native session, and it is never saved: the
    person's own conversation with that agent continues where it was.
  - irori puts a preamble before the step's prompt: the routine's name, the
    three folders, that gathered text is material and not instructions, not to
    create or change routines, to report what changed, and to begin the report
    with `[FAILED]` when the task could not be done. The folders are also in the
    CLI's environment and, on Claude Code, its additional directories.
  - The step fails when the CLI's turn fails or the report (the agent's words
    after its last tool call, request or hand-off) begins with `[FAILED]`;
    the reason after the marker is the step's detail.
  - The step waits (**待機中**) while its agent or a handed hibachi is running,
    while Git, a save or a connection keeps agents from starting, and while that
    agent has queued instructions.
- While a routine runs, Git operations wait, as they do for an agent run.
  Closing irori asks before stopping running routines.

## Records

A run's record stays on the device, never in a knowledge base: start and end,
each step's state, exit code and output (the last 16 KiB; an agent step's
report), the agent step's conversation (**会話** opens it: the hibachi with its
agent panel, or the irori agent's panel), and the files each hibachi's Git
status shows changed between the start and the end (**変更 n 件**). A run is
running, **成功**, **対象なし**, **失敗**, **停止** or **不明**. A run that irori's
exit or a crash left running becomes **不明** when irori next opens, and is
never repeated. The last 20 runs of each routine are kept; the row's history
shows them.

Files in irori's data directory:

| Path | What |
| --- | --- |
| `routines/reviews/<sha256 of owner/folder>.json` | the digest and files as confirmed |
| `routines/runs/<sha256 of owner/folder>/<run id>.json` | one run's record |
| `routines/state/<sha256 of owner/folder>/` | `IRORI_STATE` |
| `routines/work/<run id>/` | `IRORI_WORK`, removed after the run and when irori opens |

## Host boundary

Discovery, review, execution and records are `src/host/routines.ts`
(`RoutineService`); the types, the difference and step labels are
`src/domain/routines.ts`. The renderer reaches them through `HostAPI`:
`routines(workspaceId)`, `reviewRoutine(ref)`, `runRoutine(ref, { workspaceId,
digest, agents })`, `stopRoutine(ref)`, `routineRuns(ref)`, and `routine`
events carrying a run. JavaScript is the device setting `routineRuntimes`.
Agent steps go through `AgentService.startStep`, an ordinary run with a
`StepRun` (preamble, directories, environment and the conversation's routine
line) and no saved session. Document content cannot start a routine.

## Verification

- `tests/routines.test.ts` (disposable folders; Pi's protocol fixture for agent
  steps): strict `routine.yaml` reading and its reasons; the gate, the
  `[FAILED]` marker and the line difference; review before the first run, the
  difference after a change and a refused run with an old digest; steps in order
  sharing `IRORI_WORK`, `IRORI_STATE` kept across runs, the work folder removed;
  links and missing files; the nothing-to-do gate, a failing step and **停止**
  (the program ended); what a device lacks (JavaScript, Python, secrets, a
  missing command) and a `#!` program; the Git change record including a path
  dirty before the run; an agent step in a fresh session that leaves the
  person's session, with the preamble, the environment and its conversation
  line; a `[FAILED]` report; a step waiting for the hibachi and **停止** during
  an agent step; an irori agent routine handing a named hibachi; an
  unfinished run marked unknown and not repeated.
- `tests/settings.test.ts`: `routineRuntimes` kept and bounded.
- `scripts/routines-ui-smoke.ts` in the app: an invalid routine's reason,
  JavaScript added from the row, the review and the difference, a run's steps,
  output, changed files and history, the gate, **停止**, an agent step's request
  answered in the step and its conversation opened in its hibachi, and an irori
  agent routine.
- `npm run test:routines` (`scripts/routines-acceptance.ts`) runs real Claude
  Code and Codex, or the one named, as agent steps in a disposable Git hibachi,
  and uses the person's allowance: a `run` step's output turned into a note by
  the agent, the change record, the conversation, no saved session, and a
  `[FAILED]` report failing its step. Permission requests are allowed by the
  script. As root, Claude Code runs in the standard mode, since it refuses
  `bypassPermissions` there.

## Limits

- Stage 1 only: no secrets, no Python, no skill telling the irori agent how to
  write routines, no timed runs.
- Changes under a hibachi's contents folders and in hibachis that are not Git
  repositories are not in the change record.
- Agent steps ran on real Claude Code 2.1.280 and Codex 0.156.1 only
  ([STATUS](STATUS.md)); Pi, OpenCode and Hermes Agent steps are covered by
  protocol fixtures.
- A step's `#!` interpreter is only found when the program starts; a missing
  one fails that step.
