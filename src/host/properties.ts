import type { FileService } from './files';
import type { GitService } from '../git/service';
import { ifPresent, issueSummary, parseJsonText } from './local-json';
import {
  actorFromEmail,
  newPageText,
  propertyDeclaration,
  propertyDeclarationFile,
  propertyDeclarationLimit,
  type PageProperties,
} from '../domain/properties';
import { t } from '../domain/i18n';

/**
 * A knowledge base's `.property/property.json`: null when it has none, and a
 * problem to report when it cannot be read.
 */
export async function readPropertyDeclaration(
  files: FileService,
  scopeId: string,
): Promise<Omit<PageProperties, 'actor'>> {
  const doc = await ifPresent(files.read(scopeId, propertyDeclarationFile));
  if (!doc) return { declaration: null };
  const { text } = doc;
  if (Buffer.byteLength(text) > propertyDeclarationLimit)
    return {
      declaration: null,
      problem: t(
        `${propertyDeclarationFile} が大きすぎます（256 KiB まで）。`,
        `${propertyDeclarationFile} is too large (256 KiB at most).`,
      ),
    };
  try {
    return { declaration: propertyDeclaration.parse(parseJsonText(text)) };
  } catch (error) {
    const detail =
      error instanceof SyntaxError
        ? error.message
        : issueSummary(
            (error as { issues?: { path: PropertyKey[]; message: string }[] }).issues ?? [],
          );
    return {
      declaration: null,
      problem: t(
        `${propertyDeclarationFile} を読めません: ${detail}`,
        `${propertyDeclarationFile} cannot be read: ${detail}`,
      ),
    };
  }
}

/**
 * Reads a knowledge base's `.property/property.json` and the person's actor
 * for it. A missing declaration is not a problem: the view then shows generic
 * rows. A broken one is reported so the person can fix it, and the view falls
 * back the same way rather than refusing the page.
 */
export async function readPageProperties(
  files: FileService,
  git: Pick<GitService, 'userEmail'>,
  scopeId: string,
): Promise<PageProperties> {
  const actor = actorFromEmail(await git.userEmail(scopeId).catch(() => ''));
  return { ...(await readPropertyDeclaration(files, scopeId)), actor };
}

/**
 * A new page of a declared type (ADR 015 D6): its frontmatter carries the type,
 * the title from the file name, the person as its last change, and the keys the
 * type requires. A type the knowledge base does not declare is refused: a page
 * may be made without a type, never with an invented one.
 */
export async function createTypedNote(
  files: FileService,
  git: Pick<GitService, 'userEmail'>,
  scopeId: string,
  name: string,
  directory: string,
  type: string,
) {
  const { declaration, actor } = await readPageProperties(files, git, scopeId);
  if (!declaration || !Object.prototype.hasOwnProperty.call(declaration.types, type))
    throw Error(
      t(
        `種類「${type}」は ${propertyDeclarationFile} に宣言されていません。`,
        `The type "${type}" is not declared in ${propertyDeclarationFile}.`,
      ),
    );
  return files.createNote(scopeId, name, directory, (title) =>
    newPageText(declaration, type, title, actor, new Date()),
  );
}
