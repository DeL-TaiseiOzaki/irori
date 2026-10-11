# 032 — Attachments, dictation and questions in the agent chat

Date: 2026-10-11. Status: owner request; implemented for 0.1.96. Extends
[ADR 017](017-conversation-history.md) and [ADR 020](020-parallel-conversations.md).

## Context

The owner asked for the irori agent's and the hibachi agents' chat to match
Claudian: attach images and any other file, speak instead of typing, and show
the choices properly when Claude Code or Codex asks the person a question.

Before this, the composer took text only. Questions showed their options as
small buttons with a text field always beside them; option descriptions,
headers, "Other" and secret answers were dropped, and an MCP server's
elicitation form from Codex was refused.

## Decisions

1. **Attached files are kept in irori's data directory,** one folder per file:
   `attachments/<id>/<name>`. They are not written into the conversations
   folder, which may be synced or inside a Git checkout (ADR 017 D2). A file is
   kept as soon as it is added to the composer; sending names it by reference.
   - Once an instruction carries it, `sent.json` ties it to its conversation,
     and deleting the conversation deletes it. A file removed before sending
     goes at once; one never sent is pruned after a day.
   - A conversation opened on another device lists the file but cannot show
     it.
   - Each file is at most 25 MB, and an instruction takes at most 10.
2. **Every CLI is told each file's absolute path** (`prompts/attachments.ts`).
   Images also go as pictures where the CLI takes them: Claude Code as image
   blocks (up to 5 MB), Codex as `localImage`, OpenCode as file parts and Pi as
   RPC images. Hermes Agent gets the paths only. Claude Code is given each
   file's folder as an additional directory so reading it needs no approval.
3. **Files can be picked, dropped on the composer or pasted.** A message of
   files alone is sent as 「添付したファイルを見てください。」. The log shows
   images as thumbnails and other files by name; clicking opens the file after
   the usual external-app confirmation.
4. **Voice input uses the operating system's dictation** (owner choice over a
   bundled Whisper model or a paid API). The microphone button puts the caret
   in the message box and starts macOS 音声入力 (the standard
   `startDictation:` action) or Windows voice typing (Win+H). irori records
   nothing. The button is not shown on Linux.
5. **Questions keep what the CLI sent.** `Question` gains `header`, option
   `description` and `preview`, `other` (an answer of one's own), `secret`,
   `multiline` and `optional`.
   - Claude Code's AskUserQuestion always allows "Other"; Codex's
     `requestUserInput` follows `isOther` and `isSecret`; OpenCode follows
     `custom`; Pi's select takes only its options.
   - Options are radio or checkbox cards with their descriptions. One question
     with one choice is answered by picking it, as in Claude Code.
6. **MCP elicitation reaches the person** from Claude Code (`onElicitation`)
   and Codex (`mcpServer/elicitation/request`). A form's fields become
   questions, and the answers go back typed as the schema asks. A URL request
   opens the page only after the person allows it.

## Consequences

- Attachments are device-local, like native sessions; history on another
  device names them only.
- Dictation depends on the system's setting: macOS asks to turn 音声入力 on the
  first time, and Windows voice typing needs a supported language.
- Not verified with a real CLI, on macOS or on Windows; tests use protocol
  fixtures.
