# Checkpoint — 0.1.6 and 0.1.7 preview deliveries

## 0.1.7, the first release under the sync checks

Session of 2026-09-17, later the same day. Another session merged #33 at
05:39Z; it reworked KB skill loading and bundled the `yaml` library. #34 then
put the sync checks on `main`. #35 carried version 0.1.7 and its notes, and
`release-sync.yml` reported on that pull request that it would publish as
`v0.1.7-preview.1`.

- [Release run 35191670664](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35191670664) published
  [v0.1.7-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.7-preview.1) at 06:52Z from the
  artifacts of [CI 35190936323](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35190936323) for `e2ed6a7`.
  The notes held prose only. The workflow appended the **Exact package**
  section itself, the first live use of that step:
  - Windows installer: 322,444,288 bytes, SHA-256
    `a16193eeaec11fd7fb80af577156549217aed3788039167bc5d6a726a514f9e9`.
  - Mac disk image: 284,134,321 bytes, SHA-256
    `25de3c44620264dfb52c654442830a479d43b72627c2c56f791bd0216f17bc64`.
- At 06:53–06:54Z, anonymous downloads of both installers and `SHA256SUMS.txt`
  returned HTTP 200. The byte counts matched, and `sha256sum -c` passed.
- #36 pointed the manifest at the release. [Pages run 35192591714](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35192591714)
  deployed it, and the live page's bundle offered `v0.1.7-preview.1` at 07:04Z.
- The first run of the drift job on `main`, [release-sync run 35192736067](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35192736067),
  dispatched by hand, reported `main` in step with `v0.1.7-preview.1`. It found
  both installers and `SHA256SUMS.txt` on the release and the release on the
  live page.

Publication came 73 minutes after #33 merged, past the 60-minute grace period.
The drift check was not yet on `main` when #33 merged. Its hourly schedule had
not fired by the time the release was out, so nothing flagged the delay.
Publishing by hand needs two CI cycles, one for the version change and one for
the manifest, which leaves little margin inside an hour. Automatic publication
is the remaining step.

## 0.1.6, the catch-up

Session of 2026-09-17. The owner asked that `main` and the published preview
stay in sync from now on. They chose automatic publication, introduced in stages,
and gave standing authorization for agents to publish a preview after an
authorized merge. This checkpoint records the catch-up delivery,
`v0.1.6-preview.1`, for Windows x64 and Apple silicon Mac. The owner also
reported that the Mac `v0.1.5-preview.3` launches on their MacBook. They have
used it only lightly, so the rest of the installed-Mac trial is still open.

## Published

- [v0.1.6-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.6-preview.1), a prerelease
  targeting `42d6eb72eae446d478bd79989dd81aa890ab7e35`, the 0.1.6 version change
  (#30). [Release run 35180997636](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35180997636) created it from
  the artifacts of [CI 35179494206](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35179494206).
- `irori-0.1.6-windows-x64-Setup.exe`: 322,288,128 bytes, SHA-256
  `392a1bca2f42ad842ecb36e09979db6080052cc0462e485f757ef28887d096eb`.
- `irori-0.1.6-macos-arm64.dmg`: 283,886,432 bytes, SHA-256
  `597403e13c6d837de4871eace4d029177a2f9e3e934b3eeb22fcb4f37f464311`.
- `SHA256SUMS.txt`, `windows-package-evidence.json` and
  `macos-package-evidence.json` accompany them. Both evidence files report
  runtime version `0.1.6`.
- [Pages run 35181102993](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35181102993) deployed website commit
  `1dd5b62`. The live page's bundle links only to this release's two installers
  and its notes.
- At `2026-09-17T04:15Z`, an anonymous `https` download of each installer and of
  `SHA256SUMS.txt` returned HTTP 200. The byte counts matched, and
  `sha256sum -c` passed for both installers.

Before the release PR, the two installers in that CI run were downloaded and
their sizes and digests matched against each package job's evidence. The notes,
README rows and manifest were written from those values.

## Keeping main and the preview in step

The package version advanced from 0.1.5 to 0.1.6 instead of publishing a fourth
0.1.5 preview. `src/host/updates.ts` ranks `0.1.5` above every
`0.1.5-preview.N`, so an installed 0.1.5 would never have been offered a newer
0.1.5 preview.

The order used:

1. Merge a version change.
2. Let `main`'s CI run for that merge finish.
3. Commit notes, manifest and README rows with that run's exact values.
4. Dispatch `release.yml` with the run id, then `website.yml`.
5. Download anonymously and verify.

While step 2 runs, do not push to `main`: `app.yml` cancels an in-progress run on
the same ref, and the tested artifacts would be lost.

Automation is not implemented yet. Astra (Codex, `gpt-6-astra`) was consulted
read-only. It recommended release-ready PRs, a release-relevance and drift check,
then automatic publication after `main`'s CI with a generated website manifest.
That is the next engineering step.

## release.yml's first run

The workflow had never run; every earlier release was assembled by hand. Three
defects were found and fixed in #31 before dispatch. Run 35180997636 confirmed
each fix:

- The depth-1 checkout could not resolve a tested commit behind `main`'s tip.
  With full history, `42d6eb7` passed the ancestry check behind tip `1dd5b62`.
- The release had no title. It now takes the notes' first heading.
- Evidence files were named after runner platforms. They are now
  `macos-package-evidence.json` and `windows-package-evidence.json`, as on
  earlier releases.

## Still open

- Installed-device acceptance for 0.1.6 on Windows and the Mac: installation, the
  update check offering 0.1.6 to an installed 0.1.5, Japanese input, native CLI
  accounts, Git operations and Google connections.
- The staged automation above.
- Developer ID signing and notarization, Google writes, and the other gates in
  [RELEASE-PLAN](RELEASE-PLAN.md).

User KB and device data were not touched.

## Checkpoint — Mac 0.1.5 delivery

Session of 2026-09-16. The owner asked for the Mac build to be downloadable, and
later asked for Intel Mac to be removed as a target. Both are done and public.
**What is not yet known is whether the published build starts on the owner's
machine.** That single answer is the next thing this work needs. *(2026-09-17: the
owner reported that it launches; see the 0.1.6 checkpoint above.)*

## What the owner has to do next

Install
[v0.1.5-preview.3](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.5-preview.3)
on the MacBook M5 Pro, after deleting any earlier `/Applications/irori.app`
— an earlier copy may have been re-signed by hand during diagnosis — and report
whether it opens, then the displayed version, Japanese input, native CLI
accounts and Git operations. Two answers are outstanding from the previous
attempt: whether `codesign --force --deep --sign - /Applications/irori.app` made
the broken build start, which would independently confirm the diagnosis, and the
exact wording of the first-launch dialog on macOS 26.7, which the page currently
describes rather than quotes.

## The delivery, and the build that did not run

The section below this one recorded `v0.1.5-preview.2` as a completed delivery.
That was wrong, and the correction is the useful part of this checkpoint. The
package was signed, verified, published, downloaded and hash-checked, and it
could not start on the machine it was published for. From the owner's device,
macOS 26.7 arm64:

```
dyld: Library not loaded: @rpath/Electron Framework.framework/Electron Framework
  Reason: ... code signature ... not valid for use in process:
  mapping process and mapped file (non-platform) have different Team IDs
```

That is library validation, which the hardened runtime enforces. It requires
every library a process loads to carry the main executable's Team ID, and an
ad-hoc signature has none, so macOS refused to let irori load its own framework.

Two failures of verification let that reach a download.

1. **The runner did not match the target.** The Mac package job ran on
   `macos-15` while [ADR 002](decisions/002-release-and-workspace.md) names a
   macOS 26 acceptance device. That job launched the package and drove node-pty
   and bundled rclone — on an operating system that does not enforce this. A
   package job is evidence about the operating system it ran on; an older runner
   is not verification of the published target.
2. **An assertion locked in the broken state.** After finding that
   `osxSign.hardenedRuntime: false` never reaches codesign, the flag's presence
   was asserted rather than questioned, reasoning that it must be harmless
   because the runner launched the build. That inverted the check: it would have
   failed the fix and passed the crash.

[PR #23](https://github.com/DeL-TaiseiOzaki/irori/pull/23) disables the hardened
runtime through the `optionsForFile` callback, asserts the flag absent, and
moves the Mac package job to `macos-26`.

## Published

| tag | asset | bytes | SHA-256 |
| --- | --- | --- | --- |
| [v0.1.5-preview.3](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.5-preview.3) | `irori-0.1.5-macos-arm64.dmg` | 283,865,020 | `8fe20a9fe5eac6ca644bf7c0d366da1ee9c20c62a9c47df51b64fd39a9ab2fc0` |
| [v0.1.5-preview.2](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.5-preview.2) | `irori-0.1.5-windows-x64-Setup.exe` | 322,282,496 | `8eed9c059628d8461e1a90912172cf3486cabca35569af636166afa2a883ccea` |

The Mac image comes from
[CI 35068768535](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35068768535)
for application source `7e45b2aeb9e815720250d83e92d1d943f246925f`, published
unchanged except for its download filename. Its digest is identical in four
places: the `package-smoke.json` that run recorded while testing the package, the
local copy taken from the artifact, GitHub's uploaded-asset digest, and an
anonymous `https` download of all 283,865,020 bytes, which also matches the
release's `SHA256SUMS.txt`.

Only the Mac installer was republished. The Windows installer is the same
application code and stays at `v0.1.5-preview.2`; rebuilding it would give
Windows readers different bytes to re-verify for nothing. The manifest therefore
points its two slots at two tags, and the release-evidence link follows the newer
notes, which say so.

On macOS 26, the package job recorded the same result for the built bundle and
for the copy inside the disk image: identifier `io.github.deltaiseiozaki.irori`,
an ad-hoc signature, **no hardened runtime flag**, `valid on disk`, `satisfies
its Designated Requirement`, and `spctl: rejected`. The last line is the expected
verdict for unnotarized code and is recorded rather than asserted, because it
describes what a reader meets: an unverified-developer refusal that System
Settings clears once. That step is documented on the page, in the release notes
and in both READMEs.

Website commit `377877eb0c9d85211e9ba06832d5809412a2a4ae` is deployed by
[Pages 35076994342](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35076994342)
at `2026-09-16T09:01:55Z`. A fresh browser loaded the public page and observed
`v0.1.5 開発プレビュー`, both downloads linked at their published sizes, the
first-launch text, release evidence pointing at `v0.1.5-preview.3`, and no page
errors or failed requests.

## Intel Mac removed

The owner decided irori will not target Intel Macs, so
[PR #25](https://github.com/DeL-TaiseiOzaki/irori/pull/25) removes the mechanism
rather than leaving a disabled card: the `macos-x64` field is gone from the
manifest schema, the key from the manifest, the card from the page, and the
third column from the grid. The browser fixtures still exercise a partially
released manifest, now with Windows published and the Mac download unavailable.
The page and both READMEs say Intel Macs are not supported instead of calling
them unpublished. ADR 002 records the decision and supersedes its own earlier
line, which had treated an Intel download as awaiting acceptance evidence.

## Releases no longer pass through a workstation

`.github/workflows/release.yml` is manually dispatched and takes a run id, a tag
and which installers to publish. It refuses a run that did not complete
successfully, a commit that is not an ancestor of `main`, a tag that is
malformed or already exists, and missing release notes; it publishes only the
installer each package job recorded, matching size and digest before and after
renaming. Write access is scoped to that one job, and `app.yml` stays read-only.
It has not been exercised yet — every release so far was assembled by hand, which
is what prompted it — so its first real use needs watching.

## Still open

Installed-Mac acceptance is the blocker described above. Developer ID signing and
notarization remain separate work and will require turning the hardened runtime
back on, which needs its own device verification rather than a CI result. Google
connections remain read-only, and no real mount has been observed on a Mac. The
remaining release gates in [RELEASE-PLAN](RELEASE-PLAN.md) are unchanged. User KB
and device data were not touched.

## Checkpoint — Apple silicon Mac 0.1.5 delivery (superseded)

The record below described `v0.1.5-preview.2` as a completed delivery. Its
evidence about signing, publication and the deployed page is accurate; its
conclusion is not. That build does not start on macOS 26, for the reason given
above. Retained as the history of how the first Mac download was produced.

Completed public delivery, 2026-09-16: the owner asked for the Mac build to be
downloadable. It was not a manifest edit. Every Mac package Forge had produced
carried no bundle signature at all — zero `_CodeSignature` entries, with Mach-O
members still identifying themselves as `Electron` — which Gatekeeper rejects as
a damaged application once a browser download attaches the quarantine attribute.
Publishing that file would have handed the owner something that cannot be opened
and offers no way to continue.

Three merged changes precede the release. [PR #18](https://github.com/DeL-TaiseiOzaki/irori/pull/18)
ad-hoc signs the bundle during packaging, forces `continueOnError` off so a
signing failure fails the build, and verifies the signature of both the built
bundle and the copy inside the disk image. [PR #19](https://github.com/DeL-TaiseiOzaki/irori/pull/19)
replaces the update check's hardcoded Windows x64 target with one published
installer name per target. [PR #20](https://github.com/DeL-TaiseiOzaki/irori/pull/20)
removes a `hardenedRuntime: false` setting that never reached codesign — the
signing library takes per-file options only from an `optionsForFile` callback —
and asserts the flag the published binary actually carries.

[Native CI 35063963103](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35063963103)
passed verification and all three package platforms for application source
`f20b6839107e149ed49d4ffdc125cbbeaec144dc`. [Release v0.1.5-preview.2](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.5-preview.2)
publishes that run's artifacts without rebuilding or modifying them; only their
download filenames changed.

The Mac disk image is **285,660,156 bytes (272.4 MiB)** with SHA-256
`8a674433b44299714ac191758a733f42a7afcfcc362cdf051fa893b0b9b24136`. The Windows installer is **322,282,496 bytes (307.4 MiB)** with
SHA-256 `8eed9c059628d8461e1a90912172cf3486cabca35569af636166afa2a883ccea`. Each digest is identical in four places: the
`package-smoke.json` CI recorded while testing the relocated package, the local
copy taken from the CI artifact, GitHub's own uploaded-asset digest, and an
anonymous `https` download of all 285,660,156 bytes at `2026-09-16T06:43Z`
(HTTP 200), which also matches the release's `SHA256SUMS.txt`. Only the two
installers, their checksum file and the two package evidence files are attached.

The Mac package job recorded the same result for the built bundle and for the
bundle inside the disk image: identifier `io.github.deltaiseiozaki.irori`, an
ad-hoc signature, the hardened runtime flag, `valid on disk`, `satisfies its
Designated Requirement`, and `spctl: rejected`. That last line is the expected
verdict for unnotarized code and is recorded rather than asserted, because it
describes exactly what a reader meets: an unverified-developer refusal that
System Settings can clear once. The page, the release notes and both READMEs
document that step.

Website metadata moved to `v0.1.5-preview.2` in [PR #21](https://github.com/DeL-TaiseiOzaki/irori/pull/21),
merged as `1f9eec6a4ff1d423cb0351116ca9a35e75962844`, and [Pages 35065906414](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35065906414)
deployed exactly that revision at `2026-09-16T06:55:40Z`. A fresh browser then loaded the
public page and observed `v0.1.5 開発プレビュー`, the Windows card linking
`irori-0.1.5-windows-x64-Setup.exe` at `v0.1.5 · 307.4 MiB`, the Apple silicon
card linking `irori-0.1.5-macos-arm64.dmg` at `v0.1.5 · 272.4 MiB`, the Intel
Mac slot still disabled, the first-launch approval text, release evidence
pointing at `v0.1.5-preview.2`, and no page errors or failed requests.

Both slots point at one release so that the page, the notes and the update check
describe the same bytes. The Windows installer is a rebuild of unchanged
application source, so a reader already running 0.1.5 does not need to
reinstall, and preview iterations of an installed version are not advertised as
upgrades.

No installed-Mac result is implied: installation, the approval step, Japanese
input, native CLI accounts, Git operations and Google mounts on the MacBook M5
Pro remain the owner's device trial. Ask for the displayed version after they
install. Developer ID signing and notarization, Intel Mac packaging and the
remaining release gates are unchanged. User KB and device data were not touched.

## Checkpoint — Windows 0.1.5 delivery

Completed public delivery, 2026-09-15: the owner authorized publishing the
already merged daily-recovery work, whose earlier continuation had deliberately
stopped before release. [PR #5](https://github.com/DeL-TaiseiOzaki/irori/pull/5)
merged application source as `278f5a407e270752057dbe4a10574a9450644934`.
[Native CI 34853768104](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34853768104)
passed verification and all three package platforms for exactly that commit.
Its Windows artifact was published without rebuilding or modifying the EXE; only
its download filename changed. [Release notes](releases/0.1.5-preview.1.md)
record the source commit, the CI run and the package limits.

The published installer is **318,439,424 bytes** with SHA-256
`847985f585977d596fb20605caa480c1b88b4dbb98745f8a96bf34e4d9a63491`. That hash is
identical in three places: the `package-smoke.json` CI recorded while testing the
relocated package, the local copy taken from the CI artifact, and an anonymous
`https` download of all 318,439,424 published bytes at `2026-09-15T03:12Z`
(HTTP 200), which also matches the release's own `SHA256SUMS.txt`. Only that EXE,
its SHA-256 file and the package evidence are attached.

Website metadata moved to `v0.1.5-preview.1` in
[PR #7](https://github.com/DeL-TaiseiOzaki/irori/pull/7), merged as
`4aa79c766c76eae557c091a9e03773e1e6c6bb36`, and
[Pages 34896164099](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34896164099)
successfully deployed exactly that revision at `2026-09-14T21:00:31Z`. A fresh
browser then loaded the public page and observed `v0.1.5 開発プレビュー`, the
Windows card linking `irori-0.1.5-windows-x64-Setup.exe` at `v0.1.5 · 303.7 MiB`,
both Mac slots still disabled, and no page errors or failed requests.

The page's release-evidence link is now taken from the manifest instead of
separately edited markup: the previously published page had been left pointing at
`v0.1.3-preview.1` while its download slot already served 0.1.4. It now resolves
to the published `v0.1.5-preview.1` notes, the `noscript` fallback points at the
releases index, and both the schema and the browser smoke check that a published
version always names its notes. The shipped manual update check was also run
against the live endpoint as a 0.1.4 Windows x64 install: it reports 0.1.5 as
available with the exact release and installer URLs it requires.

No installed Windows 0.1.5 result, upgrade-from-0.1.4 result, Google
consent/mount result or real model turn is implied. Ask for the displayed
version after the owner installs the update. User KB and device data were not
touched.

Completed public delivery, 2026-09-14: the owner authorized merging the daily
workflow PR and publishing the Windows update. [PR #2](https://github.com/DeL-TaiseiOzaki/irori/pull/2)
merged application source as `e72a62b53950b2ddb3f9132f4e66f341a74f80fc`.
[Native CI 34841807049](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34841807049)
passed verification and all three package platforms. Its PR-merge tree exactly
equals that merged source; the Windows EXE was not rebuilt or modified for
publication. [Release notes](releases/0.1.4-preview.1.md) record both commits,
the common tree and the package limits.

[PR #3](https://github.com/DeL-TaiseiOzaki/irori/pull/3) merged the download metadata
as `e32ed4e5aca7f4415f0f3e3e4008a44ba9caa703`.
[Pages 34843640838](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34843640838)
successfully deployed that exact website revision. At
`2026-09-14T12:31:36.870Z`, a fresh anonymous desktop/mobile browser downloaded
all **318,426,624 bytes** of `irori-0.1.4-windows-x64-Setup.exe` from the public
page. SHA-256
`ffaa1ba1afc3ee358af1aee55860cca83fc294d69819907d277de6c5424de16b`
matches native CI, the renamed local file and GitHub's release-asset digest.
There were no page/HTTP errors, and both Mac download slots remain disabled.

No installed Windows 0.1.4 result, Google consent/mount result or real model
turn was supplied. Ask for the displayed version and the original paste/edit
steps when the owner tests the update. The original installed version remains
unknown. User KB/device data and the old VM preview were not reset or restarted.
The entries below retain their historical source/publication evidence.

Verified and pushed application source, 2026-09-14: `54eeee41b6c93d44297e5896613c70b0b271e9b0`. [CI 34776177942](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34776177942) passes verification and all three native package jobs, including relocated package smoke. Local build, 78/81 behavior tests (three optional skips), all nine UI suites and documentation-link checks pass. The later documentation-only checkpoint updates [the continuation prompt](HANDOFF-PROMPT.md). Public installer/site, neighboring repositories and `.local/vm-preview/{samples,device}` remain unchanged.

Development continuation after `1afe3bb`, 2026-09-14: [source/artifact navigation](KNOWLEDGE-NAVIGATION.md) adds record search, current-file resolution/opening, explicit matching-version reconnection and version-specific reverse links. This advances D06 using the existing private record store; shared portable identities and general KB search remain open. Continue from current main and the latest [HANDOFF](HANDOFF.md). The Windows 0.1.3 public installer, Google read-only scope and native-model/device acceptance boundaries remain unchanged.

Local evidence for this continuation: production build, 78/81 behavior tests with three optional native-control skips, all nine Electron suites and changed-document local links pass. Source-location identity, wrong-version/copy/alias rejection, cross-workspace navigation guards, reverse links and restart are covered with disposable files and no model inference. No new package/release/device result is implied by these checks.

Owner-requested checkpoint, 2026-09-14: the repository was clean at `c43419ac43af9efd8da89f3e9c262928f7e09ffc`, matching remote main. Application source remains `9d79182`; its recorded CI was rechecked as successful on all three package platforms. This documentation-only checkpoint adds a [copyable continuation prompt](HANDOFF-PROMPT.md). No application change, new release or device/model acceptance was added. Validation for checkpointing is documentation-link/Git-reference checking and `git diff --check`; prior runtime evidence is retained without rerunning the suites.

Verified source checkpoint, 2026-09-14: `9d79182e33eab11d1fcdff96d9d3961cf61ef3ee` is pushed and [CI 34773932413](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34773932413) passes verification plus Linux x64, Windows x64 and Mac arm64 packaging. The latest [HANDOFF](HANDOFF.md) records continuation priorities and remaining acceptance. Publication remains the earlier Windows 0.1.3 preview; source changes and short-lived CI artifacts are not a new release.

Development continuation, 2026-09-14: [conversation recovery](CONVERSATIONS.md) is implemented after source checkpoint `2c9396a`. Local build, 75/78 behavior tests (three optional skips), all eight Electron suites, Linux packaging and relocated package restart/queue smoke pass. Source and device-local metadata changes do not alter the published 0.1.3 installer. Resume from current main and the latest [HANDOFF](HANDOFF.md); Google/device/model and full-release gates remain open.

Final delivery checkpoint, 2026-09-14 JST: [Pages run 34764740194](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34764740194) successfully deployed website commit `44bcd2bc8cf682cca257cee54a9dbe837cb4b601` to [the download site](https://del-taiseiozaki.github.io/irori/). At `2026-09-13T15:10:49.647Z`, a fresh anonymous desktop/mobile browser downloaded all **318,416,896 bytes** of the Windows 0.1.3 installer and matched SHA-256 `c6099224db0b6137824088e19e43976d573d823af150ead5350be7b6312f442d` with the native CI/release evidence. No page/HTTP errors occurred; both Mac downloads remained disabled. Application source is `9b04ed2`; implementation/follow-up commits and the publication commit are pushed. This final documentation-only commit records the completed delivery.

No Windows device/Google/IME/upgrade result was supplied, and no real model test was authorized or executed. Read-only Google access, complete-release gates, untouched neighboring repositories and preserved `.local/vm-preview/{samples,device}` data remain explicit boundaries. Continue from current main using [implementation details and remaining work](EDITING-AND-RECORDS.md), rather than repeating OAuth setup or the completed editor/Git/queue work.

Published update, 2026-09-14 JST: [Windows preview 0.1.3](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.3-preview.1) contains application commit `9b04ed263b88b4754d03c7b79ab78816f0d73b06`. [Native CI 34764163901](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34764163901) passes verification and Linux x64, Windows x64 and Mac arm64 packages, including continuous editor save/image rendering and the existing configured OAuth handoff/cancellation. The unchanged CI EXE is **318,416,896 bytes (303.7 MiB)**, SHA-256 `c6099224db0b6137824088e19e43976d573d823af150ead5350be7b6312f442d`; GitHub's uploaded-asset digest matches. The website manifest now selects 0.1.3 and both Mac slots remain disabled. Pages deployment and anonymous delivery are recorded in the following checkpoint update.

Continuation after `d1b828c`: source version `0.1.3` addresses image paste, continuous document editing, bulk Git staging and queued conversations. It adds device-local source/run/artifact records and durable cloud-send preparation with an rclone delivery-engine test; Google remains read-only. See [implementation and limits](EDITING-AND-RECORDS.md). No new device result or real model permission was supplied. Native preview publication is recorded separately below when verified.

Local validation for this continuation: production build passes; 72 behavior tests ran, 69 passed and three optional native provider controls were skipped. All eight Electron suites and website real/mixed/available/unavailable fixtures pass. Actual rclone copy/hash verification used only disposable local directories. No real model inference, Google consent or native mount was performed. The VM preview and its samples/device data were not restarted or modified.

Handoff checkpoint, 2026-09-13: the owner acknowledged delivery and requested checkpointing and a continuation prompt. No new Windows 0.1.2 or Google consent/mount result was reported; "OK" is not acceptance evidence. The source tree was clean at `dc53e52` before this documentation-only follow-up. The 0.1.2 release remains public, and both recorded CI/Pages runs were rechecked as successful. [HANDOFF](HANDOFF.md) consolidates the current state, confirmed decisions, existing authorization, next priorities, test commands and protected local data. No application code, credentials or deployed bits changed during checkpointing.

Current follow-up, 2026-09-13: the owner reported completing the Google desktop client setup and registering both repository secrets. Secret names/update timestamps were verified without reading their values. The owner also declared broader Drive permissions for future writing; irori still requests only `drive.readonly` and its mounts remain read-only. Version `0.1.2` is the first configured Windows testing preview. [DISTRIBUTOR-GOOGLE](DISTRIBUTOR-GOOGLE.md) records this boundary; no external Google project/account settings were changed by the agent.

Validation: implementation commit `b51a54b1f9fb36423edf56ed6a1bec961839e165` passes [native CI run 34761095540](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34761095540) on Windows x64, Mac arm64 and Linux x64. Build, 64/67 behavior tests (three optional native provider controls skipped), eight UI suites and website fixtures pass. Copied packages verify note/terminal Japanese file saves, CSV graphs, SDK imports, bundled rclone, compiled-client account startup and cancellation. The configured OAuth check intercepts browser opening, follows only rclone's local redirect and asserts the Google authorization destination/read-only scope with fixed boolean diagnostics. It stops before Google consent. Local packaged tests used synthetic settings; CI used the registered repository secrets. No client values, authorization URLs or account tokens enter logs/evidence. No model inference or real Google consent/refresh/native mount occurred.

Delivery: [Windows preview `v0.1.2-preview.1`](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.2-preview.1) targets that exact application commit. The unchanged CI EXE is renamed `irori-0.1.2-windows-x64-Setup.exe`, **316,222,976 bytes (301.6 MiB)**, SHA-256 `b3cb5c71cb8311ad9043ad79e31632254ab8169d0b1e7de1412d41979f5012bd`. GitHub's asset digest matches. Its attached package evidence records `oauthConfigured: true` and passing handoff booleans, plus the separate missing-WinFsp prerequisite on the Windows runner. [Pages run 34761649567](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34761649567) deploys website commit `94bc9ce3caa9bc71ef5b6a3975283ddb8f14b7c5` to [the public site](https://del-taiseiozaki.github.io/irori/). At 2026-09-13 14:07 UTC, a fresh unauthenticated desktop/mobile browser clicked the Windows link, downloaded every byte and matched that hash with no page/HTTP errors. Both Mac downloads remain disabled. [Preview notes](releases/0.1.2-preview.1.md) describe the setup and limits. Local verification artifacts remain ignored under `.local/publication/`.

Next: install the new Windows build, install/recheck WinFsp as needed, and use the workspace Google Drive connection to complete real consent, select/read a folder, restart/reconnect and try a second account/shared drive. Google acceptance of the client/account and native mounts remain unverified. Versions 0.1.0/0.1.1 are unchanged and cannot acquire the new compiled settings automatically. D04 durable uploads/scope migration, Windows 11 IME/upgrade/rollback, provider acceptance and full general-release gates remain open. The VM preview and `.local/vm-preview/{samples,device}` were not restarted or modified.

## Earlier preview checkpoints

Terminal/cloud implementation follow-up, 2026-09-13: the owner requested a usable integrated terminal, automatic shell detection and Google connection setup with existing libraries. Internal app version is now `0.1.1`. Added lazy xterm/FitAddon with node-pty, default-shell/which discovery, typed session lifecycle and flow control, native child cleanup and Forge native unpacking. Forge also bundles checksum-pinned official rclone 1.75.1 plus its MIT notice; packaged startup selects that binary independently of PATH. Windows mount prerequisite UI links WinFsp and rechecks installation. Actions supports distributor OAuth repository secrets; [DISTRIBUTOR-GOOGLE](DISTRIBUTOR-GOOGLE.md) describes the required external client setup. No real Google client or consent has been supplied yet; rclone's shared client is being retired and is not used as a fallback.

Implementation evidence: build passes; 67 behavior tests total, 64 passed, three existing optional native provider controls skipped. Both rclone tests use the actual binary, including account-controller browser handoff/cancellation without Google consent. All eight Electron UI suites pass, including actual terminal keyboard input/Japanese file bytes, resize/footer, stop/restart and closure. Native service tests also verify large-output backpressure, Ctrl-C and foreground child cleanup. [Native CI run 34755088101](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34755088101) passes verify and every Windows x64, Mac arm64 and Linux x64 package job at `3d5678cba27cc0fbcae438a6e4bda13e8aff1449`. Copied packages exercise terminal keyboard input/Japanese file creation and bundled rclone startup outside the checkout. Windows uses node-pty's official Node-API prebuilds after an unnecessary Electron rebuild failed to recognize the runner's newer MSVC. See [TERMINAL](TERMINAL.md). No model inference, real Google consent or native mount acceptance occurred.

Published follow-up: [Windows testing preview 0.1.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.1-preview.1) carries that exact application commit. The renamed, unchanged CI EXE is **316,222,464 bytes (301.6 MiB)**, SHA-256 `554bf7882b69affac8b2ee227d15e8d6131c4c2a918d3d8faa5e11258c091421`; release assets also include its checksum and native package evidence. GitHub's uploaded-asset digest matches. [Pages run 34755588809](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34755588809) deploys website commit `809c170bf5c06bc7cc16235a9801c2877b11dce8` to [the download site](https://del-taiseiozaki.github.io/irori/). Updated website build/browser fixtures pass. A fresh unauthenticated browser opened the live page at desktop/mobile sizes, kept both Mac downloads disabled, and clicked the Windows link to download all bytes with that same hash; no page/HTTP errors occurred (2026-09-13 11:54 UTC). [Preview notes](releases/0.1.1-preview.1.md) record setup, limitations and identity. Local evidence remains ignored under `.local/publication/`.

Next external dependency: the owner has not yet supplied an irori-owned Google desktop OAuth client or completed Google consent. CI accepts the two repository secrets documented in [DISTRIBUTOR-GOOGLE](DISTRIBUTOR-GOOGLE.md). The public package correctly records `oauthConfigured: false`; its Windows CI runner also lacks WinFsp and receives the installation guidance. Do not report Google login or mounted folders as working based on rclone startup/control tests. The owner can now retry the embedded terminal on Windows 11; hardware IME, installer upgrade/rollback and real cloud/native-agent acceptance remain open. The entries below describe the preceding 0.1.0 preview and earlier milestones.

Windows app feedback, 2026-09-13: the owner supplied a screenshot of the running application and a KB's legacy cloud-connection dialog. This confirms that the Windows app reaches the workspace UI and opens that dialog. It shows two independent blockers: rclone could not start, and distributor Google OAuth is unconfigured. Preview 1 does not bundle rclone; the host searches for its executable on PATH (or an explicit host override). The displayed generic startup failure also covers process errors/early exit, so the screenshot does not prove whether rclone is absent, undiscoverable or unable to run. Installing rclone alone cannot enable Google account creation in this build. Packaged rclone/Windows mount prerequisites and distributor OAuth remain D03 work. New Drive connections belong to the workspace's Drive area; the shown KB dialog manages legacy attachments. Note saving, IME, Git synchronization and real cloud/agent acceptance are still unconfirmed on the owner's device.

Windows device feedback, 2026-09-13: the owner supplied a Windows 11 SmartScreen screenshot for `irori-0.1.0-windows-x64-Setup.exe`, showing an unrecognized app, unknown publisher, and Run/Don't run controls. This is the first reported device download/launch-gate evidence for preview 1, consistent with its unsigned status. The screenshot alone does not confirm installation, application startup, Japanese input, file integrity on the device or native CLI acceptance. Code signing remains D08 work; even a newly signed binary can initially trigger reputation warnings, as explained in [Microsoft's SmartScreen developer guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation). No signing account or Windows security setting was changed.

Publication follow-up, 2026-09-13: the owner asked to publish the download website for their Windows trial. [The public site](https://del-taiseiozaki.github.io/irori/) and [unsigned Windows x64 prerelease `v0.1.0-preview.1`](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.0-preview.1) are live. The release tag points to verified application commit `86839006bc49fd35cdbf58c5ed4998db1adfe0f6`; no desktop application code was changed for publication. Website commit `de0a60b0c6ab15d4e0bba48af985665d5b268fa2` is deployed by successful [Pages run 34753093494](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34753093494). GitHub Pages uses Actions with HTTPS enforced.

Publication validation: application build and 60 behavior tests passed (four optional native controls skipped); website build and actual/mixed/available/unavailable browser checks passed. A fresh unauthenticated Electron browser opened the live HTTPS project page at desktop and mobile sizes, loaded its assets without HTTP/page errors, kept both Mac buttons disabled, and clicked the Windows link to download all 271,884,288 bytes. The downloaded SHA-256 matches the native CI evidence and GitHub asset digest: `b5ec525b85acdd2d8b44f62b0ac5c1fe353e0c0538066cac24fe535794c20ab8`. An independent anonymous HTTP download also returned 200 with the same bytes/hash. This verifies public delivery, not Windows 11 installation. [Preview notes](releases/0.1.0-preview.1.md) record prerequisites, support, package identity and limitations. Local publication artifacts/screenshots are ignored under `.local/publication/` and contain no user KB data.

The owner's publication request is a narrow exception to the previous no-download gate for this testing preview. Full-release D03–D09 and native installed-device acceptance remain open; do not mark the general release complete. Mac downloads, Google account configuration and model inference were not included in this task. Next: collect the owner's Windows 11 installation/Japanese-input results against this exact installer, then continue the full-release work below.

## Application checkpoint before preview publication


Date: 2026-09-13. Continue in this independent repository on `main`. Start with [RELEASE-PLAN](RELEASE-PLAN.md), [PACKAGING](PACKAGING.md), [WORKSPACE-DRIVE](WORKSPACE-DRIVE.md), [ONTOLOGY](ONTOLOGY.md) and [ADR 002](decisions/002-release-and-workspace.md). Inspect Git status/log and the latest CI run before interpreting historical entries below.

Implemented and verified in this continuation:

- Forge EXE/DMG/ZIP packaging, app verification/native package CI, relocated own-executable SDK/save tests, actual package dependency/checksum inventory and website download-state fixtures.
- MIT license; recorded Windows 11 Ryzen 9/x64 and MacBook M5 Pro/arm64 acceptance devices. Q01 is CSV editing/note links with hierarchy/subgraph visualization, constructed by native agents with people. Q02 joins arbitrary independent GitHub KBs and selected Drive folders in a workspace with multiple accounts.
- Workspace-owned Drive storage outside KBs, empty workspaces, optional category selection, two-account UI, preserved legacy attachments, guarded profile deletion and shared read-only cloud browsing. Native Git authentication remains per repository; multiple-account GUI onboarding/acceptance is still open.
- Declared ontology column mappings, CSV table/source mode, hierarchy/subgraph filtering, note links, invalidation and a prepared native-agent setup request. Unknown columns and IDs remain intact; no automatic CSV/Markdown rewrite. Source hashes currently describe saved display revisions, not retained immutable provenance.
- Native package defects fixed: Mac framework-copy links, Windows ASAR paths, canonical renderer trust, inherited Windows PATH and closure after a renderer crash. Root-container smoke uses Chromium's temporary-file shared-memory fallback for the VM's 64 MiB `/dev/shm`; no production launch override was added.

Local evidence: build, 64 behavior tests with all four optional native controls enabled (zero failed/skipped), seven UI suites, Linux make/packaged SDK/Japanese save/CSV graph and website build/browser fixtures pass. The forced-renderer-crash close regression passes. Implementation commit `8683900` is pushed. [CI 34752136969](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34752136969) passes verification and Linux x64, Windows x64 and Mac arm64 packages, including actual SDK imports, Japanese note save, reload, CSV graph and normal shutdown. A subsequent documentation-only commit records this result; it does not change the verified application bits.

Next work, keeping all full-release requirements:

1. D03/D05: distributor OAuth project and real two-account/shared-drive mounts, native GitHub/account/CLI onboarding and authorized real-model acceptance on the user's devices. Build-time OAuth integration is ready; Google config and usable native mounts are absent here.
2. D04: durable staged cloud writes, remote confirmation, interruption/restart recovery and re-consent design. Current permissions/mounts remain read-only.
3. D06: explicit multiple-source selection, durable note/artifact/run IDs, retained exact source versions/snapshots, curation and output provenance/reverse navigation; then search/rename/backlinks/properties. The CSV/graph presentation already exists and should not be reimplemented.
4. D07–D10: native IME/performance/host comparison, credential protection, dependency redistribution review, signing/notarization, upgrade/rollback, new-user acceptance and only then public assets/Pages. Exact minimum OS versions/support contact/publisher route still need release decisions. Legacy Drive transfer and workspace-reference sharing/export remain open.

At the application checkpoint below, commit/push alone was authorized and no public deployment was performed. The subsequent Windows testing preview was separately authorized and published as recorded above; unrelated account changes and real model inference remain outside that authorization. The inherited four release-planning documents were preserved and incorporated. The VM preview and `.local/vm-preview/{samples,device}` were not restarted or modified.

## Historical checkpoint records

The following entries preserve their original verification counts and proposals. Their open Q01/Q02 statements and next-work lists are superseded by the current checkpoint above.

Date: 2026-09-13. This checkpoint includes Git collaboration and the completed implementation reuse audit following UI checkpoint `9c04abb`. The user authorized committing and pushing this work to `origin/main`. Build, 54 tests with all native controls enabled, and all five Electron UI scripts passed. No deployment or release is included. The running VM preview still needs an application restart to load this build.

## Subsequent work

The user then requested completion of all remaining reuse work. The [completion ledger](REUSE-COMPLETION-2026-09-13.md) records the implemented SDK/IPC/queue/metadata/dialog/JSONL changes and the final decision for every alternative. Build, 54 tests with native controls and all five UI scripts pass. These changes are included in this checkpoint; start with this ledger when resuming.

The user subsequently requested implementation of the high-priority reuse findings, favoring simple code. [Git/stream/UI simplification](SIMPLIFICATION-2026-09-13.md) was implemented in the first simplification slice, with build, 46 passing behavior tests (four native controls skipped) and all five UI scripts passing. Read that follow-up and the latest `STATUS.md` before resuming; the research-only audit is historical.

Resumed on 2026-09-13 from `9c04abb`; the user chose GitHub collaboration as the next task. This checkpoint adds the [Git review/commit/sync/clone journey](GIT.md), including native merge conflict review and recovery. Build, 42 behavior tests (four opt-in native controls skipped) and all five UI scripts pass. These additions are included in this checkpoint. Inspect `git status` and `docs/GIT.md` when resuming; the implementation and backlog have progressed beyond the saved UI commit described below.

Checkpoint `2914ec4` was pushed to `origin/main` with user authorization. This follow-up checkpoint adopts the user-selected app icon and applies a modern visual system to startup, the five-pane workspace and assistant; see [UI direction, installed skills and verification](UI-DESIGN.md). The user authorized committing and pushing these changes on 2026-09-13. Build, 30 behavior tests and all four UI scripts passed; four opt-in native probes were skipped. The acceptance boundaries below still apply.

## Confirmed direction

- irori's central requirement is one workspace linking multiple independent GitHub checkouts and multiple selected cloud folders/accounts. Physical repository placement remains undecided; named profiles preserve existing checkout locations.
- Users choose the actual folder name beneath `contents` for each cloud attachment. Provider folder identity remains independent of that name.
- Codex, Claude Code, OpenCode and Pi use their native local harnesses and configuration. Scope boundaries, permissions and conversation bindings remain separate.
- The original irori-extention UI reference is `../irori-extention/images/image2.png`. Its three-row, five-pane navigation is implemented: full-width Schema; personal/team Knowledge Base; personal/team contents. Organization spaces retain explicit labels in the team column. The reference repository/image was not modified by this work.
- The user confirmed that Chrome can open and interact with the preview. This is a UI viewing checkpoint, not acceptance of real Google mounts, all harness capabilities or a finished release.

## Saved implementation

- Named startup workspace profiles with creation, editing and removal; multiple existing-checkout inspection and registration; offline scope-ID retention during profile edits.
- Read-only Google Drive account/folder/shared-drive onboarding, private rclone configuration and authenticated loopback RC, exact provider IDs, mount identity checks, connect/disconnect/rebind, alias rename, attachment removal and unused account removal. Existing local bytes and remote files are preserved by management operations.
- Per-scope/provider native session handles and explicit reset, all four selectable harness adapters, streamed events, native questions/permissions where supported, cancellation and process cleanup. OpenCode/Pi have native control and protocol-fixture evidence; their actual model-turn acceptance remains open.
- Layered explorer with independent pane scrolling/collapse, scope groups, selected-file highlighting, lazy directory reads and per-space note/cloud actions. Root listings are shared across panes; classification and ownership remain host-authoritative. No native instructions are merged across repositories.
- Existing rich/source Markdown editing, save/conflict/recovery behavior, scoped agent context and website/download scaffolding remain available.
- Audit fixes include independent-scope reconnection failures, overlapping polling, missing placeholders, attachment count limits and read-only save shortcuts. See [audit](AUDIT-2026-09-13.md).
- Actual Electron desktop browser preview with persistent sample KBs, noVNC and a Japanese input helper. See [VM preview](VM-PREVIEW.md).

## Verification at this checkpoint

Tests are recorded from completed implementation work; no paid model calls or redundant full suite reruns are needed merely to create this checkpoint.

| Check                                        | Latest evidence                                                                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                              | Passed after the layered explorer change; existing dependency annotation and large-bundle warnings remain                                                                                                                             |
| `npm test`                                   | 30 passed, 0 failed; four opt-in native control probes skipped for the final UI change                                                                                                                                                |
| Native control probes at the preceding audit | All 34 tests passed with real rclone/OpenCode/Pi controls enabled; no Google consent or model inference                                                                                                                               |
| `xvfb-run -a npm run test:ui`                | All four scripts passed: editor/session, cloud protocol fixture, harness protocol fixtures and layered explorer                                                                                                                       |
| Layered explorer fixture                     | Four spaces (personal, two teams, organization), schema isolation, nested contents precedence, same-name note ownership, unsaved-switch protection, AI context, cloud-action ownership, pane collapse and narrower-window AI controls |
| Live browser preview                         | Updated layout inspected, browser login verified; user subsequently confirmed Chrome access and exploration                                                                                                                           |
| Website                                      | Earlier checkpoint's build/browser evidence is historical; website code was not changed during these additions                                                                                                                        |

Codex/Claude real-model evidence also belongs to the earlier milestone. Current OpenCode/Pi controls, seeded session tests and executable fixtures must not be presented as real model-turn or mounted-file acceptance. Details: [STATUS](STATUS.md), [HARNESSES](HARNESSES.md), [LAYERED-EXPLORER](LAYERED-EXPLORER.md), [CLOUD-SETUP](CLOUD-SETUP.md).

## Resume and preview access

1. Read `AGENTS.md`, `README.md`, this checkpoint, `docs/STATUS.md`, `docs/ACCEPTANCE.md` and the relevant implementation document. Inspect `git status` before editing.
2. Stay in the independent irori repository. KB_design is not a monorepo. The sibling reference repositories have not been changed by this implementation; preserve user-owned additions, including the UI image.
3. Inspect the current environment before assuming a preview is running. At pause, the browser viewer was available on VM loopback port 6080. A checkpoint does not recreate running processes, dependencies or ignored device state.
4. Forward port 6080 using the connected VS Code window's Ports view and open its displayed local address in Chrome. The user's embedded browser had shown `ERR_CONNECTION_REFUSED`, while Chrome worked. Use the actual forwarded address if VS Code assigns another local port.
5. Read the password from `.local/vm-preview/password`; it changes on launcher restart and is never stored in this checkpoint. Runtime metadata is in `.local/vm-preview/runtime.json`. Sample notes and edits live in `.local/vm-preview/samples`, and preview device data in `.local/vm-preview/device`; these are ignored and not backed up by the Git commit.
6. If the viewer is stopped, use `npm run preview:vm`. First-time VM setup, including `npm run setup:preview` and OS prerequisites, is in [VM-PREVIEW](VM-PREVIEW.md). A fresh app checkout needs Node 24.15+ (24.x) or 26+, `npm ci`, `npm run setup:electron` and `npm run build`.

For code changes run `npm run build` and `npm test`; renderer changes also require `xvfb-run -a npm run test:ui`. Real-provider inference remains opt-in and must be separately authorized, using disposable KBs. Close irori normally to flush drafts and shut down native services before restarting the preview; refreshing only Chrome does not reload the Electron host.

## Remaining work

The full R01–R12 matrix and sequencing remain in [ACCEPTANCE](ACCEPTANCE.md). Next priorities:

1. Supply deployment Google OAuth configuration and a native mount environment, then verify real consent, multiple accounts/shared drives, failure/recovery and actual mounted paths from every harness. This VM lacks `/dev/fuse` and the deployment OAuth settings.
2. Verify the implemented Git clone/fetch/diff/history/commit/push and native merge flow with live GitHub authentication/branch protections and native platforms; extend remaining branch/rebase/binary-conflict workflows. Cloud write/upload support with durable pending-write recovery, moved-folder and expired-account recovery remain open.
3. Real model turns and native restart/resume for OpenCode/Pi, remaining Codex question/denial gates, native capability parity and transcript redisplay.
4. Offline space relocation/unregistration, note search/rename/backlinks, broad Markdown/IME and scale acceptance, ontology UX (Q01), optional terminal and versioned artifact/source provenance.
5. Native Windows/macOS testing, installers/signing/updating, provider distribution review and performance budgets. Electron remains provisional; no equivalent Tauri comparison is complete. Repository placement policy (Q02) is also open.

Known limits include the narrow external-writer race at save, bounded watcher depth, device-local credentials protected by file permissions rather than OS vault integration, bounded conversation display history (see CONVERSATIONS.md) and unverified native crash/mount recovery. The development container launcher uses its explicit root-only Chromium sandbox exception.

Locate this checkpoint commit with:

```sh
git log -1 --format='%h %s' -- docs/CHECKPOINT.md
```
