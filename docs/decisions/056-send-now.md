# 056 — A queued instruction can be sent now

Date: 2026-11-04. Status: owner request; implemented for 0.2.56.
Adds to the queue of [ADR 020](020-parallel-conversations.md) D2 and
[ADR 034](034-irori-mode-threads.md) D3; one run per conversation, the queue
itself and its pause after a stop or a failure stay as they are.

## Context

The owner asked that an instruction typed while an agent works, for a vault
agent and the irori agent alike, can be sent at once, as Claude Code and Codex
allow, instead of waiting until the run ends. Until 0.2.55 a send to a
conversation whose run was in progress joined that conversation's queue and
waited for the run to end; the only way to reach the agent sooner was 停止,
which left the queue paused.

The CLIs differ in what they take while a turn works:

- **Claude Code** reads further user messages on stdin when it is driven in
  stream-json mode, as the Agent SDK's streaming input does. A message's
  `priority` decides when: `next` joins the running turn at its next step
  without stopping it (Claude Code's own default for a prompt that arrives while
  it works), `now` interrupts the turn, `later` waits for its end. Read from the
  SDK 0.3.284 types (`SDKUserMessage.priority`) and the queue of the installed
  Claude Code 2.1.318.
- **Codex**'s app server takes `turn/steer` (`threadId`, `input`,
  `expectedTurnId`, answered with the turn's id): the input joins the active
  turn, and a turn that has ended, a review and a compaction refuse it. Read
  from the strings of codex-cli 0.160.0's binary (`TurnSteerParams`, "no active
  turn to steer", "cannot steer a review turn"); the binary was not run.
- **Pi** has an RPC `steer` command, but one sent just as a run settles is
  queued with no run to take it, and only newer Pi versions report what became
  of it. **OpenCode**, **Hermes Agent** and the **Antigravity CLI** are driven
  one request at a time with nothing that joins a turn in progress.

## Decisions

1. **今すぐ送る on each queued instruction.** The queue under the composer
   gives every waiting instruction a 今すぐ送る button beside 取消, in a vault's
   column and in the irori agent's. The composer's send button keeps adding to
   the queue while a run works, so nothing reaches a running agent by accident.
2. **The running turn takes it when its CLI can.** For Claude Code and Codex,
   an instruction sent now goes into the turn in progress, which takes it at its
   next step and goes on: Claude Code as a user message with `priority: 'next'`
   on the streaming input every turn now uses, Codex as `turn/steer` naming the
   turn it expects. The log shows the person's words where the run took them,
   in that run; the history keeps them the same way, and the run ends once, with
   everything it did.
3. **Only what the run was started with.** An instruction joins a run only if
   it asks for the same access, model, thinking level and (for the irori agent)
   workspace and vaults, the same materials, and nothing that only goes with a
   request of its own: a skill, attached files, the person's lines of another
   note, or a CLI command (`/name`). A different open note is named before the
   words, as `selectedNote` names it in a request. A safer access mode is not
   treated as a match either: the run keeps the access it began with.
4. **Otherwise it stops the run and starts.** When the CLI cannot take words
   mid-turn (Pi, OpenCode, Hermes Agent, the Antigravity CLI), the instruction
   does not fit (decision 3), or the turn refuses it (it has just ended), the
   instruction moves to the front of the queue, the run stops as 停止 stops it,
   and the instruction starts at once. Without a run in progress it simply
   starts, ahead of the older ones. Either way the rest of the queue goes on
   after it, as a send after a stop lets it (ADR 034 D3). The button's tooltip
   says which of the two its CLI does.
5. **Never into another's run.** A routine's step and a vault agent's run
   started by the irori agent's `irori call` refuse an instruction sent now;
   their queue waits as before. The host checks that the queue belongs to the
   owner it is asked for, and sends one instruction per conversation at a time.
6. **Taken from the queue before the CLI is asked.** The instruction leaves
   the queue in one durable write before the CLI hears it, so nothing else
   starts it meanwhile; if the CLI refuses it, it goes back to the front and
   starts as decision 4 says. Claude Code's input stays open only until the
   turn's result: words sent before then are all read and answered before the
   CLI ends, and later ones start a run of their own.

## Consequences

- `HostAPI.sendQueuedNow(scopeId, conversationId, queuedId, workspaceId?)`
  answers `SentNow` (`queued`, `runId`, `steered`).
- `src/agents/steering.ts`: `Steering` (a run's way to take words, opened by
  its CLI once the turn is under way, closed when it can take no more) and
  `MessageChannel` (Claude Code's streaming input).
- `ConversationStore` gains `queuedItems`, `queuedItem`, `promoteQueued` and
  `returnQueued`.
- Every Claude Code turn now uses the SDK's streaming input instead of a string
  prompt; the request reaches the CLI as the same user message as before.
- Pi's `steer` is left for later: it needs a settled run to report whether a
  steered message was taken.
- Verified with protocol fixtures (`tests/send-now.test.ts`,
  `scripts/irori-threads-ui-smoke.ts`); not with a real Claude Code or Codex
  turn.
