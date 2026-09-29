# 016 — Routines: jobs a person or an agent defines

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
or an agent defines and that run on demand or on a schedule. A job may run a
program (rule-based fetching, filtering, reformatting) or instruct an agent
(deciding which hibachi a mail concerns and putting it there). Gathering
sources is one use of it; the rest can remain extension-level material.

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

A skill says how to do something; a routine says when it runs, what runs and
who does it. An agent step may simply tell the agent to apply a skill.

### D2 — `routine.yaml`

```yaml
name: Mail triage
when: '0 8 * * *'        # five-field cron, local time; omitted = on demand only
timeout: 30m
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
  `model` default to the ones chosen in the panel. `access` is required, so an
  unattended run never depends on a remembered choice.

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

### D4 — A routine runs only after the person enables it on this device

Routine code runs with the person's permissions, as the terminal does, and an
agent can write routines. So:

- A routine is enabled per device. The record, in irori's data directory, keeps
  a digest of the routine folder's files.
- Enabling shows `routine.yaml` and the files beside it. A later change to any
  of them, by a person, an agent or a pull, disables the routine until it is
  enabled again, and the review shows the difference.
- **今すぐ実行** on a routine that is not enabled shows the same review first.
- A routine arriving in a shared hibachi starts disabled on every device, so
  a team's members do not all run it at once without choosing to.

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

### D6 — Schedule and dispatch

- A routine starts only from its schedule or from **今すぐ実行** (owner,
  2026-09-30). There are no other triggers.
- Routines run only while irori is open (owner, 2026-09-30); irori installs no
  operating-system scheduler. The host checks due routines once a minute.
- `when` is read in the device's time zone with a maintained cron library
  (croner, as Pi's scheduling extensions and its former Slack bot use). In the
  hour repeated when clocks go back, a routine runs once.
- Dispatch is at most once: the next due time is advanced and the run recorded
  as started before its first step runs, so a crash never repeats a run.
- A run missed while irori was closed runs once when irori opens, however many
  times it was missed, and only within a grace window of half the routine's
  period, at least 2 minutes and at most 2 hours (Hermes Agent's rule). Later
  than that, the run is recorded as missed and the routine waits for its next
  time.
- Runs go one at a time across all routines, in the order they fell due. A
  routine already running or waiting is not queued a second time; the skipped
  time is recorded.
- An agent step in a hibachi waits while that hibachi is held by another agent
  run, as a hand-off does.

### D7 — Unattended agent steps

- Every agent step is a new native session. Nothing carries over between runs
  except what the routine keeps in `IRORI_STATE`.
- The step's preamble tells the agent that no one is present, that captured
  text is material and not instructions (as notes are,
  [YOUR-AI](../YOUR-AI.md)), that it must not create or change routines, and
  that it must report what it changed.
- The report may begin with `[SILENT]`, meaning nothing worth telling, or with
  `[FAILED]` and a reason, which fails the step although the CLI ended
  normally.
- A question or an approval request from the native CLI fails the step with
  that request recorded, instead of waiting for an answer no one gives.
- Success is read from the adapter's end-of-turn result, not the process exit
  code: Pi's JSON mode exits 0 after a failed turn.
- A step with no output from the agent for 10 minutes is stopped as stalled,
  in addition to the routine's `timeout`.

### D8 — Run records and notices

- Each run keeps, in irori's data directory and never in a knowledge base:
  start and end, the trigger, each step's exit status and its output (capped),
  the agent step's conversation, which can be opened like any conversation,
  and the files changed in each hibachi with Git (from `git status` before and
  after). Definitions stay in the routine folders; this record is the only run
  state, as Hermes Agent keeps its execution ledger apart from its jobs.
- A run's state is one of started, succeeded, nothing to do, failed, missed,
  skipped or unknown. A run that irori's exit or a crash left started is marked
  unknown when irori opens and is never repeated automatically.
- A finished run shows a badge on the routines view unless it was silent or
  had nothing to do. A failure notifies once; the same routine failing again
  adds to its failure count without a new notice until the person looks at it.

### D9 — Host boundary

Routine discovery, enabling, scheduling, runtimes, secrets and execution live
in the host. The renderer reaches them through narrow `HostAPI` methods (list,
review and enable, run now, records, runtime install). Document content cannot
start a routine.

## What was borrowed

[Hermes Agent](https://github.com/NousResearch/hermes-agent) and
[Pi](https://github.com/badlogic/pi-mono) were read on 2026-09-30 at the owner's
request. Hermes has a built-in scheduler (`cron/` in its repository); Pi has
none, and scheduling comes from extensions (`pi-schedule-prompt`,
`pi-scheduler`) and from its former Slack bot, mom, whose jobs were JSON files
the agent wrote into a watched folder.

Taken: the one-minute check, at-most-once dispatch, one catch-up within a grace
window, skipping a routine already running, a fresh session per run, the
nothing-to-do gate before the agent, `[SILENT]` and failure markers, unknown
runs after a crash, one notice per failure, and a run ledger apart from the
definitions.

Not taken: agents creating standing jobs that run without review (mom, and
Hermes when `allow_agent_scheduling` is on); deleting a definition that does
not parse or is late (mom); one global jobs file holding definitions and run
state together (Hermes); delivery to chat platforms, hosted schedulers and
quota holds, which a desktop app that runs only while open does not need.

## Relation to earlier decisions

- [ADR 005](005-host-and-references.md) records that irori has no extension
  mechanism and is not an MCP client. Both remain true: a routine is a folder
  irori runs, not an extension API, and agent steps use whatever MCP servers
  the native CLI is configured with.
- [ADR 009](009-agent-access-and-extension-compatibility.md): `access` in an
  agent step uses the same modes as the composer.
- [ADR 013](013-drive-folders-in-kbs.md): the split between what a folder
  declares and what the device binds (accounts, secrets, enabling) is the same.

## Not in this decision

- Shared routine building blocks (`uses: <package>`, as GitHub Actions has) and
  their distribution; a Gmail or Slack fetcher is ordinary routine code until
  then.
- How long a person's own Google OAuth client keeps a refresh token while the
  client is in testing, and what that means for a daily routine, is
  unverified.
- Putting the installed runtimes on the `PATH` of irori's terminal and agent
  runs.
- Docker and in-process Python (Pyodide): too heavy for most people, and too
  limited for network fetching, respectively.

## Stages

1. `routine.yaml`, discovery in both locations, D4's review and enabling,
   **今すぐ実行**, `run` steps with the JavaScript runtime and `PATH` commands,
   agent steps, D7 and D8.
2. D6's schedule and dispatch, and D5's secrets.
3. The Python runtime.
4. A skill in the irori agent's starter that tells it how to write a routine,
   and a check it can run before asking the person to enable one.

Each stage runs `npm run build`, `npm test` and `xvfb-run -a npm run test:ui`,
with disposable folders for routines that write files.
