# 022 — A hibachi holds other repositories as submodules

Date: 2026-10-02. Status: owner decision; implemented for 0.1.66.
Builds on [GIT](../GIT.md) and [ADR 021](021-optional-hibachi-agent-and-agent-dock.md).

## Context

On 2026-10-02 the owner asked whether one hibachi can hold several GitHub
repositories, with the other repositories tied to the main hibachi as
submodules. Until then irori cloned without submodules, refused to stage a
submodule and showed one repository per hibachi. The owner then fixed the
premise: other repositories are cloned into the hibachi as submodules, edited
there, and committed and pushed from irori.

## Decisions

### D1 — Submodules belong to the hibachi; they are not hibachis

A submodule's files are part of the hibachi that holds it: they show in its
explorer and its layers are decided from the hibachi's root, as any folder's
are. A submodule needs no `.irori/scope.json` and is not registered. Each
repository keeps its own Git state: the Changes view has a repository picker
(the hibachi, then each submodule), and commit, push, pull, fetch, merge,
history and conflicts act on the repository chosen. Only the hibachi's own
repository offers **GitHub に公開…**. One submodule level is supported; a
submodule's own submodules are not fetched.

### D2 — The hibachi records which commit each submodule is on

The hibachi's change list shows a submodule only when it is on a different
commit from the one the hibachi records; its edits are listed in the
submodule's own repository. That change is staged and committed like a file,
and its diff lists the commits it moves over. A pull of the hibachi moves each
submodule to the newly recorded commit when the submodule has nothing
uncommitted and the move is a fast-forward of its branch, fetching the commit
if needed. Otherwise the submodule stays where it is and the result says to
pull it.

### D3 — Adding and fetching submodules

- **その他 → submodule を追加…** takes a GitHub HTTPS/SSH URL and a new folder in
  the Knowledge layer (not Contents, not Schema or another hidden top-level
  folder, not an existing path or another hibachi) and runs `git submodule
  add`. Git stages the submodule and `.gitmodules`; committing them is the
  person's.
- **GitHub から取得** clones the hibachi and then fetches its submodules. A
  submodule listed but not here shows as 未取得 in the picker, with **取得**.
- A fetched submodule is put on the branch `.gitmodules` names, or the remote's
  default branch, at the commit the hibachi records, when that commit is on
  that branch; the branch tracks the remote. Otherwise it stays on the commit
  without a branch, where it can be read but not committed to.
- Submodules come only from GitHub over HTTPS or SSH: the URL Git resolves from
  `.gitmodules` is checked before anything is fetched, and Git runs with
  `protocol.allow=never` except for those two. Native credentials, SSH and the
  GitHub CLI fallback apply as for any other Git network operation.

## Consequences

- `GitTarget` names the repository of every Git HostAPI call: the scope ID for
  the hibachi, or `{ scopeId, repository }` for a submodule. The host checks the
  path is a submodule the hibachi declares and records, inside its own boundary.
- A hibachi's submodules share its Git operation queue.
- A submodule's commit message keeps its own draft (`DraftKey.repository`).
- Removing a submodule, switching branches inside it, nested submodules and
  submodules from hosts other than GitHub are not offered.
