# Spike Report: Keeping API keys and tokens for external tools

Date: 2026-10-05. Status: research complete; the owner answered its three
questions the same day ([owner decisions](#owner-decisions-2026-10-05)). It
extends [ADR 016](../decisions/016-routines.md) D5 (routine secrets, stage 2),
implemented in 0.1.72 as ADR 016's "Stage 2 as built" describes.

## Question

irori will connect to Slack, Microsoft Teams and similar tools. Where should
their API keys and tokens live, and how should irori hand them out without
breaking the existing rules? Those rules are:

- ADR 016 D5: secrets are entered in irori's own field and kept with
  `safeStorage`. They reach only the `run` steps that name them, never agent
  steps, and irori ships no provider sign-in.
- ADR 013: a folder declares what it needs, and the device binds accounts and
  secrets.
- ADR 021: CLI agents are optional tools that people run with their own
  accounts.

Success criteria:

1. A secret never enters a KB, a hibachi, Git, a conversation or recorded output.
2. At rest it is protected by the OS key store, and irori refuses to store it
   when no such store exists.
3. An agent that reads captured content cannot be talked into sending a token
   elsewhere.
4. It works with tokens that rotate (Slack token rotation, Microsoft Graph).
5. It works the same for every CLI irori runs (Claude Code, Codex and others).

## Verdict

**GO**, with three constraints the design must carry:

- **Linux needs an explicit check.** Electron 44's asynchronous `safeStorage`
  API reports itself available and encrypts with a fixed, public key when the
  device has no secret store. The synchronous API refuses correctly. This was
  measured below.
- **An environment variable is not hidden from other processes of the same
  user.** While a `run` step is alive, any process running as the same user can
  read its token from `/proc/<pid>/environ`, and that includes an agent with a
  shell. This was measured below. On Windows, DPAPI likewise does not protect
  against other apps of the same user. Criterion 3 therefore rests on two
  things: agents are never handed tokens, and outbound actions stay outside
  agent steps. It cannot rest on hiding the token from the device.
- **Rotating tokens need a write-back path.** With Slack token rotation, and
  with every Graph refresh, a new single-use or replacing refresh token is
  issued. A store that only reads secrets would break these connections within
  12 hours (Slack) or on the next refresh (Graph).

## Evidence

### Measured: Electron 44.3.0 `safeStorage` on Linux

The probe is `.local/agents/spikes/external-tool-secrets/safestorage-probe.js`
(ignored). It was run with
`env -u ELECTRON_RUN_AS_NODE xvfb-run -a node_modules/.bin/electron <probe> --no-sandbox [flag]`
on a headless Linux without a keyring daemon.

| Flag | `isEncryptionAvailable` | backend | `isAsyncEncryptionAvailable` | async ciphertext | sync `encryptString` |
|---|---|---|---|---|---|
| (default) | false | `basic_text` | **true** | `v10…`, round-trips | throws |
| `--password-store=gnome-libsecret` | false | `gnome_libsecret` | **true** | `v10…`, round-trips | throws |
| default under `dbus-run-session` | false | `basic_text` | **true** | `v10…`, round-trips | throws |

- The asynchronous API accepts a device with no secret store.
- The backend name alone is also not enough: with a forced libsecret backend
  and no daemon, it reports `gnome_libsecret` and still uses the fixed key.
- The synchronous check from the closed Drive work (PR #146,
  `0dfb66d:src/cloud/credentials.ts`, `secureStorageAvailable`) refuses all
  three cases.
- Chromium's `v10` prefix on Linux is the hardcoded-key format (inference from
  Chromium OSCrypt, not checked here).
- A real GNOME Keyring, KWallet, macOS or Windows device was not available, so
  the "store is present" branch is not measured.

### Measured: environment visibility

`SLACK_TOKEN=… sleep 30` was started, then its `/proc/<pid>/environ` was read.

- The same user reads the token.
- User `nobody` reads nothing.
- `kernel.yama.ptrace_scope` = 1.

### Repository

- `src/host/routines.ts:76` already parses `secrets:` (up to 20 names,
  `^[A-Z_][A-Z0-9_]{0,63}$`). `:563` refuses to run with "Secrets are not
  available yet."
- `src/agents/hibachi-bridge.ts` already brokers an action for an agent run.
  It serves a per-run local HTTP endpoint behind a random 24-byte path. A
  command on `PATH` calls it, and the URL exists only in the run's environment.
  It works for every CLI and is the shape a later irori broker would take.
- The Claude Agent SDK 0.3.269 also offers an in-process MCP server
  (`createSdkMcpServer`, `type: 'sdk'`, `sdk.d.ts:521`).
- `src/agents/process.ts` `agentEnv()` already strips irori's own variables
  from agent environments.

### External, from vendor documentation (read 2026-10-05)

- **Slack** ([tokens](https://docs.slack.dev/authentication/tokens),
  [rotation](https://docs.slack.dev/authentication/using-token-rotation),
  [MCP](https://docs.slack.dev/ai/mcp-server)):
  - `xoxb`, `xoxp` and `xapp` tokens do not expire by default.
  - Token rotation is opt-in and cannot be turned off once on. Access tokens
    then last 12 h, and the refresh token is single-use.
  - The official MCP server (`mcp.slack.com/mcp`) uses user OAuth with a
    registered app's client id and secret. It has no dynamic registration, so
    a person must create an internal app.
  - Whether members may install apps without approval is a workspace setting.
    That was seen only in a search snippet.
- **Microsoft Graph / Teams**
  ([message post](https://learn.microsoft.com/en-us/graph/api/chatmessage-post?view=graph-rest-1.0),
  [permissions](https://learn.microsoft.com/en-us/graph/permissions-reference),
  [refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens),
  [device code](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code)):
  - Posting is delegated-only (`ChannelMessage.Send`, `ChatMessage.Send`) and
    needs no admin consent. Reading channel messages needs admin consent.
    Tenant consent policy can still block a person's own app.
  - Access tokens last 60–90 min. Refresh tokens last 90 days and are replaced
    on every use.
  - The device-code flow works for a public client without a secret. It needs
    a tenant authority, not `/common`.
  - Microsoft's Teams MCP ("Work IQ Teams") is in preview and needs a
    Microsoft 365 Copilot license.
- **CLI-side MCP auth**:
  - Claude Code ([MCP](https://code.claude.com/docs/en/mcp)) expands `${VAR}`
    in `env`, `url` and `headers`. It has `headersHelper`, and `claude mcp login`
    for OAuth. Tokens go to the macOS keychain, or to `~/.claude/.credentials.json`
    on Linux and Windows.
  - Codex ([MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)) has
    `env_vars`, `bearer_token_env_var`, `env_http_headers` and `codex mcp login`.
    `mcp_oauth_credentials_store` is `auto`, `file` or `keyring`.
  - These were read through summaries. The Codex credential file path and the
    Entra "allow public client flows" requirement are unverified.

## Success Criteria Evaluation

| Criterion | Evidence | Assessment |
|---|---|---|
| 1. Never in KB, Git, conversation or output | D5 already requires an irori field and output redaction. Folders declare names only (ADR 013). | Met by design; redaction and a "names only" rule for shared hibachis need tests |
| 2. OS-backed at rest, refuse otherwise | Sync check refuses all measured no-store cases; the async API does not | Met with the sync check; the store-present branch is unmeasured |
| 3. Agent cannot exfiltrate tokens | Env is readable by the same user (measured). Agent steps get no tokens (D5). Agent-side tools use the CLI's own auth (decision 3). | Met for irori-held tokens. Not met against malware running as the user, which no desktop design meets |
| 4. Rotating tokens | Slack rotation and Graph replace refresh tokens | Met once write-back (decision 2) is built |
| 5. Same for every CLI | Agent-side tools stay in each CLI's own MCP configuration | Met by not intervening; each CLI's auth differs and stays outside irori |

## Risks

- **Linux without a keyring** (headless, minimal window managers, some WSL
  setups) cannot store secrets, so routines that need them cannot run there.
- **A secret sent to a `run` step is readable for that step's lifetime** by any
  same-user process. A concurrent full-access agent conversation could read it.
  Keep steps short-lived and say so.
- **A step can overwrite a secret through write-back.** Limit it to names that
  step declares, and keep the routine review as the gate on what a step does.
- **Slack MCP and Teams MCP need the person's own app, and a Copilot license
  for Teams.** irori cannot remove that work.
- **macOS needs code signing** for per-app Keychain protection. Unsigned
  previews may prompt or share access. This was not checked.

## Owner decisions (2026-10-05)

1. **Linux without a usable key store: refuse.** irori stores no secret when
   `isEncryptionAvailable()` is false or the backend is `basic_text`/`unknown`.
2. **Write-back is part of stage 2.**
3. **Agent-side tools are left to external tools for now.** An agent reaches
   Slack, Teams and similar services through its CLI's own MCP configuration
   and sign-in (`claude mcp login`, `codex mcp login`). irori holds none of
   those tokens and builds no broker yet.

## Recommendation

Implement ADR 016 stage 2 with these parts, then record the decisions in
ADR 016 D5:

- **`SecretService` in the host.**
  - It keeps a device-local map of name to ciphertext in irori's data directory.
  - It uses the synchronous `safeStorage` API with the
    `secureStorageAvailable` check revived from `0dfb66d`, and refuses on
    `basic_text`, `unknown` and unavailable encryption.
  - The renderer reaches it through narrow `HostAPI` methods: list names, set,
    delete and status. No method returns a value.
- **Entry.** A secret is entered in a dedicated field and never displayed
  again; it can only be replaced or deleted.
- **Declaration.** Folders and routines declare names only. A routine's review
  shows the names it uses, and a changed list needs a new review.
- **Handoff.** Only the `run` steps that name a secret receive it, as an
  environment variable. Agent steps receive none.
- **Write-back.** A `run` step that names secrets also receives
  `IRORI_SECRETS_OUT`, a path to a private file in a fresh `0700` directory.
  - Each `NAME=value` line it writes, for a name the step declared, is
    re-encrypted once the program ends.
  - Lines are kept even when the step fails, since a refreshed token may
    already have replaced the old one. An unfinished last line is then
    ignored. (This was changed during implementation from "after a
    successful exit".)
  - The file is removed on every outcome.
  - Undeclared names and malformed lines are refused and named in the record
    without their values.
- **Redaction.** Exact values, including written-back ones, are removed from
  records, errors and the review.
- **Verification.**
  - Unit tests: store refusal, redaction and write-back limits.
  - A UI smoke test of the entry field.
  - A disposable routine that refreshes a fake token through write-back.
  - The store-present branch measured on an installed preview with GNOME
    Keyring, macOS and Windows. Headless CI cannot show it.
