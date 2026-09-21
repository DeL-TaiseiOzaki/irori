# irori — Continuation prompt

Updated 2026-09-21, after five pull requests merged in one session. Give this
file to the next agent, or copy its contents into a new session. Inspect current
files and Git state before acting; later work takes precedence over this file.

## Task

Take over **irori** development from current `main`, which was `96d0823` with
0.1.12 published when this was written. Choose a bounded next change with
executable acceptance checks and carry it through implementation and
verification. Make independent progress while device and account evidence is
pending.

Work in the independent `irori/` repository inside the `KB_design/` workspace.
`KB_design/` is itself not a Git repository, and its shared agent configuration
at the root is under no version control at all — worth raising with the owner
before changing it. `irori-extention` ended development on 2026-09-18 and is
kept as the readable record of how the layer model was worked out;
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
select for the task: [ADR 005](decisions/005-host-and-references.md) for the
product directions and what was decided about the reference codebases,
[ADR 002](decisions/002-release-and-workspace.md) for confirmed product scope,
[ACCEPTANCE](ACCEPTANCE.md) for the requirement matrix,
[DISTRIBUTION](DISTRIBUTION.md) for the publish rule, and the per-area note
matching the change — [AUTHORSHIP](AUTHORSHIP.md), [SKILLS](SKILLS.md),
[HARNESSES](HARNESSES.md), [GIT](GIT.md), [KB-SEARCH](KB-SEARCH.md),
[ONTOLOGY](ONTOLOGY.md), [CLOUD-SETUP](CLOUD-SETUP.md) and the rest.

`references/` in the workspace parent holds **orca**, **claudian** and **VS
Code**, placed there by the owner on 2026-09-20 as reading material. Nothing in
it is imported, vendored or built. ADR 005 records what was taken from reading
them and why irori is not built on orca.

## What landed on 2026-09-21

Five PRs, all with build, 162 behaviour tests, thirteen Electron UI suites and
three platform package jobs passing:

- **#43 — one agent per knowledge base.** `AgentService` keeps
  `Map<scopeId, Run>`; a second agent in the same space is still refused, a
  cancellation stops one run, and the host's exclusions split into
  `busy(scopeId)` and `anyBusy`. `HostAPI.cancel(scopeId?)`.
- **#44 — the package stopped carrying unreachable code.** `dist/` fell from
  6,946,180 to 3,828,368 bytes. The largest item was KaTeX and its fonts, which
  `features: { Latex: false }` never removed because that flag is read after
  bundling; `Editor.tsx` composes `CrepeBuilder` from explicit features instead.
  `AgentMarkdown` and four panels load on first use, `yaml` left the renderer
  with `parseSkill`, and the renderer draws a 256-pixel mark.
- **#45 — which lines an agent wrote.** Keyed by the line's own normalised text,
  not its position, so nothing drifts and no diff is computed. See
  [AUTHORSHIP](AUTHORSHIP.md) for what is deliberately not built, in particular
  why irori does not call `git ai checkpoint known_human`.
- **#46 — ADR 005**, plus a correction: `SKILLS.md` had justified
  `.agents/skills/` partly by claiming claudian uses it. It does not; Codex and
  Pi do, which is the better justification.
- **irori-extention #21** — teamai-cli reassessed and still not adopted.

## Delivery state

`main` is `96d0823`, version **0.1.12**, published as
[v0.1.12-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.12-preview.1)
with the download page in step. 0.1.10 and 0.1.11 have committed notes but no
package of their own: each PR had to advance the version past the published
preview to satisfy `release-sync.yml`, and publishing the intermediate ones
would offer a reader two upgrades to reach the same code. Read
[DISTRIBUTION](DISTRIBUTION.md) §"How the rule is held" before the next
release.
`release-sync.yml` fails hourly while `main` holds a shipped change for more
than sixty minutes without a release, so an unpublished merge is visible rather
than silent.

Two pull requests wait for the owner's own merge instruction: **#48**, which is
this file and the delivery record, and **#49**, version 0.1.13, which stops the
package carrying executables irori never runs. #49 is stacked on #48 because
both add a section at the top of `docs/STATUS.md`; merge #48 first and GitHub
retargets #49 at `main` itself. #49 reaches the desktop package, so publishing
`v0.1.13-preview.1` is part of finishing it.

## Next work, in the order the evidence supports

1. **OKF-native graph.** `irori-templete` became an Open Knowledge Format 0.2
   bundle on 2026-09-17 — pages carry `type`, `relations` and ordinary links —
   while irori still draws its graph from a declared CSV pair. This is the
   largest gap between irori and its own recommended template, and the owner
   asked for the decision to be discussed rather than taken. `src/host/ontology.ts`,
   `src/domain/ontology.ts`, `src/app/OntologyPanel.tsx`.
2. **Indexed search and link resolution.** Closes part of R03/R08, whose open
   column names backlinks twice. `src/host/search.ts`, `src/app/SearchPanel.tsx`.
   Two things were measured on 2026-09-21 and correct this item. The links the
   recommended template actually writes are **relative Markdown links**, not
   `[[wiki links]]`: `irori-templete`'s ADR 002 D3 fixes identity as the path and
   links as relative, and the repository contains no `[[` at all. And
   `node:sqlite` is present in Electron 44 with FTS5 (SQLite 3.53.4), but its
   tokenizers decide whether Japanese works: with `unicode61` a sentence without
   spaces is one token, so a query inside it never matches, and `trigram`, which
   does match inside, returns nothing for a query shorter than three characters.
   A Japanese two-character query is ordinary, so an index needs trigram plus a
   `LIKE` path over the indexed text for shorter ones — still far cheaper than
   reading every file, which is what `SearchService` does today.
3. **D04 — writable cloud delivery.** Extend `src/cloud/outbox.ts` with an
   explicit writable capability, re-consent and exact account binding; preserve
   staged bytes across failure and restart and observe remote completion.
   Changing a scope or a `readOnly` flag alone does not complete it.
4. **The installer's real weight.** Done in #49, which removes the Agent SDK's
   bundled Claude Code binary and node-pty's foreign prebuilds: the Linux
   application directory falls from 994,253,996 to 500,345,370 bytes. No package
   carried another platform's binary; each carried one of its own, and Linux two.
   What is left to measure is the renderer packages Forge copies although Vite
   has already bundled them into `dist/`, about 50 MB, which needs the notices
   their licences require to be generated, since the bundle carries no LICENSE
   files. See [PACKAGING](PACKAGING.md).
5. **Authorship, second step.** Export and import of the Git AI Standard v3 note
   at `refs/notes/ai`, reading before writing, which makes the record portable
   without depending on the `git ai` binary.
6. **Device acceptance** (D03/D05, D07–D10) stays open: real Windows/Mac
   installs, Japanese IME, live Google consent and mounts, signing and
   notarization. Reproduce and prioritise any failure the owner reports.

Two decisions belong to the owner, not to an agent: **what "taking in
extensions" means** (running VS Code or Obsidian extensions needs an extension
host, which orca itself did not build; irori's own capability-gated plugins are
a much smaller thing that runs nobody else's extension), and **how far code
editing and execution go** — note that orca deliberately switched Monaco's
diagnostics off and tells users to run checkers in a terminal.

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
`git-ui-smoke` is timing-sensitive under load in this container and has failed
intermittently on `未解決 0 件`; rerun it alone before treating that as a
regression. Never run `npm test` alongside `npm run test:ui`. See
[PACKAGING](PACKAGING.md) for native package checks, and preserve the documented
Windows node-pty prebuild configuration and the unpacked native helpers.

A pull request that changes what ships — as `scripts/release-policy.ts` decides,
naming only what does *not* ship — must advance `package.json` and
`package-lock.json` past the latest published preview and add
`docs/releases/<version>-preview.1.md` with its `# ` title. CI enforces it.
