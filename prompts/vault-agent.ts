/**
 * The task the irori agent hands a vault agent.
 */

/**
 * A task the irori agent hands a vault agent with `irori call`, on every CLI
 * (ADR 050), with the vault's own definition of its agent when it has one
 * (`.claude/agents/vault-agent.md`, `.codex/agents/vault-agent.toml` or
 * `.opencode/agents/vault-agent.md`).
 *
 * Sent: as the request of the vault agent's run in that vault, after what
 * every vault agent request starts with.
 * Channel: the request text; the run's words go back as the command's output.
 */
export function handedTask(task: string, definition?: { file: string; instructions: string }) {
  return [
    'irori: the irori agent handed you this task. Finish with a short report: what you did, and every file you created or changed, as paths inside this vault.',
    ...(definition
      ? [
          `This vault defines its agent for such tasks in ${definition.file}. Follow it:\n<vault-agent-definition>\n${definition.instructions}\n</vault-agent-definition>`,
        ]
      : []),
    task,
  ].join('\n\n');
}
