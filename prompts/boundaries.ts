/**
 * Why a tool call was refused, as the agent reads it. Each says what to do
 * instead, so the agent can go on.
 *
 * Sent: when irori refuses a call during a run.
 * Channel: Claude Code's PreToolUse hook `permissionDecisionReason`, or the
 * SDK's permission answer.
 */

/** The irori agent, or one of its own sub-agents, tried to write in a handed vault itself. */
export const handToVaultAgent = (brain: { name: string; agent: string }) =>
  `Hand work in the ${brain.name} vault to its agent with \`irori call ${brain.agent} "<task>"\`: it works inside that vault, with that vault's Schema.`;

/** The irori agent tried to write outside its folder and every handed vault. */
export const outsideIroriAgent =
  "The irori agent writes only in its own folder. Work in a vault goes to that vault's agent with `irori call`.";

/** The person declined a permission request. */
export const permissionDenied = 'The user denied this operation.';

/** The person declined to answer the agent's question. */
export const questionDeclined = 'User declined to answer.';
