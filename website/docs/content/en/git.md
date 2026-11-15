---
title: Git and sharing
description: Review diffs, record changes, and share them with a remote such as GitHub. Work with submodules and GitHub repositories in Contents.
---

## Record changes

Open **Changes** in a vault and select a file to review its diff. Stage the changes to record, enter a message, and choose **Commit**.

A commit records local history; it has not been sent to a remote yet. Partial staging performed in another tool is preserved.

## Sync with a remote

**Fetch**, in the **More Git actions** menu, receives remote history. **Pull** brings it in when the working tree is clean and the branch can fast-forward.

**Push** asks you to confirm the vault, branch, remote, and exact commit being sent. Git uses your existing authentication. Each vault keeps its own independent history.

## Review history and conflicts

Open earlier commits and diffs in **History**. To integrate diverged history, choose **More Git actions → Merge history**.

If files conflict, compare the base, local, and incoming versions and edit the result. Stage resolved files and review them before making the merge commit. A failed Push or Pull does not forcefully replace local work.

## Publish to GitHub

Choose **Also create on GitHub** when creating a vault. For an existing local folder, use **Start Git**; without a remote, use **Publish to GitHub…**.

This requires the GitHub CLI `gh` and its authentication. Review the account, repository name, and visibility. New repositories default to private. irori does not create pull requests from inside the app.

## Submodules

A vault can hold other GitHub repositories as submodules. In **Changes**, choose **More Git actions → Add a submodule…**, enter the **GitHub repository URL** and a new **Folder** in Knowledge, and choose **Add**. Git stages the submodule; commit it in the vault to record it.

Once a vault has submodules, the **Repository** picker in **Changes** chooses the vault or a submodule. Each commits, pushes, pulls and keeps its history on its own, and the vault records which commit each submodule is on.

Pulling the vault moves a submodule along when it has nothing uncommitted. A submodule that cannot move stays where it is, and the result says so. Cloning a vault with **Clone from GitHub** on the start screen fetches its submodules too. A submodule not fetched yet shows as **Not fetched**, with **Fetch**.

## GitHub repositories in Contents

A vault's Contents can hold a GitHub repository, such as a project's code. In the vault's **Connect**, choose **GitHub** as the source, and enter the repository's HTTPS or SSH URL and, if needed, a **Branch**. Use **Choose where to clone** to have irori clone it into a folder you pick, or **Choose a clone** for a clone already on this computer. Check the name and choose **Clone and connect** (**Register and connect** for an existing clone).

The vault records only the repository's URL, in `.irori/repositories.json`; each computer keeps its own clone. On another computer, the connection's **Clone** clones it where you choose.

A repository connection is read-only unless you turn on **Allow editing**. **Update** fetches and moves the checked-out branch forward. It changes nothing, and says why, when the clone has uncommitted changes or commits of its own. irori does not commit or push there; use a terminal or an agent. See [synced folders](sync-folders.md) for what all connections share.

**GitHub repositories and branches**, the branch button in the explorer's Knowledge heading and on the Knowledge card of a vault's home, lists the vault's own repository, its submodules and the repositories connected in Contents, each with its branch. **Open on GitHub** opens one at that branch.

## Repositories that run programs

When a repository's own Git configuration runs programs (hooks, filters, diff and merge drivers, credential and SSH helpers), irori shows what they are and asks before it uses Git there. **Allow** lets Git run; irori asks again when they change. With **Don't allow**, Git does not run in that repository. Do not allow programs you do not recognize.
