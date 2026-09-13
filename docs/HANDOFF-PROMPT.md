# irori — Continuation prompt

Updated after the source-navigation continuation on 2026-09-14. Give this file to the next agent, or copy its contents into a new session. It describes the checkpoint; inspect current files and Git state before acting, since later work takes precedence.

## Task

Take over **irori** development from the source-navigation and conversation-recovery checkpoints. Continue implementation and verification of the remaining product requirements. Do not restart completed features or spend the session only rewriting plans. Choose a bounded next implementation with executable acceptance checks; make independent progress while waiting for device/account evidence.

Work in the independent `irori/` repository inside the `KB_design/` workspace. If this file is the only entry point available, the repository root is its parent directory's parent. `KB_design/` itself is not a Git repository. LayeredKB and claudian-orchestra-template are separate reference repositories with their own histories and contracts. Do not combine their changes or commits with irori.

Respond to the user in Japanese. Write code, identifiers, technical documents and commit messages in English. The user prefers simple code and established libraries. Preserve existing development, verification and commit/push authorization; do not ask again for routine, reversible work already covered by it. New user directions override this historical handoff.

## Read first

1. [Contributor contract](../AGENTS.md), [README](../README.md), current sections of [STATUS](STATUS.md) and [CHECKPOINT](CHECKPOINT.md).
2. [Full handoff and existing authorization](HANDOFF.md).
3. [Provisional host decision](decisions/001-initial-host.md), [confirmed product decisions](decisions/002-release-and-workspace.md), [release plan](RELEASE-PLAN.md) and [acceptance matrix](ACCEPTANCE.md).
4. [Continuous editing and source/artifact records](EDITING-AND-RECORDS.md), [source/artifact navigation](KNOWLEDGE-NAVIGATION.md), [conversation recovery](CONVERSATIONS.md), and the documents for the next selected task.

The optional parent `docs/irori/` contains the original product specification and implementation-start prompt. Its old Q01/Q02 proposals are superseded by ADR 002 and subsequent confirmed decisions. Older dated milestone paragraphs in local documents are historical, not the current backlog. Read [the completed reuse assessment](REUSE-COMPLETION-2026-09-13.md) before proposing another broad framework/adapter migration.

## Exact checkpoint and delivery state

- Application source: `54eeee41b6c93d44297e5896613c70b0b271e9b0` — source/artifact record search, current-file navigation, version-specific reverse links and explicit matching-version reconnection. It includes conversation recovery from `9d79182`.
- Previous documentation checkpoint: `1afe3bb`. The source-navigation implementation is committed and pushed; this prompt update is a later documentation-only checkpoint. Use current `main`, not a reset to a historical hash.
- At continuation start, `main` was clean and matched the remote at `1afe3bb`. Remote: `https://github.com/DeL-TaiseiOzaki/irori.git`.
- [CI 34776177942](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34776177942) succeeded at source `54eeee4`: build, behavior/UI suites, website fixtures and Linux x64, Windows x64 and Mac arm64 package jobs, including relocated packaged-app smoke. These remain engineering checks, not native installed-device/account acceptance.
- Local verification: production build passed; **81 behavior tests, 78 passed and three optional native controls skipped**; all nine Electron UI suites passed. New tests use disposable files and synthetic run/artifact records. The provider cancellation fixture now waits for actual prompt receipt before stopping; early startup cancellation is valid app behavior. Fixtures and rclone local-backend checks did not run model inference or complete Google consent. No new local Forge package was made in this continuation.
- The public download remains [Windows preview `v0.1.3-preview.1`](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.3-preview.1), application source `9b04ed263b88b4754d03c7b79ab78816f0d73b06`. It **does not include the later conversation-persistence or source-navigation changes**, although the development package version is still 0.1.3. The [download site](https://del-taiseiozaki.github.io/irori/) remains on that release; Mac downloads are disabled. Source push and CI artifacts do not update an installed app.

## Implemented — preserve and build on this

irori is a note-centered desktop IDE/ADE that runs real local CLI harnesses inside selected knowledge workspaces. Electron/React/TypeScript is the provisional host. Markdown uses Milkdown/CodeMirror; filesystem/process operations stay behind the typed, validated HostAPI. Document content receives no raw Node, IPC or shell access.

**資料と成果物** now searches metadata within the most recent 100 runs/100 artifact registrations, inspects current source locations, opens current files through workspace/editor guards and follows version-specific artifact/run links. Explicit reconnection requires a missing current file and an unregistered same-scope destination matching the retained size/hash; it preserves the ID across repeated moves/restart and leaves historical bytes/paths untouched. Copies, changed versions, occupied/unknown/duplicate IDs and cross-scope aliases fail. This is private device-local navigation/reconnection, not full-text KB search, automatic file moves or portable identity metadata. Historical source schemas remain compatible; stricter path validation applies to new reconnection destinations only.

The current source includes continuous editing/autosave and local images, scoped layers and independent KBs, native Git workflows, an integrated terminal, CSV/ontology graphs, workspace-owned read-only Drive connections, source versions/run IDs/manual artifact records, and durable cloud-send preparation. The delivery engine has local-backend tests; actual Google upload is not wired to a writable capability.

Conversation history and accepted pending instructions now persist by exact checkout, KB UUID and CLI. Restarted queues require explicit resumption; interrupted instructions are never automatically replayed. Restored approval/question events have no live controls. Claims and acknowledgements are durably recorded before provider launch. The recent history is bounded to 400 events/512 KiB and the queue to 20 instructions/1 MiB. Existing native session handles remain separate. Current hosts use Electron's single-instance lock per device profile. The unsent composer draft, full transcript/history management and live turn steering remain open. Do not rewrite this feature as if it were still only in memory.

## Next work

1. If the owner supplies a Windows/Google/IME failure, reproduce and prioritize it. Otherwise treat actual device acceptance as pending and continue independent engineering. No new device result or model-testing permission was supplied before this checkpoint.
2. **D04 — actual cloud delivery:** extend the existing outbox/rclone path with an explicit writable capability, appropriate re-consent and exact account/attachment binding. Preserve staged bytes across failure/restart, reject conflicting remote versions and observe remote completion. Review `src/cloud/outbox.ts`, `src/cloud/accounts.ts`, `src/cloud/service.ts`, `src/app/KnowledgePanel.tsx`, [Google configuration](DISTRIBUTOR-GOOGLE.md) and [cloud setup](CLOUD-SETUP.md). Changing a scope or read-only flag alone does not complete D04.
3. **D06 — portable knowledge identity and broader knowledge workflows:** extend `src/knowledge/store.ts` and `src/domain/knowledge.ts` toward explicitly shared identities/provenance, full-text KB search, in-app file moves/backlinks/properties and retained-history management. The record-search/reconnection/source-artifact navigation UI is implemented; preserve it. Current device-local snapshots and manual artifact associations do not prove complete lineage, cross-device identity or real generated-artifact acceptance. Read [the current behavior and limits](KNOWLEDGE-NAVIGATION.md) first.
4. Preserve D03/D05 and D07–D10 gates: real account/mount/agent/Git journeys, native IME/data safety and performance, host assessment, credential protection, signing/notarization, upgrade/rollback and complete first-release acceptance. The testing preview does not waive these requirements.

Start with actual status/diffs and state the next bounded change and its checks. Reuse current service boundaries and libraries. Finish a coherent implementation, inspect the diff, run the applicable checks, then commit/push and update the handoff. State any remaining device/account dependency precisely.

## Authorization and protected state

- Development, verification and commit/push are authorized. The unsigned Windows testing channel was separately authorized; this is not approval for a general release, Mac publication or unrelated external account changes. Any updated testing installer needs a distinct version, exact verified native artifacts, checksums/notes and a matching manifest/delivery check.
- Real provider model tests need explicit agent-execution authorization. Do not run `test:agents`, `test:lifecycle` or `IRORI_UI_REAL_AGENTS=1` without it. Do not bypass native authentication/permissions to make a test pass. Protocol fixtures are not model-turn acceptance.
- The owner already supplied distributor Google configuration through repository secrets `IRORI_GOOGLE_CLIENT_ID` and `IRORI_GOOGLE_CLIENT_SECRET`. Do not request initial registration again, retrieve their values or copy them into chat/evidence. Current OAuth requests and mounts are still read-only; actual consent/refresh, WinFsp mounts and writable access remain unaccepted.
- Use disposable KBs for mutation tests. Preserve `.local/vm-preview/samples` and `.local/vm-preview/device`; they are user data. The existing VM preview may still run older code. Do not reset/delete its data or assume it automatically uses new builds.
- Keep credentials, private notes, provider transcripts and device paths out of tracked evidence. Ignored build/test/download artifacts are not release sources of truth; publish only verified artifacts for the intended source commit.
- The workspace parent `AGENTS.md` was updated to route to irori; that file is workspace-local, outside irori's Git history. The reference repositories were not edited. LayeredKB already had an untracked `images/image2.png`; preserve it.

## Commands and completion checks

Run these from the irori repository root. The supported runtime is Node `^24.15.0 || >=26.0.0`; this workspace has Node 24.21.0 in `node_modules/.bin`. System Node may be older.

```sh
git status --short --branch
git log -6 --oneline
export PATH="$PWD/node_modules/.bin:$PATH"
npm run build
IRORI_TEST_RCLONE_PATH="$PWD/.local/rclone/linux-x64/rclone" npm test
# Renderer changes, with real-model opt-in unset:
env -u IRORI_UI_REAL_AGENTS xvfb-run -a npm run test:ui
# Website changes:
npm run build:website
xvfb-run -a npm run test:website
git diff --check
```

These shell examples target the Linux engineering workspace. See [PACKAGING](PACKAGING.md) for native package checks, and run `npm run setup:cloud` if the ignored local rclone tool is absent. Preserve the documented Windows node-pty prebuild configuration and unpacked native helpers. Remote CI uses the existing distributor secrets; a local unconfigured package is not Google account acceptance. Once the relevant checks pass, avoid repeating them without a new change/failure or unresolved concern. Report exact commits, checks and remaining limits, then checkpoint the result.
