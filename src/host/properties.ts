import type { FileService } from './files';
import type { GitService } from '../git/service';
import {
  actorFromEmail,
  propertyDeclaration,
  propertyDeclarationFile,
  propertyDeclarationLimit,
  type PageProperties,
} from '../domain/properties';
import { t } from '../domain/i18n';

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
  let text: string;
  try {
    text = (await files.read(scopeId, propertyDeclarationFile)).text;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { declaration: null, actor };
    throw error;
  }
  if (Buffer.byteLength(text) > propertyDeclarationLimit)
    return {
      declaration: null,
      actor,
      problem: t(
        `${propertyDeclarationFile} が大きすぎます（256 KiB まで）。`,
        `${propertyDeclarationFile} is too large (256 KiB at most).`,
      ),
    };
  try {
    return {
      declaration: propertyDeclaration.parse(JSON.parse(text.replace(/^﻿/, ''))),
      actor,
    };
  } catch (error) {
    const detail =
      error instanceof SyntaxError
        ? error.message
        : ((error as { issues?: { path: PropertyKey[]; message: string }[] }).issues ?? [])
            .slice(0, 3)
            .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('; ');
    return {
      declaration: null,
      actor,
      problem: t(
        `${propertyDeclarationFile} を読めません: ${detail}`,
        `${propertyDeclarationFile} cannot be read: ${detail}`,
      ),
    };
  }
}
