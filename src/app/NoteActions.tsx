import { useState } from 'react';
import type { Document } from '../domain/types';
import { noteFilename } from '../domain/note-operations';
import type { LinkUpdate } from '../domain/note-links';
import { noteLabel } from '../domain/overview';
import { parentPath } from '../domain/paths';
import { Dialog } from './Dialog';
import { displayLocale, t } from '../domain/i18n';
import { useAction } from './useAction';
import { useResource } from './useResource';

const host = window.irori;

/** What the move did to links, for the status line. */
function linkNotice(update: LinkUpdate) {
  const selfJa = update.self ? `このノート内 ${update.self} 件` : '';
  const selfEn = update.self ? `${update.self} in this note` : '';
  const notesJa = update.notes ? `参照元 ${update.notes} 件のノートの ${update.links} 件` : '';
  const notesEn = update.notes ? `${update.links} across ${update.notes} referring notes` : '';
  const doneJa = [selfJa, notesJa].filter(Boolean).join('と');
  const doneEn = [selfEn, notesEn].filter(Boolean).join(' and ');
  return [
    doneJa
      ? t(`${doneJa}のリンクを更新しました。`, `Updated ${doneEn} links.`)
      : t('更新が必要なリンクはありませんでした。', 'No links needed updating.'),
    update.skipped.length
      ? t(
          `更新できなかったノート: ${update.skipped.join('、')}。`,
          ` Notes that could not be updated: ${update.skipped.join(', ')}.`,
        )
      : '',
    update.incomplete ? t(' 一部確認できていません。', ' Some notes could not be checked.') : '',
  ].join('');
}

export type NoteAction = 'move' | 'trash';

/** Whether a note can be renamed, moved or deleted here: a writable Markdown note of a KB. */
export function noteActionsApply(doc: Document) {
  return !doc.readOnly && !doc.cloud && /\.md$/i.test(doc.path);
}

/** Renames and moves a note, or moves it to the deleted notes; opened from the note's menu. */
export function NoteActionDialog({
  doc,
  action,
  onClose,
  beforeChange,
  onChanged,
  onBusyChange,
}: {
  doc: Document;
  action: NoteAction;
  onClose: () => void;
  beforeChange: () => Promise<Document | null>;
  onChanged: (doc: Document | null, notice?: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [name, setName] = useState(() => noteLabel(doc.path));
  const [directory, setDirectory] = useState(() => parentPath(doc.path));
  const { busy, error, run } = useAction();
  const [links, setLinks] = useState(true);
  const referring = useResource(
    () => host.referringLinks(doc.scopeId, doc.path),
    [doc.scopeId, doc.path],
    { enabled: action === 'move' },
  );
  const close = onClose;
  async function submit() {
    onBusyChange(true);
    await run(async () => {
      const saved = await beforeChange();
      if (!saved) throw Error(t('ノートを保存できませんでした。', 'Could not save the note.'));
      if (saved.scopeId !== doc.scopeId || saved.path !== doc.path)
        throw Error(t('選択中のノートが変わりました。', 'The selected note has changed.'));
      if (action === 'trash') {
        await host.trashNote(saved);
        onChanged(null);
      } else {
        const filename = noteFilename(name);
        const destination = directory ? `${directory}/${filename}` : filename;
        const moved = await host.moveNote(saved, destination, links);
        onChanged(
          moved,
          `${moved.notice ?? t('ノートの場所を変更しました。', 'Moved the note.')}${
            moved.links
              ? linkNotice(moved.links)
              : links
                ? ''
                : t('リンクは更新していません。', 'Links were not updated.')
          }`,
        );
      }
      close();
    });
    onBusyChange(false);
  }
  const dialogLabel =
    action === 'move' ? t('名前と場所', 'Name and location') : t('ノートを削除', 'Delete note');
  const linksHint = !links
    ? t('参照元リンクは更新しません。', 'Referring links stay as is.')
    : referring.error
      ? t(
          `参照元リンクを確認できません: ${referring.error}`,
          `Could not check referring links: ${referring.error}`,
        )
      : !referring.data
        ? t('参照元リンクを確認中…', 'Checking referring links…')
        : t(
            `${
              referring.data.notes
                ? `参照元 ${referring.data.notes} 件・リンク ${referring.data.links} 件を更新`
                : '参照するリンクなし'
            }${referring.data.incomplete ? '・一部未確認' : ''}`,
            `${
              referring.data.notes
                ? `${referring.data.links} links in ${referring.data.notes} notes`
                : 'No referring links'
            }${referring.data.incomplete ? ' · Some unchecked' : ''}`,
          );
  return (
    <Dialog label={dialogLabel} busy={busy} onClose={close}>
      <form
        className="modal"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2>{dialogLabel}</h2>
        <p>{doc.path}</p>
        {action === 'move' ? (
          <>
            <label>
              {t('名前', 'Name')}
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
                required
              />
            </label>
            <label>
              {t('移動先', 'Destination')}
              <input
                value={directory}
                onChange={(event) => setDirectory(event.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={links}
                disabled={busy}
                onChange={(event) => setLinks(event.target.checked)}
              />{' '}
              {t('リンクも更新する', 'Also update links')}
            </label>
            <p className="hint">{linksHint}</p>
          </>
        ) : (
          <p>{t('削除済みノートから復元できます。', 'You can restore it from Deleted notes.')}</p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="actions">
          <button type="button" disabled={busy} onClick={close}>
            {t('キャンセル', 'Cancel')}
          </button>
          <button className="primary" disabled={busy}>
            {action === 'move' ? t('変更する', 'Change') : t('削除済みに移す', 'Move to deleted')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function TrashNotes({
  scopeId,
  onRestored,
  onClose,
}: {
  scopeId: string;
  onRestored: (doc: Document, notice?: string) => void;
  onClose: () => void;
}) {
  const list = useResource(() => host.trashedNotes(scopeId), [scopeId]);
  // Restored notes leave the list without reading it again.
  const [restored, setRestored] = useState<string[]>([]);
  const notes = (list.data ?? []).filter((note) => !restored.includes(note.id));
  const { loading } = list;
  const action = useAction();
  const { busy, run } = action;
  const error = action.error || list.error;
  async function restore(id: string) {
    await run(async () => {
      const doc = await host.restoreNote(scopeId, id);
      setRestored((ids) => [...ids, id]);
      onRestored(doc, doc.notice);
    });
  }
  return (
    <Dialog label={t('削除済みノート', 'Deleted notes')} busy={busy} onClose={onClose}>
      <div className="modal">
        <h2>{t('削除済みノート', 'Deleted notes')}</h2>
        {error && <p role="alert">{error}</p>}
        {loading ? (
          <p role="status">{t('読み込み中…', 'Loading…')}</p>
        ) : notes.length === 0 ? (
          <p>{t('削除済みのノートはありません。', 'There are no deleted notes.')}</p>
        ) : (
          <ul>
            {notes.map((note) => (
              <li key={note.id}>
                <span>{note.path}</span>{' '}
                <time dateTime={note.deletedAt}>
                  {new Date(note.deletedAt).toLocaleString(displayLocale())}
                </time>{' '}
                <button
                  disabled={busy}
                  aria-label={t(`${note.path} を復元`, `Restore ${note.path}`)}
                  onClick={() => void restore(note.id)}
                >
                  {t('復元', 'Restore')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button disabled={busy} onClick={onClose}>
            {t('閉じる', 'Close')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
