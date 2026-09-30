import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import writeFileAtomic from 'write-file-atomic';
import type { FileService } from './files';
import type { GitService } from '../git/service';
import { SerialQueue } from './serial-queue';
import { actorFromEmail } from '../domain/properties';
import {
  commentsFileLimit,
  commentsText,
  newComment,
  noteComments,
  type NewComment,
  type NoteComment,
  type NoteComments,
} from '../domain/comments';
import { t } from '../domain/i18n';

// Comment writes read, change and replace one file; one queue keeps two of them
// from losing each other's comment.
const queue = new SerialQueue();

const unreadable = (detail: string) =>
  Error(
    t(`コメントのファイルを読めません: ${detail}`, `The comments file cannot be read: ${detail}`),
  );

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * The comments file of a Markdown file in a hibachi, under its `.irori/comments/`.
 * Each folder on the way must be an ordinary folder, created when `create` is
 * set; an alias or symbolic link is refused, so a write never leaves the hibachi.
 */
async function location(
  files: FileService,
  scopeId: string,
  notePath: string,
  { create = false, present = true } = {},
) {
  const parts = notePath.split('/');
  if (!/\.md$/i.test(notePath) || parts.some((part) => !part || part === '.' || part === '..'))
    throw Error(
      t('コメントできるのは Markdown ファイルです。', 'Only Markdown files take comments.'),
    );
  // Confirms the file is in this hibachi and not another's, as any read would.
  if (present) await files.resolve(scopeId, notePath);
  const root = files.get(scopeId).root;
  let directory = root;
  for (const part of ['.irori', 'comments', ...parts.slice(0, -1)]) {
    directory = path.join(directory, part);
    let stat = await fs.lstat(directory).catch((error) => {
      if (!isMissing(error)) throw error;
    });
    // A folder not there yet holds no comments file.
    if (!stat && !create) return path.join(root, '.irori', 'comments', `${notePath}.json`);
    if (!stat) {
      await fs.mkdir(directory);
      stat = await fs.lstat(directory);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw Error(
        t(
          'コメントの保存先がフォルダではありません。',
          'The place comments are kept is not a folder.',
        ),
      );
  }
  return path.join(directory, `${parts.at(-1)}.json`);
}

/** The file's raw object and its comments; a missing file has none. */
async function readFile(filename: string): Promise<{ raw: NoteComments; exists: boolean }> {
  const stat = await fs.lstat(filename).catch((error) => {
    if (!isMissing(error)) throw error;
  });
  if (!stat) return { raw: { comments: [] }, exists: false };
  if (!stat.isFile() || stat.isSymbolicLink()) throw unreadable('not an ordinary file');
  if (stat.size > commentsFileLimit) throw unreadable('larger than 1 MiB');
  const text = (await fs.readFile(filename, 'utf8')).replace(/^﻿/, '');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw unreadable((error as Error).message);
  }
  const parsed = noteComments.safeParse(value);
  if (!parsed.success)
    throw unreadable(
      parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; '),
    );
  return { raw: parsed.data, exists: true };
}

/** The comments on a Markdown file of a hibachi, oldest first. */
export async function readNoteComments(
  files: FileService,
  scopeId: string,
  notePath: string,
): Promise<NoteComment[]> {
  return (await readFile(await location(files, scopeId, notePath))).raw.comments;
}

/** Adds the person's comment to the file's and returns them all. */
export async function addNoteComment(
  files: FileService,
  git: Pick<GitService, 'userEmail'>,
  scopeId: string,
  notePath: string,
  input: NewComment,
): Promise<NoteComment[]> {
  const value = newComment.parse(input);
  const by = actorFromEmail(await git.userEmail(scopeId).catch(() => ''));
  return queue.run(async () => {
    const filename = await location(files, scopeId, notePath, { create: true });
    const { raw } = await readFile(filename);
    const { note: _note, comments, ...rest } = raw;
    const comment: NoteComment = {
      id: randomBytes(6).toString('hex'),
      body: value.body.trim(),
      ...(value.quote?.trim() ? { quote: value.quote } : {}),
      ...(value.quote?.trim() && value.line ? { line: value.line } : {}),
      ...(by ? { by } : {}),
      at: new Date().toISOString(),
    };
    const next = [...comments, comment];
    if (next.length > 1000)
      throw Error(
        t('コメントは 1 ファイル 1000 件までです。', 'A file takes at most 1,000 comments.'),
      );
    await writeFileAtomic(filename, commentsText(notePath, next, rest));
    return next;
  });
}

/**
 * Removes one comment. The last one gone removes the file and the folders it
 * leaves empty, so a hibachi without comments carries nothing for them.
 */
export async function removeNoteComment(
  files: FileService,
  scopeId: string,
  notePath: string,
  id: string,
): Promise<NoteComment[]> {
  return queue.run(async () => {
    const filename = await location(files, scopeId, notePath);
    const { raw, exists } = await readFile(filename);
    if (!exists) return [];
    const { note: _note, comments, ...rest } = raw;
    const next = comments.filter((comment) => comment.id !== id);
    if (next.length === comments.length) return comments;
    if (next.length || Object.keys(rest).length)
      await writeFileAtomic(filename, commentsText(notePath, next, rest));
    else {
      await fs.rm(filename);
      await pruneFolders(files.get(scopeId).root, path.dirname(filename));
    }
    return next;
  });
}

/** Removes empty folders from `directory` up to, not including, `.irori/comments`. */
async function pruneFolders(root: string, directory: string) {
  const top = path.join(root, '.irori', 'comments');
  while (directory !== top && directory.startsWith(top + path.sep)) {
    try {
      await fs.rmdir(directory);
    } catch {
      return;
    }
    directory = path.dirname(directory);
  }
}

/**
 * Carries a moved note's comments to its new path. A note without comments has
 * nothing to carry; a comments file already at the destination is left alone.
 */
export async function moveNoteComments(
  files: FileService,
  scopeId: string,
  from: string,
  to: string,
) {
  return queue.run(async () => {
    const source = await location(files, scopeId, from, { present: false });
    const { raw, exists } = await readFile(source);
    if (!exists) return;
    const destination = await location(files, scopeId, to, { create: true });
    const { note: _note, comments, ...rest } = raw;
    const created = await fs.open(destination, 'wx');
    try {
      await created.writeFile(commentsText(to, comments, rest));
    } finally {
      await created.close();
    }
    await fs.rm(source);
    await pruneFolders(files.get(scopeId).root, path.dirname(source));
  });
}

/**
 * How many comments a hibachi holds and on how many files, for the words before
 * an agent's instruction. Files that cannot be read are not counted; the walk
 * stops after `limit` files.
 */
export async function commentsCount(files: FileService, scopeId: string, limit = 2000) {
  const top = path.join(files.get(scopeId).root, '.irori', 'comments');
  let comments = 0;
  let commented = 0;
  let seen = 0;
  async function walk(directory: string) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (seen >= limit) return;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filename);
      else if (entry.isFile() && /\.md\.json$/i.test(entry.name)) {
        seen++;
        const count = await readFile(filename).then(
          ({ raw }) => raw.comments.length,
          () => 0,
        );
        if (count) {
          comments += count;
          commented++;
        }
      }
    }
  }
  const stat = await fs.lstat(top).catch(() => undefined);
  if (stat?.isDirectory() && !stat.isSymbolicLink()) await walk(top);
  return { comments, files: commented };
}
