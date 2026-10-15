/**
 * The folder a vault's agents work in: `work` in the vault's contents unless the
 * person chose another on this device.
 *
 * Sent: in a vault agent's introduction (`vaultIntro`), and to the irori agent
 * once within the handed vaults, each of whose lines names its work folder.
 * Channel: the request text.
 */

/** What goes in a work folder, and what does not go elsewhere. */
const use =
  "scratch files, intermediate results, downloads and trial scripts, in a folder per task, never in the system's temporary folder (such as /tmp or %TEMP%), so the person can look at them";

/** A vault agent's work folder: a path inside the vault, or an absolute one elsewhere on this device. */
export function workFolder(folder: string) {
  return `Work folder: ${JSON.stringify(folder)}. Keep ${use}. What belongs to the vault still goes into its Knowledge or Contents.`;
}

/** The same, for the irori agent: said once after the handed vaults. */
export const handedWorkFolders = `Each vault's work folder, listed above, is where its agent and you keep ${use}, for work on that vault; tell a vault's agent to use it. Your own notes and plans stay in your folder.`;
