import type { AgentId } from './types';

/**
 * What each CLI loads by itself of the Schema of the folder it works in, when
 * irori starts it there, and what irori therefore gives it (ADR 058). Every
 * Schema setting reaches every CLI: by the CLI itself where its source shows it
 * loads it, otherwise by irori. The sources and versions behind each row are in
 * docs/HARNESSES.md ("Schema reach").
 */
export interface SchemaReach {
  /**
   * The CLI reads the folder's `AGENTS.md` itself. `limit`: it keeps only so many
   * bytes of it. `hiddenBy`: a file beside it the CLI reads instead.
   * `stale`: a session it goes on with keeps the copy it began with.
   */
  instructions: { reads: boolean; limit?: number; hiddenBy?: string[]; stale?: boolean };
  /**
   * It loads the `AGENTS.md` of a folder below once it reads or uses a file there.
   * irori names a knowledge folder's AGENTS.md to every CLI all the same: none
   * loads it before writing a new file there.
   */
  nested: boolean;
  /** It reads `.claude/rules`. */
  rules: boolean;
  /** It finds the folder's `.agents/skills` by itself, or with what irori passes it. */
  skills: boolean;
  /** It runs the hooks of `.claude/settings.json` itself. */
  hooks: boolean;
  /** Its output says when it compacted a session; otherwise irori's words go whole every time. */
  compaction: boolean;
}

/** Codex keeps this many bytes of a folder's instructions when irori starts it; its own default is 32 KiB. */
export const codexInstructionBytes = 1024 * 1024;

export const schemaReach: Record<AgentId, SchemaReach> = {
  // Claude Code 2.1.277+ reads AGENTS.md; irori has it read AGENTS.md beside a
  // CLAUDE.md too, and gives AGENTS.md to an older version.
  claude: {
    instructions: { reads: true },
    nested: true,
    rules: true,
    skills: true,
    hooks: true,
    compaction: true,
  },
  // Codex cuts AGENTS.md at `project_doc_max_bytes`, which irori raises.
  codex: {
    instructions: { reads: true, limit: codexInstructionBytes, hiddenBy: ['AGENTS.override.md'] },
    nested: false,
    rules: false,
    skills: true,
    hooks: false,
    compaction: true,
  },
  // OpenCode attaches a folder's AGENTS.md on a read there, not on an edit or a write.
  opencode: {
    instructions: { reads: true },
    nested: false,
    rules: false,
    skills: true,
    hooks: false,
    compaction: true,
  },
  // Pi reads AGENTS.md whatever the project's trust; skills come with `--skill`.
  pi: {
    instructions: { reads: true, hiddenBy: ['AGENTS.override.md'] },
    nested: false,
    rules: false,
    skills: true,
    hooks: false,
    compaction: true,
  },
  // Hermes reads one kind of context file, cuts a long one, keeps the system
  // prompt a session began with, finds project skills only when trusted, and
  // compresses in place without saying so.
  hermes: {
    instructions: {
      reads: true,
      limit: 20_000,
      hiddenBy: ['.hermes.md', 'HERMES.md', 'AGENTS.override.md'],
      stale: true,
    },
    nested: true,
    rules: false,
    skills: false,
    hooks: false,
    compaction: false,
  },
  // The Antigravity CLI cuts a rule file at 24,000 bytes and does not say when it compacts.
  antigravity: {
    instructions: { reads: true, limit: 24_000 },
    nested: false,
    rules: false,
    skills: true,
    hooks: false,
    compaction: false,
  },
};

/**
 * How the shared Schema's skills become each CLI's own skills (ADR 066), beside
 * their names in the shared Schema's words. The shared Schema is in the irori
 * agent's folder, which no CLI reads, so irori gives each one its skills:
 *
 * - `links`: Claude Code reads links in a folder irori adds (ADR 049).
 * - `skill-flag`: Pi takes each skill folder with `--skill` (ADR 058).
 * - `extra-root`: Codex's app server takes a folder of links as an extra skill root.
 * - `config-path`: irori's plugin adds a folder of copies to OpenCode's skill paths.
 * - `workspace-copy`: the Antigravity CLI reads copies in a workspace folder irori adds.
 * - `listed`: Hermes Agent takes no skill folder from irori; it hears them listed.
 *
 * A name the folder's own skills have, or retired, is never given (ADR 027 D8).
 * OpenCode and the Antigravity CLI get copies: each may change a skill's folder
 * without asking, and through a link it would change the shared Schema.
 */
export const sharedSkillReach: Record<
  AgentId,
  'links' | 'skill-flag' | 'extra-root' | 'config-path' | 'workspace-copy' | 'listed'
> = {
  claude: 'links',
  codex: 'extra-root',
  opencode: 'config-path',
  pi: 'skill-flag',
  hermes: 'listed',
  antigravity: 'workspace-copy',
};

/** The events irori runs itself around every run of a CLI that does not run hooks. */
const aroundRun = ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd', 'Notification'];

/**
 * The hook events irori runs for each CLI that does not run hooks itself: those
 * around the run, those of the CLI's compactions and permission requests irori
 * sees, and the tool events its plugin, extension or own hooks hand irori.
 * Hermes Agent hands irori a tool call only once it ran, so PreToolUse cannot
 * hold one there; Pi, Hermes Agent and the Antigravity CLI ask no permission.
 */
export const hookEvents: Record<Exclude<AgentId, 'claude'>, readonly string[]> = {
  codex: [
    ...aroundRun,
    'PreToolUse',
    'PostToolUse',
    'PermissionRequest',
    'PreCompact',
    'PostCompact',
    'SubagentStart',
    'SubagentStop',
  ],
  opencode: [
    ...aroundRun,
    'PreToolUse',
    'PostToolUse',
    'PermissionRequest',
    'PreCompact',
    'PostCompact',
    'SubagentStart',
    'SubagentStop',
  ],
  pi: [
    ...aroundRun,
    'PreToolUse',
    'PostToolUse',
    'PostToolUseFailure',
    'PreCompact',
    'PostCompact',
  ],
  hermes: [...aroundRun, 'PostToolUse', 'PostToolUseFailure', 'PostCompact', 'SubagentStop'],
  antigravity: [...aroundRun, 'PreToolUse', 'PostToolUse'],
};

/**
 * Hook events that decide nothing in Claude Code: a CLI that cannot run them
 * says so and goes on. A missing hook of any other event could be a guard, and
 * the person decides whether to go on without it (ADR 058).
 */
export const informationalHookEvents = new Set([
  'SessionStart',
  'SessionEnd',
  'Notification',
  'PostToolUseFailure',
  'PostCompact',
  'SubagentStart',
  'InstructionsLoaded',
  'CwdChanged',
  'FileChanged',
  'DirectoryAdded',
  'MessageDisplay',
  'PostModelSwitch',
  'StopFailure',
  'Setup',
  'PermissionDenied',
  'ElicitationResult',
  'WorktreeRemove',
]);
