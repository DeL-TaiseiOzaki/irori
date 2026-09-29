/**
 * The note open beside the hibachi agent.
 *
 * Sent: before the person's words, when the instruction goes with the open
 * note (the person has not removed it from the composer).
 * Channel: the request text.
 */
export function selectedNote(path: string) {
  return `The user selected this note in the active KB: ${JSON.stringify(path)}. Read its current saved bytes before editing.`;
}
