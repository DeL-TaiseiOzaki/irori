---
title: Vaults on SSH hosts
description: Show a vault that lives on a Linux machine you reach with ssh, and hand work to the agent that runs there.
---

## What it is for

A vault does not have to be on this computer. A vault on a Linux machine you reach with `ssh` (an SSH host) shows in a workspace beside your other vaults.

That vault's agent runs on the host, so code runs on the other machine while you talk to your notes here. For now a vault on an SSH host is **shown, not changed**: nothing in the window edits it.

## Before you start

- irori uses this computer's `ssh` with its keys, agent and configuration. It cannot answer a password, a passphrase or a host-key question, so first check in a terminal that `ssh <destination>` connects by itself.
- The host runs Linux on x64 or arm64, with glibc 2.28 or later.
- The vault's agent runs on the host. Install the CLI you use there (Claude Code, Codex…) and sign in.

The first connection puts irori's own files under `~/.irori-host` on the host. The Node they run on (the official build, about 55 MB) is downloaded here and sent through the connection, so the host needs no internet access. Nothing is installed system-wide.

## Add an SSH host

Open **Settings → Where vaults live → SSH hosts**.

**A host written in your ssh configuration.** As VS Code's Remote-SSH does, irori lists the hosts your own ssh configuration names, under **Hosts in your ssh configuration**. Choose **Add** on one, and it is added under that name. With more than a few hosts, type in the field above the list to filter them by name, address or user.

irori reads `~/.ssh/config`, the files it includes and the system's file, and writes nothing there. `ssh` applies the configuration each time it connects, so what you change in the file later needs no change in irori. What is listed:

- Each name on a `Host` line, with the address, user and port `ssh` would use for it. Settings from a pattern such as `Host *` are counted in.
- Not a pattern such as `*.example.com` or `!name`: it says how to connect, not where. To use a host that only a pattern covers, add it by its destination.
- Not a host that only a `Match` line names.
- A file named by `Include` is read as `ssh` reads it. An `Include` written below a `Host` line belongs to that block: `ssh` reads the file only for the hosts the block matches, and uses no other host in it. Write `Include` at the top of the file.

**Any other host.** Choose **Add one by its destination**, enter a **Name** and the **Destination** (what you would type after `ssh`: `user@host`, or a Host of your ssh configuration), a **Port (optional)** if needed, and choose **Add**.

**Connect** connects a host in the list, **Edit** changes its name or destination, and **Remove** takes it off. Hosts are this computer's own record and are not part of the [environment saved on GitHub](settings.md#section-6).

## Add a vault

The host's **Add vault** opens a dialog that walks the host's folders. **From an SSH host** on the start screen, and **SSH host** where a vault is added, start the same way. There, a host of your ssh configuration can be chosen directly: irori adds it, connects and shows its folders in one step.

Choose a folder, or type a path starting with `/` in **Folder path on the host**, and choose **Make it a vault**. Like a folder on this computer, one that is not a vault yet gets `.irori/scope.json` and a `/contents/` line in `.gitignore`. A vault already registered here or on another host is refused: one vault, one place.

The new vault joins the workspace on show.

## What you see

Its files, notes, search, backlinks, comments, properties, ontology, and Git status, history and diffs are read through the host. A note opens read-only.

The vault's panel names its host. When the host cannot be reached, **Connect** connects it again. **Take off the list** in the vault's menu takes it off this computer's list and leaves the folder on the host as it is.

## Hand work to its agent

In place of the vault agent's instruction box, a vault on an SSH host shows a note: ask the irori agent in [irori mode](irori-mode.md).

When the irori agent hands it work, the vault's agent runs **on the host**, in the vault. Its steps and permission requests show in the irori agent's conversation, and you answer them here. Stopping the irori agent stops the run there.

The irori agent reads the vault when it needs to, with `irori ls`, `irori read` and `irori search`, and gives it a file with `irori send`, which puts it in the vault's work folder. A handed task holds 30,000 characters; longer material goes this way.

If the connection is cut while an agent works, the run goes on. Its report waits on the host for a day, and irori collects it when the connection is back. With nothing running, no report waiting and no irori attached for fifteen minutes, what irori started on the host ends by itself.

## Things to know

- Text the irori agent sends to a host, in a task or with `irori send`, stays on that machine and is readable by whoever administers it, as are the CLI's records there.
- Not yet for a vault on a host: editing it, talking to its own agent directly, the terminal, connected folders and routines.
- On another computer where the environment is restored, such a vault shows as unavailable until its host is added there.
