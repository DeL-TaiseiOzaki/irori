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
  /** It loads the `AGENTS.md` of a folder below whenever it works with a file there. */
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

/** The events irori runs itself around every run of a CLI that does not run hooks. */
const aroundRun = ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd', 'Notification'];

/**
 * The hook events irori runs for each CLI that does not run hooks itself: those
 * around the run, and the tool events its plugin, extension or own hooks hand
 * irori. Hermes Agent hands irori a tool call only once it ran, so PreToolUse
 * cannot hold one there.
 */
export const hookEvents: Record<Exclude<AgentId, 'claude'>, readonly string[]> = {
  codex: [...aroundRun, 'PreToolUse', 'PostToolUse', 'PreCompact', 'SubagentStop'],
  opencode: [...aroundRun, 'PreToolUse', 'PostToolUse', 'PreCompact', 'SubagentStop'],
  pi: [...aroundRun, 'PreToolUse', 'PostToolUse', 'PreCompact'],
  hermes: [...aroundRun, 'PostToolUse', 'SubagentStop'],
  antigravity: [...aroundRun, 'PreToolUse', 'PostToolUse'],
};
