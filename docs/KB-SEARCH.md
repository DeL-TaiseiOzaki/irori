# Local KB text search

The sidebar's **KB内を検索** searches saved text in one selected KB from the
current workspace. The initial selection follows the active KB. The search
form saves the current editor through its normal save/conflict handling before
starting. Querying another KB does not switch the active agent or editor scope.

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
NUL bytes and at most 2 MiB. The search reads at most the observed file size
plus one byte, rechecks file size/modification time and scope resolution, and
skips files observed changing during the read. It does not claim a filesystem
snapshot or atomicity against concurrent external writers.

A request stops at 200 matching lines, 2,000 successfully scanned files,
10,000 examined directory entries or 32 MiB of read data. A five-second budget
is checked between files/directories and matching lines; it cannot interrupt
a stalled OS filesystem operation. The explorer's existing 4,000-entry limit
also applies per directory. A limit, unreadable descendant directory or skipped
eligible file marks the result incomplete. Root access failures remain errors;
an incomplete empty result is never presented as proof of no matches.

Queries run on form submission. Editing the query, changing the selected KB or
closing the dialog invalidates older responses. A newer host search supersedes
an older one between operations. Closing alone discards its eventual response;
it does not interrupt OS I/O. File-change events prompt a manual refresh rather
than starting searches automatically. No query, index or search result is
persisted. Searching again observes current files and external renames.

## Verification and remaining work

Behavior tests cover literal Japanese/regex-punctuation queries, CRLF/BOM line
handling, body-only matching, KB/layer/alias exclusion, invalid and oversized
files, each search budget, access failures, superseded requests, external edits
and renames, long-line previews, and HostAPI argument validation. The Electron
search suite checks the visible workflow against disposable registered KBs.
No model execution, real Drive access or user KB mutation is involved.

Verified locally on 2026-09-14: production build; 88 behavior tests (85 passed,
three optional native controls skipped); all ten Electron UI suites; changed
source formatting, documentation links and diff checks. The new search UI suite
also exercises initial/restored keyboard focus, saved edits, result opening,
incomplete/refresh notices, delayed query/scope/close responses, retry after an
error and preservation of an external-edit conflict. The initial focus failure
was fixed by focusing the input after the dialog opens; the final complete UI
run passes.

This is on-demand search of saved local text. Indexed large-vault search,
cross-KB searching, binary document extraction, cloud search, unsaved-buffer
search and direct line/cursor navigation remain separate work. Existing
source/artifact record search and explicit identity reconnection remain in
[KNOWLEDGE-NAVIGATION](KNOWLEDGE-NAVIGATION.md). Portable identities, backlinks,
file moves/properties and real generated-artifact acceptance remain open D06 work.
