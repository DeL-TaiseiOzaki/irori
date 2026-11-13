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
4. **The vault host outlives the connection.** `attach` joins a login's pipes to
   the vault host of a data folder and starts one when none answers; `serve` is
   that process, on a socket only its user can open. A device that attaches
   again is sent the events it missed (the last 2,000 are kept) and the
   questions still open. With no agent working and no device attached for
   fifteen minutes it ends by itself. One device is attached at a time, the
   newest. *The owner's default for a cut connection: a run goes on to its end.*
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
  host; conversations with its own agent and its `irori` command; the terminal;
  connected folders; routines; the shared Schema for runs there; answering
  SSH's prompts in the window; hosts other than Linux on x64 and arm64.
- A host with glibc older than 2.28 cannot run the Node that is sent.
- Where `systemd-logind` kills a user's processes at logout
  (`KillUserProcesses=yes`), the vault host ends with the login; the common
  distributions do not set it.
- Verified on Linux only: `tests/remote-hosts.test.ts` with this machine
  standing in for a host, and the same over a real `ssh` to another account
  when `IRORI_TEST_SSH` names one. Not tried from a Windows or macOS client,
  over a slow or lossy network, or with a real CLI and account on the host.
