# Conversations

What irori keeps of the conversations with hibachi agents and the irori agent,
as of **0.1.60** ([ADR 017](decisions/017-conversation-history.md) stage 1). Stage 2
adds the choice of folder and search; stage 3 adds rewind, clone and rebuilt
context. Earlier behavior (a bounded display window per space, CLI and checkout)
is described in the history of this file.

## What the person sees

- A hibachi and the irori agent each have any number of conversations, and they
  run side by side ([ADR 020](decisions/020-parallel-conversations.md)). The
  hibachi agent's panel keeps the open ones as tabs, shown once there are two;
  the irori agent's panel shows one at a time. **新しい会話** starts an empty one on the same CLI; nothing
  is written until its first instruction. **履歴** lists the owner's own
  conversations: a hibachi's list never holds the irori agent's, and the reverse.
- Choosing another CLI in the panel starts a new conversation: a conversation's
  CLI is fixed. Opening a conversation from 履歴 switches the panel to its CLI.
- Opening a panel shows the owner's conversation that is running, else the one
  whose queued instruction is oldest, else its latest with the chosen CLI
  (not archived, not a routine's or a hand-off's).
- **履歴** rows show the title, the CLI, the time of the last turn and the linked
  note, pinned rows first, then by last update, archived rows in their own
  section. **ノート別** groups rows by linked note; **このノート** shows only the
  conversations linked to the note open beside the panel. Each row can be
  renamed, pinned, archived and deleted. Deleting asks first and says that the
  CLI's own history stays; it removes irori's folder only. Sending in an archived
  conversation brings it back.
- The title is the first line of the first instruction, cut at 50 characters
  (whole characters, emoji included). A renamed title is never replaced. A
  routine's step is titled with the routine and step; a hand-off with its task.
- The separate **会話をリセット** is gone: 新しい会話 replaces it.

## Storage

```
<data>/conversations/<id>/meta.json     metadata, rewritten atomically
<data>/conversations/<id>/events.jsonl  events, one per line, appended only
<data>/conversation-state/<id>.json     this device's queue and run in progress
<data>/device.json                      this device's id
```

- **meta.json** (`conversationMeta` in `src/domain/conversation.ts`): owner
  (`hibachi` or `irori-agent`, its id and its name then), CLI, model, title and
  where it came from, times, linked note, the hibachis the irori agent's
  hand-offs reached, pin and archive, `forkedFrom` (null until stage 3), a
  routine step's `routine` or a hand-off's `handedBy`, and `native`. Keys a later
  version adds are read and kept.
- **events.jsonl** (`storedEvent` in `src/agents/conversations.ts`): each line
  has an id, the run's id, a time, a role (`user` or `agent`), a type and the
  text and details. Permission and question requests are kept as status text,
  never as something to answer. A streamed reply keeps one id; when it spans
  several writes, its lines share the id and are joined when read.
- **Event ids** are given when irori sends an event to the views, so the view and
  the file name the same event.
- **Details over 1 MiB** (a tool's input or result) are kept to their first
  1 MiB on a character boundary, with `cut` holding the original byte count; the
  view shows the first 16,000 characters. Text is kept whole. Claude Code's tool
  results and Codex's finished items (a command's output, a file change) are
  recorded as results of their calls; Pi, OpenCode and Hermes Agent already
  reported theirs. The log shows a result under its call.
- **Writes** to one conversation go through one queue; conversations write
  independently. Events are buffered and appended every 250 ms, at the end of a
  turn before its end is reported, and at shutdown, each append followed by
  fsync. A line a crash cut short stays a line of its own and is read as damaged.
- **Device state** stays in the data directory: the instructions waiting to be
  sent (up to 20 and 1 MiB per conversation) and the run in progress. It is
  deleted when empty. Claiming a queued instruction removes it from the queue
  and records the run, with the instruction, in one atomic write before the
  person's message is appended and the CLI starts.
- Files are private (0600, folders 0700) and must be ordinary files; a folder
  that is a link is listed as damaged and deleted as a link only.

## Native sessions

- A conversation keeps its CLI's session handle per device:
  `native[<deviceId>] = { handle, access, root }`, where `root` is the SHA-256 of
  the checkout path, so no local path enters the folder. `deviceId` is a random
  UUID in `device.json`, made once.
- A turn resumes the handle only on the same device, checkout and access mode.
  Otherwise it starts a new native session in the same conversation and says
  why in one line (another device, another folder, or a changed access mode,
  [ADR 009](decisions/009-agent-access-and-extension-compatibility.md)). Other
  devices' handles are kept. Stage 1 does not yet give the new session the
  conversation so far; stage 3 does.
- A resume that fails before the agent says or does anything is reported, and
  this device's handle is set aside: the next instruction starts a new session.
  A turn that fails after the agent worked keeps the handle.
- A routine's agent step is a conversation of its own and never keeps a handle
  ([ROUTINES](ROUTINES.md)).

## Runs and the queue

- One run at a time per conversation; an owner's conversations run at once in
  the same checkout, and different hibachis run in parallel. The run map is keyed
  by run id. irori does not coordinate edits between runs in one checkout.
- A send to a conversation whose run is in progress, or whose queue is not
  empty, is queued in that conversation, and waits for that conversation alone.
  A completed run sends its conversation's next; a failed or stopped run pauses
  that queue; after a restart queues are paused until **送信を再開**. A run never
  passes its conversation's waiting queue. `startNextQueued(scopeId,
  conversationId?)` starts the named conversation's next, or the oldest among
  conversations not running.
- **停止** stops the conversation's own run; the owner's other runs go on.
- A run the host could not see finish is shown as unconfirmed on the next start
  and never sent again. If the host stopped between claiming a queued
  instruction and writing it, the message is written from the claim.
- The irori agent's hand-off to a hibachi through the `hibachi` command
  continues in one hibachi conversation per irori agent conversation
  (`handedBy`), apart from the person's own conversations.

## Damage

- A damaged `meta.json` lists the conversation as unreadable, with only
  **削除**; it is never replaced. Its owner, when still readable, keeps it in the
  right list; otherwise it is listed for every owner so it can be removed.
- A damaged line of `events.jsonl` is skipped and counted; the view says how many
  lines could not be read, and later turns still append.
- A damaged queue record blocks sends to that conversation with the reason.
- A damaged `device.json` blocks runs with the reason; it is not replaced.

## Migration (D8)

On the first start of 0.1.60, each record in `agent-conversations/` becomes one
conversation titled **以前の会話** with its CLI, holding its events, its queue and
its unconfirmed run, with the handle from `agent-sessions/` under this device. A
handle without a record becomes an empty 以前の会話. The same record always
becomes the same conversation id, so an interrupted migration adds nothing when
repeated. `conversations-migrated.json` marks it done. Records that cannot be
read are left in place and named in the mark. The old files stay for one
release and are then removed. Nothing is sent to a model.

## Host boundary

The store, the queue and native handles live in the host. The renderer reaches
them through `agentConversations`, `agentConversation`, `createConversation`,
`renameConversation`, `pinConversation`, `archiveConversation`,
`deleteConversation`, `queueAgentMessage`, `removeQueuedMessage`,
`startNextQueued` and `start`, and never receives the folder's path. Agents are
not given the conversations folder.

## Verification

- `tests/conversations.test.ts`: the folder, title and file modes; appends,
  streamed ids across writes and the 1 MiB mark; damaged `meta.json`, a damaged
  and a cut line; the queue across conversations and restart; a claim
  interrupted before its message; limits; rename, pin, archive and delete.
- `tests/sessions.test.ts`: the device id; resume only with the same access; a
  failed resume and the next turn; another device id; another checkout; a
  damaged device id (Codex protocol fixture).
- `tests/conversation-migration.test.ts`: records of a hibachi and the irori
  agent, a handle alone, damaged and misfiled records, the old files unchanged
  and a second run.
- `scripts/conversations-ui-smoke.ts`: the migrated conversation, 新しい会話, a
  send waiting behind another conversation's run, rename, pin, archive, delete,
  restart, and the irori agent's separate history.
- Real CLIs were not run for this change.
