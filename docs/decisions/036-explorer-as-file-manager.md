# 036 — The explorer works as a file manager

Date: 2026-10-12. Status: owner request; implemented for 0.2.2, folder drops for 0.2.5.
Extends [ADR 031](031-agents-use-what-irori-does.md) decision 3 (`irori move`).

## Context

The owner reported that neither Knowledge nor Contents could make a folder or
any file other than a Markdown note, and asked for the explorer to work as
Explorer or Finder does. Until 0.2.1:

- Knowledge made only notes: the section's **+** and a note's own
  **Name & location** dialog. A folder, a CSV or a file brought in from
  elsewhere had to be made outside irori.
- Contents made notes, and renamed, moved and deleted the entries of an
  editable connected folder. It made no folders or other files.

## Decisions

1. **One menu for both layers.** A right click on a row, on the empty space of
   a level, or the row's **⋯** opens the same items: **New note**, **New file**,
   **New folder**, **Add files…** for a folder; **Rename**, **Move**, **Delete**
   for an entry; and **Show in Finder** (Explorer, file manager). F2 renames and
   Delete deletes the focused row. Dragging a row onto a folder moves it there;
   files and folders dropped from the file manager are copied in, a folder with
   everything inside it except hidden entries (0.2.5). A closed folder held
   under a drag opens.
2. **What may change.** In Knowledge, every file and folder except the
   knowledge folder itself, whose name belongs to the vault settings (ADR 024).
   In Contents, what an editable connected folder holds; the connected folder's
   own name stays with the connection dialog. Hidden names are refused in
   Knowledge, since they are Schema there. A folder that holds another vault or
   a contents folder is neither moved nor deleted.
3. **Never replace.** A new file or folder refuses a name its folder holds in
   any case or normalization. A file brought in instead takes the first free
   `name 2.ext`, as Finder keeps both; so does a brought-in folder. Up to 2,000
   files in one drop are brought in through irori; more through the file
   manager. A file of any size comes in (0.2.7; until then, up to 100 MiB).
4. **A move in Knowledge carries what names its paths.** A note that stays a
   note moves as before (`moveNoteCarrying`). Any other file or folder moves as
   it is, then `carryMove` — shared with the layer folder rename — rewrites the
   links into it, and moves its comments, drafts, material IDs, person-line
   records and the places `.irori/notes.json` names.
5. **Deletion.** A note of Knowledge goes to irori's deleted notes as before;
   any other file or folder to the system trash. Contents keeps its trash.
6. **HostAPI.** `createEntry`, `moveEntry`, `trashEntry` and `revealEntry` take
   a path in either layer; the host picks the layer. They replace
   `moveCloudEntry` and `deleteCloudEntry`.
7. **Agents.** `irori move` takes a file or folder of Knowledge as well as a
   note, through the same host function. Agents make and delete other files
   with their own tools; `irori trash` stays for notes.

## Consequences

- Organizing a vault no longer needs Finder or a terminal, and links survive
  folder moves made in irori.
- A file brought in crosses the IPC bridge in pieces of at most 16 MiB
  (`appendEntry`), so its size has no bound and the renderer holds one piece at
  a time. The host takes the free name with the first piece; a piece that fails
  removes the partial file. Closing irori in the middle of a copy leaves it short.
- Not tried on Windows or macOS: their trash, Finder or Explorer reveal and
  drops from the system file manager are verified only through the Linux
  Electron smoke and its synthetic drop.

## Amendment, 2026-10-13 (0.2.10)

The owner asked for a right click on any file of any layer to copy its path, as
in Explorer or Finder. Every row of the vault panels now has the menu, and so do
the Schema settings' instruction, skill and rule rows. Its order follows the file
managers: **Open** (files), what may be made in a folder, **Rename**, **Move** and
**Delete** where the layer allows them, **Copy path** and **Copy relative path**,
then **Show in Finder**. Rows that cannot change keep only open, copy and show.
`copyEntryPath` writes the path from the main process (`clipboard`): the full path
under the vault's root (or the shared or irori agent Schema folder), or the path
from that root with `/`.
