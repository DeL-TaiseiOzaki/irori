import { useEffect, useState } from 'react';
import type { Document } from '../domain/types';
import { noteFilename, type TrashedNote } from '../domain/note-operations';
import type { LinkUpdate } from '../domain/note-links';
import { Dialog } from './Dialog';
import { displayLocale, t } from '../domain/i18n';
import { errorText } from './ErrorMessage';

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
  const [name, setName] = useState(() => doc.path.split('/').at(-1)!.replace(/\.md$/i, ''));
  const [directory, setDirectory] = useState(() => doc.path.split('/').slice(0, -1).join('/'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [links, setLinks] = useState(true);
  const [referring, setReferring] = useState<
    Pick<LinkUpdate, 'notes' | 'links' | 'incomplete'> | { error: string }
  >();
  useEffect(() => {
    if (action !== 'move') return;
    let current = true;
    setReferring(undefined);
    host.referringLinks(doc.scopeId, doc.path).then(
      (value) => {
        if (current) setReferring(value);
      },
      (error) => {
        if (current) setReferring({ error: errorText(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [action, doc.scopeId, doc.path]);
  const close = onClose;
  async function submit() {
    onBusyChange(true);
    setBusy(true);
    setError('');
    try {
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
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  const dialogLabel =
    action === 'move' ? t('名前と場所', 'Name and location') : t('ノートを削除', 'Delete note');
  const linksHint = !links
    ? t('参照元リンクは更新しません。', 'Referring links stay as is.')
    : !referring
      ? t('参照元リンクを確認中…', 'Checking referring links…')
      : 'error' in referring
        ? t(
            `参照元リンクを確認できません: ${referring.error}`,
            `Could not check referring links: ${referring.error}`,
          )
        : t(
            `${
              referring.notes
                ? `参照元 ${referring.notes} 件・リンク ${referring.links} 件を更新`
                : '参照するリンクなし'
            }${referring.incomplete ? '・一部未確認' : ''}`,
            `${
              referring.notes
                ? `${referring.links} links in ${referring.notes} notes`
                : 'No referring links'
            }${referring.incomplete ? ' · Some unchecked' : ''}`,
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
  const [notes, setNotes] = useState<TrashedNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    void host
      .trashedNotes(scopeId)
      .then((notes) => {
        if (current) setNotes(notes);
      })
      .catch((error) => {
        if (current) setError(errorText(error));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [scopeId]);
  async function restore(id: string) {
    setBusy(true);
    setError('');
    try {
      const doc = await host.restoreNote(scopeId, id);
      setNotes((notes) => notes.filter((note) => note.id !== id));
      onRestored(doc, doc.notice);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
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
