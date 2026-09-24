# 011 — Interface language: Japanese or English

Date: 2026-09-25. Status: owner request accepted and implemented for 0.1.33.

## Decision

The owner asked for the system language to be selectable between English and
Japanese. The interface now has a device setting, `language`, with the values
`ja` and `en`. Japanese stays the default, so existing installations and every
test that names an element by its Japanese text behave as before.

- **Where it is chosen.** The display settings menu, beside theme and Markdown
  font, lists **日本語** and **English**, each named in its own language. The
  choice is kept in the device record with the other display settings, not in a
  knowledge base.
- **Applying it.** The renderer re-renders from the application root when the
  language changes, so the switch is immediate and keeps component state, open
  notes and drafts. The host sets its own copy when the setting is saved, so its
  dialogs and error messages follow from the next message on.
- **Form of the translations.** Japanese remains the source text and each use
  site writes the English beside it: `t('閉じる', 'Close')` from
  `src/domain/i18n.ts`. With two languages, a pair at the point of use keeps the
  two versions reviewed together and leaves no catalogue of keys to fall out of
  step with the code. A third language would be the point to move to catalogues.
- **What is translated.** The application's own interface text: labels, buttons,
  dialogs, notices and messages irori reports, in both processes.
- **What is not.** Content written into a knowledge base (templates, generated
  files, Git commits irori writes), instructions sent to agents, text used to
  match or parse files and tool output, and messages produced by Git, rclone or
  an agent CLI. The window menu is Electron's default and follows the OS.

## Consequences

New interface text must be written with `t()`. Module-level constants holding
interface text must be resolved at render time, since they are otherwise read
once before the language is known. Text already on screen when the language
changes, such as a status message held in component state, stays in its
language until it is produced again.
