# 017 — Conversations irori keeps, lists and clones

Date: 2026-09-30. Status: owner direction accepted; design only, not implemented.
Addresses the "full transcript/history management" that
[ACCEPTANCE](../ACCEPTANCE.md) leaves open under R04 and R09, and the
follow-up work [CONVERSATIONS](../CONVERSATIONS.md) lists.

## Context

Today irori keeps one conversation per hibachi, CLI and exact checkout, and
one for the irori agent:

- `<data>/agent-conversations/<key>.json` holds a display window of at most 400
  events and 512 KiB, cut from the oldest end. It is not an archive.
- `<data>/agent-sessions/<key>.json` holds the native session handle (Claude
  Code's `session_id`, Codex's `threadId`, ...). The full transcript stays in
  each CLI's own store, which irori never reads.
- A hibachi's panel has **新しい会話** and a reset of the native session; the
  irori agent's panel has neither. There is no list of past conversations, no
  search, rename, deletion, clone or rewind.

The owner asked for history in the manner of
[Claudian](https://github.com/YishenTu/claudian), an Obsidian plugin that runs
the same native CLIs. Its 2.3.1 source was read on 2026-09-30:

- Per conversation it writes, inside the vault, a metadata file (title, times,
  provider and model, native session id, linked note, pin and archive, fork
  source, rewind point) and a ledger of the person's inputs. Metadata is kept
  per device, because native transcripts live on each machine.
- The messages are never stored by Claudian. Opening a conversation rebuilds
  them from the provider's own files (`~/.claude/projects/.../<id>.jsonl`,
  `~/.codex/sessions`, OpenCode's SQLite, ...), with one reader per provider.
- It offers any number of conversations in tabs, a list with pinned and
  archived sections grouped by linked note, search over titles and paths,
  AI-generated titles, fork (Claude, Codex, Grok, Pi) and rewind (Claude,
  Grok, with file restoration on Claude). Deleting a conversation never touches
  native history.

The owner's answers of 2026-09-30:

1. Wherever the history is kept, the person chooses the place; the default is
   the PC.
2. Each conversation keeps its metadata beside its body, as a set.
3. A hibachi has several conversations, and each must say which hibachi, which
   CLI and what was discussed.
4. Conversations can be searched by their text.
5. The irori agent and the hibachi agents stay distinct, while both gain reset
   and clone as Claudian has them.

## Decisions

### D1 — irori records the conversation from the run itself

irori already receives every run as structured events from each adapter
(`src/agents/service.ts`): the person's instruction, text, tool calls and
results, questions, approvals and the end of the turn. It writes all of them to
the conversation, instead of keeping a bounded window.

It does not read native transcript files. Five CLIs keep five formats that
change with their releases, and irori's events already remove the difference
between them. The consequence is that a conversation started outside irori,
such as `claude` typed in a terminal, is not in irori's history; importing
native sessions is listed under Later.

Text is kept whole. A single tool result above 1 MiB, typically the content of
a file the tool read, is kept to its first 1 MiB with a marker; the file and
the native transcript still hold it.

### D2 — A conversation is a folder of metadata and events

```
<conversations folder>/<conversationId>/
  meta.json      metadata, rewritten atomically
  events.jsonl   one event per line, appended only
```

```json
{
  "schemaVersion": 1,
  "id": "<uuid>",
  "owner": { "kind": "hibachi", "id": "<scope uuid>", "name": "research" },
  "agent": "claude-code",
  "model": "<model id or null>",
  "title": "...",
  "titleSource": "first-message",
  "createdAt": "...",
  "updatedAt": "...",
  "linkedNote": "notes/2026-09-30.md",
  "hibachis": ["<scope uuid>"],
  "pinned": false,
  "archived": false,
  "forkedFrom": { "conversationId": "<uuid>", "eventId": "<uuid>" },
  "native": { "<deviceId>": { "handle": "...", "access": "default", "root": "<sha256 of the checkout path>" } }
}
```

- `owner.kind` is `hibachi` (with the hibachi's scope UUID) or `irori-agent`
  (with the id in `your-ai.json`). `owner.name` is the name when the
  conversation began, for display when the hibachi is gone.
- `agent` is fixed for the life of the conversation. Choosing another CLI in
  the composer starts a new conversation.
- `linkedNote` is the note selected when the conversation began, relative to
  the owner's root.
- `hibachis` lists, for the irori agent, the hibachis its hand-offs reached.
- `native` is the only device-specific part. `deviceId` is a random UUID irori
  creates once in its data directory. The checkout path is stored as a digest,
  so no local path enters a folder that may be synced or shared.
- Each event carries an `id`, `runId`, time, role and type, and the text and
  details it has today. Permission and question requests are kept as text,
  never as answerable requests, as now.
- `meta.json` is read for the list; `events.jsonl` only when a conversation is
  opened or searched. Writes to one conversation go through one serial queue,
  and events are flushed as now (every 250 ms, at the end of a turn and at
  shutdown).

Pending instructions and the run in progress are device state. They stay in
irori's data directory, keyed by conversation id, and never enter the
conversations folder.

### D3 — The person chooses where conversations are kept

- One setting, **会話の保存先**, names the conversations folder. The default is
  `<data>/conversations/` on this PC.
- The person may choose any folder: a synced folder, or a folder inside a
  hibachi to keep its conversations with it. irori says, before switching, that
  prompts and replies will be written there, and, when the folder is inside a
  Git checkout, that they will be committed unless ignored. irori does not edit
  `.gitignore`.
- Switching the setting offers to move the existing conversations. irori writes
  to one folder at a time and never merges two.
- A folder that is missing or unwritable blocks new runs with the reason, as a
  damaged record does now; it is never silently replaced by the default.

This turns the rule in ACCEPTANCE that full transcripts are device-local into
the default instead of a constraint.

### D4 — Many conversations per owner; one run per checkout

> Superseded in part on 2026-10-02 by [ADR 020](020-parallel-conversations.md):
> an owner's conversations now run side by side, one run per conversation.

- A hibachi and the irori agent each have any number of conversations.
- The irori agent's conversations are kept per workspace (owner, 2026-10-09):
  `meta.json` records the workspace a conversation began in, and its history
  list, the conversation shown, its queue and new conversations are those of the
  workspace open. A conversation continues only in its own workspace.
  Conversations begun before this have no workspace and are shown in none (the
  owner chose not to carry them over); their folders are kept. A hibachi's
  history stays one per hibachi wherever it is opened, in the one conversations
  folder (the owner kept D3; a folder per hibachi remains under Later).
- The panel shows one conversation at a time with a **履歴** list for its own
  owner. A hibachi's list never shows the irori agent's conversations, and the
  reverse. The irori agent's hand-offs remain visible in the hibachi's panel as
  they are now ([YOUR-AI](../YOUR-AI.md)).
- One run at a time per hibachi checkout, as now, whatever the conversation:
  two conversations editing one checkout at once would overwrite each other. A
  send in another conversation of that hibachi is queued behind the run.
- Different hibachis still run in parallel.

### D5 — The list, titles and search

- **履歴** lists the owner's conversations by last update, pinned first, with
  archived ones in their own section. Each row shows the title, the CLI, the
  time and the linked note. The list can be grouped by linked note, and a note
  can show the conversations linked to it.
- The title is the first line of the first instruction, cut at 50 characters.
  The person can rename it; a renamed title is never replaced. No extra model
  call is made for titles.
- Each row can be renamed, pinned, archived, cloned (D6) and deleted.
  Deletion removes irori's folder only and says that the CLI's own transcript
  remains where the CLI keeps it.
- Search matches the title, the linked note and the text of instructions and
  replies, as a literal substring ignoring letter case, the same matching as
  [KB search](../KB-SEARCH.md). Tool output is not searched. The scan is
  linear in the text read, never a backtracking regular expression.
  Two-character Japanese queries therefore work, which SQLite FTS5's trigram
  tokenizer does not allow.

### D6 — New conversation, rewind and clone

- **新しい会話** starts an empty conversation for the same owner and CLI. It
  replaces the boundary line and the separate native-session reset; the irori
  agent's panel gains it.
- **ここからやり直す** on one of the person's messages starts the next turn
  from before that message. The later events stay in `events.jsonl`, marked as
  set aside, and are hidden from the view. The message returns to the composer.
  Files the agent changed are not restored.
- **複製** on any message creates a new conversation holding a copy of the events up
  to it, with `forkedFrom` set. The original is unchanged.
- The native side of rewind and clone uses the CLI's own mechanism where the
  adapter supports and verifies it: Claude Code's `resume` with
  `resumeSessionAt` and `forkSession`, Codex's thread fork, Pi's fork. Elsewhere,
  and whenever no handle is usable (D7), irori starts a fresh native session and
  rebuilds the context.
- **Rebuilding context**: the first instruction of the fresh session is
  preceded by the conversation so far, the instructions and replies without tool
  output, cut from the oldest end to a fixed budget, and labelled as an earlier
  conversation that is material and not instructions.

### D7 — Native sessions follow the device

- A conversation continues its native session only on the device and checkout
  recorded in `native`, with the same access mode (the ADR 009 rule stays).
- Opened on another device, in another checkout of the hibachi, or after the
  handle fails, the conversation's next turn starts a fresh native session with
  rebuilt context (D6), and the new handle is added under this device. The view
  shows a boundary line saying so. A failed resume is reported, not silently
  retried, as now.

### D8 — Migration

On the first start of the version that implements this, each existing
`agent-conversations` record becomes one conversation in the default folder,
titled **以前の会話** with its CLI, holding the events it had. Its native handle
from `agent-sessions` is attached under this device. The old files are left in
place for one release and then removed. Nothing is sent to a model during
migration.

### D9 — Host boundary

The conversation store, the storage folder and search live in the host. The
renderer reaches them through narrow `HostAPI` methods (list, open, search,
rename, pin, archive, delete, clone, rewind, move storage) and never receives
the folder's path. Document content cannot reach them. Agents are not given
the conversations folder; the person who places it inside a hibachi accepts
that the hibachi's agent can read it there.

## What was borrowed from Claudian

Taken: metadata apart from the messages; provider state kept as an opaque
handle per device; native history never changed or deleted by irori; pin,
archive and grouping by linked note; clone and rewind through the CLI's own
mechanisms where they exist; one write queue per conversation.

Not taken:
- Rebuilding messages from native files, which needs a reader for each
  provider (D1).
- The input ledger with images as base64 inside the vault.
- AI-generated titles, which spend a model call per conversation.
- Search limited to titles and paths.
- Unlimited tabs.
- Claude-only file restoration on rewind.

## Relation to other decisions

- [ADR 009](009-agent-access-and-extension-compatibility.md): a change of
  access mode still starts a fresh native session within the same
  conversation.
- [ADR 016](016-routines.md) (proposed): a routine's agent step is an
  ordinary conversation in this store, owned by the routine's owner, with the
  routine's run id in its metadata, so D8 there needs no conversation store of
  its own.
- [CONVERSATIONS](../CONVERSATIONS.md) describes the current store; it is
  rewritten when stage 1 lands.

## Later

- Importing sessions from native stores, for conversations started outside
  irori.
- A conversations folder per hibachi instead of one setting.
- Restoring files on rewind, on the CLIs that checkpoint them.
- Retention: removing conversations older than a chosen age.
- Showing two conversations side by side.

## Stages

1. D1, D2, D4, D5 without search, D6's **新しい会話**, D8, for hibachis and the
   irori agent, with the default folder.
2. D3 and D5's search.
3. D6's rewind and clone with rebuilt context, then native fork per CLI as each
   adapter is verified, and D7.

Each stage runs `npm run build`, `npm test` and `xvfb-run -a npm run test:ui`.
Tests cover migration from existing records, a conversation opened on a second
device id, a damaged `meta.json` or `events.jsonl` line, search over Japanese
two-character queries and a crafted long line, and an unwritable folder.
