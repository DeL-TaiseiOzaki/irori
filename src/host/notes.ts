import path from 'node:path';
import type { FileService } from './files';
import type { Document } from '../domain/types';
import { classify } from '../domain/scopes';
import {
  dailyNotePath,
  dateTokens,
  defaultNoteDirectory,
  expandTokens,
  notesDeclaration,
  notesDeclarationFile,
  type NotesDeclaration,
} from '../domain/notes';

async function insideKnowledge(files: FileService, scopeId: string, relative: string) {
  const space = files.get(scopeId);
  if (classify(space, relative) !== 'Knowledge_Base')
    throw Error('ノートの場所はこの KB のナレッジ層の中で宣言してください。');
}

async function ownFile(files: FileService, scopeId: string, relative: string) {
  const space = files.get(scopeId);
  if (classify(space, relative) === 'contents')
    throw Error('contents のファイルはテンプレートに使えません。');
  const actual = await files.resolve(scopeId, relative);
  if (path.relative(space.root, actual).split(path.sep).join('/') !== relative)
    throw Error('テンプレートに alias / シンボリックリンクは使えません。');
}

/**
 * Reads `.irori/notes.json`, the KB's own declaration of where notes go. A KB
 * without one keeps irori's defaults; a declaration that points outside the
 * knowledge layer is an error, not a fallback.
 */
export async function readNotesDeclaration(
  files: FileService,
  scopeId: string,
): Promise<NotesDeclaration | null> {
  let text: string;
  try {
    text = (await files.read(scopeId, notesDeclarationFile)).text;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const declaration = notesDeclaration.parse(JSON.parse(text.replace(/^﻿/, '')));
  if (declaration.newNoteDirectory)
    await insideKnowledge(files, scopeId, declaration.newNoteDirectory);
  if (declaration.daily) await insideKnowledge(files, scopeId, declaration.daily.path);
  return declaration;
}

/** The directory the new-note dialog offers for this KB. */
export async function noteDirectory(files: FileService, scopeId: string): Promise<string> {
  return (await readNotesDeclaration(files, scopeId))?.newNoteDirectory ?? defaultNoteDirectory;
}

/**
 * Opens today's note at the declared path, creating it from the declared
 * template on first use. An existing note is returned as it is: the template is
 * only ever read for a note that does not exist yet.
 */
export async function openDailyNote(
  files: FileService,
  scopeId: string,
  at = new Date(),
): Promise<Document> {
  const declaration = await readNotesDeclaration(files, scopeId);
  if (!declaration?.daily) throw Error('この KB はデイリーノートの場所を宣言していません。');
  const relative = dailyNotePath(declaration, at);
  try {
    return await files.read(scopeId, relative);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const tokens = dateTokens(at);
  let text = `# ${tokens.date}\n\n`;
  if (declaration.daily.template) {
    await ownFile(files, scopeId, declaration.daily.template);
    text = expandTokens((await files.read(scopeId, declaration.daily.template)).text, tokens);
  }
  return files.createNoteAt(scopeId, relative, text);
}
