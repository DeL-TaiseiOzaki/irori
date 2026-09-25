# Your AI: session root, brain sub-agents, observation and permissions (spike)

Date: 2026-09-25. Status: research for UI v5 phase 5 ([ADR 014](../decisions/014-ui-v5.md),
decision 5). Nothing here is implemented. No model inference was run: the
evidence is irori's source, the installed Claude Agent SDK's type declarations,
the installed CLIs' `--help` / `features list` output, the Codex app-server
protocol bindings generated from the installed binary, and official
documentation. Every behavioural claim that only a model turn can settle is
listed under [acceptance](#what-a-real-provider-acceptance-run-must-confirm).

Versions inspected: `@anthropic-ai/claude-agent-sdk` 0.3.269 (irori's
dependency), Claude Code 2.1.280 (the `claude` irori launches), `codex-cli`
0.156.1. irori's `available()` still marks Codex 0.154.0 and Claude Code 2.1.232
as the tested versions (`src/agents/service.ts:190-195`).

Codex protocol references below (`v2/…ts:line`) are to the output of
`codex app-server generate-ts --experimental --out <dir>` from the installed
0.156.1. irori does not vendor these types; regenerate them to check a line.

## Recommendation in short

1. **Run your AI through the existing `AgentService`, keyed by a reserved
   device-local id**, not by registering its folder as a KB. The folder
   (`~/irori/you`) and its id live in irori's data directory. One resolver,
   `root(scopeId)`, replaces the direct `files.get(scopeId).root` lookups. The
   existing run, queue, conversation, session and respond/cancel HostAPI methods
   then take that id unchanged. New HostAPI methods: status and create for the
   folder, plus read-only entries/read for the Your AI screen.
2. **Give the brains to your AI per run, host-resolved.** The renderer names
   brains by `scopeId` only. The host passes their roots as Claude
   `additionalDirectories` and as Codex `turn/start`
   `sandboxPolicy.workspaceWrite.writableRoots`. It also adds a short preamble
   that maps each brain to the sub-agent name irori expects.
3. **Your AI runs in the standard access mode only** for now. Both CLIs make
   sub-agents inherit the parent's permission mode or sandbox. Full access for
   your AI would therefore give full access to every brain it delegates to,
   whatever each brain's own setting.
4. **Attribute everything a sub-agent does to a brain, and have irori enforce
   the brain boundary**. Use Claude hook `agent_id`/`agent_type` and
   `canUseTool`'s `agentID`, and Codex `threadId` on every notification and
   approval. For Claude, irori also enforces the boundary with a `PreToolUse`
   deny for file writes outside that brain's root. Codex has no equivalent
   in-process hook, so its sandbox allows writes to every brain root in the run.
5. **Lock the delegated brains while your AI's run is active.** The per-scope
   lock of `AgentService.busy()` and the git/space/cloud refusals in `main.ts`
   otherwise let a brain's own AI, or a Git operation, touch the same checkout
   as a sub-agent.
6. **Fix the Codex adapter before delegation:** it currently ends the run on
   *any* `turn/completed` and shows every thread's text and approvals as the
   parent's (`src/agents/service.ts:572-591`, `625-682`).

A correction to the ADR's premise: Codex 0.156.1 **does** have a sub-agent
definition format, `.codex/agents/*.toml` (see [(b)](#codex-app-server)). The
skill-driven spawn still works without it. With definitions, each spawned thread
carries an `agentRole`, which makes attribution to a brain deterministic. The
owner should decide whether the `brain-agents` skill also asks a Codex-backed
your AI to write them.

## (a) Launching your AI with `cwd` = its folder

### What assumes a registered KB scope today

| Place | Assumption |
| --- | --- |
| `src/domain/conversation.ts:20` | `startInput` requires `scopeId: z.uuid()`. Any uuid passes; nothing checks registration here. |
| `src/agents/service.ts:95-97` | `binding()` takes the root from `files.get(scopeId).root`. `FileService.get` throws `Unknown space` for anything not registered (`src/host/files.ts:97-101`). Every session/conversation call goes through this. |
| `src/agents/service.ts:222`, `358` | `start()` and `execute()` call `files.get(input.scopeId)` again: once as a guard, once for `space.root` and `space.name` (the "Running … in …" status line, `436-438`). |
| `src/agents/service.ts:360-376` | `notePath` and `personLines` resolve and read a note through `FileService` in that scope. |
| `src/agents/service.ts:377-379` → `src/host/skills.ts:165-178` | A selected skill is read from the scope's `.agents/skills` via `FileService`. |
| `src/agents/service.ts:389` → `src/knowledge/store.ts:90-110` | `knowledge.begin` writes an immutable run record under `runs/<scopeId>/` and captures `sources` from the scope. It works with any uuid, but its history is read per KB. |
| `src/agents/service.ts:713-723` → `src/knowledge/authorship.ts:88-102` | The Claude `PreToolUse` person-lines hook resolves the edited path against the run's scope root. It ignores paths outside that root, so a sub-agent's edit in a brain gets no notice. |
| `src/agents/service.ts:452-457` | The OpenCode/Pi person-lines bridge is built with the run's `scopeId`. |
| `src/agents/sessions.ts:10-45`, `src/agents/conversations.ts:28-69` | Stores key on `sha256([scopeId, agent, root])` and validate `scopeId` as uuid and `root` as a string. They work unchanged for a non-KB root once `binding()` can produce one. |
| `src/agents/service.ts:54`, `86-94` | `runs` map and `busy()` are per `scopeId`; `anyBusy` gates workspace and space changes in `src/host/main.ts` (`214`, `255`, `318`, `332`, `427`, `442`, `465`, `506`, `515`). |
| `src/host/main.ts:122-135` | `canStartAgent()` is global (Git, saves, cloud). It needs no scope. |

The launch paths themselves do not need a KB. Codex starts with the given `cwd`
(`service.ts:544`, `605`); Claude receives `cwd` (`697`); OpenCode and Pi take
`NativeContext.cwd` (`src/agents/adapter.ts`, `service.ts:459-460`).

### Smallest change

- **Identity:** a host-owned record `{ id: uuid, root }` in the data directory
  (for example `you.json`, written with `writeLocalJson`). The default root is
  `~/irori/you`, one per person as the ADR settles. It is never written to any
  KB. Do not register it in `FileService`. Its declaration requires
  `.irori/scope.json` with at least one `contents` entry
  (`src/host/files.ts:31-38`, `103-108`), and every workspace, tree, Git and
  cloud path would then need to exclude it.
- **`AgentService`:** add a `root(scopeId)` resolver: the registered space's
  root, or the your-AI root for the reserved id. Use it in `binding()` and the
  two `files.get` calls, and use a display name ("your AI") for the status
  line. For the your-AI id, refuse `notePath`, `personLines` and `sources` at
  first: they are note-in-a-KB features. Resolve `skill` from the your-AI
  root's `.agents/skills` by giving the skill reader a root instead of a scope,
  or refuse it until the Your AI screen needs it.
- **Person lines:** change `personLinesNotice` to find the registered space
  whose root contains the absolute edited path, rather than trusting the run's
  scope. A sub-agent's edit inside a brain then gets that brain's person-lines
  notice. For ordinary brain runs the result is identical.
- **HostAPI** (`src/domain/types.ts`), new:
  - `yourAi(): Promise<YourAi>`, returning `{ id, root, state: 'missing' | 'ready' }`.
  - `createYourAi(): Promise<YourAi>`, which writes the minimal starter only
    into an absent or empty folder and never overwrites.
  - `yourAiEntries(dir)` and `yourAiRead(path)`, read-only and confined to the
    root with the same `realpath` containment `FileService` uses.

  Reused unchanged with `scopeId = yourAi.id`: `start`, `queueAgentMessage`,
  `startQueuedMessage`, `agentConversation`, `agentSession`,
  `resetAgentSession`, `cancel` and `respond`.
- **`StartRun`:** add `brains?: string[]` (scopeIds, validated as registered and
  capped), accepted only for the your-AI id. The host resolves the roots; the
  renderer never sends a path.

## (b) Giving brain sub-agents access to brain roots

### Claude Agent SDK 0.3.269

| Option | Declaration | Relevance |
| --- | --- | --- |
| `cwd?: string` | `Options` | Your AI's folder. |
| `additionalDirectories?: string[]` | `sdk.d.ts:1412-1416`: "Additional directories Claude can access beyond the current working directory. Paths should be absolute." | Brain roots. |
| `agents?: Record<string, AgentDefinition>` | `sdk.d.ts:1436-1451`; `AgentDefinition` `36-100` (`description`, `prompt`, `tools`, `disallowedTools`, `model`, `skills`, `maxTurns`, `background` `79`, `permissionMode` `91`, …) | Programmatic definitions. irori should **not** use them: ADR 014 says the definitions belong to your AI's Schema. |
| `settingSources?: SettingSource[]` | `sdk.d.ts:2087-2096`; `SettingSource = 'user' \| 'project' \| 'local'` (`8681`) | irori passes all three (`service.ts:700`). |
| `permissionMode?: PermissionMode` | `'default' \| 'acceptEdits' \| 'bypassPermissions' \| 'plan' \| 'dontAsk' \| 'auto'` (`sdk.d.ts:2327`) | irori uses `default` / `bypassPermissions` (`service.ts:702-703`). |

**File-based definitions.** The SDK subagents guide says Claude Code watches
`~/.claude/agents/` and `.claude/agents/`. It also loads `.claude/agents/` from
directories added with `additionalDirectories`, but does not watch them.
Programmatic `agents` override a file-based agent of the same name. The Claude
Code subagents page puts project `.claude/agents/` at priority 3 and user
`~/.claude/agents/` at priority 4. The SDK permissions guide says project
settings load when the `project` setting source is enabled.

So `.claude/agents/<brain>.md` in the your-AI folder should load with irori's
current `settingSources`. This is inferred from the docs; the
[acceptance](#what-a-real-provider-acceptance-run-must-confirm) run confirms it
from the init message's `agents?: string[]` (`sdk.d.ts:5482-5485`) or
`Query.supportedAgents()` (`sdk.d.ts:2765-2769`).

There are two side effects. Each brain's own `.claude/agents/` also loads,
because brains are additional directories, so names can collide and the
higher-priority location wins. A new `agents/` directory created during a
session needs a restart; irori starts a fresh process per run anyway.

**No per-sub-agent `cwd`.** The Agent tool input has `description`, `prompt`,
`subagent_type`, `model`, `run_in_background`, `name` and `isolation`
(`worktree` or `remote`), and no working directory
(`sdk-tools.d.ts:692-735`). The docs: "A subagent starts in the main
conversation's current working directory. Within a subagent, `cd` commands
don't persist between Bash or PowerShell tool calls."

A brain sub-agent therefore differs from the brain's own AI:

- It works in your folder.
- It loads *your* project `CLAUDE.md`, not the brain's (the docs' "What
  subagents inherit" table).
- It does not get the brain's `.claude/settings.json` permission rules or
  hooks.
- It reaches the brain only through paths, the `additionalDirectories` scope,
  and the `brain-agents` skill telling it to read the brain's `AGENTS.md` and
  `.agents/skills`.

What controls a sub-agent is its tool list (`tools` / `disallowedTools`), its
permission mode, irori's hooks and `canUseTool`, and path-scoped settings rules.

**Permission inheritance.** From the SDK permissions guide: "A subagent runs in
the parent session's permission mode unless you set `permissionMode` on its
`AgentDefinition` and the parent session is in `default`, `dontAsk`, or `plan`
mode. Even then, Claude Code never applies a `"bypassPermissions"` value. A
subagent runs in `bypassPermissions` mode only when the parent session itself
does."

A definition's `permissionMode` can therefore narrow a sub-agent but never
widen it past the parent. `acceptEdits` auto-approves edits only inside the
working directory or `additionalDirectories`.

### Codex app-server

**`multi_agent` in 0.156.1.** `codex features list` shows `multi_agent stable
true`, `multi_agent_v2 stable false` and `multi_agent_mode removed false`. The
installed binary's `spawn_agent` instructions say "Do not spawn sub-agents
unless the user or applicable AGENTS.md/skill instructions explicitly ask for
sub-agents, delegation, or parallel agent work". A skill in your AI's Schema is
therefore the intended trigger. The same instructions say the spawned agent
"will have the same tools as you". No per-spawn working directory appears
anywhere in the protocol or instructions.

**Custom agent definitions exist.** Official docs
([subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)):
"Custom agents are defined as standalone TOML files in `~/.codex/agents/`
(personal) or `.codex/agents/` (project-scoped)". Required fields are `name`,
`description` and `developer_instructions`; optional ones include `model`,
`model_reasoning_effort`, `sandbox_mode`, `mcp_servers` and `skills.config`.

The installed binary contains the matching loader:

- `agent-roles/src/loader.rs` and `discovery.rs`
- `core/src/agent/role.rs`
- the errors "must define `developer_instructions`", "`developer_instructions`
  cannot be blank" and "unknown agent_type '…'"
- the telemetry key `codex.multi_agent.spawn agent_type`

A spawned thread records the role: `Thread.agentRole` ("Optional role
(agent_role) assigned to an AgentControl-spawned sub-agent", `v2/Thread.ts:132-134`)
and `SubAgentSource.thread_spawn.agent_role` (`SubAgentSource.ts:7`). Whether
project `.codex/agents` loads for an untrusted `~/irori/you` is unverified.

**Writable roots.**

| Surface | Declaration |
| --- | --- |
| `turn/start` `sandboxPolicy` | `v2/TurnStartParams.ts:74` "Override the sandbox policy for this turn and subsequent turns"; `SandboxPolicy` `workspaceWrite: { writableRoots: AbsolutePathBuf[], networkAccess, excludeTmpdirEnvVar, excludeSlashTmp }` (`v2/SandboxPolicy.ts:7`). The app-server docs show the same `writableRoots` example. |
| `thread/start` / `thread/resume` | `sandbox?: SandboxMode` only (`'read-only' \| 'workspace-write' \| 'danger-full-access'`); `config?: {[key]: JsonValue}` overrides; `runtimeWorkspaceRoots?: AbsolutePathBuf[]` "Replace the thread's runtime workspace roots" (`v2/ThreadStartParams.ts:27`, `v2/TurnStartParams.ts:61`). What `runtimeWorkspaceRoots` grants is **not** documented; do not rely on it. |
| CLI | `codex --add-dir <DIR>`: "Additional directories that should be writable alongside the primary workspace". This is not used over app-server. |
| Sandbox text in the binary | "`sandbox_mode` is `workspace-write`: The sandbox permits reading files, and editing files in `cwd` and `writable_roots`. Editing files in other directories requires approval." |

irori sends `sandbox: 'workspace-write'` on `thread/start` (`service.ts:604-609`).
The minimal addition is a `sandboxPolicy` of type `workspaceWrite` with the
brain roots on `turn/start`. Its other fields must equal the current defaults so
ordinary runs keep their behaviour.

The docs say sub-agents "inherit your current sandbox policy" and approval
mode. The roots are thread-wide: every sub-agent, and your AI's own thread, can
write every brain passed to the run. Codex has no per-brain path isolation.

## (c) Observing sub-agent activity

### Claude

| Signal | Declaration | Use |
| --- | --- | --- |
| `tool_use` block named `Agent` (older CLIs `Task`) with `input.subagent_type`, `description`, `prompt` | SDK subagents guide ("check for `tool_use` blocks where `name` is `"Agent"`"); `AgentInput` (`sdk-tools.d.ts:692-735`) | Creates a task row: brain from `subagent_type`, task text from `description`. |
| `parent_tool_use_id: string \| null` on assistant, user and stream messages | `sdk.d.ts:3337-3345`, `5096`, `5706` | Routes a message to the task whose Agent `tool_use.id` it names. irori currently emits every `tool_use` and streamed text as the parent's (`service.ts:787-802`). |
| `subagent_type`, `task_description` on assistant messages | `sdk.d.ts:3375-3382` | Direct attribution without a lookup. |
| `system` `task_started` (`task_id`, `tool_use_id`, `description`, `subagent_type`, `is_backgrounded`, `spawn_depth`), `task_progress` (`last_tool_name`, `summary`, `usage`), `task_updated` (`patch.status`), `task_notification` (`status: completed \| failed \| stopped`, `summary`) | `sdk.d.ts:5545-5655` | Task state for the row: running, done or failed. `agentProgressSummaries` (`1923-1930`) adds model-written one-line summaries at extra cost; leave it off. |
| `background_tasks_changed` (replace-semantics set) | `sdk.d.ts:3423-3440` | A level signal for "sub-agents still running". |
| Agent tool result: user message with `tool_use_result`; `AgentOutput` `{ agentId, agentType, content[], toolStats, status: 'completed' }` or `{ status: 'async_launched', agentId, … }` | `sdk.d.ts:5709`; `sdk-tools.d.ts:103-160` | The report shown under the task. `toolStats.editFileCount` / `linesAdded` give the changed-file summary. |
| Hooks `SubagentStart { agent_id, agent_type }`, `SubagentStop { agent_id, agent_type, last_assistant_message, agent_transcript_path }`; every hook input carries `agent_id`/`agent_type` "when the hook fires from within a subagent" | `sdk.d.ts:8856-8893`, `173-183` | Maps `agent_id` (what `canUseTool` sees) to `agent_type` (the brain). |
| `forwardSubagentText?: boolean` | `sdk.d.ts:1738-1742` "By default, only tool_use/tool_result blocks from subagents are emitted" | Keep the default; tool events are enough for the list. |

The docs note: "Subagents run in the background by default." In a one-shot
(string-prompt) query, the result "held back while background work finishes"
(`sdk.d.ts:5318`) and "a one-shot run … still kills hold-back tasks at the
held-result release" (`4212`). Which of the two applies to irori's run is an
acceptance item. The fallback is
`env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` (named at `sdk.d.ts:2960`), which
keeps every sub-agent in the foreground. Parallel Agent calls in one message
still run concurrently.

### Codex (`codex app-server` 0.156.1)

| Signal | Declaration |
| --- | --- |
| Every notification is thread-scoped: `item/started` `{ item, threadId, turnId }`, `turn/completed` `{ threadId, turn }` | `v2/ItemStartedNotification.ts`, `v2/TurnCompletedNotification.ts` |
| `thread/started` `{ thread }` with `parentThreadId`, `source: { subAgent: { thread_spawn: { parent_thread_id, depth, agent_path, agent_nickname, agent_role } } }`, `agentNickname`, `agentRole`, `cwd` | `v2/Thread.ts:42`, `104`, `117`, `130-134`; `SubAgentSource.ts:7`; `v2/SessionSource.ts` |
| Item `collabAgentToolCall` `{ tool: spawnAgent \| sendInput \| resumeAgent \| wait \| closeAgent \| sendMessage \| followupTask \| interruptAgent \| listAgents, status, senderThreadId, receiverThreadIds, prompt, model, agentsStates: { [threadId]: { status: pendingInit \| running \| interrupted \| completed \| errored \| shutdown \| notFound, message } } }` | `v2/ThreadItem.ts:88-125`, `v2/CollabAgentTool.ts`, `v2/CollabAgentStatus.ts` |
| Item `subAgentActivity` `{ kind: started \| interacted \| interrupted \| completed, agentThreadId, agentPath }` | `v2/ThreadItem.ts:125`, `v2/SubAgentActivityKind.ts` |

The parent thread's `collabAgentToolCall` (spawn: `prompt`, `receiverThreadIds`)
and `subAgentActivity` items are enough for the task list even if the child
threads' own item stream is not delivered. The app-server docs say spawned
threads emit `thread/started`; whether their `item/*` and `turn/completed`
arrive on irori's connection is an acceptance item. The docs name the item
`collabToolCall`, but the installed types say `collabAgentToolCall`: trust the
installed version.

**Adapter defects this exposes** (`src/agents/service.ts`):

- `572-591`: `item/agentMessage/delta`, `item/started` and `turn/completed` are
  handled without checking `p.threadId`. A child's `turn/completed` would end
  your AI's run early, and child text would be concatenated into the reply.
- `625-682`: approvals and questions ignore `p.threadId`, so a child's request
  is shown as the parent's.

The fix: keep the current handling for `threadId === run.threadId`, and route
other threads to delegate events.

### How a handed-over task appears in the brain's AI panel

Add an optional `delegate?: { scopeId: string; task: string; state: … }` to
`AgentEvent` (`src/domain/types.ts:68-79`) for events a sub-agent causes. They
stay in your AI's conversation record, the single source. The brain's AI panel
and the Overview task list show your-AI events whose `delegate.scopeId`
matches, labelled "あなたの AI から". Do **not** write them into the brain's
native session or conversation store: it records that CLI's own resumable
conversation, and injected entries would misrepresent it.

## (d) Permissions

What exists: `src/domain/agent-access.ts` is a per-run choice, `default` or
`full-access` (Pi `default` only), validated by `requireAgentAccess`. The
composer resets it to default on workspace, KB or CLI change and on restart
(HARNESSES "Native configuration and lifecycle"). There is **no persisted
per-brain access policy** to apply to a sub-agent. The honest mapping today is:
delegated work runs under the standard mode, and its native requests reach the
person, attributed to the brain.

**Claude.** Evaluation order: hooks, deny rules, ask rules, permission mode,
allow rules, then `canUseTool` (SDK permissions guide).

- `canUseTool` receives `options.agentID` "If running within the context of a
  sub-agent" and `toolUseID` (`sdk.d.ts:256-260`). irori's callback ignores
  its third argument (`service.ts:746`).
- `PreToolUse` hook inputs carry `agent_id`, `agent_type` and `tool_use_id`
  (`sdk.d.ts:173-183`, `2580-2585`). A hook `permissionDecision: 'deny'`
  (`2587-2593`) applies even in `bypassPermissions`.
- `permission_denied` system messages carry `agent_id`, which "Mirrors
  can_use_tool for host-side routing" (`sdk.d.ts:5127-5131`).
- The docs: "Background subagents surface every permission prompt in your main
  session".

So irori can:

1. On `SubagentStart`, record `agent_id → agent_type → brain scopeId` from the
   run's name table.
2. On `PreToolUse` for `Edit|MultiEdit|Write|NotebookEdit` from a mapped
   `agent_id`, deny a path outside that brain's root. Keep the person-lines
   notice, resolved against the brain that contains the path. Unmapped
   sub-agents, such as `general-purpose`, get the same boundary: any registered
   brain root in the run, never outside them.
3. In `canUseTool`, publish the request with `delegate.scopeId` so it shows in
   that brain's panel and the Overview, where answering is allowed.

Bash cannot be path-confined by a hook in general. In `default` mode, commands
that are not read-only already ask.

**Codex.** Every approval and question request carries `threadId`
(`v2/CommandExecutionRequestApprovalParams.ts:17`,
`v2/FileChangeRequestApprovalParams.ts:5`,
`v2/PermissionsRequestApprovalParams.ts:7`,
`v2/ToolRequestUserInputParams.ts:9`). With `thread/started` or
`collabAgentToolCall.receiverThreadIds` mapped to a brain, a request is
attributed exactly. Enforcement is weaker than Claude's:

- The sandbox roots are shared by every thread.
- A custom agent's `sandbox_mode` can narrow a role, for example to
  `read-only`; whether it can widen one is unknown.
- irori has no in-process hook channel for Codex, which is the same limitation
  that already blocks the person-lines notice.

**Full access.** Do not offer it for your AI in the first version:

- Claude `bypassPermissions` is inherited by every sub-agent.
- Codex `danger-full-access` is inherited by every spawned thread.

If the owner later wants per-brain full access for delegated work, it needs a
persisted per-brain policy. Claude could then emulate it by auto-allowing a
mapped sub-agent's in-root calls in `canUseTool`; Codex cannot mix modes within
one parent thread.

## Recommended implementation for irori

1. **Host: your-AI record and HostAPI** as in (a). Keep the starter minimal and
   irori-written:
   - `AGENTS.md`
   - `CLAUDE.md` pointing at it
   - `.agents/skills/brain-agents/SKILL.md`
   - empty `.claude/agents/`

   Write it only when the person creates the folder. Keep it free of
   development permissions or accounts.
2. **Brain name table** in `src/domain/` with one function,
   `brainAgentName(space)`: a stable slug without `:`, deduplicated with a short
   scopeId suffix. It goes into every your-AI prompt preamble and into the
   "update definitions" request. The request asks your AI to write or refresh
   `.claude/agents/<name>.md` (and, if the owner agrees, `.codex/agents/<name>.toml`)
   with that brain's root, `AGENTS.md`, skills and the report format. irori
   never writes the definitions.
3. **`AgentService`:** add the `root()` resolver and `brains` on `StartRun`.
   Claude gets `additionalDirectories`, the `SubagentStart`/`SubagentStop`
   hooks, the widened `PreToolUse` and the `agentID`-aware `canUseTool`.
   Codex gets `turn/start sandboxPolicy.writableRoots`, `threadId` filtering
   and thread → brain mapping. Both emit `delegate` events: a task started from
   an Agent `tool_use` or `collabAgentToolCall` spawn, progress from
   `task_*` or `subAgentActivity`, and a report from the Agent tool result or
   the child's completion.
4. **Locking:** while a your-AI run is active, `busy(scopeId)` is true for each
   brain in its `brains`. A your-AI run refuses to start while any of those
   brains is busy. This is coarse but safe: it matches the "one run per
   checkout" invariant (`service.ts:52-54`). Refinement to lock only on
   `SubagentStart` has a start race, so leave it for later.
5. **Renderer:** the Overview's "your AI" island and task list, the Your AI
   screen (read-only Schema tree from `yourAiEntries`), and the brain panel's
   "あなたの AI から" projection all read one conversation.
6. **Tests without inference:** protocol fixtures for Claude messages carrying
   `parent_tool_use_id`, `task_*`, hook inputs with `agent_id`, and
   `canUseTool` with `agentID`. Codex JSONL fixtures cover child-thread
   `turn/completed`, which must not end the run, and a child approval
   attributed to its brain. Unit tests cover `root()`, `brains` validation,
   locking, the path-boundary deny and the name table.

## Open risks

- **A brain sub-agent is not the brain's own AI** (ADR 014 decision 4 defines
  the brain's AI as the CLI loaded in that brain's folder). A sub-agent keeps
  your AI's `cwd`, `CLAUDE.md`, settings and hooks, and only follows the
  brain's `AGENTS.md` and skills because the skill tells it to. The Codex
  sandbox does not confine it to one brain. If this gap matters, the
  alternative is an irori-mediated hand-off: your AI calls a host tool (Claude
  in-process MCP; Codex `dynamicTools`, `v2/ThreadStartParams.ts:72`, which
  irori currently declines at `service.ts:665-679`) that queues the brain's
  real per-scope run. That changes decision 5, so it is the owner's call.
- **Codex definition format** contradicts the ADR's premise; see above.
- **Run lifetime:** the ten-minute deadline (`service.ts:339-346`) will likely be
  short for multi-brain work, and background sub-agents may outlive or be
  killed at the one-shot result.
- **Throughput and cost:** Claude defaults allow nesting depth 3 and 20
  concurrent sub-agents (SDK guide, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`,
  `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`). irori could pass depth `1` through
  `env` so brain sub-agents do not spawn further.
- **Name collisions:** brains' own `.claude/agents` load too, via
  `additionalDirectories`.
- **Codex project trust** for `.codex/` in `~/irori/you` is unknown.
- **Content as data:** a brain's notes flow through a sub-agent's report into
  your AI's context and into other brains' tasks. Brain text must not become
  instructions (the workspace security rule).
- **Version drift:** the tested pins in `available()` predate both installed
  CLIs.

## What a real-provider acceptance run must confirm

This needs the owner's separate authorization: it uses the owner's Claude Code
and Codex accounts and consumes allowance. Use two disposable KBs
registered in a disposable workspace, a disposable your-AI folder written by the
starter, standard access only, and no user notes. Do not commit transcripts.

Claude Code 2.1.280 through SDK 0.3.269:

1. The init message's `agents` lists the `.claude/agents/<brain>.md`
   definitions from the your-AI folder with irori's `settingSources`. Record
   whether brains' own `.claude/agents` also appear.
2. A delegation prompt produces an `Agent` `tool_use` with `subagent_type` =
   the brain name.
   - `SubagentStart` delivers the same `agent_type` and an `agent_id`.
   - Sub-agent messages carry that `parent_tool_use_id`.
   - `task_started` and `task_notification` link by `tool_use_id`.
3. A sub-agent edit inside a brain root reaches `canUseTool` with `agentID`
   equal to the hook's `agent_id`. A deny is respected. A `PreToolUse` deny for
   a path in the other brain is respected.
4. The ordering of `result` against `task_notification` for a background
   sub-agent: does irori's run end only after the reports? Cancel stops the
   sub-agents and the process tree.
5. The person-lines notice reaches a sub-agent edit of a line the person wrote.
6. A resumed your-AI session still sees the definitions and can resume a
   sub-agent.

Codex 0.156.1 through `codex app-server`:

1. A skill-driven delegation spawns threads. Record which notifications arrive
   on irori's connection: `thread/started` with `parentThreadId` and
   `agentRole`/`agentNickname`, child `item/*`, and child `turn/completed`
   (with the threadId filter in place). Record the contents of
   `collabAgentToolCall` and `subAgentActivity`.
2. A child approval carries the child `threadId`; a decline is respected.
3. `turn/start` `sandboxPolicy.workspaceWrite.writableRoots` lets a child write
   inside a brain root without escalation. A write outside the roots asks.
4. Whether `.codex/agents/<brain>.toml` in the your-AI folder loads (a spawned
   thread's `agentRole`), trusted and untrusted.
5. `turn/interrupt` on the parent stops the children, and the process tree
   ends.

A new opt-in script (for example `test:your-ai`) should hold these checks,
separate from `npm test` and the existing `test:agents`.
