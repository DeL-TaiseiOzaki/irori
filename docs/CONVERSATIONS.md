# Conversations

What irori keeps of the conversations with vault agents and the irori agent,
as of **0.1.60** ([ADR 017](decisions/017-conversation-history.md) stage 1), with
stage 3's rewind, copy and rebuilt context from **0.2.58** (ADR 017 D6). Stage 2,
the choice of folder and search, is still to come. Earlier behavior (a bounded
display window per space, CLI and checkout) is described in the history of this
file.

## What the person sees

- A vault and the irori agent each have any number of conversations, and they
  run side by side ([ADR 020](decisions/020-parallel-conversations.md)). Each
  column keeps the open ones as tabs, shown once there are two. irori mode shows
  the irori agent in up to four columns of its own, and a conversation running
  without a tab gets one in the first column
  ([ADR 034](decisions/034-irori-mode-threads.md)). **新しい会話** starts an empty one on the same CLI; nothing
  is written until its first instruction. **履歴** lists the owner's own
  conversations: a vault's list never holds the irori agent's, and the reverse.
- The irori agent keeps a history per workspace (0.1.94). Its 履歴, the
  conversation a panel opens on, its queue and a new conversation are those of
  the workspace open; opening another workspace shows that one's. A conversation
  continues only in the workspace it began in. Since 0.1.99 the columns, tabs and
  conversations on show are also kept per workspace, and the host refuses to
  show a named irori agent conversation in another workspace (ADR 034 D2). Conversations from before 0.1.94
  have no workspace and appear in none; their folders stay. A vault keeps one
  history wherever it is opened, and a routine's irori agent step is kept in the
  routine's workspace.
- **この指示を編集してやり直す** on a person's message that started a run puts
  it back in the composer with its files. Sending sets that message and
  everything after it aside (kept in `events.jsonl`, out of the view) and goes
  on from before it. **ここから分岐** on a run's end copies the conversation
  through that run into a new one, opened as a tab ([ADR 017](decisions/017-conversation-history.md) D6).
  Files the agent changed are not restored.
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
  CLI's own history stays, and so do the copies of notes and materials its runs
  used, which irori keeps in its data folder; it removes the conversation's own
  folder only. Sending in an archived
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
  (`vault` or `irori-agent`, its id and its name then), CLI, model, title and
  where it came from, times, linked note, the vaults the irori agent's
  hand-offs reached, pin and archive, `forkedFrom` (null until stage 3), a
  routine step's `routine` or a hand-off's `handedBy`, the irori agent's
  `workspace` (the id of the workspace it began in), and `native`. Keys a later
  version adds are read and kept.
- **events.jsonl** (`storedEvent` in `src/agents/conversations.ts`): each line
  has an id, the run's id, a time, a role (`user` or `agent`), a type and the
  text and details. Permission and question requests are kept as status text,
  never as something to answer. A streamed reply keeps one id; when it spans
  several writes, its lines share the id and are joined when read. A run's
  `done` line holds `native`, where its CLI's session stood (device, checkout
  digest, access, handle and Claude Code's entry or Codex's turn). A rewind
  rewrites the file once, atomically, marking the set-aside lines with `aside`.
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
  devices' handles are kept. A new session in a conversation that already has
  messages hears them first, as material: the person's messages and the
  replies without tool output, newest kept within 30,000 characters
  (`prompts/earlier-conversation.ts`).
- After a rewind or in a copy, this device's entry carries `branch`: the next
  turn goes on from that point as a new session of its own (Claude Code's
  `resumeSessionAt` with `forkSession`, Codex's `thread/fork` with `lastTurnId`)
  and saves the new handle. Other CLIs, and points from another device,
  checkout or access, start a fresh session with the conversation so far.
- A resume that fails before the agent says or does anything is reported, and
  this device's handle is set aside: the next instruction starts a new session.
  A turn that fails after the agent worked keeps the handle.
- A routine's agent step is a conversation of its own and never keeps a handle
  ([ROUTINES](ROUTINES.md)).

## Runs and the queue

- One run at a time per conversation; an owner's conversations run at once in
  the same checkout, and different vaults run in parallel. The run map is keyed
  by run id. irori does not coordinate edits between runs in one checkout.
- A send to a conversation whose run is in progress, or whose queue is not
  empty, is queued in that conversation, and waits for that conversation alone.
  A completed run sends its conversation's next; a failed or stopped run pauses
  that queue (**一時停止中**); after a restart queues are paused until
  **送信を再開**, or until the next send to that conversation, which joins the
  queue and lets it go on, oldest first (ADR 034 D3). A run never
  passes its conversation's waiting queue. `startNextQueued(scopeId,
  conversationId?)` starts the named conversation's next, or the oldest among
  conversations not running.
- **停止** stops the conversation's own run; the owner's other runs go on.
- **今すぐ送る** on a queued instruction sends it ahead of the others
  ([ADR 056](decisions/056-send-now.md)). A Claude Code or Codex run in progress
  takes it at its next step and goes on, when it asks for nothing the run was
  not started with (access, model, level, vaults, materials) and nothing that
  needs a request of its own (a skill, attached files, a `/` command); its words
  are kept in that run. Otherwise, and on the other CLIs, the run stops and the
  instruction starts at once. A routine's step and a hand-off refuse it.
- A run the host could not see finish is shown as unconfirmed on the next start
  and never sent again. If the host stopped between claiming a queued
  instruction and writing it, the message is written from the claim.
- The irori agent's hand-off to a vault through `irori call`
  continues in one vault conversation per irori agent conversation
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
`startNextQueued`, `sendQueuedNow`, `rewindConversation`,
`forkConversation` and `start`, and never receives the folder's path. Agents are
not given the conversations folder.

## Verification

- `tests/conversations.test.ts`: the folder, title and file modes; appends,
  streamed ids across writes and the 1 MiB mark; damaged `meta.json`, a damaged
  and a cut line; the queue across conversations and restart; a claim
  interrupted before its message; limits; rename, pin, archive and delete.
- `tests/sessions.test.ts`: the device id; resume only with the same access; a
  failed resume and the next turn; another device id; another checkout; a
  damaged device id (Codex protocol fixture).
- `tests/rewind-fork.test.ts`: a rewind and a copy on Codex (`thread/fork`
  through the turn before, or the copied one) and Claude Code
  (`--resume-session-at` with `--fork-session`), the set-aside lines out of the
  view, a conversation's first message, and Hermes Agent hearing the
  conversation so far in a new session.
- `tests/send-now.test.ts`: an instruction sent now into a Codex turn
  (`turn/steer`) and a Claude Code turn (`priority: 'next'`), recorded in that
  run; one that does not fit, or that the turn refuses, stopping the run and
  starting; without a run, ahead of older ones; another owner refused.
- `tests/conversation-migration.test.ts`: records of a vault and the irori
  agent, a handle alone, damaged and misfiled records, the old files unchanged
  and a second run.
- `scripts/conversations-ui-smoke.ts`: the migrated conversation, 新しい会話, a
  send waiting behind another conversation's run, rename, pin, archive, delete,
  restart, and the irori agent's separate history.
- Real CLIs were not run for this change.
