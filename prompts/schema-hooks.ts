/**
 * What an agent hears of the Schema's hooks when irori runs them for its CLI
 * (ADR 058): Claude Code runs its own and hears them itself; for every other CLI
 * irori runs the hooks of the shared Schema and of the folder's own, and gives
 * the agent what Claude Code would.
 *
 * Sent: as the hooks decide.
 * Channel: a PreToolUse denial is the reason the CLI's plugin, extension or hook
 * gives for the call it stops; PostToolUse feedback goes with the tool's result
 * where the CLI lets irori add to it; SessionStart and UserPromptSubmit context
 * goes in the request text after the person's words; a Stop hook that keeps the
 * turn going sends the next request in the same session.
 */

/** Why a call did not run when irori could not be asked about it: a hook may be a guard. */
export const hookUnreachable =
  'irori could not run the Schema hooks for this call, so the call did not run.';

/** Said with a call's result when irori could not run its PostToolUse hooks. */
export const hookUnreachableAfter =
  'irori could not run the Schema PostToolUse hooks for this call.';

/** Why a call did not run when irori could not read what the CLI's hook sent. */
export const hookUnreadable = 'irori could not read this hook event, so the call did not run.';

/** Why a tool call did not run, as the agent reads it. */
export function hookDenied(reason: string) {
  return `A PreToolUse hook of the Schema blocked this call: ${reason}`;
}

/** What PostToolUse hooks said about a call that ran, as the agent reads it with the result. */
export function hookToolFeedback(
  event: 'PostToolUse' | 'PostToolUseFailure' | 'SubagentStop' | 'Stop',
  words: string[],
) {
  return `${event} hook feedback from the Schema:\n${words.join('\n')}`;
}

/** Context the SessionStart or UserPromptSubmit hooks gave, after the person's words. */
export function hookContext(event: 'SessionStart' | 'UserPromptSubmit', words: string[]) {
  return `irori: context from the Schema's ${event} hooks:\n<hook-context>\n${words.join('\n\n')}\n</hook-context>`;
}

/** The request that goes on after a Stop hook did not let the turn end. */
export function stopHookContinue(reason: string) {
  return `irori: a Stop hook of the Schema did not let your turn end yet. Continue the work as it asks:\n<stop-hook>\n${reason}\n</stop-hook>`;
}
