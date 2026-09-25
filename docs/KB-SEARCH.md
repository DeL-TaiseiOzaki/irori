# Local KB text search

The sidebar's **KB内を検索** searches saved text in one selected KB from the
current workspace, or, with the **すべての Brain** chip, every brain of the
workspace at once. The initial selection follows the active KB. The search
form saves the current editor through its normal save/conflict handling before
starting. Querying another KB does not switch the active agent or editor scope.

Cross-brain search runs the same per-brain search concurrently against every
workspace brain and groups the results under each brain's tile, name and hit
count, in the workspace's brain order; opening a result switches to that hit's
own brain the same way a single-brain result does. It is not a merged index:
each brain is walked and matched independently, so one brain's limit, error or
incomplete result is shown inside its own group and does not affect the
others', and the "files changed" notice covers a change in any searched brain.
A newer scan of a KB (a search, a backlink count or a move preview) replaces an
older one of the same KB, which shares its index; scans of different KBs run
side by side, so one brain's backlink count does not cancel another brain's
search.

Search is a literal, single-line substring search, ignoring letter case. Queries
are trimmed and limited to 200 characters; regex punctuation is ordinary text.
Results show the relative path, original matching line number and a bounded
preview around the first match on that line. Clicking a result opens the current
file through the existing editor save, workspace-membership and agent-scope
guards. It opens the document, not a retained version or an exact cursor position.

## Scope and limits

The host searches the `Knowledge_Base` layer of the selected registered KB.
This includes text documents outside a literally named Knowledge_Base folder,
as defined by the existing layer classifier. Schema/control files, declared
contents/Drive trees, hidden entries, node_modules, symlinks and other registered
nested KBs are excluded. No cloud content is fetched and no cross-KB index is
built. Unregistered ordinary subfolders still belong to their parent KB.

Supported extensions match the text editor: Markdown, TXT, CSV, JSON, YAML,
TOML, TypeScript, JavaScript and CSS. Files must be regular UTF-8 text without
NUL bytes and at most 2 MiB. When a file is read, the search reads at most the
observed file size plus one byte, rechecks file size/modification time and
scope resolution, and skips a file observed changing during the read. It does
not claim a filesystem snapshot or atomicity against concurrent external writers.

A request stops at 200 matching lines, 50,000 checked files, 100,000 examined
directory entries or 32 MiB read into the index. A five-second budget covers the
walk that checks and re-reads files and a second one the matching over checked
text; both are checked between files/directories and matching lines, and neither
can interrupt a stalled OS filesystem operation. The explorer's existing
4,000-entry limit also applies per directory. A limit, unreadable descendant
directory or skipped eligible file marks the result incomplete. Root access
failures remain errors; an incomplete empty result is never presented as proof
of no matches.

Until 2026-09-21 the file limit was 2,000 and the byte limit bounded what a
request read to answer, because every request read every file; a larger
knowledge base was always incomplete. A checked file now costs one stat — about
36 µs per file on the measurement machine, directory listing included — instead
of a read and a match, so the counts were raised to what the time budget covers
and the byte limit now bounds what one request reads into the index.

The [backlink list](NOTE-LINKS.md#which-notes-link-here) walks the same layer
with the same guards and limits, reading Markdown only, so a change here changes
both.

## The index

Since 2026-09-21 the host keeps a device-local index per knowledge base: one
SQLite database under the application's data directory
(`search-index/<scopeId>.sqlite`), through Electron's built-in `node:sqlite`
(SQLite 3.53.4 in Electron 44) with no native dependency to build. It holds, for
every eligible file, the path, size and modification time it was read at and
the text itself — or the fact that the reading guards rejected it — plus an
FTS5 trigram index over the text with `detail=none`, which records which files
hold a trigram and not where.

A request does not trust the index. It walks the layer as before — the same
classifier, exclusions and blocked entries — and stats each eligible file. A
file whose size and modification time match its row is taken from the index;
any other file is read through the same guards as before and its row replaced;
rows the walk did not meet are dropped once the walk has reached the end. A file
added, changed, removed or renamed since the last request is therefore seen by
the next one without help from the watcher, whose events are the hint behind the
refresh notice and not a freshness guarantee (its depth limit and missed events
would make it a poor one). What the walk cannot see is a change that keeps a
file's size and lands within the filesystem's modification-time resolution of
the previous one; ext4, APFS and NTFS resolve nanoseconds to 100 ns.

Hits are computed as before: the per-line matcher runs over the stored text of
the checked files in walk order, so previews, line numbers, `iu` case folding
and the 200-hit cut-off are unchanged. For a query of three or more characters
the trigram index first narrows the candidates to the files holding every
trigram of the query — a superset, since adjacency is not recorded and case is
folded — and only those texts are matched. FTS5 folds case with Unicode 6.1
tables while the matcher uses the runtime's current ones, and 899 of the 2,964
case pairs the matcher accepts (Georgian Mtavruli, Cherokee and later additions)
are not folded by FTS5, so each non-ASCII letter of the query is written in every
case it takes; a check over every cased code point found no pair the matcher
accepts that the narrowed query misses. A query of one or two characters — a
two-character Japanese word is ordinary — has no trigram, so it is matched over
every checked text. So is the backlink list: a link can be written in too many
encodings (`%E5…`, `<x y.md>`, `../x.md#h`) for a narrower lookup to stay exact.

The database is a cache. Its schema is versioned; a file that is not a
database, one from another schema version, or one whose damage a query meets is
deleted and rebuilt by the next request, and deleting it by hand loses nothing
but that request's time. Nothing is written inside the knowledge base.
`DatabaseSync` is synchronous and runs in the main process, so each write is a
short transaction of at most 64 files or 1 MiB of text that is never held across
an await — which also keeps a superseded request from holding the write lock
against its successor, whose buffered writes are simply dropped — and the
matching yields to the event loop between files. Such a write is not free: a
1 MiB batch holds the main process for about 80 ms and a single 2 MiB file for
about 200 ms (measured with the same schema), so while a large knowledge base is
first indexed, requests to the host wait that long between batches; the window
itself keeps painting, since it is a separate process. The existing generation
and deadline checks apply throughout.

## Measurements

Disposable fixtures outside the repository, 2026-09-21: 2,000 and 15,118
Markdown notes (the ACCEPTANCE target) of mixed Japanese and English sentences
with relative links between them, 5.7 MB and 42.8 MB of text in 2,275
directories. Node 24.21 with SQLite 3.53.4, the version Electron 44 carries, on
a container shared with other agents' builds, so times moved between runs; the
table shows the quieter of two runs and ranges where they differed materially.
Queries that hit the 200-line limit stop early, so the "no match" rows show the
whole cost.

| Request                                  | 2,000 notes                                     | 15,118 notes                                                          |
| ---------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| Before, default limits, no match         | 515 ms, every file read                         | 522–797 ms, stops at 2,000 files, incomplete                          |
| Before, limits raised to read every file | 471 ms; backlinks 546 ms                        | 4.8–6.1 s; 2-character query 8.6 s; backlinks 7.6–9.4 s               |
| First search (index build)               | 768 ms, one request                             | 7.2 s over two requests: 5.0 s to 11,200 files (incomplete), then 2.1 s |
| Repeat, 4-character Japanese query       | 77 ms                                           | 540 ms                                                                |
| Repeat, 2-character Japanese query       | 74 ms; no match, every text matched: 149 ms     | 523 ms; no match, every text matched: 1.1 s                           |
| Repeat, no match (walk only)             | 71 ms                                           | 508 ms                                                                |
| Repeat, backlinks                        | 244 ms                                          | 1.7 s                                                                 |
| After touching 10 files                  | 88 ms                                           | 823 ms                                                                |
| Database                                 | 9.1 MB for 5.7 MB of text                       | 69.4 MB for 42.8 MB of text                                           |

Of a warm request at 15,118 notes about 300 ms is the directory listing (2,273
`entries` calls through `FileService`) and 90 ms the stats, which one directory
at a time run together rather than in turn (335 ms in turn). FTS5 with
`detail=full` doubled the database in a synthetic run (22 MB against 11 MB for
6.6 M characters) for positions the matcher never reads, and per-file
autocommits tripled the build, which is why writes are batched. The first
request on a large knowledge base reports incomplete until the index is built —
two requests at 15,118 notes — and every later one is complete.

## Verification and remaining work

Behavior tests cover literal Japanese/regex-punctuation queries, CRLF/BOM line
handling, body-only matching, KB/layer/alias exclusion, invalid and oversized
files, each search budget, access failures, superseded requests, external edits
and renames, long-line previews, and HostAPI argument validation. For the index,
`tests/search-index.test.ts` covers a repeat request that reads no file, the
index staying out of the KB, files modified (including same size with a later
modification time), added, removed and renamed between requests, one- and
two-character Japanese queries beside longer ones, case-insensitive parity beyond
ASCII and Unicode 6.1, a file that is not a database, a schema-version mismatch
and damage met by a query, and backlinks answered from indexed text. The Electron
search suite checks the visible workflow against disposable registered KBs, and
the packaged-application smoke now runs one search, so that the CI package jobs
show `node:sqlite` loading in the packaged main process on each platform. No
model execution, real Drive access or user KB mutation is involved.

Verified locally on 2026-09-21: production build; 179 behavior tests (175
passed, four environment-gated skips); the search and links Electron UI suites
against the built application, which is the evidence that `node:sqlite` loads in
Electron's main process — `scripts/build-host.mjs` bundles with
`packages: 'external'`, so the host bundle keeps `require("node:sqlite")` rather
than inlining it; changed source formatting. The packaged application was not
exercised locally: in a worktree whose `node_modules` is a symlink, packaging
operates on the shared tree, so the package jobs on the pull request are the
verification of the packaged search.

Verified locally on 2026-09-14: production build; 88 behavior tests (85 passed,
three optional native controls skipped); all ten Electron UI suites; changed
source formatting, documentation links and diff checks. The new search UI suite
also exercises initial/restored keyboard focus, saved edits, result opening,
incomplete/refresh notices, delayed query/scope/close responses, retry after an
error and preservation of an external-edit conflict. The initial focus failure
was fixed by focusing the input after the dialog opens; the final complete UI
run passes.

Hosted verification: [CI 34810865845](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34810865845)
passes at `ac935a9160f5e0a0be3d77a23e71d24073e53fcb`, including the verification
job and Linux x64, Windows x64 and Mac arm64 package/relocated-startup checks.
The public testing installer remains the earlier 0.1.3 build.

This is on-demand search of saved local text. The index makes a repeat request
cheap; it does not yet run search or backlinks on every open, and nothing keeps
the index warm between sessions other than the next request. Cross-brain search
(above) runs the existing per-brain search grouped by brain, not a merged
index or ranking across brains; binary document extraction, cloud search,
unsaved-buffer search and direct line/cursor navigation remain separate work.
Existing source/artifact record search and explicit identity reconnection remain in
[KNOWLEDGE-NAVIGATION](KNOWLEDGE-NAVIGATION.md). Portable identities, file
moves/properties and real generated-artifact acceptance remain open D06 work.
