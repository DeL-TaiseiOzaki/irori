import { useEffect, useState } from 'react';
import type { Document } from '../domain/types';
import { noteFilename, type TrashedNote } from '../domain/note-operations';
import type { LinkUpdate } from '../domain/note-links';
import { Dialog } from './Dialog';
import { displayLocale, t } from '../domain/i18n';

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
    update.incomplete
      ? t(
          '上限または読めないファイルにより、すべての参照元を確認できていません。',
          ' A limit or unreadable files meant not every referring note could be checked.',
        )
      : '',
  ].join('');
}

export type NoteAction = 'move' | 'trash';

/** Whether a note can be renamed, moved or deleted here: a writable Markdown note of a KB. */
export function noteActionsApply(doc: Document) {
  return !doc.readOnly && !doc.workspaceId && /\.md$/i.test(doc.path);
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
        if (current) setReferring({ error: String(error) });
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
      if (!saved)
        throw Error(
          t('ノートを保存してからもう一度操作してください。', 'Save the note before trying again.'),
        );
      if (saved.scopeId !== doc.scopeId || saved.path !== doc.path)
        throw Error(
          t(
            '選択中のノートが変わりました。開き直してください。',
            'The selected note has changed. Open it again.',
          ),
        );
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
      setError(String(error));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  const dialogLabel =
    action === 'move'
      ? t('ノートの名前と場所', 'Note name and location')
      : t('ノートを削除', 'Delete note');
  const linksHint = !links
    ? t(
        '参照元のリンクは更新しません。相対リンクを含むノートは同じフォルダで名前を変更してください。',
        'Referring links will not be updated. If this note contains relative links, rename it within the same folder.',
      )
    : !referring
      ? t('参照元のリンクを調べています…', 'Checking referring links…')
      : 'error' in referring
        ? t(
            `参照元のリンクを確認できませんでした: ${referring.error}`,
            `Could not check referring links: ${referring.error}`,
          )
        : t(
            `${
              referring.notes
                ? `参照元 ${referring.notes} 件のノートにある ${referring.links} 件のリンクと、`
                : 'このノートを参照するリンクはありません。'
            }このノート内の相対リンクを移動先に合わせて更新します。${
              referring.incomplete
                ? '上限または読めないファイルにより、すべての参照元を確認できていません。'
                : ''
            }`,
            `${
              referring.notes
                ? `The ${referring.links} links in ${referring.notes} referring notes and this note's relative links`
                : "No links refer to this note. This note's relative links"
            } will be updated to match the destination.${
              referring.incomplete
                ? ' A limit or unreadable files meant not every referring note could be checked.'
                : ''
            }`,
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
              {t('ノート名', 'Note name')}
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
                required
              />
            </label>
            <label>
              {t('移動先フォルダ', 'Destination folder')}
              <input
                value={directory}
                onChange={(event) => setDirectory(event.target.value)}
                disabled={busy}
              />
            </label>
            <p className="hint">
              {t(
                '同じスペース内の既存フォルダを指定します。空欄はスペース直下です。',
                'Specify an existing folder within the same space. Leave it blank for the top of the space.',
              )}
            </p>
            <label>
              <input
                type="checkbox"
                checked={links}
                disabled={busy}
                onChange={(event) => setLinks(event.target.checked)}
              />{' '}
              {t('リンクも更新する', 'Also update links')}
            </label>
            <p className="hint">
              {linksHint}{' '}
              {t(
                '本文のリンクと frontmatter の関係・出典が対象です。irori で貼り付けた画像は移動先にも保持します。',
                'This covers links in the body and the relationship/source in frontmatter. Images pasted in irori are kept at the destination too.',
              )}
            </p>
          </>
        ) : (
          <p>
            {t(
              'この端末の「削除済みノート」から復元できます。画像ファイルは残ります。このノートへのリンクは更新しません。',
              'You can restore this from "Deleted notes" on this device. Image files are kept. Links to this note are not updated.',
            )}
          </p>
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
        if (current) setError(String(error));
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
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog label={t('削除済みノート', 'Deleted notes')} busy={busy} onClose={onClose}>
      <div className="modal">
        <h2>{t('削除済みノート', 'Deleted notes')}</h2>
        <p>
          {t(
            'この端末で削除したノートを元の場所に戻します。同じ場所にファイルがある場合は復元できません。',
            'Restores notes deleted on this device to their original location. It cannot restore one if a file already exists there.',
          )}
        </p>
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
