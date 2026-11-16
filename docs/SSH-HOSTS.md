# Vaults on SSH hosts

How a vault that lives on another machine is served, for whoever changes this
part. The decisions and their reasons are in
[ADR 061](decisions/061-vaults-on-ssh-hosts.md).

## The parts

| Part               | Where                                                                                    | What it does                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Vault host         | `src/remote/vault-host.ts`, `host.ts`                                                    | Runs on the SSH host. `attach` is what a login runs; `serve` is the process that stays. It keeps irori's vault services for the vaults there. |
| Protocol           | `src/remote/wire.ts`, `protocol.ts`                                                      | One JSON value a line; bytes as base64. This device asks, the host answers; the host sends numbered events and a few questions.               |
| Connection         | `src/host/remote-link.ts`                                                                | One `ssh` login with the vault host on its pipes: installs what is missing, attaches, replaces another version once it is idle.               |
| What is sent       | `src/host/remote-payload.ts`                                                             | The `ssh` command line, the built vault host and the pinned Node.                                                                             |
| The person's hosts | `src/host/ssh-config.ts`                                                                 | Reads `~/.ssh/config`, what it includes and the system's file, and lists the names on `Host` lines for the window to offer. Read only.        |
| Hosts and vaults   | `src/host/remote-hosts.ts`                                                               | This device's list (`remote-hosts.json`), connections on demand, the duplicate check, and the `RemoteVaults` port for agent runs.             |
| Routing            | `src/host/main.ts` (`hosted`, `onHosts`)                                                 | An operation that names a vault on a host goes there when it is a read, is answered here, or is refused.                                      |
| Agent runs         | `src/agents/service.ts` (`startHanded`, `handOff`), `vault-reach.ts`, `remote-vaults.ts` | A hand-off starts where its vault is; `irori ls`, `read`, `search` and `send`.                                                                |
| The window         | `src/app/RemoteHosts.tsx`, and `Space.host` where a vault is shown                       | The settings part, the dialog that walks a host's folders, and a vault on a host shown without anything that edits it.                        |
| Shared reads       | `src/host/vault-reads.ts`                                                                | The reads both the main process and the vault host answer.                                                                                    |

## On the host

Everything is under `~/.irori-host`, mode 700:

```text
node/v24.21.0/node            the Node the vault host runs on
bin/<version>/vault-host.cjs  the vault host; <version> is the digest of this file
data/                         its own device data: spaces.json, conversations, indexes
data/host.sock                the socket a login attaches through (mode 600)
data/host.pid, data/host.log  the running vault host, and why one did not start
```

`ssh <destination> 'sh -c "…"'` first checks for Node and the vault host. When
both are there it runs `attach`, which prints `IRORI-HOST 1` and from then on
relays lines between the login and the socket. Otherwise it prints
`IRORI-NEEDS <system> <machine> [node] [bundle]` and takes what is missing from
the same login: a line `archive|binary|bundle <bytes> [member]`, that many
bytes, answered by `IRORI-DONE` or `IRORI-FAILED`, then `go`, and `attach` runs.
Whatever a login shell prints before these lines is passed over.

A connection is one login whatever it has to do. `attach` finds a vault host of
another version, asks it to end when nothing runs on it (`IRORI-REPLACING`) and
starts its own, or prints `IRORI-BUSY` and leaves it while an agent works.
One login is one sign-in: a person who types a verification code types it once.

## What ssh asks

A password, a key's passphrase, a verification code and whether to trust a
host's key are asked in a window (`RemoteHost.asking`, the dialog `SshQuestions`).

- `ssh` has no terminal, so it runs the program `SSH_ASKPASS` names with the
  question as its argument and reads the answer from that program's output.
  `SshAskpass` (`src/host/ssh-askpass.ts`) gives each connection attempt a
  session: its environment for `ssh`, and what `RemoteHosts` shows the person.
- The program reaches irori through a socket in a folder of its own under the
  system's temporary folder (a named pipe on Windows), with the session's
  random id. Nothing listens on a network port.
- On macOS and Linux the program is a shell launcher that runs
  `<data>/ssh/askpass.cjs` on irori's own runtime. On Windows it is
  `irori-askpass.exe`, built from `native/askpass/Askpass.cs` by
  `scripts/build-host.mjs` with the C# compiler of .NET Framework 4 and shipped
  outside the archive. Win32-OpenSSH writes the question after the program
  unquoted, so a script would be run by cmd.exe with a host's words as commands.
  It also fails to start a program whose path has letters outside the system's
  code page (CI's first run: `CreateProcessW failed error:2` from a folder named
  in Japanese), so `SSH_ASKPASS` is the program's name alone, its folder is first
  on `ssh`'s search path, and `ssh` runs in `<data>/ssh`, where Windows looks
  before the search path and finds nothing of that name.
- No answer ends the login (`LoginCancelled`): `ssh` would only ask again. After
  a login that asked and failed, nothing asks by itself until the person
  connects (`hold`). A retry irori makes on a timer asks nothing (`BatchMode`).
- An answer goes to `ssh` and is kept nowhere.

## Adding an operation

- A read the window already has: add it to `vaultReads` when the main process
  and the vault host answer it the same way, and to `forwardedReads`.
- Something only a vault host does: add it to `hostOperations` with its
  argument check, and to `own` in `host.ts`.
- Something this device answers for such a vault without asking the host: add
  it to `hosted` in `main.ts`.

A write needs more than a row: its guards in `main.ts` (`changeFiles`,
`changeVault`) are not on the vault host yet, and the window treats such a
vault as read-only.

## Trying it

`tests/remote-hosts.test.ts` stands this machine in for a host: each login is a
shell with another home, and the vault host runs from source. Nothing leaves
the machine.

A real host, after `npm run build`:

```sh
IRORI_TEST_SSH=<destination> npm test
```

`<destination>` must be a disposable Linux machine that `ssh <destination>`
reaches without a prompt.

What `ssh` asks is tried without a host: `tests/fixtures/ssh-server.ts` is an
SSH server on a loopback port that wants a password and a code, and the
system's own `ssh` signs in to it. `tests/remote-hosts.test.ts` runs a login's
commands on this machine behind it, and `scripts/package-smoke.ts` uses it
against the packaged app on each system CI packages for, which is where the
Windows program is run. The first run downloads Node from nodejs.org (about
55 MB) and sends it. The test leaves `~/.irori-host` there and removes the one
folder it makes.

A run from source (never a packaged app) sends the Node named by
`IRORI_VAULT_HOST_NODE` instead of downloading one, and
`IRORI_VAULT_HOST_IDLE_MS` on the host shortens the fifteen minutes a vault host
stays idle. `scripts/remote-hosts-ui-smoke.ts` uses both, with a stand-in `ssh`
on its `PATH`.
