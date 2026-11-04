---
title: Conversations and history
description: Keep AI work in separate conversations and reopen it from history.
---

## Start or open a conversation

Each vault agent and the irori agent can have several conversations. **New conversation** starts an empty one with the same CLI. It is recorded when you send its first instruction.

Open earlier conversations from **History**. Choosing a different CLI starts a new conversation; opening one from history switches to its CLI.

## Organize history

Rename, pin, or archive conversations. **By note** groups them by linked note, and **This note** filters to the note open beside the panel.

Deleting a conversation removes irori's saved copy. The CLI's own history stays, and so do the copies of notes and materials its runs used, in irori's data folder. Conversations live in this computer's application data. Choosing a storage folder and searching conversation text are not available yet.

## Queues and resuming

Each conversation runs one instruction at a time, and several conversations can run at once. Instructions sent during a run wait in that conversation's queue.

When an instruction cannot wait, press **今すぐ送る** (send now) beside it in the queue. Claude Code and Codex take it at their next step without stopping the running work. An instruction with attached files, one whose skill, model or other choices differ from the run's, and any instruction on another CLI stop the run and are then sent.

A failed or stopped run pauses the queue. Sending another instruction continues it, oldest first; **Resume sending** does the same. Instructions survive a restart. A run whose completion could not be confirmed is never automatically repeated.

A native CLI session resumes only on the same computer, folder, and access mode. A change starts a new CLI session. Previous conversation context is not automatically supplied to it yet; include the material it needs in your next request.
