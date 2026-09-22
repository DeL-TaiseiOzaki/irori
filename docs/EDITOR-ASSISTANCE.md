# One-button editor assistance

Date: 2026-09-23. The owner wants editor conveniences shown or hidden together
with one button, while ordinary native CLI capabilities remain available.

**コード支援 ON / OFF** sits in the document toolbar. It controls the existing
CodeMirror assistance in source files and fenced code blocks inside Markdown:
syntax coloring, line numbers, folding controls, active-line emphasis, bracket
assistance and available language completions. Source files select a language
from their filename; unsupported filenames remain plain text. Completions depend
on the installed language package. Full language-server diagnostics and project
run buttons are not implemented by this display change.

The setting starts enabled to preserve the existing editor defaults, is shared
across this device's workspaces, and persists across application restarts in
`device-settings.json`. It is not written into the KB. A failed preference write
reports an error and returns the button and editor to the previous setting.
The button is hidden in CSV table mode, which has no code editor.

Live CodeMirror reconfiguration changes the assistance without recreating the
editor or serializing a document. Text, selection and Undo history survive;
search and the person's line marks remain available. Code-block language and
copy controls remain document actions. Display changes do not submit prompts,
save notes, run commands or change native-agent/cloud write permissions.

Future language diagnostics and editor run controls should follow this same
display choice. Their introduction still needs real behavior and acceptance;
an enabled button is not evidence that those features exist.

Verification covers persisted preferences and input validation, live editor
reconfiguration, and the actual Electron button, document contents, Undo and
restart behavior. Exact completed results belong in [STATUS](STATUS.md).
