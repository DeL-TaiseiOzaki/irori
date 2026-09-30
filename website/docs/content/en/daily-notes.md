---
title: Daily notes
description: Open a dated note in a chosen location using your own template.
---

## Set the destination

Declare daily notes in the hibachi's `.irori/notes.json`. This example places dated notes in a folder for each year.

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

`template` is optional. The destination must be in Knowledge. There is currently no dedicated settings form for this declaration.

## Write a template

`{{date}}` becomes `yyyy-MM-dd`. `{{yyyy}}`, `{{MM}}`, and `{{dd}}` become the year, month, and day, using your computer's local date. `{{datetime}}` also includes the time and UTC offset.

```markdown
# {{date}}

## Today's record

## Next steps
```

## Open today's note

**Today's note** appears when the hibachi declares daily notes. Choose it to open that day's file. If the file does not exist, irori creates it from the template.

An existing note is never overwritten with the template. Without a template, a new note starts with a date heading. Edit and save it like any [other note](notes.md).
