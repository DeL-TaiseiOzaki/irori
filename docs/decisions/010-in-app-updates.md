# 010 — In-app updates with one button

Date: 2026-09-23. Status: owner request accepted and implemented for 0.1.29;
installed-device trials on Windows 11 and macOS 26 are pending.

## Decision

The owner asked that an installed irori update itself with one button, without
downloading or reinstalling it by hand, in the way the Codex and Claude desktop
applications do. Until now irori checked only when the person pressed
**更新を確認** and then opened the installer in the browser. [ADR 004](004-ui-library-adoption.md)
left adopting an auto-updater as a product decision; this is that decision.

- **Finding a new version.** A packaged irori checks the fixed public release
  endpoint by itself 10 seconds after it starts and then hourly, as well as when
  the person presses **更新を確認**. An automatic check shows something only when
  a newer version exists. A development run never checks by itself.
- **One button.** **更新して再起動** downloads the release's package, verifies it,
  stages it and restarts into it. Nothing is downloaded before that press:
  previews are published several times a day and each package is about 200 MB.
- **Restarting.** The restart is the same shutdown as closing the window. Drafts
  are flushed first, a running agent or terminal needs the person's consent, and
  a Git operation in progress blocks it. Declining leaves the prepared update and
  a **再起動して更新** button.
- **Verification.** Every request, including each redirect GitHub answers with,
  must be HTTPS. The downloaded bytes must have the size the release publishes
  and the SHA-256 its `SHA256SUMS.txt` lists. Nothing reaches the installer
  otherwise, and the download is removed once staged or rejected.

## Mechanism per platform

**Windows.** Squirrel.Windows already installs irori, and its `Update.exe` sits
beside the installed versions. irori writes a local feed from the verified
package and runs `Update.exe --update <feed>`, which installs the new version
beside the running one. The restart runs `Update.exe --processStartAndWait
irori.exe`, which starts the newest version once irori has exited; this is what
Electron's own `autoUpdater.quitAndInstall` does, called directly so that the
restart happens only after irori's own shutdown has agreed. Releases therefore
also publish Squirrel's full package, `irori-<version>-full.nupkg`, listed in
`SHA256SUMS.txt`. The hourly drift check requires it from 0.1.29.

**macOS.** Electron's updater on the Mac, Squirrel.Mac, accepts an update only
when its signature satisfies the running app's designated requirement. An
ad-hoc signature pins that requirement to the exact build, so no later version
can ever satisfy it. irori replaces its bundle itself instead, from the same
disk image a person downloads. It copies `irori.app` out of the image with
`ditto` into a hidden `.irori-update` folder beside the installed bundle, so the
final rename never crosses a volume. It then checks that `codesign --verify
--deep --strict` passes, that the identifier is irori's and that the version is
the published one. At restart, two renames swap the bundles, each undone if a
later step fails. A detached shell waits for irori to exit, opens the new bundle
through Launch Services and removes the previous one. A bundle that macOS
translocated, or one in a folder irori cannot write, is offered the installer
instead.

Neither `electron-updater` nor `update-electron-app` is adopted: both rely on
Squirrel.Mac for the Mac, which cannot accept these signatures, and Windows needs
nothing beyond the Squirrel installation it already has.

## Trust and limits

An in-app update trusts what a browser download already trusts: TLS to
`github.com` and the release's own `SHA256SUMS.txt`. It adds no signature. A
replaced release could deliver a harmful update either way. A signing identity
(Authenticode, Developer ID with notarization, or a key for update manifests)
would close that gap. Each needs the separate authorization that signing
identities require.

A file irori downloads carries no quarantine attribute, so the Mac does not ask
the person to approve the new version again after the first installation. The
kernel still checks every executable's signature, and irori verified the whole
bundle before swapping it in. macOS's App Management protection can refuse to
let an app modify an app bundle. Reports from other ad-hoc signed apps that
replace themselves this way show no refusal, but the owner's macOS 26 device
has to confirm it. A refusal is reported with the System Settings route and the
installer as the alternative, and the installed bundle stays in place.

Versions up to 0.1.28 cannot update themselves: 0.1.29 has to be installed once
from the download website. Background downloads, a switch to turn automatic
checks off, delta packages, rollback to an earlier version and Linux packages
are not part of this decision.

The mechanics and their evidence are in [UPDATES](../UPDATES.md).
