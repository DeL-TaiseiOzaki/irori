import { z } from 'zod';

/**
 * Comments on a Markdown file are kept in the hibachi beside its other irori
 * files, one JSON file per commented file named after its path, so they travel
 * with the hibachi through Git and any agent working in it can read them.
 */
export const commentsDirectory = '.irori/comments';
export const commentsFile = (notePath: string) => `${commentsDirectory}/${notePath}.json`;

export const commentBodyLimit = 4000;
export const commentQuoteLimit = 2000;
/** The largest comments file irori reads or writes. */
export const commentsFileLimit = 1024 * 1024;

/**
 * One comment. `quote` is the passage it is about, as the person selected it;
 * without one the comment is about the whole file. `line` is where the passage
 * began when the comment was written, a hint that later edits may move.
 * Fields irori does not know — an agent's reply, a later version's — are kept.
 */
export const noteComment = z.looseObject({
  id: z.string().min(1).max(64),
  body: z.string().min(1).max(commentBodyLimit),
  quote: z.string().max(commentQuoteLimit).optional(),
  line: z.number().int().positive().optional(),
  by: z.string().max(200).optional(),
  at: z.string().max(40),
});
export type NoteComment = z.infer<typeof noteComment>;

export const noteComments = z.looseObject({
  note: z.string().max(4096).optional(),
  comments: z.array(noteComment).max(1000),
});
export type NoteComments = z.infer<typeof noteComments>;

export const newComment = z.object({
  body: z
    .string()
    .max(commentBodyLimit)
    .refine((value) => value.trim().length > 0),
  quote: z.string().max(commentQuoteLimit).optional(),
  line: z.number().int().positive().optional(),
});
export type NewComment = z.infer<typeof newComment>;

/** A comments file's text, as irori writes it: the note's path, then its comments. */
export function commentsText(note: string, comments: NoteComment[], rest: object = {}) {
  return JSON.stringify({ ...rest, note, comments }, null, 2) + '\n';
}

const clip = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * The comments on the note an agent was given, for the words before its
 * instruction. They are the person's notes on the text: the agent acts on them
 * when the instruction asks it to, and finds all of them in the file named.
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

/** One line for a hibachi agent without a commented note in hand: where comments are. */
export function commentsPointer(count: number, files: number) {
  return `This hibachi has ${count} comment${count === 1 ? '' : 's'} from people on ${files} file${files === 1 ? '' : 's'}, kept in ${commentsDirectory}/<file path>.json. Read them when the instruction concerns comments.`;
}
