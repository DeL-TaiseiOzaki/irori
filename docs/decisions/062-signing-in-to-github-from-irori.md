# 062 — irori signs the GitHub CLI in and sets the Git author

Date: 2026-11-16. Status: owner request; implemented for 0.2.73.

## Context

[ADR 026](026-github-account-environment.md) made the GitHub CLI's sign-in
irori's GitHub account: irori shows the account `gh` uses and keeps no token.
When `gh` was signed out, **設定 → アカウント** said so, named
`gh auth login`, and offered only **再確認**. The owner found no way to sign in
from there: a person had to leave irori for a terminal, run an interactive
command, and come back. The owner asked that the GitHub user name and email be
set in irori and that it connect by itself.

A user name and email alone cannot sign in to GitHub: GitHub authorizes an
application only on its own page, with the person's password and second factor.
What irori can do is what a terminal does: run `gh auth login --web`, show the
one-time code it prints, and open GitHub's page to enter it on. gh then waits
for the approval and stores the token itself.

The name and email are also what Git records on every commit (`user.name`,
`user.email`). irori already reported a commit that failed for want of them
(*commit の作成者名とメールアドレスが未設定です*), and a page's `last-change`
property already reads `user.email`, but nothing in irori could set them.

## Decisions

1. **irori runs gh's own sign-in.** Where a GitHub call needs gh and gh is
   signed out — **設定 → アカウント**, the restore sheet, and the account picker
   for publishing a vault — irori offers **GitHub にログイン** instead of the
   error. It runs `gh auth login --web --hostname github.com` without a terminal,
   shows the one-time code gh prints, and **コードをコピーして GitHub を開く**
   copies it and opens `https://github.com/login/device`. Once the person approves
   there, gh exits and the section reads the account again; nothing has to be
   pressed in irori. **キャンセル**, closing the sheet, a second start, or gh's
   own expiry (15 minutes) stops the waiting gh.
2. **The token stays gh's**, as ADR 026 decided. irori reads only gh's stderr
   for the code and the page, opens a page only on `https://github.com`, and
   never reads, stores or passes on the token. The scopes are gh's defaults.
3. **Signing in gives the device's Git an author where it has none.** After the
   sign-in, each of `user.name` and `user.email` that the person's own Git
   configuration (`git config --global`) lacks is set from the account: the
   profile name (the login without one), and the public profile email or else
   GitHub's private address `<id>+<login>@users.noreply.github.com`, which
   attributes commits to the account without showing an email. A part already
   set is kept.
4. **The author is shown and edited in the account section.** **Git の作成者**
   shows the two values from Git's own configuration. While a part is unset and
   gh is signed in, the account's are filled in to save with **作成者を保存**.
   irori checks that the name is one line without `<` or `>` and the email one
   address; Git's own configuration is the only place they are kept, so a
   commit made in a terminal or by an agent uses the same author.
5. **Not done:** installing gh (a missing gh is named, with a link to
   `https://cli.github.com/`), signing out, choosing SSH, writing a credential
   helper into Git's configuration (`gh auth setup-git`; irori's own Git
   operations already use gh's credentials for HTTPS GitHub remotes), and a
   repository's own `user.name` or `user.email`, which still win over the
   device's.

## Consequences

- A new device needs Git, gh and irori; the sign-in and the restore of
  ADR 026 happen in irori's window.
- A device with a token in `GH_TOKEN` or `GITHUB_TOKEN` cannot be signed in
  this way; gh refuses, and irori says to remove the variable.
- Saving the author changes Git for every repository on the device that does
  not set its own, which is what Git's `--global` means. The section says so.
