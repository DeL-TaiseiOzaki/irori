# ADR 005 — irori keeps its own host; the references are borrowed from by piece

Date: 2026-09-21. Status: accepted for the host question; the product directions
below are the owner's, with the open branches named as open.

## Context

On 2026-09-20 the owner placed three codebases under `KB_design/references/` and
asked whether irori should be built differently in light of them: **orca**, an
MIT-licensed "next-gen IDE for parallel agentic development" that was believed
to use VS Code internals; **claudian**, an Obsidian plugin that embeds Claude
Code, Codex and other agent CLIs in a vault; and **VS Code** itself. The
question asked outright was whether irori could be built *on top of* orca.

Each was read. The findings that decide the question:

- **orca is not a VS Code fork.** There is no `vs/`, no `code-oss`, no extension
  host, no extension API and no language server protocol anywhere in it. It uses
  the `monaco-editor` npm package as a viewer and diff surface with all
  TypeScript diagnostics deliberately switched off, a privately patched
  `@xterm/xterm` beta (7 patched packages, 13 MB of patch), and
  `vscode-textmate` with exactly one bundled grammar. Building on orca would
  therefore not deliver VS Code's editing stack; it would deliver Monaco, which
  is an npm install.
- **The size difference is not a detail.** orca is about 1.79M lines of
  non-test TypeScript across roughly 22,000 files; `src/main/ipc/` alone holds
  841. irori is about 14,000 lines across 79. The great majority of orca is
  ground irori does not stand on: SSH execution hosts (332 files), WSL, a mobile
  relay with its own cloud deployment, computer-use binaries for three operating
  systems, an embedded browser, emulator control, ticket-system integrations,
  and per-vendor adapters for some thirty agent CLIs.
- **orca's data model is worktree-centred and that concept runs through
  everything** — tabs, persisted open files, the filesystem API, agent status,
  mobile tab selection. irori's model is several independent knowledge-base
  repositories plus read-only Drive mounts in one workspace. Translating one to
  the other is a cross-cutting change of meaning, not an adaptation.
- **What irori most needs has no precedent in orca**: a non-filesystem backend
  like Drive, and any document synchronisation model.
- **Licensing is MIT, but a fork would inherit gaps.** `LICENSE` is MIT
  (`Copyright (c) 2026 Lovecast Inc.`, while the GitHub organisation and
  `package.json` author are `stablyai`); the root `package.json` carries no
  `license` field; and the bundled Geist and Nerd Font files and the upstream
  code embedded in the xterm patches have no corresponding notice files in the
  repository. Borrowing a part means honouring one MIT notice. Forking the whole
  means inheriting that housekeeping.

## Decision

**irori keeps its own Electron host and its own model. orca, claudian and VS
Code are read as references, and specific subsystems are borrowed by piece with
attribution where code is actually copied.**

What has been taken so far, and where:

1. **Crepe composed from explicit features** rather than its flattened entry
   point, after orca's build showed what an entry bundle drags in regardless of
   runtime flags. This removed KaTeX and its fonts from irori's package —
   1.4 MB for a feature no menu offered. See
   [0.1.11's notes](../releases/0.1.11-preview.1.md).
2. **Authorship keyed by line content**, arrived at while assessing git-ai,
   whose per-line record and history-rewrite carrying are the expensive parts
   this representation makes unnecessary. See [AUTHORSHIP](../AUTHORSHIP.md).
3. **One run per space rather than one per application**, which claudian's warm
   process pool and persistent message channel made obviously overdue.

What is worth taking next, in the order the evidence supports:

- `node:sqlite` with FTS5 for indexed knowledge-base search, as orca does it,
  with no native dependency to rebuild.
- `[[wiki link]]` resolution returning `resolved | missing | ambiguous`, which
  is the shape irori's own graph question needs.
- A round-trip safety gate before rich editing a document whose constructs the
  editor cannot serialise back, which orca applies to Markdown with embedded
  HTML.
- A deny-by-default capability gate for any extension mechanism, which is
  smaller and more auditable than the VS Code extension API and is the model to
  follow if irori grows one.

## Product directions the owner confirmed

These are the owner's statement of what irori is for, recorded here so later
work can be checked against it. Their current state is stated plainly; where
irori does not do the thing yet, the entry says so.

1. **A light, Notion-like Markdown editor.** Implemented (Crepe with a
   CodeMirror source mode), and materially lighter as of 0.1.11.
2. **Native to the Open Knowledge Format.** The graph question was settled on
   2026-09-22 by [ADR 008](008-graph-index-module.md), implemented in 0.1.24.
   irori generates a Git-tracked CSV module from the bundle's pages and typed
   relations on request; an explicit CSV declaration still wins. Broader
   portable source/run/artifact provenance remains incomplete.
3. **Code editing and execution, as an IDE offers them.** *Partial.* The source
   view is CodeMirror with Markdown highlighting only, and execution means the
   native terminal. Language support, diagnostics and running a project are not
   there. Note that orca reached the opposite conclusion here — it switched
   Monaco's diagnostics off and tells users to run checkers in a terminal pane —
   so how far irori goes is a product decision, not a matter of catching up.
4. **Ready to take in extensions, as VS Code and Obsidian do.** *Not
   implemented.* irori has no plugin or extension mechanism, and does not act as
   an MCP client itself (the agent CLIs own their MCP configuration).

## Open branches, not decided here

- **What "taking in extensions" means.** Running VS Code extensions or Obsidian
  plugins as they are would require an extension host and the corresponding API
  surface — work orca itself did not undertake. Offering irori's own capability-
  gated plugins is a much smaller thing that would not run anyone else's
  existing extension. These are different products and the choice has not been
  made.
- **Graph source: resolved.** ADR 008 now owns the decision described above.
- **How far code editing goes.** See direction 3.

## Consequences

The references stay in the workspace as reading material, not as dependencies.
Nothing in `references/` is imported, vendored or built. Where irori copies code
rather than an idea, the source's MIT notice travels with it and
`docs/THIRD_PARTY_NOTICES.md` records it; so far every borrowing has been of a
technique, and no orca code is in irori.

Rejecting the fork is not a rejection of the references. orca is the most useful
one precisely because it is a working answer to a nearby question, and reading
it has already changed three things in irori.
