/**
 * A handed vault that lives on an SSH host (ADR 061): what the irori agent is
 * told of it, and what the forms of the `irori` command that reach it answer.
 *
 * Sent: with the handed vaults, on every request to the irori agent that hands
 * it a vault on an SSH host; the usage and the refusal as the command's error,
 * read by the agent in its shell.
 * Channel: the request text, and the command's standard error.
 */

/** How a vault on an SSH host is reached, said only when one is handed. */
export const handedRemoteVaults = [
  'A vault on an SSH host is not on this computer: no path here is inside it. Its agent runs on that host, so what it runs, runs there.',
  'Read such a vault with `irori ls <vault> [<folder>]`, `irori read <vault> <file>` and `irori search <vault> <words>`; paths are those inside the vault.',
  "`irori send <vault> <file> [--as <name>]` puts a file of your folder, or of a handed vault on this computer, into that vault's work folder and prints where it is. A task you hand over holds at most 30,000 characters: send longer material this way and name its path in the task.",
].join('\n');

/** How each form is written, when its arguments cannot be read. */
export const reachUsage = {
  ls: 'Name a vault on an SSH host, and a folder inside it if not its root: irori ls <vault> [<folder>].',
  read: 'Name a vault on an SSH host and one file inside it: irori read <vault> <file>.',
  search: 'Name a vault on an SSH host and what to look for: irori search <vault> <words>.',
  send: 'Name a vault on an SSH host and one file here: irori send <vault> <file> [--as <name>].',
};

/** The form named a handed vault that is on this computer. */
export const onThisDeviceAlready = (brain: { name: string; root: string }) =>
  `The ${brain.name} vault is on this computer, at ${JSON.stringify(brain.root)}: read it there. This form is for a vault on an SSH host.`;
