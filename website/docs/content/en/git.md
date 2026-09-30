---
title: Git and sharing
description: Review diffs, record changes, and share them with a remote such as GitHub.
---

## Record changes

Open **Changes** in a hibachi and select a file to review its diff. Stage the changes to record, enter a message, and choose **Commit**.

A commit records local history; it has not been sent to a remote yet. Partial staging performed in another tool is preserved.

## Sync with a remote

**Fetch** receives remote history. **Pull** brings it in when the working tree is clean and the branch can fast-forward.

**Push** asks you to confirm the hibachi, branch, remote, and exact commit being sent. Git uses your existing authentication. Each hibachi keeps its own independent history.

## Review history and conflicts

Open earlier commits and diffs in **History**. To integrate diverged history, choose **More → Merge history**.

If files conflict, compare the base, local, and incoming versions and edit the result. Stage resolved files and review them before making the merge commit. A failed Push or Pull does not forcefully replace local work.

## Publish to GitHub

Choose **Also create on GitHub** when creating a hibachi. For an existing local folder, use **Start Git**; without a remote, use **Publish to GitHub…**.

This requires the GitHub CLI `gh` and its authentication. Review the account, repository name, and visibility. New repositories default to private. irori does not create pull requests from inside the app.
