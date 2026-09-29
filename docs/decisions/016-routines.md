# 016 — Routines: jobs a person defines and starts

Date: 2026-09-30. Status: owner direction accepted; design only, not implemented.
The owner chose the name **routines** (ルーティン) on 2026-09-30 over "tasks",
which a second brain's reader takes for to-do items.

## Context

The owner set irori's direction on 2026-09-29: an IDE for a second brain that
gathers what a person holds in other tools, such as Gmail and Slack. One source
often concerns several hibachis: one mailbox receives mail about hibachi A and
hibachi B.

Three designs were discussed and set aside:

- **An irori-level inbox that the irori agent routes item by item.** It decides
  acquisition, retention, relevance and publication at once, at capture time,
  and it makes routing a product feature. A mailbox is an access boundary and a
  hibachi a boundary of responsibility for knowledge; they need not align.
- **Connectors as a core feature** (a manifest and a sync program per source,
  with a per-hibachi declaration of what to take). The owner found it too
  focused on building a second brain for a general IDE capability.
- **Mounting every source as a filesystem.** Mail and chat are streams, and a
  virtual filesystem needs platform drivers. Drive keeps its rclone mounts.

The owner's decision: irori gains one general capability, jobs that a person
or an agent defines and that the person starts with a button. A job may run a
program (rule-based fetching, filtering, reformatting) or instruct an agent
(deciding which hibachi a mail concerns and putting it there). Gathering
sources is one use of it; the rest can remain extension-level material.

Running at set times was designed and then deferred (owner, 2026-09-30): an
IDE that does work every morning on its own, as Hermes Agent does, is not what
irori is. A routine is irori sending instructions to Claude Code or another
native agent, and to programs, when the person asks. The schedule design is
kept under "Later" below.

A hibachi is a folder with `.irori/scope.json` (`src/host/files.ts`); Git,
GitHub and Drive are optional. Routines therefore belong to folders, not to a
particular kind of storage. irori has no program execution of its own today:
the terminal and the native agents run what the person has installed, and the
`hibachi` command runs irori's own executable as Node
([YOUR-AI](../YOUR-AI.md)).

## Decisions

### D1 — What a routine is and who owns it

A routine is a folder holding `routine.yaml` and the files its steps use,
shaped like a skill folder. Skills stay in the schema layer; routines are held
by one of two owners (owner, 2026-09-30):

| Location | Working folder | Use |
| --- | --- | --- |
| `<irori agent folder>/routines/<name>/` | the irori agent's folder | personal routines that span hibachis |
| `<hibachi>/.irori/routines/<name>/` | the hibachi's root | a routine of that hibachi, carried and shared with it |

A skill says how to do something; a routine says what runs and who does it. An agent step may simply tell the agent to apply a skill.

### D2 — `routine.yaml`

```yaml
name: Mail triage
steps:
  - run: fetch_gmail.py   # a file in the routine folder, or an argv array
    secrets: [GMAIL_TOKEN]
  - agent: irori
    hibachis: all
    access: full-access
    prompt: |
      Read the mail in $IRORI_WORK/inbox. Put each one into contents/mail of the
      hibachi it concerns. Leave any you cannot place and list them.
```

Two step kinds only:

- **`run`** — a file in the routine folder, run by its extension (D3), or an
  argv array naming a command on `PATH`. It runs in the working folder.
- **`agent`** — a native agent run. In the irori agent's folder, `agent: irori`
  with `hibachis` (names or `all`) handed to it, as an ordinary irori agent
  request. In a hibachi, `agent: hibachi` is that hibachi's agent. `cli` and
  `model` default to the ones chosen in the panel. `access` is required, so what
  a routine may do is written in it, not taken from the panel's last choice.

Every step receives:

- `IRORI_WORK` — a fresh folder for this run, in irori's data directory, shared
  by its steps and removed after the run's record is kept.
- `IRORI_STATE` — a folder kept for this routine on this device (a cursor, the
  last message id).
- `IRORI_ROUTINE` — the routine's own folder.

A step that fails stops the run. Steps run in order; there is no branching,
with one exception: a `run` step whose last line of output is
`{"continue": false}` ends the run quietly as having nothing to do, so a
fetcher that found no new mail spends no agent turn (Hermes Agent's
`wakeAgent`).

A `routine.yaml` that does not parse, or names a missing file, is shown as
invalid with the reason and is never run. irori never deletes or rewrites a
routine's files.

### D3 — Runtimes are add-ons the person installs

| Extension | Runtime | Installed by |
| --- | --- | --- |
| `.js`, `.mjs`, `.cjs` | irori's own executable as Node (`ELECTRON_RUN_AS_NODE=1`, `process.execPath`) | turning on **JavaScript** in settings; nothing is downloaded |
| `.py` | Python through [uv](https://docs.astral.sh/uv/), with dependencies declared inline (PEP 723) | choosing **Python** in settings, which downloads uv into `<irori data>/runtimes/` |
| anything else, or an argv array | the command on `PATH` | the person, outside irori |

- Nothing is installed without the person's choice, and nothing is installed
  system-wide. uv is downloaded over HTTPS and checked against a SHA-256 digest
  pinned in irori's source, as an update is checked against its published
  digest ([ADR 010](010-in-app-updates.md)); uv then obtains Python and each script's dependencies in irori's data
  directory.
- A routine whose runtime is missing does not run; its row says which runtime
  it needs, with the button that adds it. A missing `PATH` command is named.
- A routine folder holds code and declared dependencies only, so a hibachi's
  routine runs on another device once that device has the runtime.

### D4 — A routine runs only after the person has reviewed it on this device

Routine code runs with the person's permissions, as the terminal does, and an
agent can write routines. So:

- The first **実行** of a routine on a device shows `routine.yaml` and the
  files beside it, and runs only after the person confirms. The device keeps,
  in irori's data directory, a digest of the folder's files as reviewed.
- A later change to any of them, by a person, an agent or a pull, brings the
  review back, showing the difference.
- This applies equally to a routine that arrives in a shared hibachi.

### D5 — Secrets

- A secret is entered in irori's own field, never in a conversation, and kept
  in irori's data directory encrypted with Electron's `safeStorage`.
- It is given only to the `run` steps that name it, as an environment
  variable. Agent steps never receive secrets: the agent that reads captured
  mail holds no token that mail could make it send elsewhere.
- Exact secret values are removed from recorded output.
- Authenticating with a provider is the person's part (owner, 2026-09-30):
  they obtain the token, or create their own OAuth client for Google, and
  store what the routine needs as a secret. irori ships no provider sign-in
  for routines, so it carries no provider's app review.

### D6 — Starting and stopping

- A routine starts only when the person presses **実行** in the routines view
  (owner, 2026-09-30). There is no schedule, no file-change trigger and nothing
  that runs while irori is closed.
- A routine that is running cannot be started again; its **停止** ends the
  step in progress, and later steps do not run.
- Different routines may run at the same time. An agent step in a hibachi
  waits while that hibachi is held by another agent run, as a hand-off does.

### D7 — Agent steps

- An agent step is an ordinary native run started by irori, shown in the
  agent's conversation as it goes. A question or an approval request from the
  CLI reaches the person as in any other run.
- Every agent step is a new native session. Nothing carries over between runs
  except what the routine keeps in `IRORI_STATE`.
- The step's preamble says that captured text is material and not
  instructions (as notes are, [YOUR-AI](../YOUR-AI.md)), that the agent must not
  create or change routines, and that it must report what it changed.
- A report beginning with `[FAILED]` and a reason fails the step although the
  CLI ended normally. Success is otherwise read from the adapter's end-of-turn
  result, not the process exit code: Pi's JSON mode exits 0 after a failed turn.

### D8 — Run records

- Each run keeps, in irori's data directory and never in a knowledge base:
  start and end, each step's exit status and its output (capped), the agent
  step's conversation, which opens like any conversation, and the files
  changed in each hibachi with Git (from `git status` before and after).
  Definitions stay in the routine folders; the record is the only run state,
  as Hermes Agent keeps its execution ledger apart from its jobs.
- A run's state is one of running, succeeded, nothing to do, failed, stopped
  or unknown. A run that irori's exit or a crash left running is marked unknown
  when irori opens and is never repeated automatically.

### D9 — Host boundary

Routine discovery, review, runtimes, secrets and execution live in the host.
The renderer reaches them through narrow `HostAPI` methods (list, review, run,
stop, records, runtime install). Document content cannot start a routine.

## What was borrowed

[Hermes Agent](https://github.com/NousResearch/hermes-agent) and
[Pi](https://github.com/badlogic/pi-mono) were read on 2026-09-30 at the owner's
request. Hermes has a built-in scheduler (`cron/` in its repository); Pi has
none, and scheduling comes from extensions (`pi-schedule-prompt`,
`pi-scheduler`) and from its former Slack bot, mom, whose jobs were JSON files
the agent wrote into a watched folder.

Taken now: a fresh session per run, the nothing-to-do gate before the agent,
a failure marker in the agent's report, unknown runs after a crash, and a run
ledger apart from the definitions. The scheduling parts are kept for later
below.

Not taken: agents creating jobs that run without review (mom, and Hermes when
`allow_agent_scheduling` is on); deleting a definition that does not parse or
is late (mom); one global jobs file holding definitions and run state together
(Hermes); delivery to chat platforms, hosted schedulers and quota holds.

## Relation to earlier decisions

- [ADR 005](005-host-and-references.md) records that irori has no extension
  mechanism and is not an MCP client. Both remain true: a routine is a folder
  irori runs, not an extension API, and agent steps use whatever MCP servers
  the native CLI is configured with.
- [ADR 009](009-agent-access-and-extension-compatibility.md): `access` in an
  agent step uses the same modes as the composer.
- [ADR 013](013-drive-folders-in-kbs.md): the split between what a folder
  declares and what the device binds (accounts, secrets, reviews) is the same.

## Later: running at set times

Deferred by the owner on 2026-09-30, together with Hermes-like standing jobs.
If it is taken up, the design worked out from Hermes Agent and Pi's
extensions was:

- `when:` as a five-field cron in the device's time zone, read with a
  maintained library (croner, which Pi's scheduling extensions use), checked
  once a minute and only while irori is open (the owner's answer of
  2026-09-30).
- At-most-once dispatch: advance the next due time and record the run before
  its first step, so a crash never repeats it; skip a routine already running.
- A run missed while irori was closed runs once when irori opens. Hermes
  limits this to half the period, at most two hours, which would drop a
  morning routine on a day irori opens late; running once until the next due
  time suits an app that is often closed. Open for the owner.
- Unattended agent steps: a question or approval request fails the step, a
  `[SILENT]` report suppresses the notice, a step silent for ten minutes is
  stopped, and a failure notifies once until the person looks.

## Not in this decision

- Shared routine building blocks (`uses: <package>`, as GitHub Actions has) and
  their distribution; a Gmail or Slack fetcher is ordinary routine code until
  then.
- How long a person's own Google OAuth client keeps a refresh token while the
  client is in testing is unverified.
- Putting the installed runtimes on the `PATH` of irori's terminal and agent
  runs.
- Docker and in-process Python (Pyodide): too heavy for most people, and too
  limited for network fetching, respectively.

## Stages

1. `routine.yaml`, discovery in both locations, D4's review, **実行** and
   **停止**, `run` steps with the JavaScript runtime and `PATH` commands, agent
   steps, D7 and D8.
2. D5's secrets.
3. The Python runtime.
4. A skill in the irori agent's starter that tells it how to write a routine,
   and a check it can run before asking the person to run one.

Each stage runs `npm run build`, `npm test` and `xvfb-run -a npm run test:ui`,
with disposable folders for routines that write files.
