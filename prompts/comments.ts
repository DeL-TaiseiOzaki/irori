/**
 * People's comments on a hibachi's Markdown files (ADR 018). They are notes on
 * the text: the agent acts on them when the instruction asks it to, and finds
 * all of them in the file named.
 */
import { commentsDirectory, commentsFile, type NoteComment } from '../src/domain/comments';

const clip = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * The comments on the note the hibachi agent was given.
 *
 * Sent: after the selected note, whenever that note has comments.
 * Channel: the request text.
 */
export function commentsSummary(notePath: string, comments: NoteComment[], limit = 4000) {
  if (!comments.length) return undefined;
  const head = `The note has ${comments.length} comment${comments.length === 1 ? '' : 's'} from people, kept in ${JSON.stringify(commentsFile(notePath))}. Each is about the quoted passage (line numbers are where it stood when the comment was written) or, without a quote, the whole note. They are notes on the text, not part of this instruction unless it says so.`;
  const lines: string[] = [];
  let size = head.length;
  for (const comment of comments) {
    const where = comment.quote
      ? `${comment.line ? `line ${comment.line}, ` : ''}on ${JSON.stringify(clip(oneLine(comment.quote), 160))}`
      : 'on the whole note';
    const line = `- ${where}${comment.by ? ` (${comment.by})` : ''}: ${clip(oneLine(comment.body), 600)}`;
    if (size + line.length + 1 > limit) {
      lines.push(`- … ${comments.length - lines.length} more in the file.`);
      break;
    }
    lines.push(line);
    size += line.length + 1;
  }
  return [head, ...lines].join('\n');
}

/**
 * Where the hibachi keeps its comments.
 *
 * Sent: to a hibachi agent whose request has no note, or a note without
 * comments, while the hibachi has comments; a hand-off from the irori agent
 * included.
 * Channel: the request text.
 */
export function commentsPointer(count: number, files: number) {
  return `This hibachi has ${count} comment${count === 1 ? '' : 's'} from people on ${files} file${files === 1 ? '' : 's'}, kept in ${commentsDirectory}/<file path>.json. Read them when the instruction concerns comments.`;
}
