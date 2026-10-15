# 043 — The saved environment carries the irori agent's routines

Date: 2026-10-15. Status: owner request; implemented for 0.2.17.
Extends [ADR 026](026-github-account-environment.md) (the GitHub account
carries the environment) and [ADR 016](016-routines.md) (routines).

## Context

The owner asked what **環境を保存** keeps and asked that routines be kept too.
ADR 026 D3 left routines out. A vault's routines are files in the vault
(`.irori/routines/`), so they already travel with its repository once
committed and pushed. The irori agent's routines (`routines/` in its folder)
travel only when that folder is a GitHub repository, which it usually is not.
The device's routine runtimes (the JavaScript switch) were also left on the
device.

## Decisions

1. **The irori agent's routine folders are saved with the environment,** as
   `routines.json` beside `environment.json` in the account's private
   `irori-settings` repository: each folder holding `routine.yaml`, with its
   name and every file (UTF-8 text as text, anything else as base64, and
   whether the file is executable). A separate file keeps `environment.json`
   readable by older irori. A vault's routines are not copied; its repository
   carries them.
2. **What does not fit is left out and named.** GitHub's contents API returns
   no content for a file over 1 MB, so the routines saved stay within about
   900 KB; a routine past that, or one holding a link or more than 100 files,
   is left out and the account section names it. **環境を保存** still replaces
   the saved routines with this device's, and the section says how many saved
   routines that drops.
3. **The routine runtimes travel with the other preferences.** The
   JavaScript switch is the person's choice, not a property of the device.
4. **Restoring adds routine folders only.** **環境を復元** lists the saved
   routines; the chosen ones whose folder is absent here are written into the
   irori agent's `routines/` (after its folder is cloned, when that was chosen).
   A folder already here is left as it is. Where the irori agent is not set up
   (no `AGENTS.md`), nothing is written, since files there would keep it from
   being set up; the routine is reported as failed.
5. **Secrets and reviews stay on the device.** Secrets never go to GitHub
   (ADR 026); a restored routine names a missing secret as before. A restored
   routine is unreviewed on the new device and runs only after
   **ルーティンの確認** there (ADR 016 D4).

## Consequences

- One restore brings back the irori agent's routines without making its folder
  a repository. The routine files are only as private as the account's private
  repositories, like the rest of the environment.
- A routine edited on two devices is not merged: the last save wins, and a
  restore never overwrites a folder that is already here.
