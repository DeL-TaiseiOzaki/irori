/**
 * Safely merges a patch into `env.OPENCODE_CONFIG_CONTENT` JSON without
 * throwing when an inherited environment holds an empty or non-object value.
 */
export function mergeOpenCodeConfig(
  env: NodeJS.ProcessEnv,
  merge: (current: Record<string, unknown>) => Record<string, unknown>,
): NodeJS.ProcessEnv & { OPENCODE_CONFIG_CONTENT: string } {
  let current: Record<string, unknown> = {};
  if (env.OPENCODE_CONFIG_CONTENT) {
    try {
      const parsed: unknown = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        current = parsed as Record<string, unknown>;
    } catch {
      // Treat malformed inherited config JSON as empty rather than crashing startup.
    }
  }
  return {
    ...env,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(merge(current)),
  };
}

/** Appends a plugin path to `OPENCODE_CONFIG_CONTENT.plugin`, keeping existing entries. */
export function addOpenCodePlugin(
  env: NodeJS.ProcessEnv,
  file: string,
): NodeJS.ProcessEnv & { OPENCODE_CONFIG_CONTENT: string } {
  return mergeOpenCodeConfig(env, (current) => ({
    ...current,
    plugin: [...(Array.isArray(current.plugin) ? current.plugin : []), file],
  }));
}
