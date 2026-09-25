# irori — Continuation prompt

Updated 2026-09-25, after v0.1.37-preview.1 was published and the records
merged. Give this file to the next agent, or copy its contents into a new
session. Inspect current files and Git state before acting; later work takes
precedence over this file.

## Task

Take over **irori** development from current `main`, which had **0.1.37**
published and the download page in step when this was written. Nothing is
waiting to be merged. The owner is about to try the Google Drive work on their
Windows 11 device; their reports come first. Otherwise choose a bounded next
change with executable acceptance checks and carry it through implementation
and verification.

Work in the independent `irori/` repository inside the `KB_design/` workspace.
The workspace's own shared files — `AGENTS.md`, `.claude/`, `.codex/`,
`.agents/`, `scripts/`, research and initial specifications — are versioned as
the private repository **`irori-workspace`**; it ignores the three product
repositories and `references/`, and its changes follow the same branch and pull
request rule. `irori-extention` ended development on 2026-09-18 and is kept as
the readable record of how the layer model was worked out; `irori-templete` is
the recommended main-KB repository template.

Respond to the user in Japanese. Write code, identifiers, technical documents
and commit messages in English; interface text is bilingual through
`t('日本語', 'English')` ([ADR 011](decisions/011-interface-language.md)). The
user prefers simple, minimal code and asks for unnecessary parts to be cut.
Every new feature starts on a dedicated branch and reaches `main` through a pull
request. Development, verification, feature-branch commit/push and PR creation
are authorized; merging needs the owner's own words. New user directions
override this file.

## Read first

The [contributor contract](../AGENTS.md), then [STATUS](STATUS.md), which is
newest-first and carries the verification evidence for everything below. For
Drive work: [ADR 012](decisions/012-drive-editing.md) (editing Drive folders in
place, and what is not included), [ADR 013](decisions/013-drive-folders-in-kbs.md)
(Drive folders belong to KBs; it supersedes ADR 002 Q02's workspace-owned
connections), [WORKSPACE-DRIVE](WORKSPACE-DRIVE.md) and [CLOUD-SETUP](CLOUD-SETUP.md).
Otherwise select for the task: [ADR 009](decisions/009-agent-access-and-extension-compatibility.md),
[ADR 010](decisions/010-in-app-updates.md) and [UPDATES](UPDATES.md),
[ADR 011](decisions/011-interface-language.md), [AUDIT-2026-09-22](AUDIT-2026-09-22.md),
[ACCEPTANCE](ACCEPTANCE.md), [DISTRIBUTION](DISTRIBUTION.md) for the publish
rule, and the per-area notes ([ONTOLOGY](ONTOLOGY.md), [PACKAGING](PACKAGING.md),
[AUTHORSHIP](AUTHORSHIP.md), [HARNESSES](HARNESSES.md), [GIT](GIT.md),
[NOTE-LINKS](NOTE-LINKS.md), [KB-SEARCH](KB-SEARCH.md), [SKILLS](SKILLS.md) and
the rest).

## What landed on 2026-09-25

- **#86 (0.1.31)** — dialog panels take the theme's surface and text (the dark
  theme measured 1.26:1 before); an opened Drive folder can itself be chosen
  as the connection.
- **#87 (0.1.32)** — the explorer's rows and personal/team split resize and are
  kept per device; layout keys may be 160 characters (the three-pane workspace
  key is 67 and was never saved); the sidebar fills its pane.
- **#88 (0.1.33)** — **日本語 / English** in the display settings, applied live;
  about 1,100 `t()` calls across renderer and host; `language-ui-smoke` fails
  on any Japanese interface text in English.
- **#90 (0.1.34)** — on Windows, rclone mounts a Drive folder through WinFsp
  onto a folder whose volume has no DOS name, so `fs.realpath` fails with
  `UNKNOWN` for every path inside it (nodejs/node#50019).
  `CloudService.resolve` checks components with `lstat` instead. The setup line
  shows only when mounting is unavailable.
- **#91 (0.1.35)** — editable Drive folders ([ADR 012](decisions/012-drive-editing.md)):
  per-connection `access`, the `drive` scope with **書き込みを許可** to sign an
  older account in again, rclone's write cache, a per-mount `description`,
  in-place saves, pending uploads (`vfs/stats`) and a quit prompt, notes added
  from the sidebar, **フォルダを開く**.
- **#92 (0.1.36)** — rename/move/delete through the mount
  (`CloudEntryActions.tsx`), images in Drive notes, a save-time Drive version
  check (`operations/stat` MD5 against the editor's starting bytes; skipped for
  items in `vfs/queue`; `vfs/refresh` on conflict; 5 s bound; open Drive
  documents re-read every 25 s), upload failure reasons classified from
  rclone's stderr (`src/cloud/upload-errors.ts`, path and category only), and
  `leavePending` so a folder whose uploads keep failing can still be
  disconnected or made read-only. Written as four parallel delegated branches
  (three on Fable) and merged by the lead.
- **#94 (0.1.37)** — the separate Google Drive frame is gone; Drive folders
  belong to KBs ([ADR 013](decisions/013-drive-folders-in-kbs.md)). The header
  **クラウド接続** opens the open KB's connections; older workspace connections
  are moved with **この KB に移す** (`CloudService.moveConnection`, same mount
  ID); removing a workspace unregisters its own connections.
- **#89, #93, #95** — download manifests and records for 0.1.33, 0.1.36, 0.1.37.

## Delivery state

**0.1.37** is published as
[v0.1.37-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.37-preview.1)
through release run 36091671804 from main run 36091077153 (source `5270ac9`):
Windows 198,651,392 bytes, Mac 166,238,512 bytes and the 198,011,147-byte
`irori-0.1.37-full.nupkg`. Pages 36092377034 deployed the download page;
anonymous downloads matched `SHA256SUMS.txt`; the public release list, read with
the app's headers, named all six files; drift run 36092502782 passed. 0.1.33
and 0.1.36 were published earlier the same day (STATUS has their runs);
0.1.31, 0.1.32, 0.1.34 and 0.1.35 were not published on their own.

The owner's first steps after updating in-app to 0.1.37: **書き込みを許可** on
the account (Google asks for the `drive` scope), **編集できるようにする** on each
connection to edit (older declarations stay read-only), and **この KB に移す**
for the connection they made to the workspace earlier (KB-contents-mock is
connected twice, so that only unregisters the workspace's copy).

Every branch adds to the top of `docs/STATUS.md` and advances the version, so
parallel branches conflict there; stack a later branch on an earlier one and
retarget it with `gh pr edit <n> --base main` once the earlier one merges.
Several sessions, including Codex in VS Code, work in this repository at once:
work in a worktree under `KB_design/.local/worktrees/`, and leave the shared
checkout on `main`.

## Owner decisions in force

- **Drive (ADR 012, ADR 013).** Materials in a KB's `contents` are edited and
  added to from irori; a Drive connection is editable unless it is set
  read-only, and every Drive folder belongs to a KB. A workspace without a KB
  does not use Drive. ADR 009's third Drive mode, approval before each delivery,
  is not implemented: editing goes through the mount and the preparation
  outbox remains for keeping a version to send later. Ask the owner before
  adding that mode.
- **Access (ADR 009).** People choose whether writes are allowed. Native agent
  execution exposes each provider's actual modes, keeps native approvals by
  default and needs an explicit choice for full access.
- **Language (ADR 011).** Japanese stays the default and the source text.
- **Capabilities, extensions, graph index, authorship.** Unchanged from
  ADR 009, ADR 008 and ADR 006: ordinary native CLI capabilities through irori;
  VS Code extension compatibility as the target, with replacing the shell not
  approved; the graph index generated deterministically from pages; only the
  person's lines recorded.

## Next work, in the order the evidence supports

1. **Owner's Drive trial on Windows 11, then the Mac.** Expect reports about
   the WinFsp mount, signing in again with the `drive` scope, writable mounts,
   saving, conflicts, upload failure reasons, rename/move/delete, image paste
   and moving the workspace connection. The UI smoke fixtures cannot model a
   mount, so the new sidebar menu and dialogs have only been exercised through
   service tests; reproduce reported problems with `tests/fixtures/cloud.ts`
   (`mountedFixture`) where possible.
2. **Drive gaps listed in ADR 012.** Knowledge records keep a moved Drive
   file's old path; a deleted Drive folder's files go to Drive's trash one by
   one (`operations/purge` would trash the folder as one item but bypasses the
   VFS); merging a version changed in Drive with the draft beyond the existing
   side-by-side view.
3. **Host errors reach the interface as `Error: Error: …`** (the host sends
   `String(error)` and the preload wraps it again). Small, visible, untested.
4. **VS Code compatibility, next bounded slice**, as in the research note.
5. **Codex structured questions**, **Pi and OpenCode real-model acceptance**
   once the owner sets up those accounts, **device acceptance** (D03/D05,
   D07–D10) and **D06 provenance**, as before.

## Authorization and protected state

- Development, verification, feature-branch commit/push and PR creation are
  authorized and need no further asking. Merging needs the owner's own words in
  the current session; words from an earlier session do not carry over.
  Publishing a preview after an authorized merge is covered by standing
  authorization; signing identities, notarization, a non-preview release, a new
  platform and account changes are not.
- Real provider model tests need explicit agent-execution authorization;
  confirm it before consuming allowances. Do not run `test:agents`,
  `test:lifecycle` or `IRORI_UI_REAL_AGENTS=1` without it, and do not bypass
  native authentication to make a test pass.
- Distributor Google configuration is already in repository secrets
  `IRORI_GOOGLE_CLIENT_ID` and `IRORI_GOOGLE_CLIENT_SECRET`, and the owner has
  declared the Drive permissions in the Google project. Do not ask for
  registration again or retrieve their values.
- Keep filesystem and process work behind `src/domain/types.ts`'s `HostAPI`.
  Document content receives no raw IPC, Node or shell access. Never pass raw
  rclone output to the interface. Inside a Drive mount never use `realpath`,
  and never replace a file through a temporary file and rename.
- Use disposable KBs for mutation tests. Preserve `.local/vm-preview/samples`
  and `.local/vm-preview/device`. Keep credentials, private notes, provider
  transcripts and device paths out of tracked evidence.

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

**Never run `npm run package`, `make` or `test:package` in a worktree whose
`node_modules` is a symlink to this checkout's**; give such a worktree a real
copy (`cp -a`) first. `git-ui-smoke` is timing-sensitive and has failed
intermittently on `未解決 0 件`, locally and in CI; the Windows package job has
failed once on the packaged app's first heading. Rerun the failed job alone
before treating either as a regression. Never run `npm test` alongside
`npm run test:ui`. See [PACKAGING](PACKAGING.md) for native package checks.

A pull request that changes what ships — as `scripts/release-policy.ts` decides,
naming only what does *not* ship — must advance `package.json` and
`package-lock.json` past the latest published preview and add
`docs/releases/<version>-preview.1.md` with its `# ` title. CI enforces it.
Publishing follows [DISTRIBUTION](DISTRIBUTION.md): wait for main's CI of the
merge, dispatch `release.yml` with that run id, then the manifest PR,
`website.yml`, an anonymous checksum check and a `release-sync.yml` drift run.
