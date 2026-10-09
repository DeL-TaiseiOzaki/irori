import { useEffect, useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { agentNames } from '../domain/types';
import { isDamaged, type ConversationRow, type ConversationSummary } from '../domain/conversation';
import { t } from '../domain/i18n';
import { baseName } from '../domain/paths';
import { shortWhen as when } from './display';
import { Icon } from './Icon';
import { useAction } from './useAction';
import { useResource } from './useResource';

const host = window.irori;

/**
 * One owner's conversations (ADR 017 D5): pinned first, then by last update, with
 * archived ones apart. Rows open, rename, pin, archive and delete; grouping by
 * linked note and the open note's conversations narrow the list.
 */
export function ConversationHistory({
  scopeId,
  workspaceId,
  current,
  note,
  onOpen,
  onDeleted,
  onError,
}: {
  /** The owner: a hibachi's scope or the irori agent's id. */
  scopeId: string;
  /** For the irori agent: the workspace whose history is listed (ADR 017 D4). */
  workspaceId?: string;
  /** The conversation on show. */
  current?: string;
  /** The note open beside the panel, whose conversations can be listed alone. */
  note?: string;
  onOpen: (row: ConversationSummary) => void;
  onDeleted: (id: string) => void;
  onError: (error: unknown) => void;
}) {
  const [reload, setReload] = useState(0);
  const list = useResource(
    () => host.agentConversations(scopeId, workspaceId),
    [scopeId, workspaceId],
    {
      refresh: reload,
    },
  );
  const rows: ConversationRow[] | undefined = list.data;
  useEffect(() => {
    if (list.error) onError(list.error);
  }, [list.error]);
  const [byNote, setByNote] = useState(false);
  const [onlyNote, setOnlyNote] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; title: string }>();
  const [deleting, setDeleting] = useState<string>();
  const { busy, run: act } = useAction({
    onError,
    after: () => setReload((value) => value + 1),
  });
  async function remove(id: string) {
    if (await act(() => host.deleteConversation(id))) {
      setDeleting(undefined);
      onDeleted(id);
    }
  }
  async function rename() {
    const target = renaming;
    if (!target) return;
    if (await act(() => host.renameConversation(target.id, target.title))) setRenaming(undefined);
  }
  if (!rows) return <p className="hint">{t('読み込み中…', 'Loading…')}</p>;
  const noted = rows.some((row) => !isDamaged(row) && row.linkedNote);
  const visible = rows.filter(
    (row) => !onlyNote || !note || (!isDamaged(row) && row.linkedNote === note),
  );
  const live = visible.filter((row) => isDamaged(row) || !row.archived);
  const pinned = live.filter((row) => !isDamaged(row) && row.pinned);
  const others = live.filter((row) => isDamaged(row) || !row.pinned);
  const archived = visible.filter(
    (row): row is ConversationSummary => !isDamaged(row) && row.archived,
  );
  const groups = new Map<string, ConversationRow[]>();
  if (byNote)
    for (const row of others) {
      const key = (!isDamaged(row) && row.linkedNote) || '';
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
  const item = (row: ConversationRow) =>
    isDamaged(row) ? (
      <li key={row.id} className="history-row damaged">
        <span className="history-open">
          <span className="history-title">{t('読み込めない会話', 'Unreadable conversation')}</span>
          <small>{row.damaged}</small>
        </span>
        <button className="panel-button" disabled={busy} onClick={() => setDeleting(row.id)}>
          {t('削除', 'Delete')}
        </button>
        {deleting === row.id && confirmation(row.id)}
      </li>
    ) : (
      <li
        key={row.id}
        className={`history-row ${row.id === current ? 'current' : ''}`}
        aria-current={row.id === current || undefined}
      >
        {renaming?.id === row.id ? (
          <form
            className="history-rename"
            onSubmit={(event) => {
              event.preventDefault();
              void rename();
            }}
          >
            <input
              aria-label={t('会話の名前', 'Conversation name')}
              value={renaming.title}
              maxLength={200}
              autoFocus
              disabled={busy}
              onChange={(event) => setRenaming({ id: row.id, title: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setRenaming(undefined);
              }}
            />
            <button
              type="submit"
              className="panel-button"
              disabled={busy || !renaming.title.trim()}
            >
              {t('保存', 'Save')}
            </button>
          </form>
        ) : (
          <button className="history-open" onClick={() => onOpen(row)}>
            <span className="history-title">
              {row.pinned && <Icon name="pin" size={12} />}
              {row.title}
            </span>
            <small>
              {[
                agentNames[row.agent],
                when(row.updatedAt),
                row.linkedNote && baseName(row.linkedNote),
                row.origin === 'routine' && t('ルーティン', 'Routine'),
                row.origin === 'hand-off' && t('irori agent から', 'From the irori agent'),
                row.running && t('実行中', 'Running'),
                row.queued > 0 && t(`送信待ち ${row.queued}`, `${row.queued} pending`),
              ]
                .filter(Boolean)
                .join(' · ')}
            </small>
          </button>
        )}
        <Menu.Root modal={false}>
          <Menu.Trigger
            className="icon-button"
            aria-label={t(`${row.title} の操作`, `Actions for ${row.title}`)}
            disabled={busy}
          >
            <Icon name="more" size={15} />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="end" sideOffset={4}>
              <Menu.Popup className="menu">
                <Menu.Item onClick={() => setRenaming({ id: row.id, title: row.title })}>
                  <Icon name="penLine" size={14} />
                  {t('名前を変更', 'Rename')}
                </Menu.Item>
                <Menu.Item
                  onClick={() => void act(() => host.pinConversation(row.id, !row.pinned))}
                >
                  <Icon name="pin" size={14} />
                  {row.pinned ? t('ピン留めを外す', 'Unpin') : t('ピン留め', 'Pin')}
                </Menu.Item>
                <Menu.Item
                  onClick={() => void act(() => host.archiveConversation(row.id, !row.archived))}
                >
                  <Icon name="archive" size={14} />
                  {row.archived ? t('アーカイブから戻す', 'Unarchive') : t('アーカイブ', 'Archive')}
                </Menu.Item>
                <Menu.Item onClick={() => setDeleting(row.id)}>
                  <Icon name="trash" size={14} />
                  {t('削除', 'Delete')}
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
        {deleting === row.id && confirmation(row.id)}
      </li>
    );
  const confirmation = (id: string) => (
    <div className="history-confirm" role="group" aria-label={t('削除の確認', 'Confirm deletion')}>
      <span>
        {t('削除しますか？CLI 側の履歴は残ります。', "Delete? The CLI's own history stays.")}
      </span>
      <button className="panel-button danger" disabled={busy} onClick={() => void remove(id)}>
        {t('削除する', 'Delete')}
      </button>
      <button className="panel-button" disabled={busy} onClick={() => setDeleting(undefined)}>
        {t('戻る', 'Back')}
      </button>
    </div>
  );
  return (
    <section className="conversation-history" aria-label={t('履歴', 'History')}>
      {(noted || note) && (
        <div className="history-tools">
          {noted && (
            <button aria-pressed={byNote} onClick={() => setByNote((value) => !value)}>
              {t('ノート別', 'By note')}
            </button>
          )}
          {note && (
            <button aria-pressed={onlyNote} onClick={() => setOnlyNote((value) => !value)}>
              {t('このノート', 'This note')}
            </button>
          )}
        </div>
      )}
      {!visible.length && (
        <p className="hint">{t('会話はまだありません。', 'No conversations yet.')}</p>
      )}
      {pinned.length > 0 && (
        <>
          <h3>{t('ピン留め', 'Pinned')}</h3>
          <ul>{pinned.map(item)}</ul>
        </>
      )}
      {byNote ? (
        [...groups].map(([key, group]) => (
          <div key={key || 'none'}>
            <h3>{key ? baseName(key) : t('ノートなし', 'No note')}</h3>
            <ul>{group.map(item)}</ul>
          </div>
        ))
      ) : (
        <ul>{others.map(item)}</ul>
      )}
      {archived.length > 0 && (
        <details>
          <summary>{t(`アーカイブ ${archived.length}`, `Archived ${archived.length}`)}</summary>
          <ul>{archived.map(item)}</ul>
        </details>
      )}
    </section>
  );
}
