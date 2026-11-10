# 057 — Settings show one part at a time, chosen from framed groups

Date: 2026-11-07. Status: owner request; implemented for 0.2.60.
Supersedes decisions 2 and 3 of [ADR 055](055-settings-sheet.md); the sheet
itself (decision 1) and a choice applying at once (decision 4) stay.
[ADR 059](059-the-window-shows-the-work.md) adds **画面に出すもの** to 表示 and
the CLIs' versions to **共通**.

## Context

From 0.2.53 the settings were a sheet whose side list scrolled one long column
to a part. The owner found it hard to understand: what was set where was not
designed as a whole. The vault agent's switch, the access of new conversations
and a button to every Schema shared one エージェント section, although the
irori agent and the vault agents have different roles. The owner asked for the
side list to be designed first, as frames and lists, with each part's own
settings shown when its entry is chosen.

A review of 0.2.59's sheet also found:

1. On/off settings (vault agent, JavaScript, Python) looked like one option of
   a choice: nothing said whether they were on.
2. The chosen option differed from the others only by a slightly lighter fill.
3. The Schema button had no left padding, dimmer text than the choices beside
   it, and the shape of a choice, although it closes the settings and opens
   another dialog.
4. What the vault agent's switch does was only in a tooltip; the routine
   runtimes had no explanation, and Python's download showed no progress.
5. Note display choices apply at once, but the blurred window hid the note, so
   their effect could not be seen until the sheet closed.
6. Updates named no version.
7. The account's error folded its details under the system's marker, and kept
   the language it was read in after the language changed.

## Decisions

1. **The side lists framed groups.** Each group has a small label and its
   entries in one frame:
   - **表示** — **言語とテーマ**, **ノートの表示**.
   - **エージェント** — **共通** (what applies to every agent), **irori agent**,
     **vault agent**: the two agents are separate entries because their roles
     differ.
   - **自動化** — **ルーティン**.
   - **アカウントと更新** — **アカウント**, **更新**.

   Each entry shows under its name its current value (日本語・いろり,
   ゴシック・16px, 新しい会話：標準 in the attention colour when it is
   フルアクセス, オン/オフ, the runtimes turned on, the version with
   更新あり when one waits) or, for the irori agent, its role. The entry on
   show takes the focus colour on its icon.
2. **One part at a time.** Choosing an entry shows that part alone, its name and
   one sentence on what it governs at the top. The part shown last opens again
   the next time the settings open in that window.
3. **Rows say what they do.** Each part frames its rows in groups. Every setting
   has a visible description. A choice is a row of tiles; the chosen tile takes
   the focus colour with a check, and **フルアクセス** the attention colour.
   On/off is a switch with オン or オフ beside it. A setting kept elsewhere is a
   row with **開く** and a chevron. A row that needs a workspace or the irori
   agent says so where its button would be.
4. **What each agent part holds.**
   - **共通**: the access of new conversations (each option with what it does)
     and the shared Schema.
   - **irori agent**: what it is; its working folder for this workspace
     ([ADR 044](044-where-agents-work.md)); setting it up when it is not; its
     Schema; its own screen.
   - **vault agent**: what it is; the switch ([ADR 021](021-optional-hibachi-agent-and-agent-dock.md))
     and, always visible, what still runs while it is off; each vault's Schema.

   Each Schema button opens the Schema dialog ([ADR 027](027-shared-schema.md))
   on that owner.
5. **Notes show a sample.** The note display part starts with a few lines in the
   note's own face, size, line spacing and side margins, which follow each
   choice and stay in view while the choices scroll. Text sizes show their
   pixels; the theme and the side margins say what the chosen one does.
6. **Routines say what each runtime runs.** JavaScript runs `.js`, `.mjs` and
   `.cjs` with irori as Node; Python runs `.py` through uv and downloads it. While
   uv downloads, the row says so and the switch waits; the download continues
   if the settings close.
7. **Account and updates.** The account's error sits in a frame with its details
   folded under a chevron and is read again when the language changes. Updates
   name the version in use.
8. **The start screen** lists the same groups without 更新, which its footer
   offers; rows that need a workspace say they are set in one.

## Consequences

- `Settings` keeps the display choices, the runtimes and the part on show;
  `SettingsSheet` draws the framed side list. A workspace passes
  `SettingsWorkspace` (its id, the irori agent, its vaults and callbacks), and
  `SchemaDialog` takes `initialOwner`.
- The UI smokes choose a part (`navigation 設定の項目`) before its choices; the
  vault agent and runtime switches have the `switch` role.
- The README's and the guide's **設定 → エージェント** paths name the entry.
