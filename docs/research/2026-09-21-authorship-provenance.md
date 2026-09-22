# Recording which text the person wrote: a survey

Date: 2026-09-21. Input to [ADR 006](../decisions/006-person-lines.md). The question
was whether irori can know, below the line, which parts of a note the person wrote
and which an agent did, and whether an existing tool already records it. The
decision that followed chose the line, not the character; this survey is kept for
the evidence and for the day sub-line tracking or sharing is revisited.

## git-ai, read at the source

Read by the lead at git-ai `0670e7e` (2026-09-09; Apache-2.0).

- **The standard is line-level.** `specs/git_ai_standard_v3.0.0.md` calls the
  attestation section "line-level attribution mapping": each key names line
  ranges (`1-4,9-10`) valid in that commit's version of the file. Keys are `s_`
  (an AI session with a per-checkpoint trace), `h_` (a known human, "explicitly
  observed being typed … in an IDE with the git-ai extension installed", keyed by
  the committer identity) and legacy AI keys. A line under no key is
  "untracked". A note may carry any subset of the key kinds.
- **Tracking is character-level, the record is not.** `src/authorship/
  attribution_tracker.rs` keeps `Attribution { start, end, author_id, ts }` over
  character positions through edits (diff, move detection, a code tokenizer). On
  commit, `attributions_to_line_attributions` picks one author per line — the
  latest timestamp among the non-whitespace ranges on it, with an `overrode`
  marker when a human edit came after an AI one — and then "strip[s] away all
  human-authored lines that aren't overrides". What part of a line the person
  changed is not in the note.
- **A known human is a save, not a keystroke.** The VS Code extension's
  `known-human-checkpoint-manager.ts` runs `git-ai checkpoint known_human` on
  every document save (500 ms debounce per repository); the diff since the last
  checkpoint becomes the human's. An agent edit that no agent hook reported is
  therefore attributed to the person at their next save.

Date read: 2026-09-21 (all URLs were read on this date unless noted). Scope: what exists
for recording, below the line, which parts of a text a person wrote and which parts an
AI wrote; whether any of it fits irori's constraints (Milkdown/ProseMirror rich editor,
CodeMirror source view, agents that rewrite the same Markdown files on disk, nothing
written into the knowledge base's working tree). git-ai itself is covered by the lead;
here it appears only as other tools describe it.

Verification marks: **[V]** read in a primary source (spec, docs, source, paper);
**[S]** secondary source or search summary only; **[X]** could not be confirmed.

Baseline (irori today, `irori/docs/AUTHORSHIP.md`, 2026-09-21): line granularity, keyed by
the line's normalised text; the reader's lines attested from irori's own save; agent
lines attested from the file watcher during a run; unattested otherwise; device-local
JSON; no diff library (ADR 004); prompt states line ranges per writer as a record.

---

## 1. AI-code provenance standards and tools

| Name | Granularity | Human spans: attested or inferred | Survives edits / rebase / other machines | Reusable form | Licence | Source (read 2026-09-21) |
| --- | --- | --- | --- | --- | --- | --- |
| **Agent Trace** (Cursor, RFC v0.1.0, Jan 2026) | File and **line ranges** (`ranges[].start_line`/`end_line`, 1-indexed) with optional `content_hash` (e.g. `murmur3:9f2e8a1b`). No column or character offsets in the served spec. [V] | Representable: `contributor.type` is `human`, `ai`, `mixed` ("human-edited AI or AI-edited human code") or `unknown`. The spec defines no observation model, so whether a human record is positive or residual is left to each implementation. [V] | `content_hash` is meant to follow moved code; rebase/merge handling is explicitly deferred ("We expect to see different implementations… feedback welcome"). Storage is "unopinionated": no ref name or sidecar mandated. [V] | JSON data spec + reference `trace-store.ts`/`trace-hook.ts` ("an example for Cursor or Claude Code"). **The GitHub repo linked from agent-trace.dev (`github.com/cursor/agent-trace`) returned 404 on 2026-09-21 via curl and authenticated `gh api`**; the spec text is still served at agent-trace.dev. [V] | [X] not verifiable (repo unreachable) | https://agent-trace.dev/ ; Thoughtworks Radar Vol. 34, Apr 2026, ring *Assess*, adopters "Cline and OpenCode, plus … Git AI": https://www.thoughtworks.com/en-us/radar/platforms/agent-trace |
| **git-ai / Git AI Standard v3** (as others describe it) | Line-level notes at `refs/notes/ai` (git-byline reads and writes "the Git AI Standard v3 authorship format at `refs/notes/ai`"). [V via git-byline README] | git-byline's comparison: "Git AI adds prompt-linked provenance and lifecycle observability; git-byline intentionally excludes prompts, transcripts, cloud sync…". OpenCode hooks into it through `tool.execute.before/after` plugin hooks, "line-level attribution", supported since 2025-12-05 (git-ai's own docs). [V] | — (lead's question) | Notes format readable by git-byline and Exceeds Ink ("authorship/3.0.0" schema name in Exceeds' notes). | — | https://github.com/comarch/git-byline ; https://usegitai.com/docs/agents/opencode |
| **git-byline** (Comarch, pure Go) | Line ranges. Four states per line: `human`, `ai`, `human-override` ("A person replaced AI output; the AI origin stays visible"), `untracked`. [V] | **By elimination, bounded**: "Content changed after the last agent checkpoint defaults to `human` and carries the commit author's identity"; "Lines without checkpoint history are `untracked`"; "When evidence is missing, the answer is `untracked`, never a confident guess." Human identity = commit author e-mail local part, not an editor observation. [V] | Agent hooks (Factory, Claude Code, GitHub Copilot, VS Code Agent, Cursor, Codex, Gemini CLI, Windsurf, Grok) snapshot files before/after edits as content-addressed blobs; `post-rewrite`, `post-merge`, `reference-transaction`, `post-checkout` hooks reproject; "Unmatched rewritten content becomes `untracked`"; forge squashes: "pairing by patch ID for rebase merges and folding in commit order for squashes". Portable through `refs/notes/byline` (+ `refs/notes/ai`, Agent Trace 0.1 output). [V] | CLI + hooks; canonical JSON in `refs/notes/byline`; `.git/byline/checkpoints.jsonl`, `state.json`. Limits: ≤500 files / 16 MiB per note, files >64 MiB skipped, no prompts stored. | MIT (© 2026 Comarch S.A.) | https://github.com/comarch/git-byline (README) |
| **agentblame** (mesa-dot-dev) | Line-level (gutter markers, line counts). [V] | Inferred: AI lines are marked; human is the unmarked remainder. [V] | Editor hooks for Cursor, Claude Code, OpenCode; pending attributions with content hashes matched at commit; notes in `refs/notes/agentblame`; "Attribution survives squash and rebase merges" via a GitHub Actions workflow. [V] | CLI, browser extension for PRs, notes ref. | Apache-2.0 | https://github.com/mesa-dot-dev/agentblame (README) |
| **Exceeds Ink** (commercial) | Line-level (`exceeds-ink blame`). [V] | Unattributable lines reported as `unknown_lines`, "rather than being assigned to either category". [V] | 5 adapters (Claude Code, Cursor, Codex, Copilot, Windsurf) + heuristic detection of ~50 tools; notes at `refs/notes/exceeds-ink` (JSON "authorship/3.0.0"); post-rewrite hooks; squash resolved against the working tree at the squash commit. [V] | Notes ref; product otherwise closed. | Commercial (terms not shown) | https://blog.exceeds.ai/track-ai-code-contributions-git/ (2026-06-08, updated 2026-07-09) |
| **Cursor Blame + AI Code Tracking API** (Enterprise; API "Alpha") | Line-level; AI sources `TAB` and `COMPOSER`; per-commit and per-change line counts, per-file counts. [V] | **Residual**: `nonAiLinesAdded`/`nonAiLinesDeleted` = "max(0, totalLines − AI lines)". [V] | Line "signatures" compared against later commits [S]; "attribution data cached locally… fetched from Cursor's servers"; commit must be scored on the machine where the AI authored it [S]; Background Agents / CLI lines not attributed to commits [S]. | Closed; REST API, no export format documented. | Proprietary | https://cursor.com/docs/integrations/cursor-blame ; https://cursor.com/docs/account/teams/ai-code-tracking-api |
| **GitHub Copilot usage metrics** | Aggregate lines of code (`loc_suggested_to_add_sum`, `loc_added_sum`, …) per feature (completions, chat, `agent_edit`) and language. **No per-line, per-file or per-commit provenance.** [V] | Not represented. | n/a | REST API / dashboards. | Proprietary | https://docs.github.com/en/copilot/reference/copilot-usage-metrics/lines-of-code-metrics |
| **Aider** | **Commit-level only**: "(aider)" appended to git author/committer names by default; optional `--attribute-co-authored-by` trailer and commit-message prefixes. Nothing per line or span. [V] | Not represented. | Commit metadata; lost on squash unless trailers are kept. | git metadata. | Apache-2.0 (project) | https://aider.chat/docs/git.html |
| Commit trailers in general (`Co-authored-by`) | Commit-level. [V] | Not represented. | Trailers survive only if the merge keeps the message. | Git convention. | — | https://docs.github.com/en/pull-requests/how-tos/commit-changes/creating-a-commit-with-multiple-authors |

Notes for section 1.

- Every git-side tool above stops at the **line**. None records column or character
  ranges; Agent Trace's `content_hash` is a per-range hash, not a sub-line locator.
- Human authorship on the git side is a **remainder** (Cursor API, agentblame) or a
  **bounded default** (git-byline: unclaimed content after a checkpoint is `human`,
  never-checkpointed files are `untracked`). No git-side tool observes the person typing.
- Survival across rebase/squash is bought with hooks (`post-rewrite`, forge workflows) or
  content hashes; git-byline and Exceeds both fall back to "untracked/unknown" when a
  rewrite cannot be matched. irori's content-keyed record avoids the problem for lines;
  the same idea extends below the line (see §5).

---

## 2. Prose and document tools with sub-line authorship

| Name | Granularity | Human spans: attested or inferred | Survives edits / other machines | Reusable form | Licence | Source (read 2026-09-21) |
| --- | --- | --- | --- | --- | --- | --- |
| **Grammarly Authorship** (GA Oct 2024 for Free/Pro/education) | Span-level colour coding in the report ("color-coded based on human-typed or sourced"); exact unit (word/sentence) not stated. [V] | **Attested from events**: "tracks what you typed, pasted, or asked AI to help with"; categories: typed by a human; pasted from a browser source; pasted from an unknown source; AI-generated; modified with on-demand AI rephrase; edited with traditional (grammar/clarity) suggestions. Requires the extension to be active in the document and clipboard access. Limits: fast keystrokes can be missed; desktop pastes outside Word untracked; new AI tools uncategorised. [V] | Stored on-device (AES-256-GCM); a generated report is uploaded and shareable by URL; report includes a replay. Works in Google Docs, Word (20-page limit), Grammarly docs. [V] | **Closed product feature**; no API or file format for third parties. [V] | Proprietary | https://support.grammarly.com/hc/en-us/articles/29548735595405-About-Grammarly-Authorship ; https://www.grammarly.com/blog/product/grammarly-authorship/ |
| **iA Writer 7 Authorship + "Markdown Annotations" v0.2** | **Character ranges by grapheme-cluster index** (`@Human: 0,20 33,4 …`, `&AI: 20,13 …`). [V] | **Attested by explicit marking**: "Authorship is a manual process… You must explicitly assign authorship using Mark as…, Paste as…, or Paste Edits from…"; iA detects ChatGPT / LM Studio conversations on paste and offers to mark them. Keys: `@` human (named author, optional `<id>`), `&` AI, `*` reference. [V] | Annotation block appended **inside the Markdown file** after `---` … `...`; a hash annotation (`Annotations: 0,95 SHA-256 <hash>`) validates the ranges; on mismatch "tools… should warn users that annotations may be misplaced" and let them discard/keep. Stripped on export to Markdown/HTML/PDF/Word; carried on AirDrop/mail. What happens to an `&AI` range when the human edits inside it: [X] not stated. | Open format spec (README, v0.2, repo `iainc/Markdown-Annotations`, pushed 2025-11-05); app closed. README: "While the format is open, avoid cloning our work." Rationale for a trailing block: "The markup always got in the way when editing because every other word can have a different author." | No LICENSE file in the repo [V] | https://github.com/iainc/Markdown-Annotations ; https://ia.net/writer/support/editor/authorship ; https://ia.net/topics/ia-writer-7 |
| **Google Docs** | Version history highlights additions per editor colour and strikes deletions [S: androidpolice, zapier, spreadsheetpoint]; "Show editors" on a selected span (official; Business Standard/Plus, Enterprise, Education Plus only). [V] | Attested per edit session, per Google account; Gemini "Help me write" inserts **as suggestions** to accept/reject [V]; how accepted Gemini text is attributed in version history: [X]. | Server-side; no export of per-span authorship. | Closed. | Proprietary | https://support.google.com/docs/answer/190843 ; https://support.google.com/docs/answer/13447609 |
| **Microsoft Word / OOXML tracked changes** | **Run-level inside the line**: `<w:ins w:id w:author w:date>` / `w:del` (ISO/IEC 29500-1 §17.13.5.18). [V] | Attested per Word user while Track Changes is on; "Edit with Copilot will respect Track Changes, and if Track Changes is enabled then Edit with Copilot changes will be tracked" [V]; Copilot shown as the author: [S] (forum/blog claims only). | Travels inside the `.docx`; survives any editor that honours revisions. | **Open file format** (ECMA-376 / ISO 29500); libraries exist (Open XML SDK, docx.js). | Standard | https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.insertedrun ; https://support.microsoft.com/en-us/word/edit-with-copilot-in-word |
| **Microsoft Loop / Fluid Framework attribution** | **Per character**: `segment.attribution.getAtOffset(offset)` on `SharedString` → key → `IAttributor` gives user + timestamp of the insertion. [V] | Attested per client insertion; unacked changes return `LocalAttributionKey`. [V] | Travels with the Fluid container. | Library, but "Attribution is currently in alpha development and is marked internal: expect breaking changes in minor releases" (`@fluid-experimental/attributor`, `@fluidframework/merge-tree`). | MIT (Fluid) [S] | https://github.com/microsoft/FluidFramework/blob/main/packages/dds/sequence/README.md |
| **Etherpad** (easysync changesets) | **Per character** via attribute runs: `['author', 'a.kVnWeomPADAT2pn9']` interned in the pad's attribute pool; a changeset op `*0*1+9` applies attributes 0 and 1 to the next 9 characters. "A character can carry several attributes… but only one value per key (so it cannot belong to two authors)." [V] | Attested per connected author. | Attributes persist through every revision (pool keeps "every current and historical attribute"). | Library inside the app: `require('ep_etherpad-lite/static/js/Changeset')` (`src/static/js/Changeset.ts`); no standalone npm package verified. | Apache-2.0 | https://docs.etherpad.org/api/changeset_library.html |
| **Draftback**, **Revision History**, **Process Feedback** (Google Docs replay tools) | Replay of Docs revision history (Draftback: play/pause at real speed; local only, "No document data is collected"). [S] | Inferred from revision timing/paste size; Process Feedback advertises copy-paste tracking and "AI use detection" [S; site returned 403]. | Depends on Google's revision log. | Closed extensions. | Proprietary | https://draftback.com/ ; https://chromewebstore.google.com/detail/revision-history-writing/dlepebghjlnddgihakmnpoiifjjpmomh ; https://processfeedback.org/gdocs/ [X] |
| **Turnitin Clarity** (launched 2025-07-15) | Draft-level: "revision timelines, pasted vs. typed text, and a summary of AI chat history". [V] | Attested inside Turnitin's own composition space (pasted vs typed); Turnitin says it captures periodic drafts rather than live keystrokes [S]. | Server-side. | Closed. | Proprietary | https://www.prnewswire.com/news-releases/turnitin-delivers-turnitin-clarity-…-302504889.html |
| **HaLLMark** (CHI 2024, research) | **Span-level**: pasted LLM text auto-highlighted "AI-written" (orange); "AI-influenced" (green) marked manually; "If a user re-writes or edits a portion of the AI-written text, we remove the highlight from the specific portion." [V] | Human = unhighlighted remainder, but AI spans are attested by the copy/paste event. | In-app only. | Research prototype (paper). | — | https://arxiv.org/abs/2311.13057 |
| **InkSync** (UIST 2024, research) | **Character-level alignment algorithm** tracks accepted system edits; audit view highlights system-originated content (yellow = new information, grey = no new info). [V] | AI spans attested from accepted executable edits; suggestions whose `original_text` disappears are "implicitly dismissed". | In-app only. | Research prototype. | — | https://arxiv.org/abs/2309.15337 |
| **CoAuthor** dataset (CHI 2022) | **Keystroke-level** logs with source (writer vs GPT-3 suggestion), 1445 sessions, 72.6% of text human-written; replay interface. [V] | Attested per event. | Dataset. | Public dataset + replay. | Research | https://coauthor.stanford.edu/ |

Notes for section 2.

- The only prose tools that **positively** attest the person's words do it by observing
  the editor (Grammarly events, Etherpad/Fluid per-client ops, CoAuthor logs) or by
  explicit marking (iA). None infers it from a saved file.
- Only two carry the record with the document: OOXML `w:ins`/`w:del` and iA's trailing
  annotation block. Both write into the file, which irori rules out. iA's design notes
  are still the closest precedent for a Markdown file: grapheme ranges plus a hash of the
  text they index, and a mandatory "warn and let the user decide" rule on hash mismatch.

---

## 3. Libraries and data models usable inside irori

irori's current tree (from `irori/package-lock.json`, read-only): `@milkdown/kit`/`crepe`
7.22.1, `prosemirror-model` 1.25.11 / `-transform` 1.12.1 / `-state` 1.4.4 / `-view`
1.42.3, `@codemirror/state` 6.7.4 / `view` 6.43.11, and **`prosemirror-changeset` 2.4.2
already present transitively via `@milkdown/prose` and `@milkdown/preset-gfm`**. No yjs,
automerge, loro or diff package.

| Name (version) | How an insertion is attributed | How attribution follows later edits | Cost | Keepable outside the Markdown file? | Licence | Source |
| --- | --- | --- | --- | --- | --- | --- |
| **prosemirror-changeset** 2.4.3 (npm 2026-09-17; GitHub repo archived 2026-04-01, moved to `code.haverbeke.berlin`) | `ChangeSet.create(doc, combine)` then `addSteps(newDoc, maps, data)`; every inserted/deleted `Span` carries `data` (e.g. `{by: 'reader'}` or `{by: run}`); `combine` decides whether adjacent metadata merges. `Change{fromA,toA,fromB,toB,deleted[],inserted[]}`; `simplifyChanges` widens mixed edits to word boundaries; `toJSON()`. [V] | Spans are re-mapped through each step's `StepMap`; the base document is the reference for deletions. | Incremental per transaction; O(changes). Positions are ProseMirror positions, so a Markdown offset needs a serialiser-side mapping (irori already notes block ≠ node). | Yes: JSON per note, device-local. | MIT | https://github.com/ProseMirror/prosemirror-changeset ; npm registry |
| **ProseMirror "track changes" example** | `TrackState{blameMap, commits, uncommittedSteps, uncommittedMaps}`; each `Commit` stores inverted steps + maps; `blameMap` is a list of ranges → commit; "Hover over commits to highlight the text they introduced." [V] | Ranges mapped through later steps; revert = rebase inverted steps over later commits (`Mapping`). | Same order as changeset; keeps full step history. | Yes (serialise steps). | MIT (example) | https://prosemirror.net/examples/track/ |
| **Yjs 14 attributions** (GitHub `v14.0.0-rc.26` 2026-09-07; npm `beta` 14.0.0-16 2025-12-07; stable 13.6.32) + **`@y/prosemirror` 2.0.0-11** (2026-09-08, requires `@y/y ^14.0.0-rc.26`) | Every item has an id; an `IdMap` maps id ranges → attributions: `Y.createIdMapFromIdSet(diff, [Y.createContentAttribute('insert','Bob')])`; `ytext.toDelta({renderer})` returns ops with `attribution: {insert:['Bob']}`, `{delete:['Bob']}`, `{format:{italic:['Bob']}}`. **Yjs's own example attributes a deletion to `'OpenAI o3'`.** Encoding: run-length + de-duplicated attributes ("27 bytes" example). [V] | Attribution is keyed to item ids, so it follows content through any edit; needs `gc: false` to keep deleted items. `@y/prosemirror` renders it as marks `y-attributed-insert/delete/format/attrs` via `mapAttributionToMark(format, attribution)` where `attribution = {insert?, delete?, format?, insertAt?, deleteAt?, formatAt?}`; "Attribution marks are presentation, not content. They must never round-trip into the CRDT." Powers suggestion mode and version diffs. [V] | The Y.Doc must become the note's source of truth; the agent's on-disk rewrite must be applied to it as a delta under the run's identity (a diff is still required). Pre-release: `@y/prosemirror` is the "unstable" v14 branch; `@milkdown/plugin-collab` 7.22.1 peers `yjs: *` but `y-prosemirror` 1.3.7 pins `yjs ^13.5.38`. `y-simple-attribution-server` is "WIP". | Yes: Y.Doc binary + IdMaps, device-local; nothing in the file. | MIT | https://github.com/yjs/yjs/blob/main/attributing-content.md ; https://github.com/yjs/y-prosemirror/blob/master/ATTRIBUTION.md ; https://archive.fosdem.org/2026/schedule/event/8VKQXR-blocknote-yjs-prosemirror/ (talk 2026-02-01) ; https://github.com/yjs/y-simple-attribution-server |
| **Yjs 13 `PermanentUserData` + `ychange`** | y-prosemirror 1.x renders snapshot diffs with a `ychange` mark (`user`, `type`) using `permanentUserData` to map clientIDs to users. [S: community threads; the v14 README no longer documents it] | Snapshot-to-snapshot only. | Requires snapshots. | Yes. | MIT | https://discuss.yjs.dev/t/how-to-use-y-permanentuserdata/154 |
| **Automerge** `@automerge/automerge` 3.5.0 (2026-09-16) | Every op id is `(counter, actorId)`; text is per-character ops (`splice`, or `updateText` which diffs internally); marks/`spans`/cursors for rich text. **3.5.0 adds opaque change-level "author" metadata** retrievable with `getAuthor`/`getAuthors` (+ `getAuthorForActor`, `getActorsForAuthor`). [V] | Op ids are permanent; cursors follow. **No documented API that answers "which actor/author inserted the character at position p"** — it must be derived from change history (`getChanges`, `inspectChange`, `diff`). Upwelling (Mar 2023) needed "an experimental fork of Automerge which added… attributing edits to individual authors"; the essay promised "a more stable form in future Automerge releases" — the 3.5.0 author metadata is the first such landing found. [V] | Doc as source of truth; WASM runtime. | Yes. | MIT | https://automerge.org/automerge/api-docs/js/ ; https://github.com/automerge/automerge/releases/tag/js/automerge-3.5.0 ; https://www.inkandswitch.com/upwelling/ |
| **Loro** `loro-crdt` 1.16.1 (Rust crate 1.16.2, 2026-09-21) | Built-in: `LoroText.getEditorOf(pos): PeerID \| undefined` — "Gets the peer ID of who last edited the character at a position" (Rust `get_editor_at_unicode_pos`, `None` if "attribution is unavailable"); `subscribeFirstCommitFromPeer` to store a peer→user (or peer→run) map inside the doc for "edit attribution". [V] | Per-character origin is intrinsic; stable cursors by item id; time travel/checkout. Deleted elements' ids are not kept in state ("Loro optimizes State metadata by not storing the IDs of deleted elements"). | Doc as source of truth; agent rewrites applied as a peer after a diff. | Yes. | MIT | https://docs.rs/loro/latest/loro/struct.LoroText.html ; https://www.loro.dev/llms-full.txt (API reference) |
| **Peritext** (Ink & Switch, Nov 2021; CSCW 2022) | Each character has an `opId` of the form `counter@nodeId`, so the inserting node is intrinsic; formatting ops anchor to gaps between characters. [V] | Ids permanent. | TypeScript prototype on a simplified Automerge; inline formatting only. | Yes. | MIT (`inkandswitch/peritext`) | https://www.inkandswitch.com/peritext/ |
| **Etherpad easysync** | See §2: per-character `author` attribute runs. | Attribute pool persists. | In-app library. | Yes (changesets are text). | Apache-2.0 | https://docs.etherpad.org/api/changeset_library.html |
| **Fluid `@fluid-experimental/attributor`** | See §2: `getAtOffset(offset)` per character. | Merge-tree segments. | Alpha, "marked internal". | Yes. | MIT [S] | (see §2) |
| **Character diff libraries** — `diff-match-patch` 1.0.5 (npm 2020; Google repo **archived 2024-08-05**), `@sanity/diff-match-patch` 3.2.0 (2025-01, Apache-2.0), `jsdiff` (`diff`) 9.0.0 (2026-04-13, BSD-3-Clause) | Not a store: they compute the inserted/deleted spans between the last known bytes and an external rewrite so the inserted spans can be attributed to the run. Myers diff with "pre-diff speedups and post-diff cleanups" (semantic cleanup avoids one-character fragments). [V] | Each rewrite is a new diff against the previous attributed text; attribution carried by re-applying spans. | O(ND) per rewrite; needs a stored previous version (irori already keeps the pre-save bytes for its hash check). | Yes. | Apache-2.0 / BSD-3 | https://github.com/google/diff-match-patch ; npm registry |
| **prosemirror-suggest-changes** (Handle with Care; `@blocknote/prosemirror-suggest-changes` fork) | Insertion / deletion / modification **marks in the document** with an `id` and optional extra attrs such as `userId`. [V] | Marks move with content. | Marks would serialise into Markdown unless stripped on save. | Not by itself. | [X] not shown | https://github.com/handlewithcarecollective/prosemirror-suggest-changes |
| **Tiptap AI Changes** | `startTrackingAiChanges` snapshots the doc; later changes are diffed against the snapshot; `getChanges()`, accept/reject per change; state in `extensionStorage.aiChanges`, not in the doc. [V] | Snapshot diff only. | Commercial Tiptap product; licence not shown. | Yes (plugin state). | Proprietary [S] | https://tiptap.dev/docs/content-ai/capabilities/changes/features/review-changes |
| **Ink & Switch Patchwork / Universal Version Control** | Patchwork "prototyped a simple way for an AI bot to propose a branch on your writing and leave suggestions which you can review and accept/reject" (G. Litt, 2024-05-05); a style-guide bot "explains its underlying reasoning". Universal Version Control essay: "we also increasingly collaborate with LLMs and other AI agents." [V] | Branch/diff level on Automerge. | Research; no published attribution library. | — | — | https://buttondown.com/geoffreylitt/archive/towards-universal-version-control-with-patchwork/ ; https://www.inkandswitch.com/universal-version-control/ ; notebook entries 2026 at https://www.inkandswitch.com/patchwork/notebook/ (JS-rendered; entry 07 could not be read [X]) |

Notes for section 3.

- Two shapes exist for sub-line attribution: **CRDT identity** (Yjs 14 IdMaps, Loro
  `getEditorOf`, Automerge/Peritext op ids, Etherpad, Fluid) where every character is born
  with its author, and **editor-side span tracking** (prosemirror-changeset, the track
  example, Tiptap, HaLLMark, InkSync) where insertions are recorded as ranges and mapped
  through later steps.
- Both shapes keep the record outside the text. Neither shape attributes an **external
  rewrite of the file** by itself: the agent's bytes arrive without operations, so a
  character diff against the last known text is unavoidable (Automerge's `updateText` and
  Cline's user-edit feedback both do exactly this internally). This is the point where
  ADR 004's "no diff library" decision meets the sub-line goal.

---

## 4. Evidence that human-authored spans are useful to an AI collaborator

| Source | What it does with "which text the human wrote" | Representation in the prompt / UI | Verified |
| --- | --- | --- | --- |
| **Cline** (source `src/core/prompts/responses.ts`, tag v3.12.0) | After a write, if the person changed the agent's content, the model receives the person's edits **as a diff** and the final file: "The user made the following updates to your content:\n\n${userEdits}… Proceed with the task using this updated file content as the new baseline… If the user's edits have addressed part of the task or changed the requirements, adjust your approach accordingly… use the final_file_content shown above as your reference". Motivated by issue #337 (2024-09-20): "Model will try to re-apply edits after user modifies its changes". | Unified diff + `<final_file_content>` block; not an instruction to protect the text, but a record that the model must treat as the new baseline. | [V] https://github.com/cline/cline/blob/v3.12.0/src/core/prompts/responses.ts ; https://github.com/cline/cline/issues/337 |
| **Claude Code** Edit tool | Refuses an edit when the file was "modified since read, either by the user or by a linter" — a freshness guard, not provenance; the "modified since you last read it" note fires once and is not re-armed by Read (issue #94794). | Tool error / one-shot system note. | [S] issues https://github.com/anthropics/claude-code/issues/94794 , /48390 , /3513 |
| **VS Code Copilot Next Edit Suggestions** | Uses the person's own recent edits as the intent signal: "Based on the edits you're making, next edit suggestions predict both the location of the next edit you'll want to make and what that edit should be." | Recent-edit context (contents not disclosed). | [V] https://code.visualstudio.com/docs/copilot/ai-powered-suggestions |
| **Who Owns the Text? Design Patterns for Preserving Authorship in AI-Assisted Writing** (Zhang, Bu, Dhillon; arXiv 2601.10236, 2026-01-15) | Psychological ownership fell ~0.85–1.0 on a 7-point scale with AI suggestions; **style personalisation recovered +0.43 and increased incorporation of AI text**. Patterns: on-demand initiation, micro-suggestions, **voice anchoring** (the writer's own style), audience scaffolds, **point-of-decision provenance** (make "which text the human wrote" visible at the moment of choice). | Human text as a style anchor for the model; provenance shown to the writer. | [V] https://arxiv.org/abs/2601.10236 |
| **Authorship Drift** (Park et al., CHI 2026; arXiv 2602.05819) | 302 participants; collaboration lowered self-efficacy and raised trust; those with stable self-efficacy "demonstrated higher actual and perceived authorship of the final text". | Design recommendations for supporting authorship. | [V] https://arxiv.org/abs/2602.05819 |
| **HaLLMark** (Hoque et al., CHI 2024; arXiv 2311.13057) | Span-level AI-written / AI-influenced highlighting; "helped them retain a sense of control and ownership of the text". Provenance is shown to the writer, **not fed to the LLM**. | Orange/green highlights, timeline, pie chart. | [V] https://arxiv.org/abs/2311.13057 |
| **InkSync** (Laban et al., UIST 2024; arXiv 2309.15337) | Character-level trace of accepted AI edits for Warn / Verify / Audit; auditors label traced spans. Also human-facing. | Highlighted audit view. | [V] https://arxiv.org/abs/2309.15337 |
| **LaMP** (Salemi et al., arXiv 2304.11406, 2023/2024) | Retrieving the user's **own past writing** into the prompt improves personalised generation across 7 tasks ("demonstrate the efficacy of the proposed retrieval augmentation approach"). Follow-up (arXiv 2504.08745) reports ~15% relative gain from author features + contrastive examples [S]. | Retrieved user items in the prompt. | [V] https://arxiv.org/abs/2304.11406 |
| **CoAuthor** (Lee, Liang, Yang, CHI 2022) | Keystroke-level human/GPT-3 provenance enables "Identifying authors of sentences" analyses; 72.6% human-written. | Event log with source. | [V] https://coauthor.stanford.edu/ |
| **Detection-side work** — "Segmenting Human–LLM Co-authored Text via Change Point Detection" (arXiv 2605.03723, 2026), **LLMTrace** (character-level annotations; arXiv 2509.21269), **M4GT-Bench** task 3 (token-level human/machine boundary; arXiv 2402.11175) | Shows the alternative to recording: **inferring** the boundary after the fact. Error-prone by construction; irori's stated policy (observe, never guess) sides with the recording tools. | n/a | [V] abstracts |
| **Yjs 14 docs** | The maintainer's example attributes a change to `'OpenAI o3'` alongside a human — CRDT designers now treat AI agents as attributable peers (see also Electric's "AI agents as CRDT peers", 2026-04-08 [S]). | Attribution field on delta ops. | [V] attributing-content.md |

What was **not** found: any product or paper that keeps a standing **span-level map of
human vs AI text** and passes it to the model as context on every turn. Cline's diff is
the nearest (event-level, at write time); LaMP-style personalisation uses human text as
style evidence; the CHI papers argue for showing provenance to the person. irori's current
"line ranges each writer holds" statement is already ahead of what was surveyed.

---

## 5. What exists vs what irori needs

| irori need | What exists | Gap |
| --- | --- | --- |
| Sub-line spans for **both** writers, the person's words **positively** attested | Editors/CRDTs: Etherpad, Fluid, Yjs 14, Loro (`getEditorOf`), Grammarly (events), iA (manual), HaLLMark/InkSync (research). Git-side tools: none below the line; human by remainder. | Nothing observes a person typing in **irori's** editor except irori. A ProseMirror-level observer (changeset with `data = reader`) or a CRDT peer is required; the CodeMirror source view needs its own range mapping (`@codemirror/state` `RangeSet`/`ChangeDesc` map positions through edits). |
| Agent writes are **external file rewrites** during a run | Nothing attributes an external rewrite at sub-line level without a diff: Automerge `updateText`, Tiptap snapshot diff, Cline user-edit diff all compute one. | irori must diff the last known text (it already has the pre-save bytes) against the watcher's new bytes and attribute inserted spans to the run. This is the ADR 004 decision to revisit; `jsdiff` (BSD-3, 2026) or `@sanity/diff-match-patch` (Apache-2.0) are maintained; Google's original is archived. |
| Record stays **out of the working tree** | Changeset JSON, CRDT doc + IdMaps, Fluid, Tiptap state: all outside the text. Git notes (v3, byline, agentblame, Exceeds) are outside the tree too but line-level. iA and OOXML write into the file. | irori's device-local store can hold spans; only iA's format is a Markdown-native precedent, and it violates the constraint. |
| Survive edits, reflow and renormalisation | CRDT ids (intrinsic); step-map mapping (changeset); content hashes (Agent Trace `content_hash`, Cursor signatures, git-byline blobs); hash-validated ranges (iA). | A content-keyed extension of irori's line key is possible: per line key, a list of `(grapheme offset, length, text hash, by)` spans, re-anchored by searching the span text within the line on load; a span whose text is gone is dropped; a span rewritten by the person becomes the person's (matches git-byline's `human-override`, Agent Trace's `mixed`, HaLLMark's "remove the highlight from the edited portion"). |
| Portability to other machines / tools | Line-level: `refs/notes/ai` (v3), Agent Trace 0.1, `refs/notes/byline`. Sub-line: only CRDT sync or iA's in-file block. | Sub-line portability would be irori's own format (export on demand), with line-level projection to v3 notes as already planned. Note that Agent Trace's canonical repo was unreachable on 2026-09-21. |
| Tell the agent which words are the person's | Cline: diff at write time; LaMP: human text as style evidence; papers: show provenance to the person. | No precedent for a standing span map in the prompt. Options consistent with irori's "record, not instruction" stance: (a) per line, list the person's phrases; (b) a diff of the person's edits since the run's last write (Cline's shape); (c) an annotated copy of the note with light inline markers (iA/HaLLMark shape). (b) has the only field evidence of changing agent behaviour. |

Build sketches, ordered by how much of irori they touch:

1. **Editor-side spans (smallest change).** In the rich editor, feed the person's
   transactions into a `prosemirror-changeset` (already in the tree) with
   `data = {by: 'reader'}`; on an agent write during a run, diff old→new text, apply as
   steps with `data = {by: run}`; on save, serialise spans against the saved Markdown
   (map ProseMirror positions to Markdown offsets at serialisation, or re-anchor by span
   text within the line) into the existing device-local record keyed by line key. Source
   view mirrors the spans with CodeMirror decorations mapped through `ChangeDesc`.
   Costs: a diff dependency; a position mapping; the record grows per span (iA's block
   for its own README is ~200 bytes for 6 KB of text, so size is not the issue).
2. **CRDT as the note model (largest change).** Make a Loro or Yjs 14 document the source
   of truth per note, stored device-local; the person edits through the binding, the
   agent's rewrite is applied as a second peer after a diff. Gives intrinsic per-character
   attribution (Loro `getEditorOf`; Yjs IdMaps rendered as `y-attributed-*` marks with
   suggestion mode for free) but replaces irori's file-centred model and, for Yjs, rides a
   release candidate (`@y/prosemirror` 2.0.0-11 depends on `@y/y ^14.0.0-rc.26`); Milkdown
   has no v14 binding. Loro is stable (1.16) but has no ProseMirror binding in the tree.
3. **Adopt an external tool.** None found that meets the need: all git-side tools are
   line-level and infer the human side; all prose tools are closed or write into the file.

Not confirmed / not existing (plainly):

- No tool records **sub-line** human/AI authorship for **externally rewritten Markdown
  files** while keeping the file untouched. This is the gap irori would be filling.
- `github.com/cursor/agent-trace` returned 404 on 2026-09-21 (Wayback lookup was
  rate-limited, so archival status is unknown); the spec is only verifiable via
  agent-trace.dev.
- Cursor Blame's internal line signature, the Word author name for Copilot edits, iA's
  behaviour when a human edits an `&AI` range, Process Feedback's method, and the licence
  of iA's format and of prosemirror-suggest-changes could not be verified.
- No paper found that measures agent behaviour with a standing "human-written spans" map
  in context; the closest evidence is Cline's diff feedback (engineering) and LaMP-style
  personalisation (style, not intent).
