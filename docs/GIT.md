# Per-space Git collaboration

Version 0.1.4 provides a nonmodal **ソース管理** sidebar, file-row and bulk
stage/unstage, a top commit composer and center-pane diffs. Opening Git flushes
the note automatically; editing and autosave continue beside the pane. The note
stays mounted while a diff is displayed. Partial index contents and separate
push confirmation remain. See [the daily-workflow follow-up](DAILY-WORKFLOW.md).

The original 2026-09-13 change-review sheet established the graphite `#25282c`,
paper `#fafaf8`, ink `#22292e`, muted `#626b75`, rule `#dfe3e5` and ember `#c88435`
palette. The sidebar keeps those tokens and existing Noto Sans JP/system
typography, with monospace for patches and revisions. Repository ownership and
the distinction between local commits and remote operations remain visible.

```text
repository / branch       note or selected diff
commit message / commit   return to note
changes | history
file selection / + / -
```

## Implemented journey

Open **ソース管理** in workspace navigation. The repository selector keeps each
independent repository's changes, branch and history separate. Select a file to
review its diff, or use its row's **＋**/**−** to stage/unstage. Already staged
changes appear separately and can be inspected or removed from the index without
reverting the working file. Partial staging performed in another tool is
preserved: a commit includes the displayed index, while later unstaged edits
stay on disk. The staged list and message are the review; **コミット** creates
the local commit directly. It does not push.

**履歴** paginates local commits, with first-parent commit diffs. **その他 → Fetch**
fetches the selected remote branch without touching the working tree. Counts
describe the locally observed remote-tracking history, not a continuous online
observation. **Pull** fetches and accepts only a fast-forward into a clean
working tree.
**その他 → 履歴を統合** explicitly starts Git's normal merge without an automatic
merge commit. Conflicts show base/ours/theirs and a manual result field. Resolving
a supported text conflict saves the result, stages that path, and retains the
observed versions in private device-local `git-recovery/` files before replacement.
Delete/modify conflicts offer an explicit deletion choice. Finishing the merge
requires a reviewed commit.

**Push** opens a confirmation naming the space, branch, remote and exact commit
to push. Push uses one explicit source OID and destination branch; it disables
force, recursive submodule publication and follow-tags, and refuses
mirror/multiple-push-URL remotes. Native rejection retains local commits and
index/worktree changes. GitHub remotes offer an explicit **GitHub を開く** action
under **その他**; irori does not create pull requests or bypass branch protections.

### Authorship notes

Since 0.1.21 a commit made here carries the
[Git AI Standard v3](https://github.com/git-ai-project/git-ai/blob/main/specs/git_ai_standard_v3.0.0.md)
note naming, as `h_` entries, the lines a person wrote or revised, under
`refs/notes/ai`, and the sync actions carry that ref the way git-ai does — see
[AUTHORSHIP](AUTHORSHIP.md) for what the note says and how it is read.
Fetch, Pull and 履歴を統合 run a second fetch
of `+refs/notes/ai:refs/notes/ai-remote/<remote>` after the branch fetch; a
remote without the ref leaves nothing to merge, and git reports that the same
way as a transport failure, so that fetch's failure is not shown. The tracking
ref is merged into the local `refs/notes/ai` with `git notes merge -s ours`
(copied when there is no local ref), so a note both sides wrote keeps this
device's version and a note only the remote changed arrives as written. Push
sends `refs/notes/ai:refs/notes/ai` after the branch, with the same flags and
never forced; a rejected notes push leaves the branch pushed and says so in the
result, and a Fetch merges what the remote has so the next Push lands. The push
confirmation states that the notes ref goes along when it exists.

A note is attached to one commit SHA. GitHub's squash and rebase merge buttons
create new commits on the base branch, which carry no note; the notes stay on
the branch's own commits, unreachable from `main`'s history once the branch is
deleted. git-ai answers this with a GitHub Actions workflow (`git ai ci`) that
rewrites the attribution onto the merge commit at merge time; irori has no
equivalent, so a knowledge base merged that way keeps its attributions only in
the merge commits of a plain merge or in irori's own device records. `git notes
merge` can also refuse when another tool left a notes merge unfinished in the
repository; the result names it and the branch operation is unaffected.

**スペースを追加 → GitHub から取得** accepts a GitHub HTTPS/SSH repository URL, a chosen parent directory and a new folder name. Native clone runs without recursive submodule initialization and then returns to the existing inspected registration flow. Existing directories are never overwritten. Failed-clone leftovers are not removed by irori; retries can use another name. A duplicate portable scope identity still follows the existing registration policy.

## Boundaries and recovery

- Native Git runs through typed, Zod-validated HostAPI calls. No raw renderer command/IPC interface is added. Arguments and literal pathspecs preserve spaces, Japanese, newlines and glob-like filenames without shell interpolation. Native credential helpers, SSH, hooks and signing remain effective; provider model calls are unnecessary.
- Git mutations queue per working tree. The host prevents overlap with agent execution, file saves/registration and cloud attachment changes. Shutdown waits for Git operations to finish. Process output and runtime are bounded (4 MiB; 30 seconds locally, 90 seconds for transport); termination settles before releasing the mutation lock.
- Review tokens detect observed HEAD/index/remote changes and changed selected file bytes before staging or resolving. An outdated commit or push review is rejected. Unsaved conflict text blocks navigation and remains in the sheet after a stale-resolution rejection so the user can review the new versions and retry.
- Contents and nested registered scopes are excluded from working-tree scans and history diffs. A separate index inspection surfaces already staged foreign paths and blocks their commit; users can unstage them. Symlink/directory/submodule staging is refused. Incoming edits to contents, nested ownership or the active scope declaration are refused before merge. Scope declaration reconciliation needs a separate future implementation.
- No hard reset, worktree restore, implicit stash, forced push or automatic conflict choice is used. Index-only removal is explicit, including removing an initial staged file whose working bytes have changed. Existing hooks may reject an operation; their raw output and credential-bearing transport diagnostics are not returned to the renderer.
- The authorship note is written after `git commit` returns, through `git fast-import` with the current `refs/notes/ai` tip as its parent, which git refuses to move unless the new tip contains that one; a note another process attached in between is kept and the commit result says the note was not written. An existing note on the commit is merged, never replaced; one irori cannot read is left alone.

These checks coordinate this application instance, not arbitrary external Git clients or hostile concurrent filesystem writers. There remains a narrow check-to-operation race; native Git's own index/ref locks and conflict checks still apply. Hooks and native configuration belong to the user's repository trust model. Rebase/cherry-pick continuation, merge abort, branch creation/switching, remote editing, automatic fetch, and binary/large-file conflict editing are outside this slice. Uncommitted resolution typing survives refresh/rejection in the live sheet but is not a persistent crash-recovery draft. Text review/resolution is bounded at 2 MiB; Git output and change lists also have limits.

## Verification

`npm run build` passes. `npm test` passes 42 behavior tests, with four opt-in native harness/rclone controls skipped. The 12 new Git tests use real temporary repositories and local bare remotes: exact paths and initial commits, partial staging, unstage without deleting work, stale reviews, scope/contents isolation, native hook rejection and diagnostic redaction, serialization of duplicate commits, fetch/fast-forward/push, divergent history, text and delete/modify merge resolution with recovery copies, remote retargeting, and clone input/destination validation.

`xvfb-run -a npm run test:ui` passes all five scripts: existing editor/session, cloud protocol fixtures, harness protocol fixtures, layered explorer, and the new Git journey. The actual Electron Git journey additionally tests review/commit/share, history isolation, native divergence and merge, preserving unsaved resolution text after a stale-result rejection, editor refresh, modal focus return, 1024px bounds, and real clone/registration. Clone's GitHub URL is rewritten to a disposable local bare repository through a test-only Git config; this is real Git execution, not an authenticated GitHub transport acceptance test. Screenshot/log evidence stays in ignored `test-results/`.

Live GitHub login/credential-expiry/branch-protection acceptance and native Windows/macOS execution remain open. No real account publication, real cloud operation, inference, installer or release is implied by the local fixtures.

The running VM preview was restarted normally after verification. Its separate **Git連携を試す** workspace provides a prepared diff and a local bare remote for review/commit/share; existing personal/team sample bytes were preserved. The demo is ignored device state, described in [VM-PREVIEW](VM-PREVIEW.md).

Git behavior follows the native executable and first-party documentation: [status porcelain](https://git-scm.com/docs/git-status), [staging and commit](https://git-scm.com/docs/git-commit), [index-only restore](https://git-scm.com/docs/git-restore), [merge without automatic commits](https://git-scm.com/docs/git-merge), and [explicit push refspecs](https://git-scm.com/docs/git-push). Authentication uses existing credential helpers/SSH. No provider model call is needed for this feature.
