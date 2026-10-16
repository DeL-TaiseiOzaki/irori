# 044 — The irori agent works in its workspace's folder; reply paths start where their writer works

Date: 2026-10-15. Status: owner request; implemented for 0.2.19. Decision 5
corrected by [ADR 045](045-work-folder-in-contents.md).
Extends [ADR 042](042-waiting-folders-and-work-folders.md) (work folders) and
the path links of 0.2.14. Keeps [ADR 027](027-shared-schema.md) (the shared
Schema) and [ADR 017](017-conversation-history.md) D4 (the irori agent's history
per workspace).

## Context

On 2026-10-15 the owner reported that a path in an agent's reply was written
correctly but its link opened another file, or said the file was not found.
The reply links of 0.2.14 read a relative path from the vault on show whenever
the irori agent wrote it. The irori agent does not work there: it runs in
`~/irori/you`, one folder for every workspace, and relays its vault agents'
reports, whose paths are inside their own vaults. Its own folder was not among
the places a link could open. Two smaller faults showed in the same review:
`AGENTS.md:12` read as a scheme `agents.md:`, and Codex's built-in instructions
allow a bare name or the tail of a path, which irori read from the vault's root.

The owner also noted that the person cannot tell where agents work: the irori
agent belongs to a workspace and a vault agent to its vault, so both should
work in a folder the person can see and choose. They chose a folder per
workspace for the irori agent (`~/irori/you` by default) and `contents/work`
for a vault's work folder.

## Decisions

1. **The irori agent's folder is per workspace.** A workspace may choose a
   folder for the irori agent on this device, on its screen or, before it is
   set up there, beside 「irori agent を用意する」. Without a choice it is the
   default, `~/irori/you`. The choice lives in irori's data
   (`irori-agent-folders.json`), not in the workspace's record, because a path
   names the person and the environment saved on GitHub (ADR 026) restores
   workspaces on another device. A chosen folder that is not there gives way to
   the default meanwhile, as a vault's work folder does.
2. **What follows the workspace's folder.** A run's working directory, the
   sub-agent definitions irori writes, the skills it finds, the Schema settings
   and screen of the irori agent, its `/` commands and its terminal. Each
   folder is set up by itself; a newly chosen empty folder offers the setup.
   The host is told which workspace the window shows (`showWorkspace`) for the
   screens and the terminal; a run carries its own workspace.
3. **What stays in the default folder.** The shared Schema (`.irori/shared`),
   the irori agent's routines and the folder the saved environment reads. They
   are the person's across workspaces. The shared Schema needs the default
   folder set up.
4. **A chosen folder stands apart.** It may not overlap a vault, irori's data,
   the default folder or another workspace's choice. A folder inside another
   would read that folder's AGENTS.md as well, as Claude Code reads every
   instruction file above its working directory. Two workspaces may choose the
   same folder.
5. **A vault's work folder is `work` in its contents.** It replaces
   `.irori/work` as the default, so the explorer shows what agents leave. irori
   makes it with a `.gitignore` of `*` when a run first needs it. A folder the
   person already has there is used as it is, its Git left alone. What agents
   left in `.irori/work` is moved over when the new folder is first made.
6. **A reply's path starts where its writer works.** The irori agent's replies
   start in its folder for the workspace; a vault agent's report in its vault.
   When the person clicks, the host looks for the file there first, then in the
   workspace's other vaults and the irori agent's folder, then without a diff's
   `a/` or `b/`. When no folder has the path as written, it looks for files
   whose path ends with it (a bare name, or the tail of a path). One file opens.
   Several are each offered. None says the file was not found, instead of
   opening another.
7. **The folders a path may land in.** The workspace's vaults, the irori
   agent's folder, and each connected folder's real place, which stands for its
   path inside its vault (`contents/<name>`). An absolute path outside all of
   them is not a link. A file of the irori agent's folder opens on its screen.
8. **`AGENTS.md:12` is a file and its line,** not a scheme.

## Consequences

- An irori agent conversation continued after its workspace changed folder
  starts a new native session there; ADR 017 D7 already does this for another
  folder.
- A search by name walks at most 20,000 entries and returns at most 20 files.
  It does not follow links, so a connected folder is not searched by name.
- The `irori` command has no verb for the irori agent's folder yet; a person
  chooses it in the window.
- A vault whose contents folder is itself a link cannot get the default work
  folder; choosing another folder still works.
