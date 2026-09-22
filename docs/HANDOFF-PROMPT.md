# irori — Continuation prompt

Updated 2026-09-21 (evening), after v0.1.19-preview.1 was published and #61
opened. Give this file to the next agent, or copy its contents into a new
session. Inspect current files and Git state before acting; later work takes
precedence over this file.

## Task

Take over **irori** development from current `main`, which was `60eea4e` with
0.1.19 published and the download page in step when this was written. First
check **#61** (0.1.20, open): if the owner has merged it, publish v0.1.20;
otherwise leave it for them. Then choose a bounded next change with executable
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
select for the task: [ADR 006](decisions/006-person-lines.md) (on #61's branch
until it merges) for the authorship decision,
[ADR 005](decisions/005-host-and-references.md) for the product directions,
[ADR 002](decisions/002-release-and-workspace.md) for confirmed product scope,
[ACCEPTANCE](ACCEPTANCE.md) for the requirement matrix,
[DISTRIBUTION](DISTRIBUTION.md) for the publish rule, and the per-area note
matching the change — [NOTE-LINKS](NOTE-LINKS.md), [KB-SEARCH](KB-SEARCH.md),
[SKILLS](SKILLS.md), [AUTHORSHIP](AUTHORSHIP.md), [HARNESSES](HARNESSES.md),
[GIT](GIT.md), [ONTOLOGY](ONTOLOGY.md), [CLOUD-SETUP](CLOUD-SETUP.md) and the
rest.

`references/` in the workspace parent holds **orca**, **claudian** and **VS
Code** as reading material. Nothing in it is imported, vendored or built.

## What landed on 2026-09-21 (second half)

Each change was implemented by a Fable agent in its own worktree, then rebuilt,
re-tested and mutation-checked by the lead on its stacked base, with all
fourteen Electron UI suites and the three platform package jobs passing:

- **#53 (0.1.15) — リンク元**, the notes that link to the open one, on demand
  over `SearchService`'s walk. `linksTo` reads links as a Markdown reader would
  and in linear time: the first version's regexes took 236 s over two crafted
  lines, which in the main process freezes the window.
- **#55 (0.1.16)** — a backlink opens at its link (label and column through the
  search navigation), case follows what the disk does (`foldsCase` observes it),
  and the list refreshes itself on file events.
- **#56 (0.1.17)** — 名前・場所 rewrites relative links in other notes and in the
  moved note (`rewriteLinks`, `src/host/relink.ts`), hash-checked, skipping and
  naming a note changed meanwhile; リンクも更新する is on by default.
- **#57 (0.1.18)** — a device-local `node:sqlite` FTS5 trigram index
  (`src/host/search-index.ts`) behind search and backlinks: a request stats every
  file and reads only changed ones, 1–2 character queries match over stored
  text, and non-ASCII case is expanded because FTS5 folds with Unicode 6.1. A
  15,118-note KB answers in about 0.5 s instead of 5–9 s. Limits rose to 50,000
  files; a 1 MiB write batch holds the main process about 80 ms.
- **#58 (0.1.19)** — skills: a reach check per harness (`src/domain/skill-reach.ts`
  with sourced versions), `RETIRED.md` markers that no CLI discovers, and
  `metadata.roles/projects` with a device-local picker narrowing.
- **#59 closed** — git-ai notes with agent (`s_`) entries only; superseded by the
  owner's decision below.
- **#61 (0.1.20, open)** — the authorship record keeps only **the person's
  lines**: a save marks lines absent from the bytes it replaces; Claude Code is
  told before an `Edit`/`MultiEdit`/`Write` would change one (Agent SDK
  `PreToolUse` `additionalContext`); any agent gets them only when the person
  ticks 自分の行を伝える. ADR 006 and
  `docs/research/2026-09-21-authorship-provenance.md` carry the reasoning.

## Delivery state

`main` is `60eea4e`, version **0.1.19**, published as
[v0.1.19-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.19-preview.1)
from CI 35587392974 through release run 35588153507, with the download page
deployed (Pages 35588281118, #60) and the drift re-check 35588385140 in step.
Anonymous downloads were 215,806,464 bytes (Windows) and 182,440,647 (Mac) with
`SHA256SUMS.txt` matching. 0.1.16–0.1.18 have notes but no package of their own;
one release carries #55–#58. v0.1.15-preview.1 (release run 35578021397) was the
earlier release the same day.

**#61 is the only open pull request.** Its version 0.1.20 is ahead of the
published preview; after it merges, publish from `main`'s CI run for the merge
commit as [DISTRIBUTION](DISTRIBUTION.md) describes. Two facts about the flow:
every substantial change adds a section at the top of `docs/STATUS.md`, so
branches cut from `main` conflict there — stack the later one and retarget it
with `gh pr edit <n> --base main` after the first merges, since GitHub does not
retarget here; and a drift run that lands between the release and the Pages
deployment fails by seconds — dispatch `release-sync.yml` after the deploy.

## Owner decisions from this session

- **Authorship is about the person's lines, one mark per line.** The owner
  wants an agent to be able to see which lines carry the person's intent; a
  line with any of the person's change is the person's. Sub-line tracking was
  judged more than needed. The agent needs this only some of the time — hence
  the edit-time hook and the unticked-by-default tickbox.
- **Sharing, when wanted, is Git AI Standard `h_` entries only.** Pre-irori
  material is kept apart at folder level, so an agent's line and a line of
  unknown origin need not be told apart. The closed branch `feat/git-ai-notes`
  holds reusable parts: the notes format, the fast-import write that never
  clobbers another writer, the tracking-ref sync, and a bounded `rangeLines`.
- **The teamai-inspired skill ideas** were all approved and are in 0.1.19; the
  matching `irori-templete` conventions (`RETIRED.md`, `metadata.roles/projects`)
  are proposed in `docs/SKILLS.md`, not yet written into the template.

## Next work, in the order the evidence supports

1. **Publish 0.1.20 when #61 merges** (release, website manifest PR, Pages,
   download check, drift re-check).
2. **`h_` sharing of the person's lines**: at commit, write the lines the record
   marks as `h_` entries under `refs/notes/ai`, keyed by the committer identity;
   read `h_` entries back as the person's lines; carry the ref on fetch and push.
   Reuse `feat/git-ai-notes`. Decide with the owner whether Push should carry
   the ref by default.
3. **Tell Codex, OpenCode and Pi at edit time**, as Claude Code is told, where
   each harness offers a comparable hook; which do is open.
4. **Template conventions** in `irori-templete`: `RETIRED.md` and
   `metadata.roles/projects` in the skills contract, as `docs/SKILLS.md` proposes.
5. **OKF-native graph** — still the owner's decision to discuss; the largest gap
   between irori and its own template.
6. **D04 — writable cloud delivery**, and the ~50 MB of renderer packages Forge
   copies although Vite bundled them (needs generated licence notices).
7. **Device acceptance** (D03/D05, D07–D10) stays open.

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
other platforms' prebuilds and the Agent SDK's platform packages. It happened on
2026-09-21 and was repaired with `npm rebuild --ignore-scripts` and `npm pack`
of the locked versions. Leave packaging to CI in such a worktree.
`git-ui-smoke` is timing-sensitive under load in this container and has failed
intermittently on `未解決 0 件`; rerun it alone before treating that as a
regression. Never run `npm test` alongside `npm run test:ui`. See
[PACKAGING](PACKAGING.md) for native package checks, and preserve the documented
Windows node-pty prebuild configuration and the unpacked native helpers.

A pull request that changes what ships — as `scripts/release-policy.ts` decides,
naming only what does *not* ship — must advance `package.json` and
`package-lock.json` past the latest published preview and add
`docs/releases/<version>-preview.1.md` with its `# ` title. CI enforces it.
