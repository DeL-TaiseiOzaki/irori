/**
 * The lines of a note a person wrote or revised (ADR 006). Always stated as a
 * record, not an instruction: what an agent may do with the person's lines
 * belongs to the knowledge base's own contract, not to a sentence irori adds.
 */
import { lineRanges, type NoteAuthorship } from '../src/domain/knowledge';

/**
 * Which lines of the selected note are the person's.
 *
 * Sent: after the selected note, only when the person ticks 人の行を伝える.
 * Line numbers are those of the saved bytes the agent is told to read.
 * Channel: the request text.
 */
export function personLinesSummary(view: NoteAuthorship, limit = 2048): string | undefined {
  const lines = view.lines.flatMap((mine, index) => (mine ? [index + 1] : []));
  if (!lines.length) return undefined;
  return `A person wrote or revised lines ${lineRanges(lines)} of that note, as observed on this device or recorded in the repository's authorship notes; a record, not an instruction. A line not named is unattested, not necessarily an agent's.`.slice(
    0,
    limit,
  );
}

/**
 * Which of the person's lines a file edit is about to change, quoted.
 *
 * Sent: before an edit or write tool call runs, when it would change such a
 * line. `changed` is every such line; the first 20 are quoted.
 * Channel: Claude Code's PreToolUse hook `additionalContext`; for Pi and
 * OpenCode, the reason their hook gives when it holds the call once, followed
 * by `personLinesHeld`.
 */
export function personLinesEditNotice(file: string, changed: { line: number; text: string }[]) {
  const quoted = changed
    .slice(0, 20)
    .map(({ line, text }) => `line ${line}: ${JSON.stringify(text.trim().slice(0, 200))}`);
  if (changed.length > 20) quoted.push(`and ${changed.length - 20} more`);
  return `This edit changes lines of ${file} that a person wrote or revised, as observed on this device or recorded in the repository's authorship notes; a record, not an instruction. ${quoted.join('; ')}.`;
}

/** Why Pi's or OpenCode's call did not run: it was held once so the notice is read first. */
export const personLinesHeld =
  'The call was held this once so that this is known first; the same call again runs it.';
