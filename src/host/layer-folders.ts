import type { CloudService } from '../cloud/service';
import type { KnowledgeStore } from '../knowledge/store';
import type { AuthorshipStore } from '../knowledge/authorship';
import type { LayerFolderRename } from '../domain/types';
import { layerFolder, movedPath, type LayerMove, type NamedLayer } from '../domain/layers';
import { t } from '../domain/i18n';
import type { FileService } from './files';
import { moveFolderComments } from './comments';
import { renameInNotesDeclaration } from './notes';
import { relinkFolder } from './relink';

/**
 * Renames a vault's knowledge or contents folder and carries over what names
 * its paths (ADR 024): the connected folders are linked again under the new
 * name, then the device's material IDs and person-line records, the notes
 * declaration, the comments and every link that led into the folder follow.
 * Making the vault's root the knowledge folder, or a named folder again,
 * carries the same records for the entries that moved (ADR 035).
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
  const { space, previous, files: moved, entries } = renamed;
  const next = layerFolder(space, layer);
  const result: LayerFolderRename = {
    space,
    previous,
    ...(entries && { entries }),
    links: 0,
    notes: 0,
    skipped: [],
  };
  if (next === previous) return result;
  const move: LayerMove = { from: previous, to: next, entries };
  // A knowledge folder taken as it is from the root moved nothing.
  if (!previous && !entries?.length) return result;
  const carried = await carryMove({ files, knowledge, authorship }, scopeId, move, moved, layer);
  notices.push(...carried.notices);
  Object.assign(result, carried.links);
  if (notices.length) result.notice = notices.join(' ');
  return result;
}

/**
 * After files moved inside a vault — a layer folder, or a file or folder the
 * explorer moved within knowledge — carries what names their paths: the device's
 * material IDs and person-line records, the notes declaration, the comments and
 * every link that led to them. `files` are their paths before the move. What
 * could not be carried is reported, not undone.
 */
export async function carryMove(
  services: {
    files: FileService;
    knowledge?: Pick<KnowledgeStore, 'renameFolder'>;
    authorship?: Pick<AuthorshipStore, 'renameFiles' | 'carry'>;
  },
  scopeId: string,
  move: LayerMove,
  files: string[],
  /** The layer whose folder was renamed; absent for an entry moved within knowledge. */
  layer?: NamedLayer,
) {
  const { knowledge, authorship } = services;
  const notices: string[] = [];
  const note = (ok: boolean, ja: string, en: string) => {
    if (!ok) notices.push(t(ja, en));
  };
  const succeeds = (work: Promise<unknown> | undefined) =>
    Promise.resolve(work).then(
      () => true,
      () => false,
    );
  note(
    await succeeds(knowledge?.renameFolder(scopeId, move)),
    '資料 ID を新しい場所に再接続できませんでした。',
    'Material IDs could not be reconnected at the new location.',
  );
  const pages = files.filter((file) => /\.md$/i.test(file));
  if (pages.length)
    note(
      await succeeds(
        authorship?.renameFiles(
          scopeId,
          pages.map((file) => [file, movedPath(move, file)!]),
        ),
      ),
      '人の行の記録を引き継げませんでした。',
      'The record of human-written lines could not be carried over.',
    );
  if (layer !== 'contents')
    note(
      await succeeds(renameInNotesDeclaration(services.files, scopeId, move)),
      '.irori/notes.json のノートの場所を更新できませんでした。',
      'The note locations in .irori/notes.json could not be updated.',
    );
  const kept = await moveFolderComments(services.files, scopeId, move).catch(() => [move.from]);
  note(
    !kept.length,
    `${kept.length} 件のファイルのコメントを移せませんでした。`,
    `Comments on ${kept.length} files could not be moved.`,
  );
  const links = await relinkFolder(
    services.files,
    scopeId,
    move,
    async (before, after) => {
      // A link rewrite keeps every line's author.
      await authorship?.carry(before, after, before.text, after.text).catch(() => {});
    },
    !!layer,
  ).catch(() => undefined);
  if (!links) notices.push(t('リンクを更新できませんでした。', 'Links could not be updated.'));
  return { notices, links: links ?? { notes: 0, links: 0, skipped: [] as string[] } };
}
