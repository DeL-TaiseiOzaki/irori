# Vaults on SSH hosts

How a vault that lives on another machine is served, for whoever changes this
part. The decisions and their reasons are in
[ADR 061](decisions/061-vaults-on-ssh-hosts.md).

## The parts

| Part             | Where                                                                                    | What it does                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Vault host       | `src/remote/vault-host.ts`, `host.ts`                                                    | Runs on the SSH host. `attach` is what a login runs; `serve` is the process that stays. It keeps irori's vault services for the vaults there. |
| Protocol         | `src/remote/wire.ts`, `protocol.ts`                                                      | One JSON value a line; bytes as base64. This device asks, the host answers; the host sends numbered events and a few questions.               |
| Connection       | `src/host/remote-link.ts`                                                                | One `ssh` login with the vault host on its pipes: installs what is missing, attaches, replaces another version once it is idle.               |
| What is sent     | `src/host/remote-payload.ts`                                                             | The `ssh` command line, the built vault host and the pinned Node.                                                                             |
| Hosts and vaults | `src/host/remote-hosts.ts`                                                               | This device's list (`remote-hosts.json`), connections on demand, the duplicate check, and the `RemoteVaults` port for agent runs.             |
| Routing          | `src/host/main.ts` (`hosted`, `onHosts`)                                                 | An operation that names a vault on a host goes there when it is a read, is answered here, or is refused.                                      |
| Agent runs       | `src/agents/service.ts` (`startHanded`, `handOff`), `vault-reach.ts`, `remote-vaults.ts` | A hand-off starts where its vault is; `irori ls`, `read`, `search` and `send`.                                                                |
| Shared reads     | `src/host/vault-reads.ts`                                                                | The reads both the main process and the vault host answer.                                                                                    |

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
`IRORI-NEEDS <system> <machine> [node] [bundle]`, and this device sends what is
missing with one login each, then tries again. Whatever a login shell prints
before either line is passed over.

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
reaches without a prompt. The first run downloads Node from nodejs.org (about
55 MB) and sends it. The test leaves `~/.irori-host` there and removes the one
folder it makes.

A run from source (never a packaged app) sends the Node named by
`IRORI_VAULT_HOST_NODE` instead of downloading one, and
`IRORI_VAULT_HOST_IDLE_MS` on the host shortens the fifteen minutes a vault host
stays idle. `scripts/remote-hosts-ui-smoke.ts` uses both, with a stand-in `ssh`
on its `PATH`.
