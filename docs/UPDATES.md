# In-app updates

Date: 2026-09-23, from 0.1.29. The owner asked for an installed irori to update
itself with one button, as the Codex and Claude desktop applications do.
[ADR 010](decisions/010-in-app-updates.md) records the decision and its trust
limits.

## What the person sees

The startup screen and the workspace sidebar show **更新を確認** under the
version. An installed irori also checks by itself 10 seconds after it starts and
then hourly. When a newer version is published, the same place shows
「0.1.x を利用できます」 with the installed and published versions, whether or
not anyone pressed the button.

**更新して再起動** then does everything:

1. It downloads the release's package, showing the percentage and megabytes, and
   offers **キャンセル** while the download runs.
2. It checks the file and prepares the new version (「確認して準備しています」).
3. It closes irori as the window's close button would and opens the new version.
   Drafts are saved first. A running agent or terminal asks
   「停止して再起動しますか？」, and a Git operation in progress has to finish.
   If the person stays, **再起動して更新** remains and nothing is downloaded again.

When the update cannot be applied, the notice says why and keeps
**インストーラーを取得** and **変更点を見る**, which open the release in the
browser as before. That covers an unsupported way of running irori (a
development run, a copy Squirrel did not install, a Mac bundle that was never
moved out of the disk image or Downloads folder, or a folder irori cannot write),
a release without the files an in-app update needs, and a download or
preparation that failed. A failed attempt also offers **もう一度更新**. An
automatic check that fails or finds nothing stays silent. A check the person
asked for always reports its result.

## How the update is applied

The host keeps the whole procedure. The renderer can ask for the state, start
the update of the version the latest check offered, cancel a download, and ask
for the restart. It never supplies a URL or a path.

- **Download.** Only the file for this platform is fetched: on Windows,
  Squirrel's full package `irori-<version>-full.nupkg`, and on the Mac, the disk
  image `irori-<version>-macos-arm64.dmg` a person would download. GitHub answers
  with redirects to its download host; each hop must be HTTPS without
  credentials, and at most five redirects are followed. The bytes are streamed to
  `<userData>/updates`, hashed as they arrive, and must match the size the
  release publishes and the SHA-256 in its `SHA256SUMS.txt`. A server that keeps
  sending past that size is cut off, and a download that receives nothing for
  60 seconds is abandoned. The folder is removed after staging or failure and
  again at the next start.
- **A lagging release list.** From 0.1.30, a release newer than the installed
  one that the public list names without files is read again from
  `/releases/<id>/assets`, at most three per check. After 0.1.29 was published
  the list served it without files for over half an hour while that endpoint
  listed every file. `release.yml` also keeps a release a draft until all files
  are uploaded and publishes it 30 seconds later.
- **Windows.** irori writes a `RELEASES` file naming the package with its SHA-1
  and size, which Squirrel checks again, and runs `Update.exe --update` on that
  folder. Squirrel installs the new version beside the running one; irori
  confirms that `app-<version>\irori.exe` exists. The restart starts
  `Update.exe --processStartAndWait irori.exe`, which opens the newest version
  once irori has exited. Squirrel keeps the previous version's folder until the
  next update, as with any Squirrel application.
- **macOS.** irori attaches the disk image read-only and copies `irori.app` with
  `ditto` into `.irori-update/irori.app` beside the installed bundle, then
  detaches it. The copy must pass `codesign --verify --deep --strict`, carry the
  identifier `io.github.deltaiseiozaki.irori` and report the published version
  in `CFBundleShortVersionString`. At restart the installed bundle moves to
  `.irori-update/previous.app` and the copy takes its place; a failure in either
  rename, or in starting the relaunch, puts the running bundle back. A detached
  `/bin/sh` waits for irori's process to exit, runs `open` on the bundle and
  removes `.irori-update`.

## Evidence

- `tests/updates.test.ts` covers which release and file are offered, the
  per-platform package, missing files, the redirect and HTTPS rules, a wrong
  checksum, size or length, a server that keeps sending, cancelling, a stalled
  download, failed preparation, the automatic schedule and cleanup. Mutating the
  checksum comparison, the HTTPS rule, the streaming size bound or the removal of
  downloads makes a test fail.
- `tests/update-installers.test.ts` drives both installers with recorded
  commands on real directories: the Squirrel feed and arguments, an `Update.exe`
  that fails or applies nothing, the Mac staging order, refusal of another app, a
  wrong version or a broken signature, each rollback, and the relaunch script
  itself, which waits for a live process before opening and cleaning up.
- `scripts/updates-ui-smoke.ts` renders the notice in Electron: the automatic
  offer without a click, progress and cancel, preparation, a declined and a
  refused restart, failure with its retry and installer, the browser-only case
  and every manual check result.
- `scripts/package-smoke.ts` confirms the packaged preload exposes the update
  state. `scripts/update-package-smoke.ts` runs after it in the Windows and Mac
  package jobs, with the build CI just made. On Windows it installs the Setup.exe
  for the runner's user, makes that installation look older, applies the
  `-full.nupkg` through the real `Update.exe`, and watches `--processStartAndWait`
  start the new version after its parent exits. On the Mac it copies the built
  bundle into a temporary `Applications` folder, stages the disk image with the
  real `hdiutil`, `ditto`, `codesign` and `plutil`, swaps the bundles, and sees
  Launch Services open the new one and the previous one removed.

## Not verified yet

CI runners are not the owner's devices. The first real update is from 0.1.29 to
the next published version, on the Windows 11 and macOS 26 acceptance machines.
That trial should confirm three things: the Mac's App Management protection
allows the swap without a prompt; the Mac opens the new version without asking
for approval again; and Windows keeps the Start menu and taskbar shortcuts
working after Squirrel's update.
