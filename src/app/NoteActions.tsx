import { useEffect, useState } from 'react';
import type { Document } from '../domain/types';
import { noteFilename, type TrashedNote } from '../domain/note-operations';
import type { LinkUpdate } from '../domain/note-links';
import { Dialog } from './Dialog';

const host = window.irori;

/** What the move did to links, for the status line. */
function linkNotice(update: LinkUpdate) {
  const done = [
    update.self ? `このノート内 ${update.self} 件` : '',
    update.notes ? `参照元 ${update.notes} 件のノートの ${update.links} 件` : '',
  ].filter(Boolean);
  return [
    done.length
      ? `${done.join('と')}のリンクを更新しました。`
      : '更新が必要なリンクはありませんでした。',
    update.skipped.length ? `更新できなかったノート: ${update.skipped.join('、')}。` : '',
    update.incomplete
      ? '上限または読めないファイルにより、すべての参照元を確認できていません。'
      : '',
  ].join('');
}

export function NoteActions({
  doc,
  beforeChange,
  onChanged,
  onBusyChange,
}: {
  doc: Document;
  beforeChange: () => Promise<Document | null>;
  onChanged: (doc: Document | null, notice?: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [action, setAction] = useState<'move' | 'trash'>();
  const [name, setName] = useState('');
  const [directory, setDirectory] = useState('');
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
  const close = () => setAction(undefined);
  function open(next: 'move' | 'trash') {
    const parts = doc.path.split('/');
    setName(parts.pop()!.replace(/\.md$/i, ''));
    setDirectory(parts.join('/'));
    setError('');
    setAction(next);
  }
  async function submit() {
    onBusyChange(true);
    setBusy(true);
    setError('');
    try {
      const saved = await beforeChange();
      if (!saved) throw Error('ノートを保存してからもう一度操作してください。');
      if (saved.scopeId !== doc.scopeId || saved.path !== doc.path)
        throw Error('選択中のノートが変わりました。開き直してください。');
      if (action === 'trash') {
        await host.trashNote(saved);
        onChanged(null);
      } else {
        const filename = noteFilename(name);
        const destination = directory ? `${directory}/${filename}` : filename;
        const moved = await host.moveNote(saved, destination, links);
        onChanged(
          moved,
          `${moved.notice ?? 'ノートの場所を変更しました。'}${
            moved.links ? linkNotice(moved.links) : links ? '' : 'リンクは更新していません。'
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
  if (doc.readOnly || doc.workspaceId || !/\.md$/i.test(doc.path)) return null;
  return (
    <>
      <button onClick={() => open('move')}>名前・場所</button>
      <button onClick={() => open('trash')}>削除</button>
      {action && (
        <Dialog
          label={action === 'move' ? 'ノートの名前と場所' : 'ノートを削除'}
          busy={busy}
          onClose={close}
        >
          <form
            className="modal"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <h2>{action === 'move' ? 'ノートの名前と場所' : 'ノートを削除'}</h2>
            <p>{doc.path}</p>
            {action === 'move' ? (
              <>
                <label>
                  ノート名
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    disabled={busy}
                    required
                  />
                </label>
                <label>
                  移動先フォルダ
                  <input
                    value={directory}
                    onChange={(event) => setDirectory(event.target.value)}
                    disabled={busy}
                  />
                </label>
                <p className="hint">
                  同じスペース内の既存フォルダを指定します。空欄はスペース直下です。
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={links}
                    disabled={busy}
                    onChange={(event) => setLinks(event.target.checked)}
                  />{' '}
                  リンクも更新する
                </label>
                <p className="hint">
                  {!links
                    ? '参照元のリンクは更新しません。相対リンクを含むノートは同じフォルダで名前を変更してください。'
                    : !referring
                      ? '参照元のリンクを調べています…'
                      : 'error' in referring
                        ? `参照元のリンクを確認できませんでした: ${referring.error}`
                        : `${
                            referring.notes
                              ? `参照元 ${referring.notes} 件のノートにある ${referring.links} 件のリンクと、`
                              : 'このノートを参照するリンクはありません。'
                          }このノート内の相対リンクを移動先に合わせて更新します。${
                            referring.incomplete
                              ? '上限または読めないファイルにより、すべての参照元を確認できていません。'
                              : ''
                          }`}{' '}
                  irori で貼り付けた画像は移動先にも保持します。
                </p>
              </>
            ) : (
              <p>
                この端末の「削除済みノート」から復元できます。画像ファイルは残ります。このノートへのリンクは更新しません。
              </p>
            )}
            {error && <p role="alert">{error}</p>}
            <div className="actions">
              <button type="button" disabled={busy} onClick={close}>
                キャンセル
              </button>
              <button className="primary" disabled={busy}>
                {action === 'move' ? '変更する' : '削除済みに移す'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
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
    <Dialog label="削除済みノート" busy={busy} onClose={onClose}>
      <div className="modal">
        <h2>削除済みノート</h2>
        <p>
          この端末で削除したノートを元の場所に戻します。同じ場所にファイルがある場合は復元できません。
        </p>
        {error && <p role="alert">{error}</p>}
        {loading ? (
          <p role="status">読み込み中…</p>
        ) : notes.length === 0 ? (
          <p>削除済みのノートはありません。</p>
        ) : (
          <ul>
            {notes.map((note) => (
              <li key={note.id}>
                <span>{note.path}</span>{' '}
                <time dateTime={note.deletedAt}>{new Date(note.deletedAt).toLocaleString()}</time>{' '}
                <button
                  disabled={busy}
                  aria-label={`${note.path} を復元`}
                  onClick={() => void restore(note.id)}
                >
                  復元
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button disabled={busy} onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </Dialog>
  );
}
