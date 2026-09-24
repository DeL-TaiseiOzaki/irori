import { z } from 'zod';
import { kbPath } from './ontology';
import { t } from './i18n';

/** Where a KB asks irori to put notes: `.irori/notes.json`, tracked with the KB. */
export const notesDeclarationFile = '.irori/notes.json';
export const defaultNoteDirectory = 'Knowledge_Base/Notes';

const tokenPattern = /\{\{(yyyy|MM|dd|date|datetime)\}\}/g;
const notePath = kbPath.refine((value) => /\.md$/i.test(value), 'A Markdown note is required');

export const notesDeclaration = z.object({
  schemaVersion: z.literal(1),
  /** Directory offered by the new-note dialog instead of `Knowledge_Base/Notes`. */
  newNoteDirectory: kbPath.optional(),
  /** Today's note: a path with date tokens, filled from an optional template note. */
  daily: z
    .object({
      path: notePath.refine(
        (value) => /\{\{(yyyy|MM|dd|date)\}\}/.test(value),
        'The daily path needs a date token such as {{date}} or {{yyyy}}/{{MM}}/{{dd}}',
      ),
      template: notePath.optional(),
    })
    .optional(),
});
export type NotesDeclaration = z.infer<typeof notesDeclaration>;

const two = (value: number) => String(value).padStart(2, '0');

/** Local-time tokens for a moment; `datetime` carries the local UTC offset. */
export function dateTokens(at: Date): Record<string, string> {
  const yyyy = String(at.getFullYear()),
    MM = two(at.getMonth() + 1),
    dd = two(at.getDate());
  const offset = -at.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const zone = `${sign}${two(Math.floor(Math.abs(offset) / 60))}:${two(Math.abs(offset) % 60)}`;
  return {
    yyyy,
    MM,
    dd,
    date: `${yyyy}-${MM}-${dd}`,
    datetime: `${yyyy}-${MM}-${dd}T${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}${zone}`,
  };
}

/** Replaces the known `{{token}}` forms; anything else is left as written. */
export function expandTokens(text: string, tokens: Record<string, string>): string {
  return text.replace(tokenPattern, (whole, name: string) => tokens[name] ?? whole);
}

export function dailyNotePath(declaration: NotesDeclaration, at: Date): string {
  if (!declaration.daily)
    throw Error(
      t(
        'この KB はデイリーノートの場所を宣言していません。',
        'This KB does not declare where daily notes go.',
      ),
    );
  return expandTokens(declaration.daily.path, dateTokens(at));
}
