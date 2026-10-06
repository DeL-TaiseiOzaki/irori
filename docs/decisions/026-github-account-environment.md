# 026 — The GitHub account carries the environment to another device

Date: 2026-10-06. Status: owner request; implemented for 0.1.76.

## Context

The owner asked for account linking, pointing at VS Code, whose GitHub or
Microsoft sign-in carries settings between devices. Asked what it should do,
the owner chose two things: show the account irori uses, and carry the
environment to another device. They chose to keep the GitHub CLI's sign-in
rather than an irori OAuth App.

irori already used `gh` for every GitHub call (clone fallback, publishing) and
never held a token. Everything that makes up a person's irori, though, was on
one device: the registered hibachis (`spaces.json`), the workspaces and rail
groups (`workspaces.json`) and the preferences (`device-settings.json`) in the
data directory. A hibachi's identity is in its own `.irori/scope.json`, which
travels with the repository.

## Decisions

1. **The account is the GitHub CLI's.** Settings → **アカウント** shows the
   account `gh` is signed in to. irori has no sign-in of its own and keeps no
   token; when `gh` is missing or signed out, the section says so.
2. **The environment is a file in a private repository of that account,**
   `<account>/irori-settings`, file `environment.json`, read and written through
   GitHub's contents API with `gh api`. A secret gist was rejected: anyone with
   its address can read it, and the file names private repositories. irori
   creates the repository (private, with a first commit) on the first save and
   refuses to read or write one that is public.
3. **What it holds:** the hibachis that have a GitHub remote (scope id, name,
   `owner/name`); the workspaces with their groups, keeping only those
   hibachis; the theme, language, Markdown font, editor assistance,
   hibachi-agent switch and the irori agent's CLI and models; and the irori
   agent's repository when its folder is one. Not: folder paths, pane layouts,
   skill audiences, routine runtimes and secrets, drafts, conversations, or any
   note. A hibachi without a GitHub remote cannot be restored elsewhere, so it is
   left out and the section names how many.
4. **Saving and restoring are explicit.** **環境を保存** replaces the saved file
   with this device's environment (naming the blob it read, so a save that
   crossed another device's is refused); when the saved environment lists
   hibachis this device lacks, the section says a save drops them. There is no
   automatic sync and no merge.
5. **Restoring only adds.** **復元** in the settings, or **GitHub から環境を復元**
   on the start screen, lists the saved hibachis. The chosen ones not here are
   cloned beside the irori agent's folder (`~/irori` unless another folder is
   chosen) and registered; a checkout of the same repository already there is
   registered as it is, and any other folder in the way is kept and reported.
   The irori agent's folder is cloned only where it is absent or empty.
   Workspaces are taken in by id: one this device has keeps its own hibachis
   beside the saved ones, and a different workspace of the same name gets a
   numbered name. The saved preferences replace this device's.

## Consequences

- A new device needs Git, `gh auth login` and irori; one restore brings back
  the hibachis, workspaces and preferences.
- `gh auth login`'s default scopes (`repo`) cover the repository and its file.
- A hibachi registered from a repository whose `.irori/scope.json` was never
  committed gets a new id on restore; its workspaces are mapped to that id.
- The saved file lists private repository names; it is only as private as the
  account's private repositories.
