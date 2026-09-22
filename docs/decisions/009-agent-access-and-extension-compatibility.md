# 009 — User-controlled access, native CLI capabilities and VS Code extensions

Date: 2026-09-23. Status: owner decisions accepted; implementation is partial.

## Decisions

The owner approved merging PR #73 and publishing the 0.1.26 testing preview,
and explicitly authorized real native CLI model acceptance using existing
accounts. This does not grant automatic approval for future feature merges or
change any provider account.

The owner wants people to choose whether writes are allowed, with approval
and full-access choices comparable to native agent clients. Treat two distinct
permissions explicitly:

- **Native agent execution.** Expose the provider's actual supported modes.
  Preserve native approvals by default and require an explicit choice for full
  access. Do not call Codex's workspace-write/on-request setting a request for
  every write, or invent a standard approval control for Pi. Questions remain
  interactive in full access. Carry the selected mode with queued instructions;
  changing mode must not reuse an elevated native session under a lower label.
- **Drive writes.** The person must be able to choose the write policy for a
  connection. The initial design is read-only, approval before delivery, or
  permission to deliver without each approval. Full access applies to that
  chosen connection; it does not select all accounts or destinations. Native
  agent full access does not grant Google OAuth scopes, turn a read-only mount
  writable, or approve delivery of an old preparation to a rebound account.
  Existing connections remain read-only until the actual writable capability,
  re-consent, delivery checks and interruption recovery are implemented. Do not
  present an enabled write selector that cannot enforce its advertised mode.

The owner clarified that the requirement is **the capabilities available to an
ordinary native CLI agent**, including its file and command tools, through
irori. Editor syntax coloring, completion, diagnostics and run buttons are
separate conveniences. They must not be used as a reason to restrict the
agent's capabilities or as evidence of CLI parity. Native permissions and
capability-specific acceptance still apply. Provider limitations must be shown
as limitations, not silently replaced by text or simulated success. The owner
then asked for those conveniences to be shown or hidden together with one
button; [EDITOR-ASSISTANCE](../EDITOR-ASSISTANCE.md) records that display switch.

The extension target is **VS Code extension compatibility**. An irori-specific
plugin API is not a substitute. This resolves ADR 005's open question about
what "taking in extensions" means. It does not promise that every extension,
proposed API or Microsoft Marketplace package may run or be distributed.

## Consequences and next evidence

The current Electron/React/CodeMirror host remains the running implementation.
It has no VS Code extension host. Implementing compatible runtime APIs and
adopting an existing workbench are architectural alternatives to evaluate;
the owner has not approved replacing the current note workflow merely by
choosing compatibility. Record that evaluation separately in the
[compatibility investigation](../research/VSCODE-EXTENSION-COMPATIBILITY-2026-09-23.md).
An executable probe must run unchanged extensions against a real host and
exercise the APIs irori needs. Manifest parsing or VSIX extraction alone is
not evidence that extensions execute.

Permission mapping, actual native questions, denial, cancellation, restart and
person-line notification each need their own evidence. An installed executable
without a configured model is not a successful model trial. Keep credentials,
private transcripts and machine paths out of tracked results.

The Drive outbox already retains exact account/destination identity and bytes.
The additional recovery view makes those bytes reachable after removing their
owner or connection. Recovery writes a new local file; it does not enable cloud
delivery. Portable provenance, Google/device acceptance and signing remain
independent remaining work.
