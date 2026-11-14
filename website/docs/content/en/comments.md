---
title: Comments
description: Leave review or revision notes on a passage or an entire note, from you or an agent.
---

## Add a comment

1. Open a Markdown note.
2. Select a passage if your comment concerns a particular part.
3. Open **Comments** in the note's bar, enter your text, and choose **Add**.

Without a selection, the comment applies to the whole note. You can also select text and choose the comment button (**Comment on the selection**) in the toolbar that appears beside the selection. The comment box opens next to the passage with it quoted.

## Review and resolve

Choose a comment's quote to reveal its passage in the text. If edits have removed the quoted text, the comment shows that it could not be found. Each comment shows who wrote it and when.

Choose **Resolve** when the work is done. This removes the comment; there is currently no retained archive of resolved comments.

## Share with AI or your team

Comments live in the vault's `.irori/comments/` and can be shared through Git. The vault agent receives comments on the selected note; the irori agent can see each vault's comment count.

Ask [AI](agents.md) to “Read the comments and revise this note.” An agent can also leave and resolve comments through the `irori` command; its comments are signed with the agent's name.

Comments cover Markdown files kept in the vault itself, including Schema files such as `AGENTS.md`. Files in a folder connected to Contents, such as a synced folder or a GitHub repository, take no comments.
