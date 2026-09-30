---
title: Properties
description: Edit a note's title, description, status, and other values above its text.
---

## Edit properties

Markdown notes in Knowledge show their title, description, and property rows above the text. Editing a value updates the YAML frontmatter in the original Markdown. `index.md` is excluded from this view.

Properties are part of the note and can be shared with its text through Git.

## Use a hibachi's definitions

If a hibachi contains `.property/property.json`, its definitions supply options, required fields, and fields for each type. Notes can still open without that file.

Saving fills fields defined as `auto: last-change` with the actor and time. Follow your hibachi's conventions for types and options.

## Check the YAML

Broken frontmatter opens as YAML source. Review and repair the syntax; irori does not replace damaged information automatically.

The current implementation supports basic property display and editing. Dedicated resource, source, and relation pickers, and creating notes from a type, are still pending. You can also use text [links](links.md) and [comments](comments.md).
