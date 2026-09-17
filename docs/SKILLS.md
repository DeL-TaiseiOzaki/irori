# KB-declared skills

Date: 2026-09-16. A knowledge base can carry its own procedures, and the person
running an agent can choose one for a turn. This is the irori side of D9 in
`irori-templete`'s `docs/decisions/001-kb-structure.md` (open as
[pull request 1](https://github.com/DeL-TaiseiOzaki/irori-templete/pull/1) at
this date), which declines to duplicate the same skill into one directory per
CLI.

## Where skills live

`.agents/skills/<name>/SKILL.md`, in the KB's schema layer. The directory is the
provider-neutral location Codex already reads as repository-scope skills and the
one [claudian](https://github.com/YishenTu/claudian) uses for its vault store, so
a KB that declares skills there works in irori and outside it without a second
copy. irori does not write into it, generate per-runtime stubs, or change a
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
folded YAML scalars are accepted; additional metadata may be structured but is
not interpreted by irori. The whole file is at most 16 KiB in UTF-8, and at most
50 packages are listed.

## What the user sees

With a KB selected, the composer shows a skill selector beside the agent
selector, defaulting to なし. It appears only when that KB declares at least one
skill. Choosing one and sending prepends its instructions to the request, states
that they come from this KB's schema layer at a named path, and leaves the
user's own words last. The prompt tells every harness to resolve relative paths
in those instructions from that skill's package directory. The conversation
records which skill ran.

A package that cannot be read is named under the composer rather than dropped,
so a skill that stops appearing has a visible reason. A directory without a
`SKILL.md` is not a skill and is not an error.

The list is read again when the active space changes and when a run settles,
because an agent can write a skill during a session. Skills belong to the space
that declares them: switching spaces replaces the list and clears the choice,
and a run naming a skill the space does not declare fails instead of running
without it.

## Boundaries

A skill package must resolve inside its own KB's schema layer and must not be an
alias — the same checks the ontology reader applies. The chosen name crosses the
`HostAPI` boundary as a validated skill name, so it cannot address a path. The
instructions are stated to the agent as the KB's own contract; text captured
from `contents/` is not, and remains data.

irori supplies the same skill to whichever of Codex, Claude Code, OpenCode and Pi
is selected, because the instructions travel in the request rather than through
each CLI's discovery. Codex additionally finds these packages natively; irori
does not deduplicate that, and a user who selects the skill explicitly gets it
once in the prompt.

## Verification

`tests/skills.test.ts` covers front-matter parsing including BOM, CRLF, quoted and
folded values, comments, structured optional metadata, a repeated key, a name
that disagrees with its directory, UTF-8 byte limits and an empty body; the
composed prompt ordering; the run input accepting a skill name and refusing a
path; and listing against a disposable KB — ordering, a directory without
`SKILL.md`, a malformed package reported as a problem, an unknown name refused,
and a symlinked `SKILL.md` refused as an alias. A symlinked package directory is
reported instead of silently omitted.

`tests/harnesses.test.ts` runs the Pi protocol fixture and asserts the
instructions, selected-note context and retained source references reach the
harness ahead of the user's request, and that an undeclared skill fails the run.
`scripts/skills-ui-smoke.ts`, in `npm run test:ui`, drives the actual picker:
option order, the unreadable package notice, delivery to the fixture, the
recorded status, and that a second space without skills shows no picker.

Verified locally after the parser and prompt-order simplification on 2026-09-17:
production build, 148 behaviour tests (141 passed, seven environment-gated
skips), and all thirteen Electron UI suites. No model inference, Google account
or real provider CLI was used.

## What irori does not write

irori reads `.agents/skills/` and never creates it. It does not create `.claude/`,
`.codex/`, `.opencode/` or `.pi/` in a KB either, and does not pre-create a
directory a user has not asked for. `tests/harnesses.test.ts` holds this as a
property: the KB's schema-layer entries are identical before and after a turn.

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
