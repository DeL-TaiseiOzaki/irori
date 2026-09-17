# Daily notes and the declared note directory — 0.1.8

A knowledge base tells irori where its notes go. The declaration is a file the
KB owns and tracks, `.irori/notes.json`, so a repository created from
`irori-templete` carries it and every clone behaves the same way. Without the
file, irori keeps its earlier behaviour: the new-note dialog offers
`Knowledge_Base/Notes`, and there is no daily note.

```json
{
  "schemaVersion": 1,
  "newNoteDirectory": "Knowledge_Base/journal",
  "daily": {
    "path": "Knowledge_Base/journal/{{yyyy}}/{{date}}.md",
    "template": ".irori/templates/daily.md"
  }
}
```

- `newNoteDirectory` is the folder the new-note dialog offers when no note of
  this KB is open. When one is, the dialog keeps offering that note's folder, as
  before.
- `daily.path` is today's note. It must end in `.md` and contain at least one of
  `{{yyyy}}`, `{{MM}}`, `{{dd}}` or `{{date}}` (`yyyy-MM-dd`); the date is the
  device's local date.
- `daily.template` is optional. On the first opening of a day, its text becomes
  the note with the same tokens filled in, plus `{{datetime}}` (local time with
  its UTC offset, for a `generated.at` field). A note that already exists is
  opened as it is; the template is never applied to it again. Without a
  template the note starts with the date as its heading.

Both paths are relative to the KB root. `newNoteDirectory` and `daily.path` must
be in the knowledge layer; a declaration that points at `contents/` or at the
schema layer is reported, not silently ignored. The template may live anywhere in
the KB except under `contents/`, and must be a real file rather than a link.
Unknown tokens are left as written, so a template can carry `{{title}}` for a
person to fill in.

**今日のノート** appears in the KB toolbar and on the welcome screen only when
`daily` is declared. It saves the open note first, then opens today's note.

## Implementation

`src/domain/notes.ts` holds the declaration schema and the token rules;
`src/host/notes.ts` reads the file, checks the layer, and creates the note
through `FileService.createNoteAt`, which publishes exclusively (`wx`) inside the
same path checks as every other note write. The host exposes `notesDeclaration`
and `dailyNote`, and `createNote` without an explicit directory uses the declared
one. The renderer reads the declaration per KB with `useResource`, alongside the
skill listing.

## Limits

The date format is fixed to the tokens above; there is no free-form date
pattern. The declaration is not edited from the UI; the template and the KB's
`init` skill write it. Weekly or meeting notes have no dedicated command; the
KB's `journal` skill covers them.
