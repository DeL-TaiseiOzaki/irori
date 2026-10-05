import type { CloudService } from '../cloud/service';
import type { KnowledgeStore } from '../knowledge/store';
import type { AuthorshipStore } from '../knowledge/authorship';
import type { LayerFolderRename } from '../domain/types';
import { layerFolder, renamedPath, type NamedLayer } from '../domain/layers';
import { t } from '../domain/i18n';
import type { FileService } from './files';
import { moveFolderComments } from './comments';
import { renameInNotesDeclaration } from './notes';
import { relinkFolder } from './relink';

/**
 * Renames a hibachi's knowledge or contents folder and carries over what names
 * its paths (ADR 024): the connected folders are linked again under the new
 * name, then the device's material IDs and person-line records, the notes
 * declaration, the comments and every link that led into the folder follow.
 * The folder and its declaration change together or not at all; what could not
 * be carried after that is reported, not undone.
 */
export async function renameLayerFolder(
  services: {
    files: FileService;
    cloud?: Pick<CloudService, 'suspend' | 'resume'>;
    knowledge?: Pick<KnowledgeStore, 'renameFolder'>;
    authorship?: Pick<AuthorshipStore, 'renameFiles' | 'carry'>;
  },
  scopeId: string,
  layer: NamedLayer,
  name: string,
): Promise<LayerFolderRename> {
  const { files, cloud, knowledge, authorship } = services;
  const notices: string[] = [];
  const note = (ok: boolean, ja: string, en: string) => {
    if (!ok) notices.push(t(ja, en));
  };
  const succeeds = (work: Promise<unknown> | undefined) =>
    Promise.resolve(work).then(
      () => true,
      () => false,
    );
  const suspended = layer === 'contents' && cloud ? await cloud.suspend(scopeId) : [];
  let renamed: Awaited<ReturnType<FileService['renameLayerFolder']>>;
  try {
    renamed = await files.renameLayerFolder(scopeId, layer, name);
  } finally {
    // Linked again under whichever name the folder has now.
    if (suspended.length && (await cloud!.resume(scopeId, suspended)).length)
      notices.push(
        t(
          '接続していたフォルダの一部を再接続できませんでした。',
          'Some connected folders could not be connected again.',
        ),
      );
  }
  const { space, previous, files: moved } = renamed;
  const next = layerFolder(space, layer);
  const result: LayerFolderRename = { space, previous, links: 0, notes: 0, skipped: [] };
  if (next === previous) return result;
  note(
    await succeeds(knowledge?.renameFolder(scopeId, previous, next)),
    '資料 ID を新しい場所に再接続できませんでした。',
    'Material IDs could not be reconnected at the new location.',
  );
  const pages = moved.filter((file) => /\.md$/i.test(file));
  if (pages.length)
    note(
      await succeeds(
        authorship?.renameFiles(
          scopeId,
          pages.map((file) => [file, renamedPath(file, previous, next)!]),
        ),
      ),
      '人の行の記録を引き継げませんでした。',
      'The record of human-written lines could not be carried over.',
    );
  if (layer === 'Knowledge_Base')
    note(
      await succeeds(renameInNotesDeclaration(files, scopeId, previous, next)),
      '.irori/notes.json のノートの場所を更新できませんでした。',
      'The note locations in .irori/notes.json could not be updated.',
    );
  const kept = await moveFolderComments(files, scopeId, previous, next).catch(() => [previous]);
  note(
    !kept.length,
    `${kept.length} 件のファイルのコメントを移せませんでした。`,
    `Comments on ${kept.length} files could not be moved.`,
  );
  const links = await relinkFolder(files, scopeId, previous, next, async (before, after) => {
    // A link rewrite keeps every line's author.
    await authorship?.carry(before, after, before.text, after.text).catch(() => {});
  }).catch(() => undefined);
  if (links) Object.assign(result, links);
  else notices.push(t('リンクを更新できませんでした。', 'Links could not be updated.'));
  if (notices.length) result.notice = notices.join(' ');
  return result;
}
