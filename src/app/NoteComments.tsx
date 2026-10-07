import { useEffect, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import type { NoteComment } from '../domain/comments';
import type { EditorSelection } from '../editor/Editor';
import { displayLocale, t } from '../domain/i18n';
import { Icon } from './Icon';
import { useResource } from './useResource';
import { errorText } from './ErrorMessage';

const host = window.irori;

const clip = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

function when(at: string) {
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(displayLocale(), { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * The comment button in the note's bar: how many comments the file has, and in
 * its popover the comments with a field for a new one. A new comment is about
 * the passage selected when the popover opened, or about the whole file.
 */
export function NoteComments({
  scopeId,
  path,
  revision,
  selection,
  onReveal,
}: {
  scopeId: string;
  path: string;
  /** Changes when the KB's files change, so an agent's or a pull's edits show. */
  revision: number;
  /** What the editor has selected, read when the popover opens. */
  selection: () => EditorSelection | undefined;
  /** Selects a comment's passage in the editor; false when the text no longer has it. */
  onReveal: (comment: NoteComment) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [bump, setBump] = useState(0);
  const read = useResource(() => host.noteComments(scopeId, path), [scopeId, path], {
    refresh: revision + bump,
  });
  const [written, setWritten] = useState<NoteComment[]>();
  useEffect(() => setWritten(undefined), [read.data]);
  const comments = written ?? read.data;
  const [quote, setQuote] = useState<EditorSelection>();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState<string>();
  const count = comments?.length ?? 0;
  const label = count ? t(`コメント ${count} 件`, `${count} comments`) : t('コメント', 'Comments');

  async function change(action: () => Promise<NoteComment[]>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      setWritten(await action());
      setBump((value) => value + 1);
      return true;
    } catch (failure) {
      setError(errorText(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function add() {
    if (!body.trim()) return;
    const added = await change(() =>
      host.addNoteComment(scopeId, path, {
        body,
        ...(quote ? { quote: clip(quote.quote, 2000), line: quote.line } : {}),
      }),
    );
    if (added) {
      setBody('');
      setQuote(undefined);
    }
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setQuote(selection());
          setMissing(undefined);
          setError('');
        }
        setOpen(next);
      }}
    >
      <Popover.Trigger className="stage-button comments-trigger" aria-label={label} title={label}>
        <Icon name="comment" size={16} />
        {!!count && <span className="backlinks-count">{count}</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6}>
          <Popover.Popup className="stage-popover comments-popover">
            <div className="backlinks-heading">
              <Popover.Title render={<h3 />}>{t('コメント', 'Comments')}</Popover.Title>
              <Popover.Close className="stage-button" aria-label={t('閉じる', 'Close')}>
                <Icon name="close" size={15} />
              </Popover.Close>
            </div>
            <form
              className="comment-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void add();
              }}
            >
              {quote && (
                <div className="comment-quote selected">
                  <span>{clip(quote.quote, 240)}</span>
                  <button
                    type="button"
                    className="stage-button"
                    aria-label={t('引用を外す', 'Remove the quote')}
                    title={t('引用を外す', 'Remove the quote')}
                    onClick={() => setQuote(undefined)}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </div>
              )}
              <textarea
                aria-label={t('新しいコメント', 'New comment')}
                placeholder={
                  quote
                    ? t('選択箇所へのコメント', 'On the selection')
                    : t('ノートへのコメント', 'On the note')
                }
                value={body}
                maxLength={4000}
                rows={3}
                autoFocus
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    (event.metaKey || event.ctrlKey) &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void add();
                  }
                }}
              />
              <button type="submit" disabled={busy || !body.trim()}>
                {t('追加', 'Add')}
              </button>
            </form>
            {(error || (!comments && read.error)) && (
              <p className="search-error" role="alert">
                {error || read.error}
              </p>
            )}
            {!!comments?.length && (
              <ul className="comment-list" aria-label={t('コメントの一覧', 'List of comments')}>
                {comments.map((comment) => (
                  <li key={comment.id}>
                    {comment.quote && (
                      <button
                        type="button"
                        className="comment-quote"
                        title={t('本文で表示', 'Show in the note')}
                        onClick={() => {
                          if (onReveal(comment)) setOpen(false);
                          else setMissing(comment.id);
                        }}
                      >
                        {clip(comment.quote, 240)}
                      </button>
                    )}
                    {missing === comment.id && (
                      <small className="comment-missing" role="status">
                        {t('本文に見当たりません', 'Not found in the note')}
                      </small>
                    )}
                    <p className="comment-body">{comment.body}</p>
                    <div className="comment-meta">
                      <small>
                        {[comment.by?.replace(/^human:/, ''), when(comment.at)]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                      <button
                        type="button"
                        className="stage-button"
                        disabled={busy}
                        aria-label={t('解決', 'Resolve')}
                        title={t('解決', 'Resolve')}
                        onClick={() =>
                          void change(() => host.removeNoteComment(scopeId, path, comment.id))
                        }
                      >
                        <Icon name="check" size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
