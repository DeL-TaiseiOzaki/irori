# 074 — The irori agent makes vaults on SSH hosts

Date: 2026-11-24. Status: owner request; implemented for 0.2.99.
Builds on [ADR 061](061-vaults-on-ssh-hosts.md) (a vault can live on an SSH
host), [ADR 025](025-irori-agent-setup.md) (the irori agent sets vaults up
with the `irori` command) and [ADR 072](072-a-new-vault-chooses-its-layers.md)
(a new vault chooses its layers).

## Context

The owner asked the irori agent to make six vaults on an SSH host. It answered
that it could not: the `irori` command had no way to make a folder of an SSH
host a vault, and only the window's 「SSH ホストのフォルダを vault にする」
dialog could. `irori clone`, `create` and `add` worked on this computer alone,
and `irori list` did not name the SSH hosts or their vaults. The owner wanted
the irori agent to have a tool for preparing new vaults there.

## Decisions

1. **`--host` puts the vault on an SSH host.** `irori clone`, `irori create`
   and `irori add` take `--host <host>`, naming one of the hosts the person
   added in irori's settings by its name or its destination. Without it they
   work on this computer as before.
   - `add --host` registers a folder there, as the window's dialog does
     (`RemoteHosts.register`): a vault registered elsewhere is refused, and one
     already on this device's list only joins the workspace.
   - `create --host` makes a new folder there, a Git repository on `main` with
     the first commit of what irori writes, and registers it; `clone --host`
     clones a GitHub repository there with the host's own Git sign-in. Both go
     through a new vault host operation, `newVault`, which runs the host's own
     `GitService.create` or `clone`, `FileService.register` and
     `GitService.firstCommit`, so the steps are those of this computer. A new
     folder that cannot be registered is removed while it holds only irori's
     files; a clone is kept.
   - A folder on the host is absolute or taken from the host's home folder
     (`~`). New vaults go in the home folder unless `--parent` names another.
   - The new vault joins the request's workspace, as a vault made on this
     computer does, and is handed to the irori agent from the next request.
2. **The irori agent can find the host and the folder.** `irori hosts` lists
   the SSH hosts with their state and vaults; `irori hosts <host> [<folder>]`
   lists the folders in a folder there (the window dialog's listing), marking
   those that already hold a vault's declaration. `irori list` names the vaults
   on SSH hosts after this computer's.
3. **The same guards as on this computer.** These forms are the irori agent's
   alone; a vault agent's command refuses them. `clone`, `create` and `add`
   with `--host` wait for the person's 許可 as they do here; `hosts` only reads
   folder names and asks nothing. Connecting to a host that needs a password
   asks the person in irori's window, as any connection does.

## Consequences

- The vault host's protocol gains `newVault`. The host program is the one this
  irori sends, so both ends change together; an older vault host is replaced
  once nothing runs on it (ADR 061 decision 5).
- Not in this step: putting a vault on an SSH host on GitHub from irori
  (`gh repo create` runs on this computer; the `new-vault` skill says to create
  the repository first and clone it there); `irori workspace`, `set`, `remove`
  and the other forms that name a vault still reach vaults on this computer
  only.
