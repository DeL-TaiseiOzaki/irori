# Conversation history and pending instructions

Source continuation after Windows preview 0.1.3, 2026-09-14. The published installer is unchanged until a separately verified preview is published.

## User behavior

The AI panel restores its recent display history and accepted pending instructions after restarting irori. Storage belongs to the device, exact canonical checkout, KB scope UUID and selected CLI. Copies or another provider do not inherit a conversation. Existing native session handles continue to use their original independent store.

During a turn, **送信待ちに追加** saves the instruction, selected note path and explicitly selected source references before acknowledging it. The queue holds up to twenty instructions, with a combined serialized limit of 1 MiB. An oversized addition fails without dropping accepted instructions. **取消** persists before disappearing from the panel. Saved references identify paths; source bytes are captured when the queued turn starts, as before.

Successful turns continue the current queue. A failed/stopped turn pauses it. After a host restart, pending instructions always start paused: inspect them and choose **送信を再開**. Opening a workspace or selecting a CLI never submits a model prompt. Resetting the native session requires finishing or cancelling pending instructions and retains the displayed history. **新しい会話** adds a visible boundary before starting a new native session.

## Durability and interruption

The trusted host stores schema-validated records under private device `agent-conversations/`, using the existing atomic/fsync writer. Accepted instructions, cancellations and run claims are saved before acknowledgement or provider launch. Claiming a queued instruction and retaining its user message/run ID share one atomic record replacement. Concurrent claims cannot launch the same instruction twice.

Streamed display events are coalesced and saved at a 250 ms scheduling interval, then flushed before reporting turn completion and during orderly shutdown. Sudden host/power failure can lose the latest unflushed output; this is not a full provider transcript or an exactly-once execution guarantee. An unfinished persisted run is shown as having an unconfirmed outcome and is never automatically placed back in the queue. Inspect native history and file changes before deciding what to send next. Native child survival after abrupt host termination remains platform-dependent.

Restored permission/question events are plain historical text without request IDs or answer controls. Reloading or losing the renderer stops its native run and terminal. Electron's native single-instance lock prevents two current hosts from writing the same device profile concurrently. It does not exclude other programs editing KB files; close older irori versions before starting an updated build.

Malformed, oversized or mismatched records fail visibly and block new submissions for that conversation. The panel offers retry; damaged records are not silently replaced. Output persistence failure stops the active turn, and orderly shutdown remains open if history cannot be flushed. Prompts and output stay outside portable KB metadata and Git. No account token or provider session handle is added to the display-history record; provider-emitted text can still contain private data and should be treated as such.

## Retention and migration

The recent display window retains at most 400 events and 512 KiB of serialized event data. Long output is truncated; the panel displays an omission notice. This bounded window is not an archive. The unsent composer draft, full native transcripts, history export/deletion UI, historical session browsing and live turn steering remain follow-up work.

There is no destructive migration. Existing native-session files, notes, source/artifact records and cloud settings remain in place. Display text and pending messages that an older renderer already discarded cannot be reconstructed by this update. No CLI transcript import or model invocation runs during upgrade.

## Verification

Behavior tests cover restart isolation, private file mode, multiple source references, interrupted claims, non-replayable requests, failed record writes, corruption, retention bounds and queue limits. Pi protocol fixtures exercise duplicate-claim rejection, failed persistence before provider launch and native reset boundaries without model inference. Electron tests restart the host twice, verify that no prompt was submitted, persist cancellation, explicitly resume the remaining instruction and reload during a native-shaped question. Packaged smoke tests also restore and remove a pending instruction after a relocated executable restarts without executing it.

Exact completed gates are recorded in [STATUS](STATUS.md) and [HANDOFF](HANDOFF.md). Real provider model-turn/restart acceptance, Windows IME, Google consent/WinFsp and full release gates remain open.
