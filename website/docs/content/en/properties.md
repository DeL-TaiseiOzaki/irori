---
title: Properties
description: Edit a note's title, description, status, relations, and other values above its text.
---

## Edit properties

Markdown notes in Knowledge show their title, description, and property rows above the text. Editing a value updates the YAML frontmatter in the original Markdown. `index.md` is excluded from this view.

**Properties** under the description folds the rows away, leaving the title and description. Folded, they stay folded on every page until you open them again. Broken frontmatter always stays open.

Properties are part of the note and can be shared with its text through Git.

## Use a vault's definitions

If a vault contains `.property/property.json`, its definitions supply options, required fields, and fields for each type. Notes can still open without that file. A vault that declares types also offers them when you [create a note](notes.md).

Saving fills fields defined as `auto: last-change` with the actor and time. The actor is whoever saved in irori's editor, so the field still names them after an agent changes the page outside it; treat it as a guide. Follow your vault's conventions for types and options.

In **Relations**, each relation is a name and a target. Choose the name from the relations the vault declares for a page of this type, then the target from the pages of the types that relation points at, shown with their titles, or enter a URL when the relation points at one. The target is written as a link relative to the page. **+ Add a relation** adds a row, written to the page once it has both a name and a target. A name the vault does not declare, or one this type may not use, stays as written and is marked. See the [ontology](links.md) for how relations are declared.

## Check the YAML

Broken frontmatter opens as YAML source. Review and repair the syntax; irori does not replace damaged information automatically.

Dedicated pickers for `link` and `sources` properties are still pending: type a `link` as text, and edit `sources` with **Edit as YAML**. You can also use text [links](links.md) and [comments](comments.md).
