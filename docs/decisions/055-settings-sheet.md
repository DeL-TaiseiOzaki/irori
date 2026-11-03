# 055 — Settings open as a sheet of their own

Date: 2026-11-03. Status: owner request; implemented for 0.2.53.
Changes how the settings open from the rail and the start screen; what they
hold is unchanged.

## Context

Until 0.2.52 the settings were a 316 px popover beside the rail's settings
button (above it on the start screen): a narrow column of every choice, the
window unchanged around it. The owner pointed out that an application's
settings usually open as a window of their own over a blurred main window, as
an editor's preferences do, and asked for that.

## Decisions

1. **A sheet over the blurred window.** The settings button opens a modal
   sheet in the middle of the window (up to 900 × 640 px, always clear of the
   title bar of ADR 054); the window behind it, title bar included, is blurred
   and dimmed. Escape, the sheet's close button and a press on the backdrop
   close it. Settings are chrome, so the sheet is graphite in hearth and dark
   and paper in light.
2. **Its parts at the side, all in one column.** The side lists 一般 (language,
   theme), ノート (Markdown font, text size, line spacing, side margins),
   エージェント (vault agent, Schema), ルーティン, アカウント and 更新; choosing
   one scrolls the column to it, and the part in view is marked as the column
   scrolls. Every choice stays on the one column, so nothing is hidden behind a
   page change. The start screen leaves out 更新 and Schema, as before.
3. **Choices line up.** Every row of choices shares four columns. Where a
   label would not fit, the choice shows a shorter one and keeps the full label
   as its name and tooltip (the theme's システムに合わせる shows システム).
4. A choice still applies at once, and the sheet stays open for several.
