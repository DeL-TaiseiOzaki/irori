# Daily editing workflow — 0.1.4

The owner reported four issues in the installed application: images could not be
pasted into notes, editing stopped after saving, the assistant showed too much
chrome, and Git required too many steps. These repeat earlier feedback; the
0.1.3 implementation record is not evidence that the owner's installed copy
works. The exact installed version and device reproduction remain unknown.

## Continuous documents and clipboard images

Markdown remains a directly editable document without a source-mode toggle.
The editor instance, selection and undo history survive saves. A newly reproduced
bug affected an immediate save followed by undo: Milkdown's debounced Markdown
listener could skip a change back to its previous value, leaving the saved
document and React buffer inconsistent. The editor now reports document changes
from the ProseMirror view update, including that undo, without waiting for the
debounced listener. Selection-only transactions do not serialize the document.

Native clipboard coverage uses Electron's system clipboard and the paste
shortcut, checking a trusted paste event, image rendering, saved relative asset
URLs and reopening. This complements the existing signature, size and path
validation in the image host. It does not establish every Windows clipboard
source, Japanese IME or the owner's installation behavior.

## Assistant

The conversation occupies the panel below a compact heading. New-conversation
intent is a heading action; it starts a fresh native conversation on the next
send and can be cancelled without losing the composer. Existing display history
is retained. Session continuation/reset, CLI version and diagnostics live in
the **会話と接続の設定** menu, which supports keyboard dismissal.

The composer shows the active KB, the selected note when it belongs to that KB,
and explicitly added reference sources. Agent selection sits beside sending.
Missing-CLI errors and live approval/question requests remain visible. Pending
instructions, cancellation, conversation recovery and native session ownership
retain their existing behavior. No model inference was used to validate this UI.

## Source control

**ソース管理** switches the left workspace pane from the explorer to Git. It is
not a modal dialog. The selected note remains mounted; viewing a diff hides it
temporarily, and **ノートに戻る** restores it without losing editor state. Ordinary
editing and autosave continue while the source-control pane is open.

The pane provides a repository selector, branch and fetched ahead/behind state,
a commit composer, staged/unstaged groups, file-row stage/unstage actions and
bulk actions. Clicking a file opens its diff in the center workspace. Pull and
Push retain explicit repository/branch confirmation; Fetch, merge and opening
GitHub are secondary operations. Native Git still owns index and history:
partially staged files keep their selected bytes, and each KB remains a separate
repository. Status reads discard superseded replies; remote confirmation keeps
the version shown when it was opened.

Mutation entry points save the current note first. Native version checks reject
changes that occurred after review. A dirty conflict-resolution draft prevents
closing source control, changing repository or returning from its diff until
the draft is resolved or explicitly reverted. Host mutation guards remain in
place; no automatic commit, push, merge or conflict resolution was introduced.

## Distribution and verification

The source version is 0.1.4, displayed on startup and in the workspace so an
installed copy can be identified. A source commit or passing check does not
update an installed application or the public download. This feature is
delivered through a branch and pull request; merge and publication are separate
steps.

Verification covers production build, behavior tests, the Electron UI journeys
and relocated package smoke. Exact completed results are recorded in STATUS
and the pull request. Native CI packages are engineering artifacts until an
approved release publishes their verified bytes.
