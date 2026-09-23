# irori — Continuation prompt

Updated 2026-09-23 (evening), after v0.1.29-preview.1 was published and the
records merged. Give this file to the next agent, or copy its contents into a
new session. Inspect current files and Git state before acting; later work
takes precedence over this file.

## Task

Take over **irori** development from current `main`, which had **0.1.29**
published and the download page in step when this was written.
Nothing is waiting to be merged. Choose a bounded next change with executable
acceptance checks and carry it through implementation and verification. Make
independent progress while device and account evidence is pending.

Work in the independent `irori/` repository inside the `KB_design/` workspace.
The workspace's own shared files — `AGENTS.md`, `.claude/`, `.codex/`,
`.agents/`, `scripts/`, research and initial specifications — are versioned as
the private repository **`irori-workspace`** since 2026-09-21; it ignores the
three product repositories and `references/`, and its changes follow the same
branch and pull request rule. `irori-extention` ended development on 2026-09-18
and is kept as the readable record of how the layer model was worked out;
`irori-templete` is the recommended main-KB repository template.

Respond to the user in Japanese. Write code, identifiers, technical documents
and commit messages in English. The user prefers simple, minimal code and asks
for unnecessary parts to be cut. Every new feature starts on a dedicated branch
and reaches `main` through a pull request. Development, verification,
feature-branch commit/push and PR creation are authorized; merging needs the
owner's own words. New user directions override this file.

## Read first

The [contributor contract](../AGENTS.md), then [STATUS](STATUS.md), which is
newest-first and carries the verification evidence for everything below. Then
select for the task: [ADR 009](decisions/009-agent-access-and-extension-compatibility.md)
for agent access, Drive write policy and VS Code extension compatibility,
[AUDIT-2026-09-22](AUDIT-2026-09-22.md) for the open-work table,
[real native acceptance](REAL-AGENT-ACCEPTANCE-2026-09-23.md),
[VS Code compatibility evidence](research/VSCODE-EXTENSION-COMPATIBILITY-2026-09-23.md),
[EDITOR-ASSISTANCE](EDITOR-ASSISTANCE.md), [ADR 006](decisions/006-person-lines.md)
for authorship, [ADR 007](decisions/007-obsidian-ui.md) for the ObsidianUI
controls, [ADR 008](decisions/008-graph-index-module.md) for the graph index
module, [ADR 005](decisions/005-host-and-references.md) for the product
directions, [ADR 002](decisions/002-release-and-workspace.md) for confirmed
product scope, [ACCEPTANCE](ACCEPTANCE.md) for the requirement matrix,
[DISTRIBUTION](DISTRIBUTION.md) for the publish rule, and the per-area note
matching the change — [ONTOLOGY](ONTOLOGY.md), [PACKAGING](PACKAGING.md),
[AUTHORSHIP](AUTHORSHIP.md), [HARNESSES](HARNESSES.md), [GIT](GIT.md),
[NOTE-LINKS](NOTE-LINKS.md), [KB-SEARCH](KB-SEARCH.md), [SKILLS](SKILLS.md),
[CLOUD-SETUP](CLOUD-SETUP.md) and the rest.

`references/` in the workspace parent holds **orca**, **claudian**, **VS Code**
and **evoagent** (arXiv 2406.14228 and its code) as reading material. Nothing
in it is imported, vendored or built. What was taken from EvoAgent is in the
workspace's `_research/ontology-evolution-2026-09-22/`.

## What landed on 2026-09-23

- **#73 (0.1.26)** — the recovery audit's fixes: note moves keep references and
  person lines, graph index regeneration survives broken or oversized modules,
  a vanished mount no longer blocks closing, and new Drive preparations bind
  the exact account and shared drive.
- **#75 (0.1.27)** — the composer offers each native CLI's real access modes
  (native/default or explicit full access for Codex, Claude and OpenCode; Pi
  native only). Queued instructions keep their mode; changing mode starts a
  fresh native session. Retained Drive preparations can be restored as new
  local files after their workspace or connection is removed. The real native
  trials and the lifecycle script's stricter gate checks came with it.
- **#76 (0.1.28)** — **コード支援 ON / OFF** in the document toolbar switches
  syntax coloring, line numbers, folding, bracket assistance and completions
  together, in source files and Markdown code blocks. A device setting, default
  on; switching keeps text, selection and Undo, and writes nothing to the note.
  A VS Code Codex session left it uncommitted; a Claude session finished it and
  fixed two timing faults in its UI suite.
- **#74, #77, #78** — the 0.1.26 and 0.1.28 notes, download manifests and records.
- **#79** — this handoff, rewritten on the 0.1.28 basis.
- **#80 (0.1.29)** — in-app updates with one button ([ADR 010](decisions/010-in-app-updates.md),
  [UPDATES](UPDATES.md)). An installed irori checks by itself 10 seconds after
  start and hourly; **更新して再起動** downloads over HTTPS, verifies size and
  `SHA256SUMS.txt`, and restarts through the window's shutdown. Windows applies
  Squirrel's `irori-<version>-full.nupkg` with the installed `Update.exe`; the Mac
  swaps in the bundle from the published disk image after `codesign`, identifier
  and version checks. Releases now publish the `.nupkg`, and the drift check
  requires it from 0.1.29. The same PR fixed the light-theme
  **端末の送信準備を復元** button.
- **#81** — the Windows update smoke waits for file locks; **#82** — the 0.1.29
  download manifest.

## Delivery state

Version **0.1.29** is published as
[v0.1.29-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.29-preview.1)
through release run 35845216421 from main run 35843823360 (source `93951b9`).
The downloads are 198,619,136 bytes (Windows x64) and 166,268,652 (Mac arm64),
plus the 197,978,744-byte `irori-0.1.29-full.nupkg`. The download page was
deployed (Pages 35845928596) and all three files matched `SHA256SUMS.txt` when
downloaded anonymously. Right after publication GitHub's release list served
stale asset lists; STATUS records what was observed. Confirm that the release
list, with the app's `Accept` and `X-GitHub-Api-Version` headers, names all six
files and that a `release-sync.yml` drift run passes.

An installed 0.1.28 or earlier cannot update itself: the owner installs 0.1.29
once by hand. The first real in-app update, 0.1.29 to the next published
version, is device evidence still owed on Windows 11 and macOS 26, including
the Mac's App Management response to the bundle swap.

The 0.1.29 branch passed the production build, formatting, 251 tests (244
passed, seven environment-gated skips: no local rclone, OpenCode or Pi binary,
and a case-sensitive filesystem) and all fifteen Electron UI suites. Its CI ran
the new `test:update-package` on real Windows and macOS runners. 0.1.28 was
published earlier the same day (release run 35761285128).

Every branch adds to the top of `docs/STATUS.md` and advances the version, so
parallel branches conflict there; the one merged second takes the next free
version and rewrites its notes. GitHub does not retarget a stacked pull request
here (`gh pr edit <n> --base main`). Several sessions, including Codex in VS
Code, work in this repository at once: work in a worktree under
`KB_design/.local/worktrees/`, and leave the shared checkout on `main`. The
worktrees left there by the 2026-09-23 branches are all merged and clean.

## Owner decisions in force

- **Access (ADR 009).** People choose whether writes are allowed. Native agent
  execution exposes each provider's actual modes, keeps native approvals by
  default and needs an explicit choice for full access. Drive write policy is a
  separate per-connection choice — read-only, approval before delivery, or
  delivery without each approval — and native full access grants none of it.
  Existing connections stay read-only until the writable capability, re-consent,
  delivery checks and interruption recovery exist; do not show a write selector
  that cannot enforce its mode.
- **Capabilities.** The requirement is what an ordinary native CLI agent can do,
  including its file and command tools, through irori. Syntax coloring,
  completion, diagnostics and run buttons are separate conveniences, shown or
  hidden by one button; they are never a reason to restrict the agent.
- **Extensions.** The target is VS Code extension compatibility, not an
  irori-specific plugin API. The research recommends a pinned Code-OSS desktop
  workbench; the owner has not approved replacing the current shell.
- **Graph index (ADR 008).** A module the knowledge base carries,
  `Knowledge_Base/ontology/`, generated deterministically by irori from pages'
  `type`, `title` and `relations` as CSV node and edge tables, committed by the
  person. The graph draws `relations` only; body links stay reachable through
  リンク元 and search.
- **Authorship (ADR 006).** Only the person's lines are recorded, one mark per
  line; sharing is Git AI Standard `h_` entries only. Codex is not told at edit
  time.

## Next work, in the order the evidence supports

1. **D04 — writable Drive delivery.** Add the explicit writable capability and
   re-consent, the per-connection write policy of ADR 009, and connect a
   verified account and shared drive to the transport. Test independently
   confirmed remote bytes and interruption/restart recovery with local rclone
   first; real Google acceptance needs the owner's device and account.
2. **VS Code compatibility, next bounded slice** (the research note's §"Next
   bounded slice"): package the probe as a VSIX and install, disable and
   re-enable it through the chosen host, with unchanged licence-checked theme and
   language-server samples; then one irori bridge that opens a disposable KB in
   a rich Markdown editor and shows an extension's edit without overwriting
   unsaved work. How much of the current shell to keep is the owner's decision.
3. **Codex structured questions.** The native default mode has no
   `request_user_input` (`default_mode_request_user_input` is under development
   and off). Find a supported plan-mode route and its UI; do not enable an
   experimental feature or change the native default.
4. **Pi and OpenCode real-model acceptance**, once the owner sets up their native
   accounts. Neither has a configured model here; do not log in, copy
   credentials or change model defaults.
5. **Device acceptance** (D03/D05, D07–D10): Windows/Mac consent, mount and
   reconnect, installed-device IME (including the code-assistance switch),
   performance, credential storage, signing, upgrade and rollback.
6. **D06 provenance** and **evidence for the template's vocabulary review in
   use** over some weeks on a real knowledge base.

## Authorization and protected state

- Development, verification, feature-branch commit/push and PR creation are
  authorized and need no further asking. Merging needs the owner's own words
  in the current session; words from an earlier session do not carry over.
  Publishing a preview after an authorized merge is covered by standing
  authorization; signing identities, notarization, a non-preview release, a new
  platform and account changes are not.
- Real provider model tests need explicit agent-execution authorization. On
  2026-09-23 the owner authorized native acceptance with existing accounts
  (ADR 009); it covers no login, account or model-default change. Confirm it
  still stands before consuming allowances. Do not run `test:agents`,
  `test:lifecycle` or `IRORI_UI_REAL_AGENTS=1` without it,
  and do not bypass native authentication to make a test pass. Protocol
  fixtures are not model-turn acceptance.
- Distributor Google configuration is already in repository secrets
  `IRORI_GOOGLE_CLIENT_ID` and `IRORI_GOOGLE_CLIENT_SECRET`. Do not ask for
  registration again or retrieve their values. Mounts remain read-only.
- Keep filesystem and process work behind `src/domain/types.ts`'s `HostAPI`.
  Document content receives no raw IPC, Node or shell access. irori writes no
  agent configuration into a user's KB; `tests/harnesses.test.ts` and
  `scripts/real-agents.ts` assert it by hashing the schema layer across a turn.
  The graph index is the one file set irori writes into the knowledge layer on
  the person's request, through `FileService.writeGenerated`.
- Use disposable KBs for mutation tests. Preserve `.local/vm-preview/samples`
  and `.local/vm-preview/device`: they are user data, and the VM preview may
  still be running older code.
- Keep credentials, private notes, provider transcripts and device paths out of
  tracked evidence.

## Commands

Node must satisfy `^24.15.0 || >=26.0.0`; the checkout has Node 24.21.0 in
`node_modules/.bin` while the system Node may be older.

```sh
cd /workspace/KB_design/irori
export PATH="$PWD/node_modules/.bin:$PATH"
npm run build
IRORI_TEST_RCLONE_PATH="$PWD/.local/rclone/linux-x64/rclone" npm test
# Renderer changes, with the real-model opt-in unset:
env -u IRORI_UI_REAL_AGENTS xvfb-run -a npm run test:ui
# Website changes:
npm run build:website && xvfb-run -a npm run test:website
```

`npm run setup:cloud` fetches the ignored local rclone tool if it is missing.
**Never run `npm run package`, `make` or `test:package` in a worktree whose
`node_modules` is a symlink to this checkout's**: Forge then works on the shared
tree, empties `node_modules/.bin`, rebuilds node-pty for Electron and deletes
other platforms' prebuilds and the Agent SDK's platform packages. To package in a
worktree, give it a real copy instead (`cp -a` of the checkout's
`node_modules` takes seconds), and `npm prune` the copy when the shared tree
holds another branch's extra packages. Other sessions may hold the shared
checkout on their own branch; work in your own worktree.
`git-ui-smoke` is timing-sensitive under load in this container and has failed
intermittently on `未解決 0 件`; rerun it alone before treating that as a
regression. Never run `npm test` alongside `npm run test:ui`. See
[PACKAGING](PACKAGING.md) for native package checks, and preserve the documented
Windows node-pty prebuild configuration and the unpacked native helpers.

A pull request that changes what ships — as `scripts/release-policy.ts` decides,
naming only what does *not* ship — must advance `package.json` and
`package-lock.json` past the latest published preview and add
`docs/releases/<version>-preview.1.md` with its `# ` title. CI enforces it.
