# Desktop packaging foundation

Packages the application never loads, 2026-09-22: packaging keeps under
`node_modules` only what the host bundle requires and what those packages
depend on, and the build writes the notices for what Vite bundled. The Linux
x64 `app.asar` falls from 115,078,717 to 21,902,040 bytes and the whole
application directory from 500,379,979 to 407,203,302; the unpacked directory
beside the archive, node-pty and rclone, is unchanged at 89,396,019; measured
on 0.1.19's code, and 21,919,228 and 407,220,490 rebased on 0.1.22. The
packaged dependency inventory goes from 300 packages to 25. No feature is
removed; Windows and Mac packaging drops the same files, and their figures
belong to their own CI jobs.

The kept set is read, not maintained. `scripts/build-host.mjs` builds the host
with esbuild's `packages: 'external'`, so every package the host loads appears
in `dist-host/main.cjs` or `preload.cjs` as `require("name")` or
`import("name")`. `packageAfterPrune` in `forge.config.cjs` reads those two
files, takes each bare specifier's package — fourteen: the Agent SDK, the
OpenCode SDK, chokidar, cross-spawn, default-shell, electron-squirrel-startup,
eventsource-parser, node-pty, papaparse, tree-kill, which, write-file-atomic,
yaml and zod — and walks their `dependencies` and `optionalDependencies`
through the copied tree with Node's resolution, nearest `node_modules` first,
so cross-spawn's nested `which@2` stays beside the top-level `which@5`.
Everything else under `node_modules` is removed: 271 top-level packages that
only the renderer's dependency tree reaches — React and React DOM,
lucide-react, Base UI, Milkdown, CodeMirror and Lezer, xterm, React Flow and
dagre, the remark and ProseMirror families — together with what npm installed
as their dependencies but nothing imports (Vue and its compiler, Babel's
parser and types, PostCSS, lodash's types), and npm's `.bin` links, hidden
`.package-lock.json` and Vite's `.vite-temp`, which the copy filter had let
through. Zod and papaparse are used on both sides and stay. Nothing resolved by
path at run time is touched: node-pty's binary, the Agent SDK's files and
OpenCode's `dist/v2/client.js` sit inside kept directories, and `vendor/rclone`
is outside `node_modules`. The renderer's packages are not moved to
`devDependencies`: that would restate the same classification by hand, and
`npm audit --omit=dev` would then stop reporting on code that runs in the
application.

The notices are generated, not listed. `scripts/third-party-notices.ts` is a
Vite plugin that, in `generateBundle`, takes Rollup's module graph, maps each
module under a `node_modules` directory to its package, and emits
`dist/third-party-notices.txt` — 210 entries of name, version, the `license`
field and the text of the package's LICENSE, LICENCE, NOTICE or COPYING files,
282,864 bytes, shipped inside `app.asar` beside the bundle. The graph rather
than the chunks' rendered modules, because a package whose modules only
re-export another's, such as `@milkdown/kit`, is in no chunk yet is what the
source imports; the first draft read the chunks and the package smoke failed on
`@milkdown/kit@7.22.1`. An in-memory build with sourcemaps attributes rendered
code to 202 packages, every one of them named; the other eight are such
barrels or fully tree-shaken modules. `docs/THIRD_PARTY_NOTICES.md` still
describes what ships and how.

`test:package` derives the same host set from the archived bundles and
asserts that each of those dependencies is packaged, that every other
production dependency is not, and that the notices file is present and names
each of the latter at its installed version, beside the existing checks. The
new assertions were seen to fail on the 0.1.19 package (no notices file), on a
build with the removal disabled (`@base-ui/react` packaged) and on a build
whose plugin withheld `react` (`react@19.3.0` missing), and the same run drives
the packaged application through its editor, graph, terminal and both SDK
imports, which is what shows the kept set is the loadable one.

Executables the package never runs, 2026-09-21: packaging removes two sets of
binaries that npm installs on the build machine and irori cannot use. The Linux
x64 `app.asar` falls from 548,291,885 to 115,044,075 bytes, the unpacked
directory beside it from 150,232,996 to 89,572,180, and the whole application
directory from 994,253,996 to 500,345,370 bytes. No feature is removed. Each
platform is now the same weight: the package jobs report 115,044,452 bytes
archived and 89,418,890 unpacked on linux/x64, 115,157,019 and 121,209,642 on
win32/x64 — which keeps its ConPTY prebuild — and 115,058,909 and 92,590,649 on
darwin/arm64. No package carried another platform's binary before this change:
npm installs an optional dependency only where its `os` and `cpu` match, so each
carried one of its own, and Linux two.

The larger set is the Agent SDK's own copy of Claude Code.
`@anthropic-ai/claude-agent-sdk` declares one optional dependency per platform,
each a complete executable of about 220 MB, and npm installs whichever ones
match the machine — on Linux both the glibc and musl builds, 433,217,072 bytes
together. The SDK resolves them only when `pathToClaudeCodeExecutable` is unset,
and `src/agents/service.ts` always passes the reader's own installed `claude`,
so irori never opens the bundled copy; a packaged application could not spawn a
file inside `app.asar` in any case. Removing it also means irori redistributes
no Claude Code executable, which is not MIT licensed — see
[THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md).

The smaller set is node-pty's prebuilds for other platforms. node-pty resolves
`build/Release` first and then `prebuilds/<platform>-<arch>`, so only the
target's own entry can ever load, and the two Windows ones alone are 58 MB that
travelled in every Mac and Linux package. macOS and Linux rebuild node-pty from
source and keep no prebuild; the Windows package keeps `win32-x64`, which is
what the documented Windows configuration uses instead of a second MSVC build.

Both removals run in `packageAfterPrune`, after the production dependency walk
has seen the tree npm installed, and `test:package` asserts both: no
`claude-agent-sdk-<platform>` entry and no prebuild for another platform may
appear in the archive. The same run drives the real terminal inside the packaged
application on every platform, which is what shows the remaining node-pty binary
is the loadable one. `package-smoke.json` now records the archived and unpacked
weight, and the smoke prints it, so each platform's figure is in its own job log.

What remains is reachable code plus the bundled rclone (85.4 MB). Since
2026-09-22 the archive holds the renderer bundle (4.1 MB), the host bundle and
the fourteen packages it loads with their dependencies (zod 6.1 MB and the
Agent SDK 5.1 MB are the largest) — the renderer packages that Forge used to
copy are gone, and the licences their bundling requires ship as
`dist/third-party-notices.txt`. The unpacked directory is rclone and node-pty's
binary, and the rest of the application directory is Electron's own runtime.

macOS signing, 2026-09-16: the Mac bundle is ad-hoc signed while packaging.
Until now `packagerConfig` set no `osxSign`, and [@electron/packager](https://github.com/electron/packager)
signs only when that option is present, so every Mac package Forge produced
shipped with zero `_CodeSignature` entries and Mach-O members that still
identified themselves as `Electron`. Native CI could launch such a build because
a locally written file carries no quarantine attribute. A browser download does,
and [Gatekeeper](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web)
reports an unsealed bundle as a damaged application, with no route for the reader
to continue. That, not the missing Developer ID, is why publishing a Mac download
was never safe.

Ad-hoc signing needs no Apple account and no secret, and it produces a real seal
under irori's own bundle identifier, which moves Gatekeeper's answer from a
damaged application to an unverified developer that System Settings can override.
It is not a distribution signature: it carries no identity and no notarization
ticket, and it must not run under the hardened runtime. The runtime enforces
library validation, which requires every loaded library to share the main
executable's Team ID; an ad-hoc signature has none, so macOS 26 refuses to map
Electron Framework into the process and the app aborts before drawing a window.
`@electron/osx-sign` enables the runtime by default and takes per-file settings
only from an `optionsForFile` callback, so packaging disables it there and the
package smoke asserts the flag is absent. The runtime returns with Developer ID
signing, where one real Team ID covers every component, and that change needs
its own device verification. Forge defaults `continueOnError` to true, which
would produce a silently unsigned package again, so packaging sets it to false.

The Mac package job runs on `macos-26`, matching the acceptance device. It
previously ran on `macos-15`, which launched a package that aborts at startup on
macOS 26 — a passing package job on an older runner is not evidence about the
platform the download is published for.

`test:package` verifies the Mac bundle Forge produced and the copy inside the
disk image, because the image carries the bytes a reader actually downloads. For
both: the `_CodeSignature` seal exists, `codesign --verify --deep --strict`
passes over the app, its helpers and its frameworks, the identifier is
`io.github.deltaiseiozaki.irori`, and the signature is ad-hoc. `spctl`'s verdict
is recorded rather than asserted — unnotarized code is rejected by design, and
the evidence should describe the state readers meet. The relocated-launch smoke
is unchanged and still runs against the signed package. These checks run on the
built output, not the relocated copy, because Node's copy drops the extended
attributes codesign writes for non Mach-O members such as `app.asar`.

The uploaded CI artifacts remain unsigned for distribution on every platform. An
ad-hoc signature is not a signing identity, and Windows and Linux packaging is
unchanged.

Windows 0.1.4 release: [preview notes](releases/0.1.4-preview.1.md) identify the
unchanged EXE from [CI 34841807049](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34841807049).
All three native package jobs pass trusted OS clipboard paste and continuous
editing checks. The CI PR-merge tree equals merged application source
`e72a62b53950b2ddb3f9132f4e66f341a74f80fc`; exact commits/tree are recorded in the
notes. The uploaded EXE digest matches CI evidence. Public website delivery and
installed-device results remain separate evidence in CHECKPOINT/HANDOFF.

Current package evidence: version `0.1.3`, source `9b04ed2`, [CI 34764163901](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34764163901), passes verification and Linux x64 / Windows x64 / Mac arm64 package jobs. Native icon resources, local image bytes/rendering and editing after save are now checked alongside existing SDK, CSV, terminal and configured read-only OAuth handoff tests. The Windows EXE is published and anonymously download/hash verified; see [CHECKPOINT](CHECKPOINT.md). Installed-device acceptance, signing and Mac publication remain separate.

Latest verified implementation: [CI run 34761095540](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34761095540), commit `b51a54b`, passes clean verification and all Linux x64 / Windows x64 / Mac arm64 jobs for version `0.1.2`. Copied packages pass reload, SDK imports, Japanese note save, CSV graph loading, actual terminal keyboard input/Japanese file creation, bundled rclone startup and normal shutdown. Configured packages also start/cancel account onboarding with the compiled distributor client, inspect the local redirect to Google's authorization endpoint and verify the exact read-only scope; evidence contains booleans only. These tests stop before Google consent. Verification includes 64 passed behavior tests with three optional provider controls skipped, eight UI suites and website fixtures. Windows reuses node-pty's official Node-API prebuilds. [Preview notes](releases/0.1.2-preview.1.md) identify the Windows bytes and [CHECKPOINT](CHECKPOINT.md) records public delivery. The paragraphs below retain earlier diagnostic evidence. This remains unsigned engineering evidence; installation on the user's Windows 11/Ryzen 9 and M5 Pro devices, signing, Google consent/refresh/mounts and provider acceptance are still open.

Date: 2026-09-13. D02 implementation after `ce7234b`; unsigned engineering builds only.

Verified native baseline: [run 34751330082](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34751330082), commit `713222a`, passes clean verification and every Linux x64 / Windows x64 / Mac arm64 maker and relocated-app smoke. Windows renderer trust and native Git PATH fixes are exercised there. These are engineering packages, not signed installers or Windows 11/M5 Pro installed-device acceptance. The ontology follow-up adds a packaged CSV graph check; use its own run for that later evidence.

## Build and verify

Use supported Node 24.15+ (24.x) or 26+, then:

```sh
npm ci
npm run setup:electron
npm run make
npm run test:package
```

Linux needs the system `zip` command and a display; headless tests use `xvfb-run -a npm run test:package`. `npm run package` creates the application directory without an installer. Both package commands first run the normal typechecked application build.

[Electron Forge](https://www.electronforge.io/core-concepts/build-lifecycle) 7.11.2 owns copying, runtime dependency pruning, ASAR, native rebuild and makers. [Squirrel.Windows](https://www.electronforge.io/config/makers/squirrel.windows) produces the Windows EXE; its normal install/update/remove startup events use `electron-squirrel-startup`. [DMG](https://www.electronforge.io/config/makers/dmg) produces the Mac disk image on macOS. ZIP is included for Mac and Linux engineering use. There is no custom installer engine, publisher, updater or signing fallback.

The allowlist includes `dist` (with the generated `third-party-notices.txt`), `dist-host`, assets, the `node_modules` the host loads, package metadata, irori's MIT license and third-party notices. Source maps, source/test directories, `.local`, KBs, device data, credentials, logs and website output are excluded. Upstream package notices and Electron/Chromium licenses remain. The Claude SDK's optional native binary packages and the renderer's bundled packages are removed while packaging, as the dated sections above describe.

`test:package` copies the complete Forge output into a temporary Japanese/space-containing path outside the checkout, clears Node module overrides, and launches its own Electron binary with a separate cwd/device directory. It verifies ASAR contents, absence of build tooling, actual SDK imports (including the ESM OpenCode client), startup, typed host note registration/save and normal shutdown. It does not launch a model, authenticate a cloud account, or execute an installer. Playwright supplies only test control; developer Node/npm is not used by the application's host.

The ontology follow-up also verifies page reload, saved CSV parsing and the lazy graph renderer inside the relocated application. Root-only Linux container tests use `--no-sandbox --disable-dev-shm-usage`: this VM has a 64 MiB shared-memory mount, and reload exhausted it; the identical package succeeds with Chromium's temporary-file fallback. Normal hosted/native-user tests retain their regular sandbox/shared-memory path. This test setting is not shipped as an application default. Separately, host shutdown now skips renderer draft execution when that renderer has already crashed; the UI regression forcefully crashes a disposable renderer and verifies host close, retaining already persisted work.

The ignored `test-results/package-smoke.json` contains platform/runtime versions, the actual packaged dependency inventory, and SHA-256/size for each maker artifact. Preserve it with the exact candidate. Inventory is evidence for review, not a completed legal or security assessment.

## CI

`.github/workflows/app.yml` runs on main pushes, pull requests and explicit dispatch. Linux verification covers build, behavior tests, all seven Electron UI suites and website tests. Only after verification passes do Linux x64, Windows x64 and macOS arm64 jobs build packages and run the relocated-app smoke. The Mac job uses an arm64 runner; Intel Mac has no advertised support. Standard hosted runner architectures are documented by [GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

The workflow has read-only repository permissions and uploads unsigned engineering artifacts for seven days. It has no release publisher, signing credentials, deployment environment or manifest update. Anyone accessing these artifacts must treat them as test candidates. Successful hosted CI is not Windows 11/Ryzen 9 or MacBook M5 Pro installed-device acceptance. Optional native controls in `npm test` remain skipped in CI, since those tools/accounts are not installed there.

## Local evidence

- `npm run make`: Linux x64 application and ZIP generated by Forge.
- `xvfb-run -a npm run test:package`: passed relocated packaged-app startup, OpenCode/Claude SDK imports, Japanese note save and shutdown.
- `npm test` with the existing opt-in rclone/OpenCode/Pi executables: 64 passed, zero failed/skipped, without inference or Google authentication.
- All seven Electron UI scripts passed; website build and browser tests passed for the real manifest plus unavailable, mixed and available fixtures.
- `npm audit --omit=dev`: zero reported runtime vulnerabilities at this check. Full audit reports build-tool issues in Forge's transitive dependencies, including tar/extract-zip/image-size/tmp. These remain D08 review/remediation work; no forced downgrade or untested dependency override was applied.

The Linux package is approximately 767 MiB unpacked / 321 MiB zipped before final release assets. This is a baseline, not a lightweight-release claim. Exact sizes/checksums belong to each generated evidence file. Remaining work includes package size reduction where demonstrated safe, native icons, signing/notarization, OS credential protection, distributable Git/rclone/agent setup, upgrades/rollback, native IME/performance, actual installer acceptance and public distribution. OAuth and `/dev/fuse` are absent in this VM; native control success does not prove real mounts.

## CI follow-up and distributor OAuth

The first [push-triggered CI run](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34749844099) passed clean checkout installation, application/website verification and Linux packaging. Both native makers also created their EXE/DMG. The relocation test exposed two test-harness portability bugs: Node's default copy rewrites macOS framework links, causing Chromium ICU lookup failure, and the Windows ASAR API requires native path separators when reading nested entries. The test now preserves relative symlinks and normalizes archive reads. The [subsequent run](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34750392778) passes Mac arm64 and Linux x64 packaged startup. Windows exposed a real host bug: comparing file-URL strings rejects an equivalent renderer URL. Host trust now checks the same window/main frame and canonical entry file, retaining rejection of other origins/documents. The smoke also exercises fragment navigation. A successful Windows rerun remains required; EXE creation alone is not startup evidence. Test cleanup now retries Windows file locks and preserves the original failure.

The host can now embed validated distributor desktop OAuth configuration from explicit build-only inputs. Packaged irori ignores development OAuth overrides, and tests verify that an unconfigured installer stays unconfigured even with those overrides present. Build errors redact values. Actual Google consent/approval and mounts still await distributor setup/native devices; see [CLOUD-SETUP](CLOUD-SETUP.md).

Run [34750901779](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34750901779), commit `7b50cbb`, passes verification and Linux/Mac package startup. Windows now passes renderer trust and SDK loading, then fails native Git detection. `agentEnv` added an uppercase `PATH` beside Windows's inherited `Path`, shadowing the native search path under [Node's Windows environment rules](https://nodejs.org/api/child_process.html). The follow-up preserves Windows's native environment spelling, with a regression for Git/provider paths and removal of distributor OAuth values. Its native package rerun remains required.
