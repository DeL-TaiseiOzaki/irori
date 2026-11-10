# 059 — The window shows the work; what can be set is in the settings

Date: 2026-11-10. Status: owner request; implemented for 0.2.63.
Builds on [ADR 053](053-priority-and-colour-roles.md) (one subject per screen)
and [ADR 057](057-settings-by-part.md) (the settings, one part at a time).

## Context

The owner pointed to the Knowledge Work layout Google Antigravity announced on
2026-11-09: the same agents and tools, without the terminal and the Git
elements, chosen under Settings → General. What the owner wanted from it was
not the switch between two layouts. It was that the window holds almost no
settings, while everything that can be set, down to whether a thing is shown at
all, is in the settings and nowhere else.

In 0.2.62 the window held, beside the note and the conversation:

- under the instruction box: the access of the conversation, the model, the
  thinking level, the skill with the reader's role and project and a button
  that checks which CLI finds which skill, and whether to tell the agent which
  lines a person wrote;
- at the top of a conversation: a menu holding the CLI's version, a button that
  adds a column and one that hides the page;
- along the window's foot: the Git branch, the terminal's button and irori's
  version.

Each was put there for a reason, and together they made the window read as a
control panel.

## Decisions

1. **The window shows what a note and a conversation need.** A control that
   sets how irori behaves, or that only a developer's way of working uses, is a
   _window item_: on the window or off it as the settings say, each on its own.
2. **The items, and what a new device shows.**

   | Item | Where | New device |
   | --- | --- | --- |
   | アクセス (`access`) | the conversation's menu, under the instruction box | on |
   | モデルと思考量 (`model`) | the conversation's menu, under the instruction box | on |
   | スキル (`skill`) | instruction box | on |
   | 人の行を伝える (`personLines`) | instruction box | off |
   | 列の操作 (`columns`): add a column, hide the page | top of a conversation | off |
   | ブランチ (`branch`) | status bar | off |
   | ターミナル (`terminal`) | status bar and a vault's home | off |
   | バージョン (`version`) | status bar | off |

   The skill stays on: it says which skill one request uses, as an attachment
   says which file, and only the vault agent of a vault that has skills shows it.

   **How a conversation runs is set from its column, in one menu.** The first
   version of this decision took the access, the model and the thinking level
   off the window. The owner then asked for them back in the agent's column:
   they are chosen per conversation, while a person is writing to it. They
   return as one quiet button at the foot of the instruction box, not as the
   three selects they were. The button names the model and level in use and
   opens a menu in three parts (モデル, 思考量, アクセス); the menu stays open
   while several are chosen. `access` and `model` each take their part out of
   the menu, and with both off the button goes too.

3. **表示 → 画面に出すもの** is where they are set. The part groups the items by
   where they appear. Each is a switch whose description says what turning it on
   puts on the window and what holds while it is off. **すべて出す** puts every
   item on at once, and **既定に戻す** returns to decision 2. The side entry
   says how many are shown (表示中 3 / 8). A choice shows on the window at once.
4. **Taking a control off the window does not change what it was set to.** A
   conversation keeps its access, and a model chosen earlier stays chosen. The
   two choices made per request are the exception: a skill and the person's
   lines are not sent while their control is off, because nobody could see that
   they were.
5. **What is in use stays in view.** A conversation in full access says so on
   the button itself, in the attention colour (ADR 053), also while `access` is
   off; the terminal's button shows while a terminal is open, and the button that shows the page stays while the page is
   hidden. Ctrl+` still opens and closes the terminal.
6. **Two things moved instead.** The CLI's version left the conversation's menu,
   which is gone, for **エージェント → 共通 → この端末の CLI**: every CLI with its
   version, or as not found. The skill reach check left the instruction box; a
   vault's home already offers it under Schema.
7. **The choices are the person's, on the device.** `windowItems` in the device
   settings holds only what was chosen, so an item never chosen follows its
   default, also when a later version changes that default. They are among the
   preferences the account's environment carries to another device
   ([ADR 026](026-github-account-environment.md)).
8. **What stays on the window.** The CLI a conversation uses, a new
   conversation, the history, attachments, dictation, what the request is
   about, a note's own actions and the vault panel. They are the work or the
   way to it, not settings of it.

9. **The agent's column is drawn again around this.** The instruction box is
   the one lifted surface of the column: a card that floats over the
   conversation, ringed in the focus colour while the person writes in it. What
   sits on it is round and quiet: chips for what the request is about, the
   attach button, the conversation's menu and a round send button that is an
   outline until there is something to send. Before anything is said, the
   conversation shows who the agent is in one sentence and the two keys worth
   knowing (`/` for commands, Enter to send). Menus let the window show faintly
   through them. None of this adds a colour role to ADR 053.

## Consequences

- Updating from 0.2.62 takes the five developer and per-request controls off
  every window, because no device has chosen yet, and gathers the access, the
  model and the thinking level into one menu. The release notes say where each
  went; すべて出す brings the hidden ones back in one press.
- `RunSettings` replaces `ModelPicker`: it reads the CLI's models as before and
  draws the menu with the menu parts already used elsewhere. "Other…" closes
  the menu before the name is typed, and the menu stays mounted beside the
  field, so the focus stays in it. `agentAccessParts` names each access on one
  line and says what it does on the next.
- `src/domain/window-items.ts` lists the items, their defaults and the schema
  shared by the device record, the request and the saved environment.
  `useWindowItems` reads them in the window. A new item is a name there, a
  default, its two texts in `Settings` and the condition where it is drawn.
- The settings sheet is 720 px high, 40 px more, so the side's nine entries show
  without scrolling.
- UI smokes about one of these controls turn every item on for their device
  (`tests/fixtures/window-items.ts`). `window-items-ui-smoke` covers the window
  of a new device, each item from the settings, and what stays in view.
- The smokes drive the menu through `tests/fixtures/run-settings.ts`.
- Not decided here: a note's own actions (links, comments, details), the vault
  panel's sections, and a default model chosen in the settings. Each can
  become an item, or a setting, the same way.
