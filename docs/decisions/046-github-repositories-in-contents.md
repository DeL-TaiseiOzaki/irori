# 046 — A GitHub repository can be shown in contents

Date: 2026-10-16. Status: owner decision; implemented for 0.2.24.
Extends [ADR 019](019-local-folder-connections.md) (folders on this device in
contents) and [ADR 042](042-waiting-folders-and-work-folders.md). Keeps
[ADR 022](022-submodules.md) (submodules belong to the vault's knowledge) as it is.

## Context

A vault often stands for a project, and a project has code in GitHub
repositories. On 2026-10-16 the owner asked how a vault should hold them. A
submodule records the repository but puts code in the knowledge layer, where it
is searched and listed as pages. A folder connection puts it in contents, the
layer for products and materials, but the vault records only the folder's name:
another device cannot tell which repository it was.

The owner chose contents and a new kind of connection: the vault records the
repository's URL, and each device clones it to a folder the person chooses. The
repository is mostly read there; it may be edited, but commits and pushes are
made in a terminal or by an agent, not on irori's Git screen. It is brought up
to date only when the person asks.

Showing the repository through GitHub's API without a clone was considered and
dropped: agents read contents as files on disk, and editing needs a working tree.

## Decisions

1. **A third kind of connection, `github`.** The connection dialog offers
   **GitHub** beside **このコンピューター**. The person enters an HTTPS or SSH
   GitHub URL and, optionally, a branch, then either **保存先を選ぶ** (irori
   clones into a new folder named after the repository inside the chosen
   folder) or **手元のクローンを選ぶ** (a clone already on this device).
2. **The vault records the URL, never the path.** `.irori/repositories.json`
   holds the URL, the branch when one was given, the name and place in
   contents, the access, and the clone folder's name. It is a separate file so
   that builds whose `.irori/local-folders.json` record is strict keep reading
   theirs. The clone's path is device data (`local-bindings/`), as for a folder.
3. **It behaves as a folder connection.** `contents/<name>` is a link to the
   clone; the same checks, waiting, renames, access and agent access apply. A
   repository starts read-only; **編集を許可** makes it editable.
4. **The clone is partial and GitHub-only.** irori clones with
   `--filter=blob:none` and without submodules, allowing only the HTTPS and SSH
   transports. The person's Git credentials, SSH and the GitHub CLI fallback
   apply as for any clone. A clone or an update may take up to 30 minutes and
   runs outside the connection queue, so it does not hold up other work.
5. **Another device clones for the record.** A repository without a clone on
   this device shows as フォルダ未選択 with **取得**, which clones it into a
   folder the person chooses; **手元のクローンを選ぶ** takes an existing clone.
   A chosen folder must be the top of a clone whose `origin` names the same
   repository.
6. **最新にする is the only update.** It fetches and fast-forwards the checked-out
   branch to its upstream. Nothing moves, and the reason is shown, when no branch
   is checked out, the branch tracks nothing, a tracked file has changes, or the
   branch has commits of its own. irori never commits, pushes, merges or
   switches branches there.
7. **Agents do the same through `irori connect`.** `irori connect <vault>
   <GitHub URL> --into <folder>` clones, `--existing <clone>` takes a clone,
   `--branch` and `--editable` apply, and a repository the vault records but
   this device has not cloned is cloned for that record. `irori list` names
   each repository and whether it is cloned here.

## Consequences

- Renaming the contents folder rewrites `.irori/repositories.json` with the
  other records.
- Unregistering the connection leaves the clone on disk.
- An older irori ignores `.irori/repositories.json`, so it neither shows nor
  breaks those connections.
- The clone is not searched by irori's search, as no connected folder is.
- A protocol the person's own Git configuration allows for a specific transport
  still applies; irori only turns the others off for its own commands.
