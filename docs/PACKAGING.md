# Desktop packaging foundation

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

The allowlist includes `dist`, `dist-host`, assets, production `node_modules`, package metadata, irori's MIT license and third-party notices. Source maps, source/test directories, `.local`, KBs, device data, credentials, logs and website output are excluded. Upstream package notices and Electron/Chromium licenses remain. Claude SDK optional native binary packages are included by npm's production dependency tree even though irori selects the user's separately installed executable; their redistribution review remains D08 work.

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
