# irori — Continuation prompt

Updated 2026-09-22 (night), after v0.1.25-preview.1 was published with
everything that was open merged, and the graph index decision taken. Give this file to the next agent, or copy its
contents into a new session. Inspect current files and Git state before acting;
later work takes precedence over this file.

## Task

Take over **irori** development from current `main`, which was `b984804` with
0.1.25 published and the download page in step when this was written. Nothing
is waiting to be merged. Choose a bounded next change
with executable acceptance checks and carry it through implementation and
verification. Make independent progress while device and account evidence is
pending.

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
select for the task: [ADR 006](decisions/006-person-lines.md) for authorship,
[ADR 007](decisions/007-obsidian-ui.md) for the ObsidianUI controls,
[ADR 008](decisions/008-graph-index-module.md) for the graph index module, [ADR 005](decisions/005-host-and-references.md)
for the product directions, [ADR 002](decisions/002-release-and-workspace.md)
for confirmed product scope, [ACCEPTANCE](ACCEPTANCE.md) for the requirement
matrix, [DISTRIBUTION](DISTRIBUTION.md) for the publish rule, and the per-area
note matching the change — [ONTOLOGY](ONTOLOGY.md), [PACKAGING](PACKAGING.md),
[AUTHORSHIP](AUTHORSHIP.md), [HARNESSES](HARNESSES.md), [GIT](GIT.md),
[NOTE-LINKS](NOTE-LINKS.md), [KB-SEARCH](KB-SEARCH.md), [SKILLS](SKILLS.md),
[CLOUD-SETUP](CLOUD-SETUP.md) and the rest.

`references/` in the workspace parent holds **orca**, **claudian**, **VS Code**
and, since 2026-09-22, **evoagent** (arXiv 2406.14228 and its code) as reading
material. Nothing in it is imported, vendored or built. What was taken from
EvoAgent is in the workspace's `_research/ontology-evolution-2026-09-22/`.

## What landed on 2026-09-22

- **#61 (0.1.20)** — the authorship record keeps only the person's lines, one
  mark per line; Claude Code is told before an edit would change one (Agent SDK
  `PreToolUse`), any agent only when the person ticks 人の行を伝える.
- **#63 (0.1.21)** — the person's lines travel with commits as Git AI Standard
  `h_` entries under `refs/notes/ai`, read back from the last 50 noted commits;
  Push carries the notes by default and says so.
- **#64 (0.1.22)** — Pi and OpenCode hear about the person's lines before an
  edit through scripts irori writes to its data directory (never the KB); Codex
  is not told at edit time, since its hooks load only from definitions the
  person trusts.
- **#67 (0.1.23)** — the package keeps only what the host loads; `app.asar`
  about 115 MB → 21.9 MB; licence notices generated from the bundle into
  `dist/third-party-notices.txt`.
- **#69 (0.1.24)** — the graph index the KB carries (ADR 008).
- **#66 (0.1.25)** — ObsidianUI Magnet Tabs and Arrow Fill Button (ADR 007).
  Opened by a VS Code Codex session that had switched the shared checkout to
  its branch; renumbered twice (0.1.22 → 0.1.24 → 0.1.25) as the others merged.
- **#62, #65, #68, #71, #72** — the records, the 0.1.22 and 0.1.25 notes and the
  download page.
- irori-templete **#7** (`RETIRED.md`, `metadata.roles/projects`), **#9**
  (vocabulary only through reviewed proposals), **#10** (one index heading per
  type) and **#8** (`lint --irori-graph` checks irori's module);
  irori-workspace **#2** (the EvoAgent reading and the graph decision).

## Delivery state

`main` is `b984804`, version **0.1.25**, published as
[v0.1.25-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.25-preview.1)
through release run 35723813665 (from main run 35723062728), with the download
page deployed (Pages 35724596462, #72) and the drift re-check 35724815238 in
step. The downloads are 198,603,264 bytes (Windows) and 166,261,903 (Mac),
down from 215,808,512 and 182,467,091 at 0.1.22 — #67's work. Earlier the same
day v0.1.22-preview.1 carried #61, #63 and #64. 0.1.20, 0.1.21, 0.1.23 and 0.1.24
have notes but no package of their own; the published notes of 0.1.22 and
0.1.25 summarise them.

Every branch adds to the top of `docs/STATUS.md` and advances the version, so
parallel branches conflict there; the one merged second takes the next free
version and rewrites its notes. GitHub does not retarget a stacked pull request
here. Several sessions, including Codex in VS Code, work in this repository at
once: work in a worktree, and leave the shared checkout on `main`. ## Owner decisions from 2026-09-22

- **The graph index is a module the knowledge base carries** (ADR 008).
  The pages are the source of truth; irori generates `Knowledge_Base/ontology/`
  deterministically from their `type`, `title` and `relations` when the person
  asks, as CSV node and edge tables, and the person commits it, so the same
  commit shows the same graph on every device. A device-local index was
  rejected because the visible structure could differ between devices. A
  declared `.irori/ontology.json` still wins, for tables people maintain.
  Freshness is checked by regenerating in memory, not by a hash column. The
  graph draws `relations` only: body links stay reachable through リンク元 and
  search (confirmed the same day); revisit only if a real knowledge base shows
  the typed graph too sparse.
- **EvoAgent is agent generation, not an ontology method.** What was absorbed is
  the shape of its loop, as the template's vocabulary review: one proposal at a
  time with the whole vocabulary in view, a distinctness and evidence check
  before the person sees it, and the person deciding each. Its code's fail-open
  check and forgotten rejections were deliberately inverted.
- Earlier decisions stand: authorship is about the person's lines, one mark per
  line; sharing is `h_` entries only.

## Next work, in the order the evidence supports

1. **Real-model checks of the person's lines**, once the owner authorizes a
   model run: whether Claude Code acts on the `PreToolUse` context, and whether
   Pi's and OpenCode's models retry a held edit. Only fixtures exercised them.
2. **D04 — writable cloud delivery**: extend `src/cloud/outbox.ts` with an
   explicit writable capability, re-consent and exact account binding, preserving
   staged bytes across failure and restart.
3. **Evidence for the template's vocabulary review in use** — the dry runs in the
   research note are the only evidence; a real knowledge base over some weeks is
   the next.
4. **Device acceptance** (D03/D05, D07–D10) stays open.

Two decisions belong to the owner, not to an agent: what "taking in extensions"
means, and how far code editing and execution go.

## Authorization and protected state

- Development, verification, feature-branch commit/push and PR creation are
  authorized and need no further asking. Merging needs the owner's own words.
  Publishing a preview after an authorized merge is covered by standing
  authorization; signing identities, notarization, a non-preview release, a new
  platform and account changes are not.
- Real provider model tests need explicit agent-execution authorization. Do not
  run `test:agents`, `test:lifecycle` or `IRORI_UI_REAL_AGENTS=1` without it,
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
