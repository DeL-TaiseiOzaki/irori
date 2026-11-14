---
title: Google Drive
description: Use a folder that Google Drive for desktop keeps in sync as vault materials, including its Google Docs, Sheets and Slides.
---

## Connect

1. Install [Google Drive for desktop](https://www.google.com/drive/download/) and sign in.
2. Set the folder you use to **Mirror** or **Available offline**.
3. In the vault's **Connect**, use **Choose folder** to pick that folder.

If Google Drive for desktop starts after irori, the connection shows **Waiting for the folder** and connects by itself once the folder appears. See [synced folders](sync-folders.md) for the details. irori does not sign in to Google itself.

## Earlier connections

A Drive folder connected in irori 0.1.66 or earlier shows as **Ended**. **Switch to a folder** keeps its name and place when you pick the same folder.

If changes never reached Drive, the start screen shows **not sent to Drive**. **Save to a folder** takes them out.

## Google Docs, Sheets and Slides

Google Docs, Sheets and Slides in a Drive folder are `.gdoc`, `.gsheet` and `.gslides` files. They hold only the document's ID, not its content. irori opens them with the application this computer uses for that kind of file.

Agents are given the docs.google.com address the ID makes. An agent with its own Google Drive tool, such as a connector or an MCP server, can read the document; one without gives you the link.
