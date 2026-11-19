# 061 — A vault can live on an SSH host

Date: 2026-11-13. Status: owner request; first step implemented for 0.2.68.
Builds on [ADR 033](033-vaults.md) (vaults), [ADR 050](050-vault-agents-and-their-sub-agents.md)
(a hand-off is `irori call`), [ADR 042](042-waiting-folders-and-work-folders.md)
(work folders) and [ADR 051](051-multiple-windows.md) (several windows). Keeps
[ADR 031](031-agents-use-what-irori-does.md) decision 2: a vault agent reaches
its own vault alone.

## Context

The owner wants to talk with the second brain in one vault while code runs on
another machine: take what a vault on this computer says as context, and
instruct an agent that works on an SSH host, without copying text and paths by
hand. Their first picture was VS Code's Remote-SSH, with a window bound to a
host. They then set the requirements that shaped this decision:

- A vault belongs to one place, this computer or an SSH host. A workspace must
  be able to hold vaults of both, or no agent sees both.
- A window is not bound to a host.
- Only the irori agent crosses vaults; a vault agent stays in its own.
- The other vault's files are fetched when they are needed, rather than kept
  as a copy. Sharing through Git already works and is not what was asked.
- Linux hosts are enough. A vault registered in two places is refused.

Two investigations were run before deciding. A prototype (2026-11-13) ran
irori's host services without Electron on another Linux user's account through
a real `ssh` and drove them from this side: files, search, Git status, events,
a vault agent's run on Pi and on the Claude Agent SDK path, and a hand-off
carrying a local note's text. A survey of comparable tools found the same
shape everywhere: VS Code Remote, Zed, JetBrains, and closest, Claude Desktop's
SSH sessions and the Codex app's SSH hosts, which start a helper on the host
through `ssh` and need the CLI installed and signed in there. Alternatives were
weighed and dropped:

- No irori process on the host, files over SFTP and each CLI as `ssh host
  <cli>`: the agent layer works on the disk around the CLI (hooks, the Schema,
  the `irori` command's loopback URL), about 500 file calls would need a second
  implementation, and there is no watcher or search.
- A mount (sshfs, rclone): needs WinFsp or macFUSE, shows changes late, and
  runs nothing on the host.
- The host as a place to run a vault that stays here, with files synced:
  against "the vault lives there" and "fetch, not copy".
- The whole app on the host with its window shown here: a workspace could not
  mix places.
- Each CLI's own remote feature: one CLI each, several through the vendor's
  servers or experimental.
- The irori agent on the host: its folder, shared Schema and history are this
  device's, and it would lose the paths of the vaults here.

## Decisions

1. **The place belongs to the vault.** A vault is on this device or on one SSH
   host, and a workspace holds both kinds. `Space.host` names the host; `root`
   is then the vault's folder there. Windows, workspaces, the irori agent, the
   settings, secrets and routines stay this device's.
   *Amended 2026-11-19 (0.2.83), owner request: irori mode's mapping shows the
   place.* The owner found a vault on a host drawn among this computer's, with
   nothing on the map to tell it was on another machine. The mapping now puts
   this computer's vaults first and each host's vaults after them in a box of
   their own, named after the host (`mapLayout`'s `hosts` in
   `src/domain/overview.ts`), in the order the host's first vault has in the
   workspace. The box is a neutral surface and hairline, as ADR 053 gives a
   place no colour, and a vault inside it is read with its host's name. In the
   same change the view's name became **マッピング** (*Mapping*); it was
   **地図** (*Map*), which the owner did not want it called.
2. **irori's own services run beside the vault.** On the host runs a *vault
   host*: the same `FileService`, `SearchService`, `GitService`, `AgentService`
   and the rest that the main process uses, in one file with every package
   inside it (`dist-host/vault-host.cjs`, from `src/remote/`), on a Node that
   irori sends. It answers the reads of the HostAPI under their own names and
   with their own argument checks (`src/host/vault-reads.ts` is shared), so a
   vault is read the same way wherever it is.
3. **The system's `ssh` is the connection.** irori runs the person's own
   OpenSSH client with their configuration, keys and agent, as one argument
   after `--`, in `BatchMode`: it cannot answer a password, a passphrase or a
   host-key question, so `ssh <destination>` must connect by itself first. One
   login lasts as long as the connection: Windows OpenSSH cannot share
   connections, so nothing is run per file or per run. The vault host listens on
   no network port. Nothing is forwarded from the host to this device.
   *Amended 2026-11-16 (0.2.75), owner request.* The owner expects what VS
   Code's Remote-SSH gives: a host written in `~/.ssh/config` is chosen, not
   typed again. irori now reads the person's ssh configuration
   (`src/host/ssh-config.ts`): `~/.ssh/config`, the files it includes and the
   system's file, the same places Remote-SSH reads. It offers each word of a
   `Host` line that is a name and not a pattern (`*`, `?` and a leading `!`
   mark patterns). Choosing one adds a host whose destination is that name.
   `ssh` still applies the configuration, so irori decides nothing about the
   connection and follows later changes to the file. Beside each name irori
   shows the address, user and port, for telling the machines apart only.
   - The reading follows `ssh` and not Remote-SSH where the two differ, and a
     test compares it with `ssh -G`. The first value obtained wins, and a
     pattern's block (`Host *`) gives its values to the hosts it matches. A
     file included inside a block is read for that block's hosts alone, so a
     name in it that the block does not match is not offered: `ssh` would
     never apply its settings. Remote-SSH skips such files.
   - A `Match` block other than `Match all` depends on what irori cannot tell
     (a command's result, the address after substitution). The hosts it names
     are not offered, which Remote-SSH does offer; the hosts of a file it
     includes are. What it sets is shown for no host it might hold for.
   - irori writes nothing to these files, where Remote-SSH adds a host by
     writing a block: a host added by its destination stays irori's own record
     (`remote-hosts.json`).
   - Still `BatchMode`: a host that needs a password, a passphrase or a
     host-key answer typed is not connected. Remote-SSH answers these in its
     window (it sets `SSH_ASKPASS` to itself); that is the next step toward it.
   *Amended 2026-11-16 (0.2.78), owner request: what `ssh` asks is answered in
   irori's window.* A password, a key's passphrase, a verification code and
   whether to trust a host's key no longer need a terminal first.
   - `ssh` is started without `BatchMode` and with `SSH_ASKPASS` naming a small
     program of irori's (`src/host/ssh-askpass.ts`), which is how Remote-SSH
     answers on macOS and Linux. The program hands the question to irori through
     a socket only the person can open and prints the answer. The question is
     shown in ssh's own words, which for a password or a code are the host's.
   - The answer is handed to `ssh` and kept nowhere. irori remembers no
     password: a key in an agent, or `ControlMaster`, is how a person avoids
     typing one each time.
   - On Windows the program is one of its own, `irori-askpass.exe`
     (`native/askpass/Askpass.cs`). Win32-OpenSSH starts `SSH_ASKPASS` with the
     question written after it unquoted, and Windows runs a script through
     cmd.exe, where a host's words would be commands. Remote-SSH ships a batch
     file for this and leaves that mode off on Windows by default.
   - A connection is now one login, in which what is missing is installed and
     a vault host of another version gives way (decision 5). Before, a first
     connection took four logins, and a person with a verification code would
     have typed four codes.
   - No answer ends the login, since `ssh` would only ask again. After a login
     that asked and failed, nothing asks by itself: only the person connecting
     does. A retry of irori's own, for a hand-off's report, asks nothing and
     fails for a host that needs an answer until the person connects.
4. **The vault host outlives the connection.** `attach` joins a login's pipes to
   the vault host of a data folder and starts one when none answers; `serve` is
   that process, on a socket only its user can open. A device that attaches
   again is sent the events it missed (the last 2,000 are kept) and the
   questions still open. A hand-off's report waits there for the device that
   handed the task, for a day after the run ended. With no agent working, no
   report waiting and no device attached for fifteen minutes it ends by itself.
   One device is attached at a time, the newest. *The owner's default for a cut
   connection: a run goes on to its end.*
5. **What irori puts on the host** is under `~/.irori-host`, readable by its
   user alone: `node/<version>/node`, `bin/<version>/vault-host.cjs` and `data/`
   (the host's own records: its vaults, conversations and indexes, its socket
   and log). Node is the official Linux build from nodejs.org, pinned by size
   and SHA-256 in `src/host/remote-payload.ts`, downloaded to this device once
   and sent through the connection, so a host needs no internet access. The
   vault host's version is the digest of its file; one of another version is
   replaced once nothing runs on it, and never while an agent works.
6. **A vault is registered in one place.** A vault's id is in its tracked
   `.irori/scope.json`, so a repository cloned here and on a host has one id.
   Registering it a second time, here or on another host, is refused
   (the owner's choice over keying everything by host and vault).
7. **First step: shown, not changed.** A vault on a host is read through its
   host: the explorer, notes and other files, search, backlinks, comments,
   properties, the ontology, the Schema's settings, and Git status, history and
   diffs. Nothing in the window changes it yet, and a note of it opens
   read-only. The main process answers a few things itself (drafts, taking the
   vault off the list, and the lists that stay empty: connected folders and the
   vault's own conversations) and refuses the rest in words.
8. **The irori agent reaches it, and only the irori agent.** In irori mode the
   workspace's vaults are handed as before. For one on a host:
   - `irori call` starts its vault agent **on the host**, in the vault, through
     the same path a local hand-off takes (`AgentService.startHanded`). Its
     progress, permission requests and questions show in the irori agent's
     conversation, an answer goes to the host, stopping the irori agent stops
     it, and its report is collected from the host even across a reconnection.
     It runs on the irori agent's CLI, which must be installed and signed in on
     the host.
   - `irori ls`, `irori read` and `irori search` read the vault on demand.
   - `irori send` puts a file into the vault's work folder and prints where: a
     task holds 30,000 characters, and longer material goes this way. It takes
     only what the irori agent may already read: its folder and the handed
     vaults on this device.
   - The request names the host and the folder there and says how such a vault
     is reached ([prompts/remote-vault.ts](../../prompts/remote-vault.ts)). No
     path of it is given as an additional directory, checked for configuration
     or counted in the write boundary.
   A vault agent, here or there, still reaches its own vault alone.
   *Amended 2026-11-17 (0.2.79), owner request: the vault's own agent and a
   terminal.* With a vault on a host connected, its vault agent column and the
   terminal were shown dimmed, and the owner could not use either. Both were the
   next steps the handoff named.
   - The vault agent column takes instructions for such a vault as for one here.
     The run is the vault host's `AgentService`, as a hand-off's is, so the
     agent runs on the host, in the vault, on the CLI installed and signed in
     there, and its conversations are kept in the host's data. The window's
     operations on a vault's agent and its conversations go there under their
     own names and argument checks (`forwardedAgent` in `src/remote/protocol.ts`);
     the irori agent's workspace, which a vault's conversations are not kept by,
     is not sent. An operation that names a conversation goes to the host it
     was seen on.
   - The host's events of its vaults' runs reach the windows as a local run's
     do, and what a run asks is answered from the window it shows in. While a
     run is in progress this device reconnects by itself, without asking, as for
     a hand-off; a run the host no longer has once it answers with nothing
     running (its vault host was restarted) is ended in the window with a note.
   - A file attached to an instruction is sent first and kept on the host under
     the id it was staged with here, so the instruction names it unchanged.
   - Not yet: the vault agent's `irori` command there (its writes need the guards
     of decision 7's later step), and opening a path a reply from the host
     names: such a reply's paths are shown as text.
   - The terminal of such a vault is `ssh -t` to the host, run by this device
     in a terminal of its own (`sshTerminalArgs`), with the same destination
     and port as the connection. On the host it changes to the vault's folder
     and starts the person's login shell (`$SHELL -l`). The command is a POSIX
     script in single quotes, as the starter is, and the folder goes in it as
     base64, so a folder with any character but a line break is reached. It is
     a login of its own: what `ssh` asks is asked in the terminal, not in
     irori's dialog, and nothing of irori's runs on the host for it.
9. **What a vault host asks, the person answers here.** Configuration that runs
   without asking (hooks, MCP servers, plugins) and a Git repository's programs
   are approved in a dialog on this device, which names the host, before a CLI
   or Git runs them there; the approvals are kept on the host.

## Consequences

- Text the irori agent sends, in a task or with `irori send`, is on the host
  afterwards and readable by its administrator, as are the CLI's transcripts
  there. Whoever controls the host controls what its vault host answers.
- A host is this device's record (`remote-hosts.json`, with each vault as last
  seen, so that it lists while the host is away). It is not part of the
  environment saved on GitHub, and a workspace restored on another device shows
  such a vault as unavailable until the host is added there.
- Not in this step: editing, creating, moving and deleting in a vault on a
  host; its agent's `irori` command; connected folders; routines; the shared
  Schema for runs there; hosts other than Linux on x64 and arm64. (SSH's
  prompts are answered in the window since 0.2.78; conversations with its own
  agent and the terminal since 0.2.79.)
- A host with glibc older than 2.28 cannot run the Node that is sent.
- Where `systemd-logind` kills a user's processes at logout
  (`KillUserProcesses=yes`), the vault host ends with the login; the common
  distributions do not set it.
- Verified on Linux only: `tests/remote-hosts.test.ts` with this machine
  standing in for a host, and the same over a real `ssh` to another account
  when `IRORI_TEST_SSH` names one. Not tried from a Windows or macOS client,
  over a slow or lossy network, or with a real CLI and account on the host.
