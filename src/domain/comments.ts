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
