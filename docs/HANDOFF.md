# irori continuation handoff

Verified search checkpoint, 2026-09-14: application commit `ac935a9160f5e0a0be3d77a23e71d24073e53fcb` is pushed. [CI 34810865845](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34810865845) succeeds in verification and all Linux x64/Windows x64/Mac arm64 package jobs, including relocated packaged-app smoke. Local build, 85/88 behavior tests (three optional skips), all ten Electron UI suites, formatting and documentation-link checks pass. This following documentation checkpoint records the completed verification; the public Windows installer remains `9b04ed2` / `v0.1.3-preview.1`.

Development continuation, 2026-09-14: [local KB text search](KB-SEARCH.md) is implemented after the source-navigation checkpoint. **KB内を検索** searches saved Knowledge_Base text in one current-workspace KB, displays matching lines and opens the current document through the editor/workspace/agent guards. The host enforces the existing scope boundaries, skips unreadable or oversized files, bounds traversal/read work and marks incomplete results. Query/scope changes and closing discard stale responses. No persistent index, cloud fetching or cross-KB search is included.

Continue D04 writable capability/re-consent/account binding or the remaining D06 portable identity, moves/backlinks/properties, indexed search and exact line navigation. Preserve completed local text search, record navigation/reconnection and conversation recovery. The public Windows installer remains `9b04ed2` / `v0.1.3-preview.1`; source changes do not update it. Shared development configuration now lives in KB_design; contributor guidance was committed separately as `9740f98`.

Local verification for text search: build, **85/88 behavior tests** (three optional native-control skips), all **ten Electron UI suites**, changed-source formatting, local documentation links and diff checks pass. Initial search-field focus was fixed after the first UI attempt; focus entry/restoration and the complete final suite pass. New fixtures exercise the real search IPC/filesystem path and controlled delayed replies without model inference or real Google access. User VM preview/data and the public installer/site were preserved. See STATUS for hosted verification of this continuation.

Verified source checkpoint, 2026-09-14: application commit `54eeee41b6c93d44297e5896613c70b0b271e9b0` is pushed. [CI 34776177942](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34776177942) succeeds in verification and all Linux x64/Windows x64/Mac arm64 package jobs, including relocated startup smoke. Local build, 78/81 behavior tests (three optional skips), all nine Electron UI suites and documentation-link checks pass. This following documentation-only checkpoint updates the continuation prompt; the public Windows installer remains `9b04ed2` / `v0.1.3-preview.1`. No model inference, real Google access or device acceptance was added.

For a new session, use the [copyable continuation prompt](HANDOFF-PROMPT.md). It separates the newer source from the published installer and names the next D04/D06 work. Current entries supersede the historical checkpoints below.

Development continuation after `1afe3bb`, 2026-09-14: [record search and source/artifact navigation](KNOWLEDGE-NAVIGATION.md) are implemented. Missing sources can be explicitly rebound to matching files in the same scope, retaining IDs across repeated moves and restart. Location inspection distinguishes changed/missing/unavailable files; artifact and exact-version reverse links navigate to runs; current files open through existing editor/workspace guards. Copies, occupied/unknown/duplicate IDs, changed destinations, invalid paths and cross-KB aliases fail without changing historical records or file bytes. This is device-local metadata search/reconnection, not portable shared identity or full-text KB search.

Next independent work remains D04 writable capability/re-consent/exact account binding and D06 portable identity/provenance, full-text search, file moves/backlinks/properties and real artifact acceptance. Do not reimplement the completed record-navigation UI or conversation recovery. No device failure, Google consent or new model-testing permission was supplied; no installer/site publication or preview/data reset is included.

Local validation for this continuation: production build, 78/81 behavior tests (three optional native-control skips), all nine Electron UI suites and changed-document local links pass. The UI checks include binary artifact navigation, rejected out-of-workspace navigation, successful navigation after explicit membership, wrong-version rejection and retained history after reconnection/restart. Fixtures do not establish real generated-artifact or native account/device acceptance. The inherited provider cancellation test now waits for fixture prompt receipt before stopping the turn; early startup cancellation remains valid app behavior.

Verified continuation checkpoint, 2026-09-14: application commit `9d79182e33eab11d1fcdff96d9d3961cf61ef3ee` is pushed. [CI 34773932413](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34773932413) passes verification and Linux x64, Windows x64 and Mac arm64 packaging, including packaged queue recovery after restart. Local build, 75/78 behavior tests (three optional skips), all eight Electron suites and relocated Linux package smoke also pass. The public Windows installer remains 0.1.3 from `9b04ed2`; no new release or Pages deployment was performed. Resume independent D04/D06 work from this source, keeping the pending device/account/model acceptance gates. The parent workspace routing now includes irori; neither reference repository was edited, and the existing VM preview/data were preserved.

Development continuation, 2026-09-14: implemented [device-local conversation recovery](CONVERSATIONS.md) after checkpoint `2c9396a`. Recent display history and accepted pending instructions now persist by exact checkout/KB/CLI. Restored queues wait for explicit resumption; interrupted runs are not replayed, restored requests have no live controls, and current hosts use Electron's single-instance lock per device profile. Existing native session handles and the published 0.1.3 installer are unchanged. Follow-up verification is recorded in STATUS; source changes and CI artifacts do not constitute a newly published installer.

Final delivery checkpoint, 2026-09-14 JST: [Pages run 34764740194](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34764740194) successfully deployed website commit `44bcd2bc8cf682cca257cee54a9dbe837cb4b601` to [the download site](https://del-taiseiozaki.github.io/irori/). At `2026-09-13T15:10:49.647Z`, a fresh anonymous desktop/mobile browser downloaded all **318,416,896 bytes** of the Windows 0.1.3 installer and matched SHA-256 `c6099224db0b6137824088e19e43976d573d823af150ead5350be7b6312f442d` with the native CI/release evidence. No page/HTTP errors occurred; both Mac downloads remained disabled. Application source is `9b04ed2`; implementation/follow-up commits and the publication commit are pushed. This final documentation-only commit records the completed delivery.

No Windows device/Google/IME/upgrade result was supplied, and no real model test was authorized or executed. Read-only Google access, complete-release gates, untouched neighboring repositories and preserved `.local/vm-preview/{samples,device}` data remain explicit boundaries. Continue from current main using [implementation details and remaining work](EDITING-AND-RECORDS.md), rather than repeating OAuth setup or the completed editor/Git/queue work.

Published update, 2026-09-14 JST: [Windows preview 0.1.3](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.3-preview.1) contains application commit `9b04ed263b88b4754d03c7b79ab78816f0d73b06`. [Native CI 34764163901](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34764163901) passes verification and Linux x64, Windows x64 and Mac arm64 packages, including continuous editor save/image rendering and the existing configured OAuth handoff/cancellation. The unchanged CI EXE is **318,416,896 bytes (303.7 MiB)**, SHA-256 `c6099224db0b6137824088e19e43976d573d823af150ead5350be7b6312f442d`; GitHub's uploaded-asset digest matches. The website manifest now selects 0.1.3 and both Mac slots remain disabled. Pages deployment and anonymous delivery are recorded in the following checkpoint update.

Continuation after `d1b828c`: source version `0.1.3` addresses image paste, continuous document editing, bulk Git staging and queued conversations. It adds device-local source/run/artifact records and durable cloud-send preparation with an rclone delivery-engine test; Google remains read-only. See [implementation and limits](EDITING-AND-RECORDS.md). No new device result or real model permission was supplied. Native preview publication is recorded separately below when verified.

Checkpoint requested by the owner after delivery of Windows preview `0.1.2`, 2026-09-13. The owner's "OK" acknowledged delivery and requested this handoff; no successful Google login, mounted-folder access or new Windows device result was reported. This checkpoint changes documentation only. At its start, `main` was clean at `dc53e52`; the subsequent documentation commit contains this file.

## Immediate continuation after 0.1.3

Read [continuous editing and retained records](EDITING-AND-RECORDS.md) before extending the editor, conversation queue, D04 or D06. The implementation is already committed and packaged; do not restart those features. Collect explicit Windows 0.1.2/0.1.3 Google/WinFsp/read/reconnect and new editor/IME/upgrade evidence. None has been reported during this continuation. Next independent work is writable capability/re-consent and account binding for actual cloud delivery, portable knowledge identity/provenance, move/rebind/search UI and broader conversation history management. Keep the full release gates and original model-execution restrictions. The first 0.1.3 CI run at `31dcb46` was intentionally cancelled after a visual check found literal HTML empty lines; the successful final run targets `9b04ed2`. The website screenshot uses disposable examples and submits no model prompt.

## Start here

Continue development in `/workspace/KB_design/irori`, an independent Git repository on `main`, remote `https://github.com/DeL-TaiseiOzaki/irori.git`. Inspect `git status` and the relevant recent commits before making changes; check remote release/CI state when the task concerns delivery. Preserve any work added after this checkpoint. LayeredKB provides irori capabilities in VS Code, and `irori-templete` is the recommended main-KB repository template under development. Each has an independent history; change a sibling only when the current task includes it.

Follow [AGENTS](../AGENTS.md) and use [STATUS](STATUS.md) to locate the current work. Load [README](../README.md) for setup, the [host decision](decisions/001-initial-host.md) for architecture changes, [confirmed product decisions](decisions/002-release-and-workspace.md) for product constraints, and [CHECKPOINT](CHECKPOINT.md) / [RELEASE-PLAN](RELEASE-PLAN.md) for delivery. The current sections and actual code supersede historical milestone statements. Open only the topic needed from [DISTRIBUTOR-GOOGLE](DISTRIBUTOR-GOOGLE.md), [CLOUD-SETUP](CLOUD-SETUP.md), [TERMINAL](TERMINAL.md), [PACKAGING](PACKAGING.md), [ACCEPTANCE](ACCEPTANCE.md), [WORKSPACE-DRIVE](WORKSPACE-DRIVE.md) and [ONTOLOGY](ONTOLOGY.md). The [initial workspace specifications](../../docs/irori/) are historical; their old Q01/Q02 proposals are superseded by ADR 002.

Respond in Japanese. Write code, identifiers, technical documents and commit messages in English. The user prioritizes simple code and established libraries, expects implementation and verification, and has authorized commit/push. Complete independent work while waiting for device/account input. Read [the completed reuse assessment](REUSE-COMPLETION-2026-09-13.md) before proposing another broad library migration; Git collaboration and native adapters already exist.

## Public delivery and exact identities

| Item | Verified value |
| --- | --- |
| Download site | https://del-taiseiozaki.github.io/irori/ |
| Release | `v0.1.2-preview.1`, public unsigned Windows x64 prerelease |
| Application commit | `b51a54b1f9fb36423edf56ed6a1bec961839e165` |
| Native CI | [34761095540](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34761095540), all jobs successful |
| Website commit | `94bc9ce3caa9bc71ef5b6a3975283ddb8f14b7c5` |
| Pages deployment | [34761649567](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34761649567), successful |
| Installer | `irori-0.1.2-windows-x64-Setup.exe`, 316,222,976 bytes (301.6 MiB) |
| SHA-256 | `b3cb5c71cb8311ad9043ad79e31632254ab8169d0b1e7de1412d41979f5012bd` |

The unchanged Windows CI EXE was renamed and published with `SHA256SUMS.txt` and `windows-package-evidence.json`. At 14:07 UTC on 2026-09-13, a fresh unauthenticated browser checked the live desktop/mobile page and downloaded all bytes with the same hash as CI and GitHub's asset digest. Both Mac download slots remain disabled. [Release notes](releases/0.1.2-preview.1.md) describe the trial. Continue from current `main`; the release commit identifies the binary, not the latest documentation.

Versions `0.1.0` and `0.1.1` have no compiled Google client configuration and cannot acquire the new settings automatically. The owner previously demonstrated that 0.1.0 reached the Windows workspace/cloud dialog after a SmartScreen unknown-publisher prompt. That is historical startup evidence, not 0.1.2 installation/upgrade/IME or Google acceptance. Signing remains open.

## Decisions to preserve

- Source license: MIT; dependency/provider terms remain separate. Devices available to the owner: Windows 11 / Ryzen 9 / x64 and MacBook M5 Pro / arm64. Exact macOS/minimum supported OS versions still need recording. Linux is an engineering test platform.
- Q01: CSV basic editing and note links, readable graphs with hierarchy/subgraph filtering. Native CLI agents build the ontology with people; irori visualizes it. Preserve unknown columns and IDs.
- Q02: one workspace joins multiple arbitrarily named GitHub KB repositories and multiple selected Drive folders, with multiple accounts. Drive ownership is independent of GitHub/KB membership; category selection is optional. Existing legacy KB attachments remain intact.
- The terminal uses xterm.js/FitAddon, node-pty, default-shell/which and tree-kill. It discovers installed shells and starts one in the selected KB. It is a native shell with the user's ordinary permissions, not a KB sandbox. Preserve typed HostAPI boundaries, session lifecycle, backpressure and child cleanup.
- rclone 1.75.1 is bundled from an official release with pinned archive hashes and its license. Packaged startup uses the bundled binary outside ASAR. Windows additionally requires WinFsp for mounting. Source checkout setup differs from installer setup.

## Google state: configured, real consent still pending

The owner completed the Google application registration and saved these repository Actions secrets:

- `IRORI_GOOGLE_CLIENT_ID`
- `IRORI_GOOGLE_CLIENT_SECRET`

Their names/update timestamps were verified; their values were not retrieved or printed. The workflow passes them to `IRORI_BUILD_GOOGLE_CLIENT_ID` / `IRORI_BUILD_GOOGLE_CLIENT_SECRET` during packaging. Build-time validation and all three native package jobs pass. The published Windows evidence records `oauthConfigured: true`. Do not ask the owner to repeat initial registration or paste values into chat. Use existing CI secrets for subsequent authorized builds. Ordinary users only use account selection and browser consent.

The owner reported declaring all Drive permissions to allow future writing. `src/cloud/accounts.ts` still requests only `drive.readonly`; mounts are also read-only. Broader console declarations neither expand the actual request nor implement uploads. D04 still requires durable staging, observed remote completion, recovery and the corresponding scope/re-consent work. No Google project/audience/test-user settings or real account access were independently accepted during this session.

`scripts/package-smoke.ts` starts account onboarding through the packaged HostAPI and actual bundled rclone, intercepts system-browser opening, checks only the local redirect to Google's authorization endpoint, validates the read-only scope and cancels. Evidence records booleans, not OAuth URLs, client values or tokens. This is not Google's validation of the client, a completed login, consent, refresh, shared-drive access or a mounted folder. Local package verification used synthetic client settings; CI used the owner's registered secrets.

Windows trial flow: close the old app, install 0.1.2, install/recheck WinFsp if prompted, then use **Google Drive → 接続** in the workspace sidebar (or header **クラウド接続**), name/add an account, complete consent, choose/register a folder and try reading it. Per-KB contents controls manage legacy connections. If the Google project is in testing, use its registered test users; testing-mode authorization expiry is described in DISTRIBUTOR-GOOGLE and the release notes.

## Next priorities

1. D03/D05: obtain the owner's exact 0.1.2 device result and fix any reproduced account, shell or mount issue. Verify real consent, WinFsp mounting, folder reads, restart/reconnect, a second account/shared drive, denial and expired credentials. Distinguish client setup from consent and filesystem readiness. Account/device input may be requested while independent engineering continues.
2. D04: implement recoverable cloud writes using established rclone capabilities where suitable. Preserve unsent bytes across restart/network failure and distinguish pending, uploading, confirmed and failed states. A scope/`readOnly` flag change alone is insufficient.
3. D06: stable note/artifact/run identities, explicit multiple-source selection, retained source versions/snapshots and provenance/reverse links; then search, rename/backlinks/properties. CSV/graph presentation and Git collaboration are already implemented. This work can proceed while device acceptance is pending.
4. D07–D10: native IME/editor/data safety and performance, provisional Electron/host assessment, credential protection, dependency/provider distribution review, signing/notarization, upgrade/rollback, supported-OS evidence and complete new-user acceptance. Full-release requirements remain intact.

D01's Q01/Q02/license/device choices and D02's native packaging foundation are implemented. The distributor client has also been supplied. Avoid restarting those setup/research tasks because an older milestone lists them as missing.

## Validation and implementation cautions

The published 0.1.3 application passed build, 69 of 72 behavior tests (three optional provider controls skipped), eight Electron UI suites and all three native package jobs. Subsequent source verification is recorded in STATUS. Website build and real/mixed/available/unavailable browser checks passed. These checks used no model inference. Documentation-only checkpointing does not rerun or extend that runtime evidence.

Node requirement is `^24.15.0 || >=26.0.0`; this workspace has Node 24.21.0 in `node_modules/.bin`, while the system Node may be 20. For code changes, use the appropriate existing scripts under a supported Node runtime:

```sh
cd /workspace/KB_design/irori
export PATH="$PWD/node_modules/.bin:$PATH"
npm run build
IRORI_TEST_RCLONE_PATH="$PWD/.local/rclone/linux-x64/rclone" npm test
# Renderer changes:
xvfb-run -a npm run test:ui
# Website changes:
npm run build:website
xvfb-run -a npm run test:website
```

The rclone path is an ignored local tool; use `npm run setup:cloud` if it is missing. Without the rclone opt-in, additional tests skip. `npm run make` / `npm run test:package` and `.github/workflows/app.yml` verify packages. Configured package checks require `IRORI_EXPECT_PACKAGED_OAUTH=1`; the workflow sets it from secret presence. Source-only changes do not update public installers.

Preserve Windows `rebuildConfig.ignoreModules: ['node-pty']` for the pinned version: official Node-API prebuilds avoid a broken MSVC rediscovery on the Windows runner. Keep native helpers and rclone unpacked outside ASAR. The host bundle externalizes runtime dependencies; copied packages must include dynamic SDK imports and be tested outside the checkout. default-shell's named export avoids CJS/ESM double-wrapping.

Use disposable KBs for mutation tests. Keep filesystem/process work behind the typed, validated HostAPI and trusted main-frame boundary. The native terminal's own commands run with user permissions; document content receives no raw IPC/Node/shell API.

## Authorization and local state

The owner authorized development, verification and commit/push, and separately requested the Windows testing download channel and the terminal/Google follow-ups. Preserve that existing authorization for necessary tested updates; do not re-ask for already authorized work. The narrow unsigned Windows preview is not approval for a complete general release, a Mac release, unrelated external account changes, or paid native model execution. Follow AGENTS for real provider tests; do not run `test:agents` or real-model UI tests without the required authorization, or bypass provider authentication/permissions.

The old VM preview may still be running older code. `.local/vm-preview/samples` and `.local/vm-preview/device` contain untracked user data: preserve them and do not reset/delete them. This checkpoint did not restart that preview. `.local/publication/`, `.local/rclone/`, `.local/downloads/`, `out/` and `test-results/` hold ignored tools/test artifacts, including a synthetic-client local package; publish only the verified CI artifact for the exact intended commit. The anonymous download checker is `.local/publication/check-site.mjs`, not a tracked production dependency.

Desktop CI creates temporary engineering artifacts; it does not publish releases or Pages. Website deployment is manual via `.github/workflows/website.yml`. A new published installer requires a distinct version, verified native bytes, notes/checksums, the matching manifest, and anonymous delivery verification. Keep live Google client values, account tokens, authorization URLs, user notes and transcripts out of tracked evidence.
