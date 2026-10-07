# irori continuation handoff

Published 2026-10-07: **0.1.85** (copied code that had drifted, merged at the
owner's request: [#187](https://github.com/DeL-TaiseiOzaki/irori/pull/187) 0.1.82
fixes, [#190](https://github.com/DeL-TaiseiOzaki/irori/pull/190) host,
[#189](https://github.com/DeL-TaiseiOzaki/irori/pull/189) agents and domain,
[#188](https://github.com/DeL-TaiseiOzaki/irori/pull/188) renderer) is published as
[v0.1.85-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.85-preview.1)
by release run `37616904194` from main's successful CI run `37615484434` on
`ce68569` (verify plus Linux, Windows and macOS packages). 0.1.82–0.1.84 were
merged in sequence and not published on their own; the 0.1.85 notes cover them.
- Fixes: `within()` copies that refused `..name` children, the hibachi composer
  accepting 100,000 characters against the host's 32,000, `gh` answers cut at
  64 KB, doubled "Error: Error:", comment times ignoring the app language, and an
  untranslated register refusal. The rest consolidates helpers without changing
  behaviour.
- The `conversations-ui-smoke` CI hang is explained: the suite quit right after
  the fixture's reply, before its run ended, and quitting during a run opens a
  confirmation nobody answers. It now waits for **停止** to go and fails a quit
  that takes over 15 s (#187).
- Anonymous downloads matched `SHA256SUMS.txt`: Windows 176,170,496 bytes,
  Mac 141,797,159 bytes and `irori-0.1.85-full.nupkg` 175,339,160 bytes.
  The website manifest now offers 0.1.85.
- Left for an owner decision: one relative-path predicate (about 12 sites with
  different rules for `:`, drive letters and NUL) and the front-matter splitters
  whose edge cases differ.
- Owner checks remain: the installed Windows and Mac builds; real CLIs and a real
  GitHub account were not exercised.

Published 2026-10-07: **0.1.81** ([#182](https://github.com/DeL-TaiseiOzaki/irori/pull/182),
long agent sessions stay light) merged at the owner's request as `437164e` and
is published as
[v0.1.81-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.81-preview.1)
by release run `37605430358` from main's successful CI run `37595849519`
(verify plus Linux, Windows and macOS packages; its first attempt timed out in
`conversations-ui-smoke` and the rerun passed — six local runs of that suite
took 13–14 s each, so the hang is not yet explained).
- Anonymous downloads matched `SHA256SUMS.txt`: Windows 176,171,520 bytes,
  Mac 141,791,337 bytes and `irori-0.1.81-full.nupkg` 175,339,889 bytes.
  The website manifest now offers 0.1.81.
- Owner checks remain: a long session with a real CLI on the installed Windows
  and Mac builds (smoothness, **停止** ending the CLI's own servers), which was
  not measured here.

Published 2026-10-07: **0.1.80** ([#183](https://github.com/DeL-TaiseiOzaki/irori/pull/183),
a shared Schema for every agent, set from the settings, [ADR 027](decisions/027-shared-schema.md))
merged at the owner's request as `4f011e5` and is published as
[v0.1.80-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.80-preview.1)
by release run `37591763672` from main's successful CI run `37590465209`
(verify plus Linux, Windows and macOS packages).
- Anonymous downloads matched `SHA256SUMS.txt`: Windows 176,161,792 bytes,
  Mac 141,758,324 bytes and `irori-0.1.80-full.nupkg` 175,330,177 bytes.
  The website manifest now offers 0.1.80.
- Owner checks remain: a real CLI following the shared Schema, and
  **設定 → Schema** on the installed Windows and Mac builds.

Published 2026-10-07: **0.1.78** ([#181](https://github.com/DeL-TaiseiOzaki/irori/pull/181),
removing a hibachi from the start screen) merged at the owner's request as `45417e7`
and is published as
[v0.1.78-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.78-preview.1)
by release run `37587261904` from main's successful CI run `37585965134`
(verify plus Linux, Windows and macOS packages).
- Anonymous downloads matched `SHA256SUMS.txt`: Windows 176,159,744 bytes,
  Mac 141,761,146 bytes and `irori-0.1.78-full.nupkg` 175,327,231 bytes.
  The website manifest now offers 0.1.78.
- Owner checks remain: removing a hibachi from the start screen on the
  installed Windows and Mac builds, including moving its folder to the trash.

Published 2026-10-06: **0.1.77** ([#179](https://github.com/DeL-TaiseiOzaki/irori/pull/179),
making routines from the routines page or through the irori agent, [ADR 016](decisions/016-routines.md)
stage 4) merged at the owner's request as `5bce1c6` and is published as
[v0.1.77-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.77-preview.1)
by release run `37420283467` from main's successful CI run `37419304421`
(verify plus Linux, Windows and macOS packages).
- Anonymous downloads matched `SHA256SUMS.txt`: Windows 176,158,720 bytes,
  Mac 141,762,918 bytes and `irori-0.1.77-full.nupkg` 175,326,801 bytes.
  The website manifest now offers 0.1.77.
- Owner checks remain: a real CLI writing a routine with `write-routine`, and
  the routines page on the installed Windows and Mac builds.

Published 2026-10-06: **0.1.76** ([#177](https://github.com/DeL-TaiseiOzaki/irori/pull/177),
the GitHub account carries the environment, [ADR 026](decisions/026-github-account-environment.md))
merged at the owner's request as `ab8a526` and is published as
[v0.1.76-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.76-preview.1)
by release run `37409479015` from main's successful CI run `37408526050`
(verify plus Linux, Windows and macOS packages).
- Anonymous downloads matched `SHA256SUMS.txt`: Windows 176,153,600 bytes,
  Mac 141,759,614 bytes and `irori-0.1.76-full.nupkg` 175,323,089 bytes.
  The website manifest now offers 0.1.76.
- Owner checks remain: a real `gh` sign-in saving to and restoring from the
  account's `irori-settings` repository, on the installed Windows and Mac builds.

Published 2026-10-05: **0.1.75** ([#173](https://github.com/DeL-TaiseiOzaki/irori/pull/173),
routines in the rail) merged at the owner's request as `a49fad2` and is published
as [v0.1.75-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.75-preview.1)
by release run `37300125737` from main's successful CI run `37298872609`.
- Routines has its own button between irori mode and the hibachis, a GPT Image
  icon matching the existing paper/flame family, the device's JavaScript
  setting, secrets, review/run controls and history. Definitions remain
  `routine.yaml` and accompanying files.
- The agent pane stays beside routines without hibachis and retains its
  adjustable width across visits to irori mode. The map/columns choice also
  survives visits to routines. Hibachi removal (#172) and the resizable agent
  (#171) are preserved.
- Main CI passed build, formatting, unit tests (424 tests; 419 passed,
  5 skipped), all 28 UI suites, website build/smoke (42 articles, 224 links),
  and Linux, Windows and macOS package and native update checks.
- Anonymous downloads matched `SHA256SUMS.txt`: Windows 176,145,920 bytes,
  Mac 141,767,695 bytes and `irori-0.1.75-full.nupkg` 175,314,550 bytes.
  The website manifest now offers 0.1.75 and its four screenshots are fresh
  English UI captures at 2x, converted to WebP.
- Installed device acceptance and real CLI inference remain owner checks.

Published 2026-10-05: **0.1.74** (#171, resizable irori agent) is merged at
the owner's request and published as
[v0.1.74-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.74-preview.1)
by release run `37297909463` from main's successful CI run `37296848050`
(source `0287359`). The release carries Windows 174,688,768 bytes, Mac
140,342,048 bytes and `irori-0.1.74-full.nupkg` 173,857,520 bytes; anonymous
downloads of the three packages matched `SHA256SUMS.txt`. The website went
from 0.1.73 straight to 0.1.75 (#176), which includes this change, so its
manifest never offered 0.1.74. Owner checks remain: dragging the island on
the installed builds.

Resizable irori agent, 2026-10-05 (**0.1.74**). In irori mode the AI island
beside the map and the routines was a fixed 360px; it is now a
`react-resizable-panels` pane (default 360px, at least 300px; the map side
keeps at least 360px). The handle is the 8px gap, styled like the hibachi
islands' `island-handle`. Its layout is saved as
`irori-overview` with the other device layouts.
- Verified: `npm run build`, `npm run format:check`, and the `your-ai`,
  `overview`, `routines` and `dock` UI smokes under `xvfb-run`
  (`your-ai-ui-smoke` drags the handle and finds the saved layout). The whole
  `npm run test:ui` and `npm test` were not run for this renderer-only change.

Published 2026-10-05: **0.1.73** (#172, removing a hibachi) is merged at the
owner's request and published as
[v0.1.73-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.73-preview.1)
by release run `37296627070` from main's successful CI run `37295341200`
(source `32ca15c`). The release carries Windows 174,688,768 bytes, Mac
140,342,561 bytes and `irori-0.1.73-full.nupkg` 173,855,723 bytes; anonymous
downloads of the three packages matched `SHA256SUMS.txt`. The website manifest
now offers this release. Owner checks remain: moving a folder to a real system
trash, on the installed Windows and Mac builds.

Published 2026-10-05: **0.1.72** (#169, routine secrets) is merged at the
owner's request and published as
[v0.1.72-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.72-preview.1)
by release run `37283036702` from main's successful CI run `37281943491`
(source `ad0f325`). The release carries Windows 174,687,232 bytes, Mac
140,314,782 bytes and `irori-0.1.72-full.nupkg` 173,855,977 bytes; anonymous
downloads of the three packages matched `SHA256SUMS.txt`. The website manifest
now offers this release. Owner checks remain: the installed builds with a real
OS keychain (macOS Keychain, Windows DPAPI) and a real token-refreshing routine.

Routine secrets, 2026-10-05 (**0.1.72**, ADR 016 stage 2). It follows the
[secrets spike](research/spike-external-tool-credentials.md) and the owner's
three answers: refuse on a device without an OS-held key, write-back in stage
2, and agent-side Slack/Teams left to each CLI's own MCP sign-in.
- `src/host/keystore.ts` holds `SecretStore` (`secrets.json`, values sealed
  with synchronous `safeStorage`). It refuses Linux `basic_text`/`unknown`,
  because the async API accepts those. The same file has `Redactor` (hides
  values in streamed output) and `readWriteBack`.
- `RoutineService` gives each named secret only to its `run` step, along with
  `IRORI_SECRETS_OUT` (under `routines/out/`, outside `IRORI_WORK`). It keeps
  declared `NAME=value` lines whether or not the step succeeded; a failed step
  drops an unfinished last line, and a refused line fails the step. Values are
  hidden in output, reports and details.
- `needs` names missing secrets, or a device without a keychain. The review
  lists the secrets a routine receives.
- `HostAPI` gains `secrets()`, `setSecret` and `deleteSecret`; none returns a
  value. The routines view adds **<NAME> を入力**, a password dialog, and the
  **シークレット** list with **置き換え**/**削除**.
- `IRORI_TEST_KEYSTORE=reversible` stands in a non-protecting store, and only
  on a source run, for the UI smoke.
- Verified: `npm run build`, `npm test` (419 tests, 415 passed, 4 skipped;
  new `keystore` tests and two routines tests), `xvfb-run -a npm run test:ui`
  (routines smoke enters, reviews, hides, writes back and deletes a secret).
  `harness-ui-smoke` failed once on `.message.done` (0 of 5), then passed twice
  alone, and the 24 suites after it passed.
  and `npm run format:check`. Not verified: macOS Keychain, Windows DPAPI and
  a Linux secret service on installed builds.

Published 2026-10-05: **0.1.71** (#167, the irori agent sets up hibachis) is
merged at the owner's request and published as
[v0.1.71-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.71-preview.1)
by release run `37275509637` from main's successful CI run `37274540132`
(source `ee07460`). The release carries Windows 174,684,160 bytes, Mac
140,282,202 bytes and `irori-0.1.71-full.nupkg` 173,852,302 bytes; anonymous
downloads of the three packages matched `SHA256SUMS.txt`. The website manifest
now offers this release. Owner checks remain: the installed builds and a real
CLI running the `irori` command.

The irori agent sets up hibachis, 2026-10-05 (**0.1.71**,
[ADR 025](decisions/025-irori-agent-setup.md)): the owner described the
journey (download, a working folder, GitHub and a cloud folder, connect them,
start) and asked for the irori agent to do the connecting, with standard
skills already in place.
- Every irori agent run, on every CLI, has an `irori` command on its PATH
  (`src/agents/irori-bridge.ts` over the bridge it now shares with the
  `hibachi` command, `command-bridge.ts`): `list`, `clone <GitHub URL or
  owner/name>`, `create <folder>`, `add <folder>`, `connect <hibachi> <folder>`.
  `AgentSetup` (`src/host/agent-setup.ts`) only adds: it registers the hibachi
  and adds it to the request's workspace (`StartRun.workspace`; a routine's
  for its irori agent steps), or links a folder into the hibachi's contents. A
  repository or folder already registered just joins. New hibachis go beside
  the irori agent's folder (`~/irori`) unless `--parent` says otherwise.
- Clone, new folder and first commit take `duringRuns` in `GitService`, since
  the irori agent's own run would otherwise hold them back. The window follows
  a `hibachis` host event.
- Standard skills `irori-setup`, `add-hibachis`, `new-hibachi` and
  `connect-folder` (`prompts/irori-agent-skills.ts`) are written with the
  starter; for an older folder the + beside Schema on the irori agent's screen
  (標準スキルを追加) writes the missing ones. None is ever replaced.
- Verified: `npm run build`, `npm test` (412 tests, 407 passed, 5 skipped;
  new `irori-command`: the command's forms, clone through a local stand-in for
  GitHub, create and add into the request's workspace while Git refuses other
  work, connect, the launcher, the standard skills, and the irori agent on Pi's
  protocol fixture running `irori add`), the UI suites with `your-ai-ui-smoke`
  offering a deleted standard skill again and registering a folder through the
  command into the rail and the map, and `npm run format:check`.
  `links-ui-smoke` failed at the rename dialog's reference count
  (参照するリンクなし・一部未確認) in 3 of 5 runs, the known intermittent
  failure on `main`; it passed on the others.
- Not verified: real CLIs running the command (PATH and environment kept by
  their shell tools; Codex's sandbox and the loopback connection), a real
  GitHub clone, installed Windows/macOS builds. `new-hibachi` uses
  `irori create` and `gh repo create --source`, not `irori-templete` (owner:
  the template is not used yet).

Published 2026-10-05: **0.1.70** (#165, layer names) is merged at the owner's
request and published as
[v0.1.70-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.70-preview.1)
by release run `37269397238` from main's successful CI run `37268658288`
(source `16389b7`). The release carries Windows 174,672,896 bytes, Mac
140,283,023 bytes and `irori-0.1.70-full.nupkg` 173,843,183 bytes; anonymous
downloads of the three packages matched `SHA256SUMS.txt`. The website manifest
now offers this release. Owner checks remain: the installed builds.

Layer names, 2026-10-05 (**0.1.70**, [ADR 024](decisions/024-layer-names.md)):
the owner asked for Knowledge and Contents to be renamable, Schema aside; both
the shown name and the folder, set separately, for each hibachi.
- **hibachi の設定 → 層**: 表示名 (`labels` in `.irori/scope.json`) and フォルダ
  (`knowledge`, absent meaning `Knowledge_Base`; the first `contents` entry).
  `src/domain/layers.ts` holds the defaults, the name rules and `layerLabel`.
- A rename (`renameLayerFolder`, `src/host/layer-folders.ts`) moves the folder
  when it exists (only the declaration otherwise), disconnects and relinks
  connected folders, rewrites the connection records, moves drafts, material
  IDs, person-line records, comments and `.irori/notes.json` paths, then rewrites
  links into the folder in every Markdown file outside contents. Skipped files
  are reported. `.gitignore` gains the new contents line and keeps the old one.
- The knowledge folder replaces `Knowledge_Base` in the new-note default, home
  and overview lists, tree, Changes view, OKF `sources` roots and the graph index
  (`<folder>/ontology/`).
- Verified with `npm run build`, `npm test` (new `layer-names`), the UI suites
  with `brain-settings-ui-smoke` renaming the Knowledge layer and its folder, and
  `npm run format:check`. `links-ui-smoke` fails intermittently at the rename
  dialog's reference count (参照するリンクなし・一部未確認), on `main` as often
  as on this branch (2 of 3 runs each); it passed on one run here. Not verified:
  installed Windows/macOS builds, a rename on a case-insensitive volume, a second
  device following a contents rename.

Published 2026-10-04: **0.1.69** (#163, groups of hibachis in the rail) is
merged at the owner's request and published as
[v0.1.69-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.69-preview.1)
by release run `37208653832` from main's successful CI run `37207993644`
(source `21d2a36`). The release carries Windows 174,666,240 bytes, Mac
140,265,537 bytes and `irori-0.1.69-full.nupkg` 173,836,041 bytes; anonymous
downloads of the three packages matched `SHA256SUMS.txt`. The website manifest
now offers this release. Owner checks remain: the installed builds.

Groups of hibachis in the rail, 2026-10-04 (**0.1.69**): the owner asked for
a toggle that gathers hibachis, each group with its own name.
- Right-click a hibachi in the rail: **新しいグループ** (named in a dialog),
  **「name」に入れる**, **グループから外す**. The group's button opens and
  closes it; right-click it to **名前を変更** or **グループを解除**. Closed, a
  group is one folder of small tiles that shows its hibachis' AI state (ring,
  approval dot) and the bar when it holds the hibachi on show.
- `WorkspaceProfile.groups` in the device's `workspaces.json`
  (`saveWorkspaceGroups`); a group stands where its first hibachi is in the
  workspace order (`src/domain/hibachi-groups.ts`). Editing the workspace keeps
  groups for the hibachis that stay; an empty group goes.
- Verified with `npm run build`, `npm test` (new `hibachi-groups`), the UI
  suites including the new `rail-groups-ui-smoke` (group, close, restart, rename,
  ungroup) and `npm run format:check`. Not verified: installed Windows/macOS
  builds.

Published 2026-10-04: **0.1.68** (#161, connected folders named for agents) is
merged at the owner's request and published as
[v0.1.68-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.68-preview.1)
by release run `37196539796` from main's successful CI run `37195900117`
(source `df6fe06`). The release carries Windows 174,664,192 bytes, Mac
140,264,124 bytes and `irori-0.1.68-full.nupkg` 173,832,931 bytes; anonymous
downloads of the three packages matched `SHA256SUMS.txt`. The website manifest
now offers this release. Owner checks remain: a real CLI searching a connected
Drive for desktop folder.

Connected folders named for agents, 2026-10-04 (**0.1.68**): a connected
folder appears in contents through a link, and searches that walk the hibachi
skip links. ripgrep 15.2 (which Claude Code's search and Codex use) found nothing
in a linked folder from the hibachi root or with `rg --files`; it did with the
link's path named or `rg -L`. With rclone the mount was a plain directory, so
this was new with ADR 023.
- `prompts/connected-folders.ts`: a hibachi agent's request names its connected
  folders (`CloudService.linkedPaths`, `contents/<name>` of each linked folder) and
  says to name the path or use `rg -L`; the irori agent hears each handed
  hibachi's folders in its line, and the advice once.
- Verified with `npm run build`, `npm test` (prompt wording, `linkedPaths`, a
  Codex protocol fixture whose requests carry the list). Not verified: a real
  CLI searching a Drive for desktop folder.
- Not addressed (owner: acceptable): Google Docs/Sheets are `.gdoc`/`.gsheet`
  links in a synced folder, so agents cannot read their content; a Google
  Workspace CLI may cover that later.

Published 2026-10-03: **0.1.67** (#159, Google Drive through Drive for desktop)
is merged at the owner's request and published as
[v0.1.67-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.67-preview.1)
by release run `37030081349` from main's successful CI run `37028344592`
(source `c0bd6f0`). Without rclone the release carries Windows 174,665,216 bytes,
Mac 140,262,803 bytes and `irori-0.1.67-full.nupkg` 173,833,979 bytes (about
28 MB less each); anonymous downloads of the three packages matched
`SHA256SUMS.txt`. The website manifest now offers this release. Draft #146 was
closed as superseded. Owner device checks remain: a real Drive for desktop
folder connected and edited, a retired Drive connection switched, and the
unsent-change notice on a tester's machine.

Drive through Drive for desktop, 2026-10-02 (**0.1.67**,
[ADR 023](decisions/023-retire-drive-sign-in.md)): the owner retired irori's own
Google Drive sign-in. Agents are optional and separate tools, as Claudian is
beside Obsidian, and a synced folder covers what the sign-in offered, so no
Google review or CASA is needed.
- Removed: the OAuth client and accounts, rclone and its mounts, upload counts
  and the quit wait, the materials panel's "prepare upload", workspace-level
  Drive connections, and the packaging, CI and build inputs for rclone and the
  Google client (`src/cloud/{accounts,oauth,outbox,rclone,upload-errors}.ts`,
  `scripts/prepare-rclone.mjs`, `workspace-cloud-ui-smoke`).
- `CloudService` keeps the folders on this computer (ADR 019). A hibachi's
  `.irori/cloud-mounts.json` records are listed as `retired`;
  `switchCloudToLocal` turns one into a folder connection under the same id,
  name, place and access, and removes its device record and the empty mount
  point irori made. `DriveLeftovers` lists rclone cache items with
  `Dirty: true` and saves them to a chosen folder without overwriting, and it
  still restores prepared copies. The start screen shows **Drive の未送信分**
  only while there is something to save.
- Verified with `npm run build`, `npm test` (391 tests, new `retired-drive`
  and `drive-leftovers`, folder tests ported from the Drive fixtures), the UI
  suites (`cloud-ui-smoke` rewritten for folders, retired switching and the
  unsent notice) and `npm run format:check`. Not verified: a real Drive for
  desktop folder, installed Windows/macOS builds.
- Draft #146 (public Drive sign-in readiness) is superseded.

Published 2026-10-03: **0.1.66** (#157, submodules in a hibachi) is merged at
the owner's request and published as
[v0.1.66-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.66-preview.1)
by release run `37023584666` from main's successful CI run `37021164413`
(source `e2f2a0d`; its verify job passed on the third attempt after unrelated
`harness-ui-smoke` and `links-ui-smoke` timing failures). The release carries
Windows 202,738,688 bytes, Mac 170,217,943 bytes and `irori-0.1.66-full.nupkg`
202,100,794 bytes; anonymous downloads of the three packages matched
`SHA256SUMS.txt`. The website manifest now offers this release. Owner checks
remain: submodules from github.com itself and the installed Mac and Windows
builds.

Published 2026-10-02: **0.1.65** (#155, hibachi agent optional and agents side
by side) is merged at the owner's request and published as
[v0.1.65-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.65-preview.1)
by release run `36988096815` from main's successful CI run `36986846360`
(source `1b7b281`). It also carries 0.1.64 (#154, startup language), which was
merged but never published. The release carries Windows 202,732,544 bytes, Mac
170,216,335 bytes and `irori-0.1.65-full.nupkg` 202,095,725 bytes; anonymous
downloads of the three packages matched `SHA256SUMS.txt`. The website manifest
now offers this release. Owner device checks remain: the dock's columns and the
hidden page on the installed Mac and Windows builds, and real CLI turns in two
columns.

Optional hibachi agent and the agent dock, 2026-10-02 (**0.1.65**,
[ADR 021](decisions/021-optional-hibachi-agent-and-agent-dock.md)): the owner
put irori first as an IDE for knowledge bases and contents, with the hibachi
agent as an option, and asked for agent sessions side by side in a sidebar that
widens easily, with the page hideable.
- `DeviceSettings.hibachiAgent` (default off, **設定 → エージェント**). Off, the
  explorer's Schema section, the home's Schema card, the Schema view, the irori
  mode columns' AI/Schema rows and hibachi agent tab, and the ontology's hibachi
  agent button are not shown; the dock shows the irori agent.
- The assistant pane is a dock of columns (`AgentColumn`), each with its own
  conversation state, tabs, history and composer; a column shows the hibachi
  agent of the hibachi on show or the irori agent. The first column keeps owners'
  conversations under the owner id (shared with the Overview); later columns use
  `<scope>#<column>`. Later columns' drafts use `DraftKey.column`. No dock width
  limit; **列を追加** widens it.
- The stage pane is collapsible while the dock is open (**本文を隠す**, or drag);
  opening a file or closing the dock restores it.
- Run tracking and requests stay in the window; a run's end sends the next queued
  instruction unless a column shows that conversation (`display` registry).
- The website and its docs lead with editing and reading KBs and contents; the
  hibachi agent and Schema read as optional (Settings → Agents).
- Verified with `npm run build`, `npm test`, every `test:ui` suite under
  `xvfb-run` (new `dock-ui-smoke`; suites that use the hibachi agent turn it on
  first, as does `package-smoke`), `npm run format:check`, `npm run build:website`
  and `npm run test:website`. Not verified: real CLI turns in two columns,
  installed Windows/macOS builds.

Published 2026-10-02: **0.1.63** (#152, conversations side by side) is merged at
the owner's request and published as
[v0.1.63-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.63-preview.1)
by release run `36957402030` from main's successful CI run `36956668641`
(source `dab3b85`). The release carries Windows 202,729,984 bytes, Mac
170,215,174 bytes and `irori-0.1.63-full.nupkg` 202,091,092 bytes; anonymous
downloads of all six release files matched GitHub's asset digests, and the three
packages matched `SHA256SUMS.txt`. The website manifest now offers this release.
Owner device checks remain: two Claude Code or Codex conversations of one hibachi
running at once on the installed Mac and Windows builds. main's CI for #149
(`76d08fa`, docs only) failed once in `harness-ui-smoke` (a reload during a
request showed no finished turns); the next run on `dab3b85` passed.

Parallel conversations, 2026-10-02 (**0.1.63**,
[ADR 020](decisions/020-parallel-conversations.md)): the owner asked for CLI
agent sessions to run in parallel, the same as Claudian's tabs. This replaces
ADR 017 D4's one run per checkout.
- `AgentService` keys runs by run id: one run per conversation (`begin` also
  refuses a second claim), any number per hibachi. Each conversation's queue waits
  only for its own run; `startNextQueued(scopeId, conversationId?)` and
  `cancel(scopeId?, conversationId?)` gain the conversation. The irori agent no
  longer keeps the person's runs out of a handed hibachi; a hand-off stays one at
  a time per irori-agent run and hibachi, and its stop stops only it. `busy(scope)`
  (any run) still holds Git, settings, reorganizing and routine steps.
- The hibachi agent's panel keeps open conversations as tabs (shown from two),
  marking running and waiting ones; running tabs cannot close; a running
  conversation without a tab gets one. The renderer tracks runs by id.
- The person-lines and `hibachi` scripts are now written atomically.
- Verified with `npm run build`, `npm test`, `xvfb-run -a npm run test:ui` and
  `npm run format:check`. Not verified: real CLI turns running side by side,
  installed Windows/macOS builds.

Published 2026-10-01: **0.1.62** (#150, folders on this computer) is merged at
the owner's request and published as
[v0.1.62-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.62-preview.1)
by release run `36841492770` from main's successful CI run `36840169441`
(source `57cf6be`). The release carries Windows 202,728,448 bytes, Mac
170,211,167 bytes and `irori-0.1.62-full.nupkg` 202,090,938 bytes; anonymous
downloads of all six release files matched GitHub's asset digests, and the three
packages matched `SHA256SUMS.txt`. The website manifest now offers this release.
Owner device checks remain: a real sync-app folder (Drive for desktop, Dropbox,
iCloud) connected on the installed Mac and Windows builds, editing there, and a
Claude Code or Codex turn reading and writing it.

Folders on this computer, 2026-10-01 (**0.1.62**,
[ADR 019](decisions/019-local-folder-connections.md)): Google's restricted-scope
review and yearly security assessment stand between Drive sign-in and people
outside the test users, and the owner wants no one to set up Google Cloud. The
owner chose the Obsidian approach: a provider's own sync app (Drive for desktop,
Dropbox, Box, iCloud, OneDrive) keeps the folder on the device, and irori shows
a folder from it in contents. The connection dialog offers **このコンピューター**
first and **Google Drive** second.
- `CloudService` keeps local connections in `.irori/local-folders.json` (no path)
  and `local-bindings/` in irori's data (the path). Connecting makes
  `contents/<name>` a symlink (a junction on Windows); `locate` checks the link's
  identity and target and the folder's device and inode before following it, and
  refuses links inside it. Folders overlapping a hibachi or irori's data are
  refused; deletion goes through `shell.trashItem`. `HostAPI` gains
  `addLocalFolder` and `bindLocalFolder`; the existing connection methods handle
  both kinds. Standard-access Claude Code gets the folders as
  `additionalDirectories`, Codex as `sandbox_workspace_write.writable_roots`.
- The website gains the bilingual synced-folders guide; the Drive guide says
  sign-in is for invited testers.
- Verified with `npm run build`, `npm test`, `xvfb-run -a npm run test:ui`, the
  website build and smoke, and `npm run format:check`. Codex 0.159.0's app server
  reported the writable root without running a model. Not verified: real sync
  apps, installed Windows/macOS builds, Windows junctions, real CLI turns.
- Google readiness draft PR #146 also claims 0.1.62; whichever merges second
  takes the next version.

Custom-domain deployment, 2026-09-30: the owner registered **irori-ai.com** at
XServerドメイン. Website-only [PR #147](https://github.com/DeL-TaiseiOzaki/irori/pull/147)
is merged at `cb1846b`; [Pages run 36691804740](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/36691804740)
successfully deployed the updated canonical/alternate, social and download URLs.
GitHub Pages is configured with `irori-ai.com`. The owner corrected nameservers
and entered DNS records: registry/Google confirm `ns1.xdomain.ne.jp`–`ns3.xdomain.ne.jp`,
and Google/Cloudflare return the four required A records plus the www CNAME.
HTTP homepage and the old-site redirect work. Anonymous HTTP browser checks
passed on rerun after a transient document 503: desktop/mobile, images, current
download targets, both languages, canonical metadata and search. **HTTPS is
live since 2026-10-02**: GitHub's DNS health check, which had reported a
DNS/CAA failure nobody could reproduce, began passing for both hosts; one more
remove/re-add of the custom domain then got a certificate for `irori-ai.com`
and `www.irori-ai.com` (until 2026-12-31), and **Enforce HTTPS** is on. HTTP and
`www` redirect to `https://irori-ai.com/`. GitHub Support was not contacted
([HTTPS diagnosis and resolution](CUSTOM-DOMAIN.md#https-diagnosis-and-resolution)).
[DNS and ownership steps](CUSTOM-DOMAIN.md) record the evidence.
The owner added the Google Domain Property TXT record; a fresh Google DNS
response matches the supplied value. On 2026-10-01 the owner reported that
Search Console confirmed ownership and opened the Domain Property.
The published desktop remains 0.1.61. Google readiness is separate draft
[PR #146](https://github.com/DeL-TaiseiOzaki/irori/pull/146); no Google publishing
or verification setting has changed.

Published 2026-09-30: **0.1.61** (#142) is merged at the owner's request and
published as [v0.1.61-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.61-preview.1)
by release run `36672845624` from main's successful CI run `36671463044`
(attempt 2, source `1d11447`). Windows and Mac package launch/update checks passed;
Linux package checks passed. The release carries Windows 202,725,888 bytes,
Mac 170,185,390 bytes and the Windows full update package
202,086,166 bytes. Anonymous downloads of all six release
files matched GitHub's asset digests; the three application packages also matched
`SHA256SUMS.txt` and native package evidence. The website manifest now offers this
release. Pages deployment and release-sync verification follow its merge.

The first main CI attempt caught an existing Schema UI smoke timing race: the
watcher could list a renamed skill before its metadata write completed. The
assertion now polls for the same exact file contents, preserving all checks;
the focused smoke passed locally. The unmodified source CI passed on attempt 2.

The [audit](AUDIT-2026-09-30.md) maps the current architecture, reproduced
failures and bounded-history memory measurements; STATUS records the fixes and
verification. Real provider inference and installed-device acceptance remain
unverified. Concurrent website documentation work stays in its own branch.

Current development, 2026-09-30: **0.1.60 is published** as
[v0.1.60-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.60-preview.1)
(#136, #139, #140; release run `36660235725` from main CI `36658865418` at `a6b53a0`). It
carries page comments ([ADR 018](decisions/018-comments.md), 0.1.58), the agent prompts
gathered in `prompts/` (0.1.59) and conversations
([ADR 017](decisions/017-conversation-history.md) stage 1, described in
[CONVERSATIONS](CONVERSATIONS.md)); STATUS has the details. Next for conversations, when the
owner asks: stage 2 (the **会話の保存先** setting and moving conversations, search over titles,
notes and text), then stage 3 (rewind, clone, rebuilt context, native fork per CLI). Still
unverified: real CLIs with the new store (Claude Code's `tool_result` capture in particular)
and an installed app. The old `agent-conversations`/`agent-sessions` files are removed in a
later release.

Current development, 2026-09-30: **0.1.57 is published** as
[v0.1.57-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.57-preview.1)
(#137; release run `36623266425` from main CI `36621924195` at `1c45665`). Routines are
[ADR 016](decisions/016-routines.md) stage 1, described in [ROUTINES](ROUTINES.md); the
view is irori mode → **ルーティン**. Agent steps ran on real Claude Code and Codex
(`npm run test:routines`, at the owner's word); STATUS has the results. Next, when the owner
asks: stage 2 secrets (`safeStorage`, given only to the `run` steps that name them, removed
from recorded output), stage 3 Python through uv (a pinned SHA-256, and
`PYTHONDONTWRITEBYTECODE` so `__pycache__` does not bring the review back), stage 4 the irori
agent's skill for writing a routine. Still unverified: an installed app, real Pi, OpenCode
and Hermes Agent steps, and a routine gathering real mail with the person's own OAuth
client. Page comments (#136, another session) becomes 0.1.58 after a rebase onto this.

Current development, 2026-09-29: **0.1.56 is published** as
[v0.1.56-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.56-preview.1)
(#131; release run `36560142606` from main CI `36559142972` at `71b8da6`). UI copy rule
from the owner: labels and values only, one-sentence errors, the shortest name that still
identifies an action, nothing shown twice. Write new UI text to that rule.

Current development, 2026-09-29: **0.1.55 is published** as
[v0.1.55-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.55-preview.1)
(#129; release run `36544049853` from main CI `36542859364` at `15f7c3d`). Explanatory
text across the app was cut to a minimum at the owner's request: keep new UI copy to a
heading or a few words, and fix the UI rather than add an explanation. The download
website is now English and short (#127, #128).

Current development, 2026-09-29: **0.1.54 is published** as
[v0.1.54-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.54-preview.1)
(#125; release run `36530029192` from main CI `36529091919` at `f46a187`). A knowledge
page's frontmatter now opens as properties above the note, driven by the KB's optional
`.property/property.json`, and saving records the person as the last change
([ADR 015](decisions/015-page-properties.md) stage 1). Next: stage 2 pickers for files,
sources and relations, **確認済みにする**, tag suggestions; stage 3 new page from a type.
Not yet tried with Japanese IME on an installed Windows or Mac build.

Current development, 2026-09-28: **0.1.53 is published** as
[v0.1.53-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.53-preview.1)
(#122; release run `36428007641` from main CI `36426700197` at `d54aae9`). A hibachi
can now start in irori and become a GitHub repository: **hibachi を追加 → 新しく作成**,
**Git を始める** and **GitHub に公開…** ([GIT](GIT.md#making-a-hibachi-here-and-publishing-it)).
Publishing runs the person's GitHub CLI (`gh repo create`, private by default).
Not yet tried with a real `gh` on github.com, nor on macOS or Windows 11.

Current development, 2026-09-28: **0.1.52 is published** as
[v0.1.52-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.52-preview.1)
(#120; release run `36376072906` from main CI `36375356486` at `b002eb2`). Every
Drive connection now mounts with rclone's full cache, 2 GiB / 7 days per mount
([ADR 012](decisions/012-drive-editing.md)), because the owner found opening a
file in `contents` slow. Not yet tried on a real mount. The owner also reported
an error dialog that blocks quitting; its text is still awaited. Only two
dialogs in `stop()` (`src/host/main.ts`) do that: the conversation-history save
and closing the cloud connections, where a failed unmount is retried forever.

Current development, 2026-09-28: **0.1.51 is published** as
[v0.1.51-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.51-preview.1)
(#118). The rail's irori mode button shows irori mode's own mark
(`assets/irori-mode-icon*.png`, made from the owner's artwork; `assets/README.md`
records how) instead of the map glyph. The same PR fixed the CI-only
`harness-ui-smoke.ts` race that had failed main at `d3f46b9`.

Current development, 2026-09-27 (evening): **0.1.50 is published** as
[v0.1.50-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.50-preview.1)
(#114–#116). Owner vocabulary from now on: a brain is a **hibachi**, its AI the
**hibachi agent**; "your AI" is the **irori agent**, and the overview is
**irori mode** (there is deliberately no "hibachi mode"). Code identifiers keep
`brain`/`you`. What shipped:
- hibachi agents and the irori agent run on Claude Code, Codex, OpenCode, Pi or
  Hermes Agent, with a model picked from the installed CLI, full access by
  default, and no run time limit;
- the irori agent hands work to `hibachi-<name>` sub-agents irori writes
  (Claude Code, Codex, OpenCode) or to the `hibachi` command (Pi, Hermes);
- the Schema layer, for a hibachi and for the irori agent, is edited as
  instructions, skills, rules and hooks.
The owner verifies the real CLIs; STATUS lists what is unverified.

Current development, 2026-09-27: **0.1.47 is published** as
[v0.1.47-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.47-preview.1)
(#112). It fixes:
- the stray "Unknown or ambiguous cloud owner" after removing the open workspace;
- clicks on the conflict resolve buttons that were lost during a re-read;
- Windows saves that failed while another program briefly held the file.

The Windows autosave fix is the likely one but unproven; watch `package-smoke`'s
new diagnostics if that check fails again. STATUS has the details.

Current development, 2026-09-26 (night): **0.1.46 is published** as
[v0.1.46-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.46-preview.1)
(#110). Clone, fetch, pull and push against `https://github.com` fall back to the
GitHub CLI's sign-in when Git's own credentials are refused. Git failures show
their redacted output under 詳細. STATUS has the details. The owner's own
private-repository clone from the installed Mac app is the open confirmation.

Current development, 2026-09-26 (evening): **0.1.45 is published** with file
viewers as
[v0.1.45-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.45-preview.1)
(#107). PDF, Word (`.docx`), PowerPoint (`.pptx`), spreadsheets
(`.xlsx/.xlsm/.xls/.ods`) and images open on the stage, view only, instead of in
the external application. STATUS has the design; the libraries and their limits
are in [file viewer libraries](libraries/file-viewers.md).

Current development, 2026-09-26: **the interface switched to v5.** The owner
approved the v5 design canvas on 2026-09-25 and asked for the whole interface to
switch to it, keeping every capability ([ADR 014](decisions/014-ui-v5.md), which
also records the owner's answers). The work went in six stages:

- **Published:** stages 1–4 and the your-AI spike (#97–#101) are merged and
  published together as
  [v0.1.41-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.41-preview.1)
  (release run `36155578107` from main CI `36154273703`, source `a49c1a4`,
  record #102). This covers the rail and brain panel, the brain views, brain
  identity, the Overview with brain AIs side by side, and search across brains.
  0.1.38–0.1.40 were never published on their own.
- **Merged on 2026-09-26** at the owner's word ("全部マージして"):
  - #103 (0.1.42), **your AI** (`docs/YOUR-AI.md`). It also fixes a 0.1.41 bug
    where a permission request could show as ended.
  - #104 (0.1.43), the zoom between levels and the finish against the canvas
    (`scripts/ui-screens.ts` captures the screens). It also shares one backlinks
    scan between the count and the list.
  - #96, the 0.1.37 handoff; its section follows.
- **Published:** [v0.1.44-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.44-preview.1)
  carries all of it, 0.1.42 and 0.1.43 folded in. #105 (0.1.44) re-reads a
  conflict when its resolution is refused; `git-ui-smoke` had failed on CI
  without it. STATUS gives the runs.
- **Later:** Codex for your AI; your AI's work shown in a brain's own AI panel;
  holding only the brains a hand-off reaches; and, with the owner, what your AI
  should typically ask of the brains.

The paragraphs below predate v5.

Current development, 2026-09-25: **0.1.37 is published** as
[v0.1.37-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.37-preview.1);
nothing is open. One session delivered 0.1.31–0.1.37 from the owner's reports
and requests: readable dialogs and choosing an opened Drive folder (#86),
resizable explorer rows (#87), an English/Japanese interface ([ADR 011](decisions/011-interface-language.md), #88),
the Windows WinFsp `realpath` failure (#90), editable Drive folders
([ADR 012](decisions/012-drive-editing.md), #91), rename/move/delete, images,
a save-time Drive version check and upload failure reasons (#92), and Drive
folders belonging to KBs with the separate Drive frame removed
([ADR 013](decisions/013-drive-folders-in-kbs.md), #94). 0.1.33 and 0.1.36 were
published on the way. None of the Drive work has been tried on the owner's
Windows 11 or macOS devices yet; see [HANDOFF-PROMPT](HANDOFF-PROMPT.md) for the
owner's first steps after updating and the next work.

Current development, 2026-09-23 (night): **0.1.30 is published** as
[v0.1.30-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.30-preview.1).
It reads a newer release's own file list when GitHub's release list omits it
(PR #84); releases are now published from a draft. The owner installs 0.1.30
once by hand, and the first real in-app update is 0.1.30 to the next version.

Earlier the same evening, **0.1.29 was published** as
[v0.1.29-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.29-preview.1).
It adds in-app updates with one button (PR #80, [ADR 010](decisions/010-in-app-updates.md),
[UPDATES](UPDATES.md)); PR #81 steadied their Windows smoke and PR #82 pointed the
download page at it. An installed 0.1.28 or earlier has to install 0.1.29 once by
hand; the first real in-app update is 0.1.29 to the next version, on the owner's
Windows 11 and macOS 26 devices. See STATUS for GitHub's stale release listing
right after publication.

Earlier, 2026-09-23: **0.1.28 was published** as
[v0.1.28-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.28-preview.1).
It carries the 0.1.27 access-policy work (PR #75) and the 0.1.28 code-assistance
toggle (PR #76); 0.1.27 was not published on its own. PR #77 added the notes and
download manifest, PR #78 the records, and main was `95fbc12`.
[HANDOFF-PROMPT](HANDOFF-PROMPT.md) carries the current next work.
Read the newest [STATUS](STATUS.md), [ADR 009](decisions/009-agent-access-and-extension-compatibility.md),
[real native acceptance](REAL-AGENT-ACCEPTANCE-2026-09-23.md) and
[VS Code compatibility evidence](research/VSCODE-EXTENSION-COMPATIBILITY-2026-09-23.md).

The owner chose user-selectable write permission, ordinary CLI capabilities,
and VS Code extension compatibility. These are no longer pending product
questions. Native permission selection and device outbox recovery are implemented
on main; Google writable transport and the compatible workbench integration
remain next work. A working VS Code API probe ran on isolated VSCodium; it did
not add an extension host to irori. Model authorization is present for native
acceptance using existing accounts, but it does not authorize account changes
or silently enabling experimental provider features. New feature merges still
need authorization. Earlier contrary delivery/decision statements are historical.

Current delivery, 2026-09-23: PR #73 is merged at `aa0bbfe` and
[v0.1.26-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.26-preview.1)
is published for Windows x64 and Mac arm64. The owner explicitly approved
real native CLI model acceptance on this date. Later work and decisions belong
in the newest STATUS entry; the earlier waiting-for-merge and model-approval
statements below describe their dated checkpoints.

Current continuation, 2026-09-22: main is `9c92f39`, with **0.1.25** published.
The owner's follow-up audit and implementation are on `fix/audit-recovery`,
prepared as **0.1.26**; they need pull-request review and an authorized merge.
Read [the audit and remaining work](AUDIT-2026-09-22.md), current
[STATUS](STATUS.md), and [HANDOFF-PROMPT](HANDOFF-PROMPT.md) before the historical
entries below. Note/reference and authorship preservation, graph regeneration,
Drive recovery, initial clone notes and exact cloud-preparation binding have
been addressed in that branch. Real device/model acceptance and the remainder
of writable cloud delivery remain open. No new installer has been published.

## Historical continuation records

Resume here, 2026-09-21 (evening, after the 0.1.19 delivery): `main` is `60eea4e`
and [v0.1.19-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.19-preview.1)
publishes it for both platforms, with the download page in step. **#61 (0.1.20)
is open** and is the first thing to check: publish it once the owner merges it.
Give the next session [HANDOFF-PROMPT](HANDOFF-PROMPT.md); it is current.

The session built backlinks (#53), their follow-ups (#55), link rewriting on
move (#56), a device-local search index (#57) and the skill reach check,
retirement markers and scopes (#58), most of it through Fable agents in separate
worktrees whose results the lead re-verified on the stacked base. The owner then
settled authorship: **the person's lines, one mark per line**, told to Claude
Code at edit time and to any agent on request, and shared later as Git AI
Standard `h_` entries alone — [ADR 006](decisions/006-person-lines.md), built in
#61; #59 closed. The workspace root became the private repository
`irori-workspace`.

Three things are easy to get wrong next time:

- **Never package from a worktree whose `node_modules` is a symlink.** Forge
  works on the shared tree: it emptied `node_modules/.bin`, rebuilt node-pty for
  Electron and deleted the other platforms' prebuilds and the Agent SDK's
  platform packages. `npm rebuild --ignore-scripts` and `npm pack` of the locked
  versions repaired it. CI's package jobs cover packaging.
- **A backgrounded Fable agent does not survive a session restart**, and after
  one it is reachable by its agent id, not its name. Check its worktree before
  assuming progress.
- **Host-side scans must stay linear in line length.** A lookahead with `.*` or a
  lazy backreference took minutes on a crafted line in the main process; a test
  in `tests/note-links.test.ts` holds crafted lines under a second.

Resume here, 2026-09-21 (after the 0.1.14 delivery): `main` is `ae6b0f9` and
[v0.1.14-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.14-preview.1)
publishes it for both platforms, with the download page in step. Give the next
session [HANDOFF-PROMPT](HANDOFF-PROMPT.md); it is current. The download is a
third smaller than 0.1.12: 215,796,224 bytes on Windows against 319,919,104,
and 182,424,344 on the Mac against 281,574,107.

That session merged four more pull requests. #49 stopped the package carrying
executables irori never runs — the Agent SDK's own ~220 MB Claude Code binary,
which the SDK resolves only when `pathToClaudeCodeExecutable` is unset while
`src/agents/service.ts` always passes the reader's installed `claude`, and
node-pty's prebuilds for other platforms. #50 made notes follow their own links
with Ctrl/Cmd + click. #51 pointed the download page at the new release and #52
records the delivery.

Four things are worth knowing before the next change:

- **The handoff's own premise about links was wrong.** It said `[[wiki link]]`
  resolution; the recommended template writes **relative Markdown links**, since
  a page's identity there is its path (`irori-templete` ADR 002 D3), and that
  repository contains no `[[` at all. #50 implements the relative form. See
  [NOTE-LINKS](NOTE-LINKS.md).
- **An index for search has a Japanese constraint.** `node:sqlite` with FTS5 is
  available in Electron 44 (SQLite 3.53.4), but `unicode61` makes a Japanese
  sentence one token, so a query inside it never matches, and `trigram` returns
  nothing for a query shorter than three characters. Two-character queries are
  ordinary in Japanese, so an index needs trigram plus a `LIKE` path for short
  ones. Measured, not assumed.
- **Every substantial change adds a section at the top of `docs/STATUS.md`**, so
  two branches cut from `main` conflict there whichever order they merge. Stack
  the later one on the earlier (`gh pr edit <n> --base <branch>`) and retarget
  it at `main` when the first merges; GitHub does not retarget by itself here.
- **The hourly drift check reads the live download page.** The scheduled run at
  01:17:04Z failed by 25 seconds because Pages was still deploying the new
  manifest; the dispatched run at 01:18:12Z reported `main` in step. Publish the
  website before the hour, or dispatch `release-sync.yml` after the deployment.

`gh workflow run release.yml` was allowed again, with the owner's explicit
instruction to merge. A `for` loop polling `gh run view` on that release run was
refused by the CLI's own classifier; single `gh run view` calls work.

Resume here, 2026-09-21: `main` is `96d0823` and
[v0.1.12-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.12-preview.1)
publishes it for both platforms, with the download page in step. Give the next
session [HANDOFF-PROMPT](HANDOFF-PROMPT.md); it is current and this paragraph
only adds what a resuming agent would otherwise have to rediscover.

That session merged five pull requests. #43 made agent runs per knowledge base
instead of per application. #44 removed 3.1 MB of unreachable code from the
package, chiefly KaTeX, which `features: { Latex: false }` never removed
because the flag is read after bundling. #45 records which lines an agent wrote,
keyed by the line's text rather than its position — read
[AUTHORSHIP](AUTHORSHIP.md) before extending it, especially for why irori does
not call `git ai checkpoint known_human`. #46 is
[ADR 005](decisions/005-host-and-references.md): irori is not built on orca,
and the four product directions the owner stated are recorded with their honest
current state.

Three things are easy to get wrong next time:

- **Stacked pull requests do not retarget themselves here.** #44 and #45 were
  opened against their parents. GitHub moves a PR to `main` only when its base
  branch is deleted, and these were not, so each had to be retargeted with
  `gh pr edit <n> --base main` before merging — merging as they were would have
  landed them on the parent branch instead of `main`.
- **A gap in published versions is deliberate.** 0.1.10 and 0.1.11 have notes
  but no package. Each PR had to advance the version to pass `release-sync.yml`;
  publishing the intermediate ones would make a reader upgrade twice to reach
  the same code.
- **`release.yml` dispatch worked** in this session with the owner's explicit
  instruction to merge, contrary to an earlier note that it is always refused.

Two decisions are the owner's and are not settled: what "taking in extensions"
is to mean, and whether the graph is drawn from the OKF bundle or the declared
CSV pair. The workspace root outside the three repositories is also under no
version control, which the owner has not yet been asked about.

Resume here, 2026-09-17: `main` and the published preview are to stay in sync.
The owner gave standing authorization for agents to publish a preview after an
authorized merge. That covers the prerelease, the website manifest and Pages
deployment, and the anonymous download check. Signing identities, notarization,
a non-preview release and account changes still need their own authorization.
The latest preview, [v0.1.9-preview.1](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.9-preview.1),
publishes `main` for both platforms. See [CHECKPOINT](CHECKPOINT.md) for the
order used and what the three releases under the checks showed. A branch opened
before the checks existed carries neither a version nor notes: add both while
rebasing it, and correct any verification numbers it states, rather than
discovering it when the pull request fails.

Template and daily notes, 2026-09-17: `irori-templete` `main` is now an OKF 0.2
bundle maintained by agents (its ADR 002); it ships no ontology files and expects
the KB to declare where notes go. irori 0.1.8 adds that declaration,
`.irori/notes.json`, and **今日のノート**; read [DAILY-NOTES](DAILY-NOTES.md)
before touching note creation. The decision left open then — whether the graph
view should read the bundle instead of a declared CSV pair — was taken on
2026-09-22: the pages are the source of truth and irori generates a graph index
the KB carries in Git ([ADR 008](decisions/008-graph-index-module.md),
[ONTOLOGY](ONTOLOGY.md)); a declared pair still wins.

After merging an app-affecting change, advance the package version and publish,
or report the drift explicitly. The update check never offers a newer preview of
the version a reader already runs. `release-sync.yml` enforces the version and
notes on pull requests, and flags `main` when a shipped change stays unpublished
for more than an hour; `scripts/release-policy.ts` decides what ships. Automatic
publication with a generated website manifest is the next step. Until it lands,
publish by hand as [DISTRIBUTION](DISTRIBUTION.md) describes.

Mac download, 2026-09-16: [v0.1.5-preview.3](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.5-preview.3)
was published before anyone had confirmed it starts on a Mac. On 2026-09-17 the
owner reported that it launches; it has only been used lightly, so installed-Mac
acceptance is still open. The first published Mac build was verified, hashed and
deployed, and still could not launch; see [CHECKPOINT](CHECKPOINT.md) for what
that cost and why CI missed it. Intel Mac is out of scope and its mechanism is
removed, not disabled.

Mac delivery, 2026-09-16: the Mac download is enabled. Read
[PACKAGING](PACKAGING.md) before touching `forge.config.cjs`: the Mac bundle must
stay signed, and `osxSign.continueOnError` must stay `false`, or Forge will
happily produce an unsigned package again and the download becomes unopenable
without failing any job. The Mac signature checks in `scripts/package-smoke.ts`
run against the built output and the copy inside the disk image, never the
relocated copy — Node's copy drops the extended attributes codesign writes for
non Mach-O members. Hardened runtime must stay off while the signature is
ad-hoc: its library validation compares Team IDs, an ad-hoc signature has none,
and macOS 26 then refuses to load Electron Framework into the app. It is
disabled through `optionsForFile`, because `@electron/osx-sign` silently
discards a top-level `hardenedRuntime` — check the published CodeDirectory flags
before believing any such setting. The Mac package job runs on `macos-26` to
match the acceptance device; an older runner accepted a build that cannot
start there. Published installer names
are part of the update-check contract in `src/host/updates.ts`; renaming a
release asset silently stops that platform from resolving an update.

Checkpoint, 2026-09-16: the renderer UI arc (PRs #9-#15) is merged and verified
on `main`; see [the UI checkpoint](CHECKPOINT-UI-2026-09-16.md) for the commit
and CI identities, what was fixed along the way, and what was deliberately left
for its own branch. Source only — the published Windows preview is unchanged.

Device preferences, 2026-09-16: theme and pane sizes live in
`device-settings.json` through `deviceSettings`/`saveDeviceSettings`, not in the
renderer. Browser storage is not durable here — the window is a file URL — so do
not reach for `localStorage` for anything that must survive a launch. When a
resizable group gains or loses a pane, update the identifier list passed to
`useDefaultLayout` with it, or the layout is written and read under different
names. The stylesheet follows `data-theme` on the root, which the renderer
resolves; `nativeTheme.themeSource` is set for the operating system and cannot be
relied on to change `prefers-color-scheme`.

Source-control reads, 2026-09-16: the dropped-read defects in `RepositoryPanel`
are fixed (commit diffs have their own generation, the status read depends on
`conflictDirty`, the review refreshes in place, a click during another operation
leaves a notice). Read [UI findings](UI-FINDINGS-2026-09-15.md) before touching
that panel: its guards are refs and derived state, and an early return in an
effect whose condition is not a dependency silently drops the read for good.
`aria-busy` on the review region is load-bearing — `git-ui-smoke` waits on it.
Open items there: a refresh still restarts an in-flight read for the same target,
assistant links stay inert until a validated URL route exists, and the dark
palette still follows the operating system only.

Renderer libraries, 2026-09-15: `feat/ui-library-adoption` follows the UI
foundation with Markdown assistant replies, Japanese Crepe chrome, Base UI toggle
groups and an application error boundary; see
[ADR 004](decisions/004-ui-library-adoption.md) and STATUS. Before proposing another
library, read that ADR's rejected list — TanStack Query, virtualisation, a tree
component, tooltips, toasts, a diff library and electron-updater were each examined
against this codebase. When agent output needs richer display, extend
`AgentMarkdown`'s component overrides rather than relaxing them: the renderer must
not navigate or fetch on untrusted output.

UI foundation, 2026-09-15: the renderer's design tokens, dark palette, icon set,
resizable panes and popup primitives are migrated on `feat/ui-foundation`; see
[ADR 003](decisions/003-ui-foundation.md) and STATUS for the verification. Build,
behaviour tests and all twelve UI suites pass locally. The branch changes no
product behaviour and no published bytes. When continuing, prefer extending the
token roles over adding literal colours, and reach for Base UI before writing a
new popup by hand. The follow-ups this foundation was built for — splitting the
assistant panel into conversation and activity surfaces, showing agent edits as a
reviewable diff in the note, and a ⌘K command palette — are product behaviour
changes and need their own branches.

Workflow update, 2026-09-14: the owner requires every future new feature to start
on a dedicated branch and be submitted through a PR to `main`. Verify and push
the feature branch, open the PR and leave it open unless merging is authorized.
This supersedes older direct-to-main feature commit/push instructions; earlier
checkpoint hashes below remain historical evidence.

Source 0.1.5 daily recovery work is merged into `main` as
`278f5a407e270752057dbe4a10574a9450644934` and published. Read
[RECOVERY-AND-NOTE-TOOLS](RECOVERY-AND-NOTE-TOOLS.md) for private composer/Git
drafts, manual update checks, image feedback, safe note organization and match
navigation. The public installer and website are now the verified 0.1.5 preview;
[its release notes](releases/0.1.5-preview.1.md) and [CHECKPOINT](CHECKPOINT.md)
hold the exact package and delivery evidence. The next device step is the
owner's installation of the 0.1.5 EXE over 0.1.4.

Local combined verification passes: build/typecheck, 127/131 behavior tests
(four explicit environment skips), all twelve UI suites, website build and
fixtures, Linux x64 Forge/relocated packaged smoke and documentation/format
checks. New packaged checks exercise private composer/conflict drafts and
recoverable deleted notes after restart without inference. Preserve the
reconciliation generation/hash guard: delayed file reads must not invent
conflicts after another read/save has updated the editor. Search mapping uses
original-source Markdown AST text positions; hidden URL matches do not map to
unrelated visible text. Native CI results belong to the PR, not a new release.

Windows 0.1.4 public delivery is verified, 2026-09-14. The owner authorized
merging and publishing; both PR #2 (application) and PR #3 (release metadata)
are merged. Pages run 34843640838 deployed website revision `e32ed4e`.
At `2026-09-14T12:31:36.870Z`, a fresh anonymous desktop/mobile browser downloaded
all 318,426,624 installer bytes and matched SHA-256
`ffaa1ba1afc3ee358af1aee55860cca83fc294d69819907d277de6c5424de16b`
against CI/release evidence. Page/HTTP errors were empty; Mac remains disabled.
See [CHECKPOINT](CHECKPOINT.md) for exact identities. Next device check: close the
old application, install the new EXE, verify **0.1.4 Preview**, then paste an image
and continue typing after save/undo. No successful owner-device test is implied.

A post-publication CI rerun (34843622651) exposed a timing assumption in the new
save/undo fixture: adjacent setup and tested edits within ProseMirror's default
500 ms history group can both be undone. The fixture now pauses 600 ms before
the tested edit, preserving immediate save/undo and every assertion. Three
focused UI runs, typecheck and formatting pass. This is a test-only correction;
the published executable and its verified source/bytes are unchanged.

Windows 0.1.4 publication, 2026-09-14: the owner authorized merging PR #2 and
publishing the Windows update. PR #2 is merged as
`e72a62b53950b2ddb3f9132f4e66f341a74f80fc`; its Git tree exactly matches native CI
34841807049's tested PR merge. The
[0.1.4 preview](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.4-preview.1)
is public with the unchanged verified EXE, checksum and Windows package evidence.
The EXE is 318,426,624 bytes with SHA-256
`ffaa1ba1afc3ee358af1aee55860cca83fc294d69819907d277de6c5424de16b`; GitHub's asset
digest matches. The website manifest is updated to 0.1.4, with Mac slots disabled.
Pages deployment and anonymous delivery still need their own completion record.
The previous installed version and installed 0.1.4 acceptance remain unknown;
the owner's approval is publication authorization, not a successful device test.

Daily-workflow branch, 2026-09-14: source version 0.1.4 on
`feat/daily-editing-workflow` implements the repeated installed-app feedback.
See [Daily workflow](DAILY-WORKFLOW.md) for the save/immediate-undo fix, native
clipboard tests, compact assistant, source-control sidebar and version display.
Production build, 85/88 behavior tests (three optional skips), all ten UI suites
and website checks pass locally. The Git UI preserves partial staging and
conflict drafts while allowing note editing beside source control. Linux package
smoke covers trusted OS paste and continuous editing outside the checkout;
native CI is recorded on the feature PR. Do not confuse this source change with
an update to the owner's Windows installation or public download: the published
Windows preview remains 0.1.3, and the reported installed version is unknown.
Leave the feature PR open until merging is authorized; a new installer release
requires verified native CI bytes and the existing publication procedure.

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

Continue development in `/workspace/KB_design/irori`, an independent Git repository on `main`, remote `https://github.com/DeL-TaiseiOzaki/irori.git`. Inspect `git status` and the relevant recent commits before making changes; check remote release/CI state when the task concerns delivery. Preserve any work added after this checkpoint. irori-extention provides irori capabilities in VS Code, and `irori-templete` is the recommended main-KB repository template under development. Each has an independent history; change a sibling only when the current task includes it.

Follow [AGENTS](../AGENTS.md) and use [STATUS](STATUS.md) to locate the current work. Load [DEVELOPMENT](DEVELOPMENT.md) for setup, the [host decision](decisions/001-initial-host.md) for architecture changes, [confirmed product decisions](decisions/002-release-and-workspace.md) for product constraints, and [CHECKPOINT](CHECKPOINT.md) / [RELEASE-PLAN](RELEASE-PLAN.md) for delivery. The current sections and actual code supersede historical milestone statements. Open only the topic needed from [DISTRIBUTOR-GOOGLE](DISTRIBUTOR-GOOGLE.md), [CLOUD-SETUP](CLOUD-SETUP.md), [TERMINAL](TERMINAL.md), [PACKAGING](PACKAGING.md), [ACCEPTANCE](ACCEPTANCE.md), [WORKSPACE-DRIVE](WORKSPACE-DRIVE.md) and [ONTOLOGY](ONTOLOGY.md). The [initial workspace specifications](../../docs/irori/) are historical; their old Q01/Q02 proposals are superseded by ADR 002.

Respond in Japanese. Write code, identifiers, technical documents and commit messages in English. The user prioritizes simple code and established libraries, expects implementation and verification, and has authorized feature-branch commit/push and PR creation. Every new feature must follow the branch/PR workflow above. Complete independent work while waiting for device/account input. Read [the completed reuse assessment](REUSE-COMPLETION-2026-09-13.md) before proposing another broad library migration; Git collaboration and native adapters already exist.

## Public delivery and exact identities

| Item               | Verified value                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Download site      | https://del-taiseiozaki.github.io/irori/                                                               |
| Release            | `v0.1.12-preview.1`, unsigned Windows x64 and Apple silicon Mac prerelease                             |
| Application commit | `08900b05ee5ff5dcc82fd211e25e40e065ca8d04`                                                             |
| Native CI          | [35544793813](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35544793813), all jobs successful  |
| Release run        | [35545248675](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35545248675), successful           |
| Website commit     | `96d082352f94cea6fc4be3cb0c0756be8179bded` (#47)                                                       |
| Pages deployment   | [35545797228](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/35545797228), successful           |
| Windows installer  | `irori-0.1.12-windows-x64-Setup.exe`, 319,919,104 bytes (305.1 MiB)                                    |
| Windows SHA-256    | `b516f7ecac2dc1e54b97a06e627dca3e97a3db8b24a0dd84832c3e1c4a143fd1`                                     |
| Mac disk image     | `irori-0.1.12-macos-arm64.dmg`, 281,574,107 bytes (268.5 MiB)                                          |
| Mac SHA-256        | `ca86e0956dadaae621503fad51b659d9a3f018ee3f7a2f274e3528e389276259`                                     |

On 2026-09-21 both installers were fetched without credentials straight from the
release URLs; both returned HTTP 200 with the byte counts and SHA-256 above,
matching `SHA256SUMS.txt` and GitHub's own asset digests. The deployed site's
bundle names both installers and the tag. Continue from current `main`; the
release commit identifies the binary, not the latest documentation. Earlier
identities are in [CHECKPOINT](CHECKPOINT.md) and the release notes.

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

The owner authorized development, verification, feature-branch commit/push and PR creation, and separately requested the Windows testing download channel and the terminal/Google follow-ups. Every new feature now requires a dedicated branch and PR; previous commit/push authorization does not permit direct feature changes on `main` or imply merge authorization. Preserve authorization for necessary tested work without re-asking. The narrow unsigned Windows preview is not approval for a complete general release, a Mac release, unrelated external account changes, or paid native model execution. Follow AGENTS for real provider tests; do not run `test:agents` or real-model UI tests without the required authorization, or bypass provider authentication/permissions.

The old VM preview may still be running older code. `.local/vm-preview/samples` and `.local/vm-preview/device` contain untracked user data: preserve them and do not reset/delete them. This checkpoint did not restart that preview. `.local/publication/`, `.local/rclone/`, `.local/downloads/`, `out/` and `test-results/` hold ignored tools/test artifacts, including a synthetic-client local package; publish only the verified CI artifact for the exact intended commit. The anonymous download checker is `.local/publication/check-site.mjs`, not a tracked production dependency.

Desktop CI creates temporary engineering artifacts; it does not publish releases or Pages. Website deployment is manual via `.github/workflows/website.yml`. A new published installer requires a distinct version, verified native bytes, notes/checksums, the matching manifest, and anonymous delivery verification. Keep live Google client values, account tokens, authorization URLs, user notes and transcripts out of tracked evidence.
