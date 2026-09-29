/**
 * Why a tool call was refused, as the agent reads it. Each says what to do
 * instead, so the agent can go on.
 *
 * Sent: when irori refuses a call during a run.
 * Channel: Claude Code's PreToolUse hook `permissionDecisionReason`, or the
 * SDK's permission answer.
 */

/** A hibachi's sub-agent tried to write outside its hibachi. */
export const outsideHibachi = (brain: { name: string; root: string }) =>
  `The ${brain.name} hibachi's agent works only inside that hibachi (${brain.root}). Report what else is needed instead.`;

/** The irori agent, or another of its agents, tried to write in a handed hibachi itself. */
export const handToSubAgent = (brain: { name: string; agent: string }) =>
  `Hand work in the ${brain.name} hibachi to its sub-agent "${brain.agent}", which reads that hibachi's Schema first.`;

/** The irori agent tried to write outside its folder and every handed hibachi. */
export const outsideIroriAgent =
  'The irori agent writes only in its own folder or, through their sub-agents, in the hibachis handed to it.';

/** The person declined a permission request. */
export const permissionDenied = 'The user denied this operation.';

/** The person declined to answer the agent's question. */
export const questionDeclined = 'User declined to answer.';
