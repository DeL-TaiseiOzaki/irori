# KB-declared skills

Date: 2026-09-16. A knowledge base can carry its own procedures, and the person
running an agent can choose one for a turn. This is the irori side of D9 in
`irori-templete`'s `docs/decisions/001-kb-structure.md` (open as
[pull request 1](https://github.com/DeL-TaiseiOzaki/irori-templete/pull/1) at
this date), which declines to duplicate the same skill into one directory per
CLI.

Extended 2026-09-21 with three techniques borrowed from teamai-cli after the
[reassessment](../../irori-extention/docs/research/teamai-cli-evaluation.md)
declined the tool itself: a reach check in the spirit of `teamai doctor`, a
retirement marker in place of its `.removed` tombstone, and role × project
scopes in place of its `manifest/roles.yaml` and `manifest/projects.yaml`.
Each is described in its own section below.

## Where skills live

`.agents/skills/<name>/SKILL.md`, in the KB's schema layer. The directory is the
provider-neutral location Codex reads as repository-scope skills and that Pi
searches natively beside `~/.agents/skills/`, following the Agent Skills
convention, so a KB that declares skills there works in irori and outside it
without a second copy.

Corrected 2026-09-21: this paragraph previously said claudian used the same
directory as its vault store. It does not — it reads `.claude/skills` and
`.claude/commands` (`src/providers/claude/storage/SkillStorage.ts`,
`SlashCommandStorage.ts` at version 2.3.1), and `.agents` appears nowhere in its
source. The directory is still the right one, on the evidence above, but a KB's
skills are not visible to claudian without a second copy there. irori does not write into it, generate per-runtime stubs, or change a
native CLI's own skill configuration.

A package declares YAML front matter and instructions, following the skill shape
described in [OpenAI's skill documentation](https://learn.chatgpt.com/docs/build-skills):

```markdown
---
name: distill
description: Files yesterday's journal entries into the library.
---

Only ever append.
```

`name` must match the directory, which is lowercase letters, digits and hyphens.
`description` is at most 400 characters and appears beside the name in the picker. Quoted and
folded YAML scalars are accepted; additional metadata may be structured and,
apart from the `roles` and `projects` keys below, is not interpreted by irori.
The whole file is at most 16 KiB in UTF-8, and at most 50 packages are listed.

## What the user sees

With a KB selected, the composer shows a skill selector beside the agent
selector, defaulting to なし. It appears only when that KB declares at least one
skill. Choosing one and sending prepends its instructions to the request, states
that they come from this KB's schema layer at a named path, and leaves the
user's own words last. The prompt tells every harness to resolve relative paths
in those instructions from that skill's package directory. The conversation
records which skill ran.

Beside the selector, 到達確認 opens the reach view described below. When some
skill names a role or a project, 役割 and プロジェクト selectors appear before
the skill selector and narrow it to the reader's own choice. A retired skill is
named under the composer with the date and reason the KB recorded.

A package that cannot be read is named under the composer rather than dropped,
so a skill that stops appearing has a visible reason. A directory without a
`SKILL.md` is not a skill and is not an error.

The list is read again when the active space changes and when a run settles,
because an agent can write a skill during a session. Skills belong to the space
that declares them: switching spaces replaces the list and clears the choice,
and a run naming a skill the space does not declare fails instead of running
without it.

## Roles and projects

A skill can say who it is for. The Agent Skills specification reserves
`metadata` for "additional properties not defined by the Agent Skills spec" as
a map from string keys to string values
([specification, `metadata` field](https://agentskills.io/specification)),
and every harness ignores keys it does not know there: Codex reads only
`metadata.short-description` (`codex-rs/skills/src/parser.rs` at
`rust-v0.155.1`), OpenCode's loader checks `name` alone
(`packages/opencode/src/skill/index.ts` at `v1.18.30`), and Pi's documentation
lists `metadata` as "arbitrary key-value mapping". irori reads two keys:

```markdown
---
name: promote
description: Opens a promotion pull request.
metadata:
  roles: editor, maintainer
  projects: thesis
---
```

`roles` and `projects` are names separated by commas or spaces, following the
specification's string values; a YAML list is tolerated. A name is letters,
digits, `-` and `_`, at most 64 characters and at most 20 per key, so Japanese
role names are ordinary. A skill without either key is for everyone.

The reader's own role and project are chosen per KB in the composer and kept
in the device record (`device-settings.json`, `skillAudiences` keyed by scope
ID), never in the KB. The rule is teamai's unfiltered fallback: a reader who
chose nothing sees every skill; one who chose a role sees the skills naming it
plus the unscoped ones, and a project narrows independently in the same way. A
choice that hides the selected skill clears the selection, so a hidden skill is
never sent. The narrowing is a view, not a permission: a queued message naming a
skill outside the reader's choice still runs, because the KB declares it.

teamai resolves a member's namespaces as the union of role and project
namespaces from two manifests (`docs/usage-guide.md`, "Multi-project", at
v0.24.0). irori keeps the vocabulary and the union but puts the declaration on
the skill, so the layout stays `.agents/skills/<name>/SKILL.md` and native
discovery is untouched.

## Retirement

A skill removed from a KB used to just stop being listed; nobody downstream
learned that it was retired on purpose, and a personal copy of the name went on
being found. teamai records a removal as a name in `<type>/.removed`, a
newline-separated list its next pull deletes from every machine
(`src/resources/base.ts` at v0.24.0). irori's marker says more and asks nothing
of other machines:

```markdown
---
retired: 2026-09-21
reason: Folded into journal, which now carries the same steps.
replacement: journal
---

A longer explanation may follow; irori does not read it.
```

`.agents/skills/<name>/RETIRED.md` replaces the package's `SKILL.md`, which is
deleted. `retired` is a date, `reason` is at most 400 characters, and
`replacement` is an optional skill name. The file must not declare `name` or
`description`: Pi discovers a nested Markdown file under `.agents/skills` as a
skill once its front matter carries a non-empty `description`
(`packages/coding-agent/src/core/skills.ts` at 0.86.1, and CHANGELOG 0.84.3),
while Codex, OpenCode and Claude Code read only `SKILL.md`, and Claude Code does
not read `.agents` at all. A marker that carries either key is reported as a
problem, as is a package that keeps both files; neither is offered or retired.

irori honours the marker in three places: the composer names the retired skill
with its date, reason and replacement; a run — selected or queued — that names
it fails with that sentence instead of "no such skill"; and the reach view
flags a personal copy that still carries the retired name. irori reads markers
and never writes one. They are written by the KB's own contract or skills, or
by the user, so the schema-layer property in `tests/harnesses.test.ts` and
`scripts/real-agents.ts` still holds.

## Reach

irori delivers the selected skill in the request to every harness, so a skill
always reaches the agent the user chose. The reach view answers a different
question, the one `teamai doctor` asks of the directories it synced: would each
CLI find the KB's skills on its own — for an agent invoking one unprompted, and
for the same KB opened outside irori — and would a same-named skill at user
scope hide it? That is teamai's R7 lesson: a personal skill silently shadows the
project's.

irori launches every harness with the KB root as its working directory. The
table is what each CLI does from there, with the version whose documentation or
source states it.

| Harness | Reads the KB's `.agents/skills` | User-scope directories it reads | Same name in both |
| --- | --- | --- | --- |
| Codex CLI 0.155.1 | Yes: `$CWD/.agents/skills` and every directory up to the repository root (`REPO`) | `~/.agents/skills` (`USER`); `$CODEX_HOME/skills`, `~/.codex/skills` by default, deprecated but still read | Not merged; both appear in the skill selector |
| Claude Code 2.1.278 | No: project skills are `.claude/skills` only | `~/.claude/skills` (personal) | Personal over project; the KB copy is not read either way |
| OpenCode 1.18.30 | Yes: `.agents/skills` from the working directory up to the git worktree | `~/.agents/skills`, `~/.claude/skills`, `~/.config/opencode/skills` | Warns "duplicate skill name" and keeps one; which one is not documented |
| Pi 0.86.1 documentation (0.85.1 is what irori exercised) | Yes, once the project is trusted: `.agents/skills` in the working directory and its ancestors up to the git root | `~/.agents/skills`, `~/.pi/agent/skills` | First found wins, and global is loaded before project, so the personal copy wins |

Sources, read on 2026-09-21:

- Codex: [Where Codex loads local skills](https://developers.openai.com/codex/skills)
  ("If two skills share the same `name`, Codex doesn't merge them; both can
  appear in skill selectors"), and `codex-rs/ext/skills/src/host_roots.rs` at
  tag `rust-v0.155.1` for the root list, including the deprecated
  `$CODEX_HOME/skills` root and `/etc/codex/skills` at admin scope.
- Claude Code: [Choose where skills load](https://code.claude.com/docs/en/skills.md)
  and "Resolve skills that share a name" on the same page: "With `deploy` in
  both `~/.claude/skills/` and the project's `.claude/skills/`, `/deploy` runs
  the personal one". `.agents` is not among its locations. irori starts Claude
  Code through the Agent SDK with `settingSources: ['user', 'project', 'local']`
  (`src/agents/service.ts`), so personal and project skills load as in a
  terminal session.
- OpenCode: `packages/web/src/content/docs/skills.mdx` at tag `v1.18.30`
  ("Place files", "Understand discovery", and "Ensure skill names are unique
  across all locations"), and `packages/opencode/src/skill/index.ts` at the
  same tag: `discoverSkills` scans `~/.claude` and `~/.agents`, then the
  project directories, then the config directories; `add` warns on a duplicate
  name and overwrites the entry, and the files load with unbounded
  concurrency, so the survivor is whichever parsed last.
- Pi: `packages/coding-agent/docs/skills.md` at package version 0.86.1
  ("Locations" and "Name collisions (same name from different locations) warn
  and keep the first skill found"), CHANGELOG 0.54.0 (added `.agents/skills`
  discovery) and 0.63.1 (root `.md` files in `.agents/skills` ignored), and
  `src/core/skills.ts`, where `loadSkills` keeps the first skill under a name.
- teamai-cli v0.24.0: `docs/usage-guide.md`, `teamai doctor` ("`Skills
  delivered to <tool>` compares the skills your role namespaces … resolve to
  against what is on disk for each installed tool: it reports a skill that was
  never delivered separately from one that arrived unreadable").

The host reads the home directory — only there, only these directories, only
`<dir>/<name>/SKILL.md` for the names the KB declares or retired — and returns
home-relative names such as `~/.claude/skills`. No absolute path leaves the
host, and nothing is written. The renderer combines that with the table above,
which lives in `src/domain/skill-reach.ts`. Enterprise and admin scopes
(`/etc/codex/skills`, Claude Code's managed settings directory) are not
checked; neither is a `.claude/skills` or `.codex/skills` directory inside the
KB itself.

## Boundaries

A skill package must resolve inside its own KB's schema layer and must not be an
alias — the same checks the ontology reader applies. The chosen name crosses the
`HostAPI` boundary as a validated skill name, so it cannot address a path. The
instructions are stated to the agent as the KB's own contract; text captured
from `contents/` is not, and remains data.

irori supplies the same skill to whichever of Codex, Claude Code, OpenCode and Pi
is selected, because the instructions travel in the request rather than through
each CLI's discovery. Codex, OpenCode and Pi additionally find these packages
natively; irori does not deduplicate that, and a user who selects the skill
explicitly gets it once in the prompt.

## Verification

`tests/skills.test.ts` covers front-matter parsing including BOM, CRLF, quoted and
folded values, comments, structured optional metadata, a repeated key, a name
that disagrees with its directory, UTF-8 byte limits and an empty body; roles
and projects in both string and list form, an invalid name, and the visibility
rule for each combination of declaration and choice; the retirement marker's
required fields, a marker that declares `description` or `name`, and the
notice sentence; the composed prompt ordering; the run input accepting a skill
name and refusing a path; listing against a disposable KB — ordering, a
directory without `SKILL.md`, a malformed package reported as a problem, an
unknown name refused, a retired name refused with its reason, a package with
both files reported, and a symlinked `SKILL.md` refused as an alias; and the
reach check against a disposable home directory, including that a retired name
found there is flagged and that no machine path leaves the host.
`tests/settings.test.ts` holds the per-KB audience record and its request
bounds.

`tests/harnesses.test.ts` runs the Pi protocol fixture and asserts the
instructions, selected-note context and retained source references reach the
harness ahead of the user's request, that an undeclared skill fails the run,
and that a retired one fails with the KB's reason.
`scripts/skills-ui-smoke.ts`, in `npm run test:ui`, drives the actual picker
under a disposable home directory: option order, the unreadable package notice,
the retired notice, the role selector narrowing the list and writing only the
device record, the reach view naming `~/.claude/skills` and the retired name
without the machine path, delivery to the fixture, the recorded status, and
that a second space without skills shows no picker.

## What irori does not write

irori reads `.agents/skills/` and never creates it. It does not create `.claude/`,
`.codex/`, `.opencode/` or `.pi/` in a KB either, and does not pre-create a
directory a user has not asked for. `tests/harnesses.test.ts` holds this as a
property: the KB's schema-layer entries are identical before and after a turn.
A retirement marker is likewise read and never written; the reader's role and
project stay in the device record.

A KB that another tool also writes to is left alone rather than tidied: `.claude/`
and `.claudian/`, which claudian creates in a vault when its plugin loads, are
classified as schema and simply displayed there.

That check covers the Pi and OpenCode adapters through real child processes,
without a model. Claude Code needs an authorized model turn, so
`scripts/real-agents.ts` (`npm run test:agents`) holds the same property there:
it records every file in the KB's schema layer with its hash before the turn,
and fails if the turn adds, removes or rewrites one. irori answers each
permission request through `canUseTool` and never persists an allow rule.

Verified on 2026-09-17 with the owner's authorization, using Claude Code 2.1.273
on its native account:

- One `real-agents.ts` turn edited its note after one granted permission. The
  schema layer was identical afterwards, and no `.claude/` directory or settings
  file appeared in the KB. The CLI keeps its session record under the user's
  home directory instead.
- A copy of the merged `irori-templete`, registered as a KB, listed its five
  skills without problems. One Claude Code turn with `journal` selected followed
  the skill and the template's daily note. The only change in the KB was the new
  entry under `Knowledge_Base/journal/`.

Codex has not been run against the new check.

## Remaining

Skills are chosen per turn from a flat list; there is no search, no per-skill
argument, and no editing inside irori — a skill is a file in the KB, edited like
any other. A skill is not offered to the agent as something it may invoke on its
own. Whether Codex should be given the name rather than the body, so its native
repository-scope resolution is used instead, is open.

The reach table is a statement about documented versions, not a probe of the
installed CLI: a newer Codex, Claude Code, OpenCode or Pi that changes its
locations or its collision rule changes the answer without irori noticing, and
the table names the version it describes for that reason. The check reads the
user's home directory only; enterprise and admin scopes, `.claude/skills` and
`.codex/skills` inside the KB, `CODEX_HOME` set away from `~/.codex`, and Pi's
trust state are not examined. A retirement marker is checked for shape, not for
its `replacement` existing. Roles and projects are one choice per KB and per
device; a reader with two roles chooses one at a time.
