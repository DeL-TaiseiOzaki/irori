import { useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import type { CloudRoot, Entry } from '../domain/types';
import { entryNameError } from '../domain/connections';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { t } from '../domain/i18n';

const host = window.irori;
export const entryActions = ['rename', 'move', 'delete'] as const;
export type EntryAction = (typeof entryActions)[number];
/** What an action did, so the application can follow with its open document and references. */
export type EntryChange =
  | { scopeId: string; action: 'rename' | 'move'; from: string; to: string }
  | { scopeId: string; action: 'delete'; from: string };

// Labels are read at render time so they follow the interface language.
export function actionLabel(action: EntryAction) {
  return {
    rename: t('名前を変更', 'Rename'),
    move: t('移動', 'Move'),
    delete: t('削除', 'Delete'),
  }[action];
}

/** The connected folder an entry lies in: its contents root and the connection's name. */
function connectionOf(contents: string[], entryPath: string) {
  const root = [...contents]
    .sort((a, b) => b.length - a.length)
    .find((item) => entryPath.startsWith(`${item}/`));
  if (!root) return entryPath;
  const rest = entryPath.slice(root.length + 1);
  const slash = rest.indexOf('/');
  return slash < 0 ? entryPath : `${root}/${rest.slice(0, slash)}`;
}
const parentOf = (entryPath: string) => entryPath.split('/').slice(0, -1).join('/');

/** The row menu of a file or folder in an editable Drive folder. */
export function EntryMenu({
  entry,
  onAction,
}: {
  entry: Entry;
  onAction: (action: EntryAction) => void;
}) {
  const label = t(`${entry.name} の操作`, `Actions for ${entry.name}`);
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className="tree-action" aria-label={label} title={label}>
        <Icon name="more" size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4}>
          <Menu.Popup className="entry-menu">
            {entryActions.map((action) => (
              <Menu.Item key={action} onClick={() => onAction(action)}>
                {actionLabel(action)}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** The same actions for the open Drive document, in the document toolbar. */
export function CloudDocumentActions({ onAction }: { onAction: (action: EntryAction) => void }) {
  return (
    <>
      {entryActions.map((action) => (
        <button key={action} onClick={() => onAction(action)}>
          {actionLabel(action)}
        </button>
      ))}
    </>
  );
}

/**
 * Renames, moves or deletes one entry of an editable Drive folder. The host
 * checks everything again; the checks here only answer before a round trip.
 */
export function CloudEntryDialog({
  space,
  entry,
  action,
  beforeChange,
  onBusyChange,
  onDone,
  onClose,
}: {
  space: CloudRoot;
  entry: Entry;
  action: EntryAction;
  /** Saves the open document first; false when it could not be saved. */
  beforeChange: () => Promise<boolean>;
  onBusyChange: (busy: boolean) => void;
  onDone: (change: EntryChange) => Promise<void> | void;
  onClose: () => void;
}) {
  const [name, setName] = useState(entry.name);
  const [directory, setDirectory] = useState(parentOf(entry.path));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connection = connectionOf(space.contents, entry.path);
  const title = actionLabel(action);
  const destination = directory.trim().replace(/\/+$/, '');
  const problem =
    action === 'rename'
      ? name === entry.name
        ? ''
        : (entryNameError(name) ?? '')
      : action === 'move' && destination !== connection && !destination.startsWith(`${connection}/`)
        ? t(
            `${connection} の中のフォルダを指定してください。`,
            `Choose a folder inside ${connection}.`,
          )
        : '';
  const unchanged =
    action === 'rename'
      ? name === entry.name
      : action === 'move'
        ? destination === parentOf(entry.path)
        : false;
  async function submit() {
    if (busy || problem || unchanged) return;
    onBusyChange(true);
    setBusy(true);
    setError('');
    try {
      if (!(await beforeChange()))
        throw Error(
          t(
            '開いているノートを保存してからもう一度操作してください。',
            'Save the open note before trying again.',
          ),
        );
      if (action === 'delete') {
        await host.deleteCloudEntry(space.scopeId, entry.path);
        await onDone({ scopeId: space.scopeId, action, from: entry.path });
      } else {
        const to =
          action === 'rename' ? `${parentOf(entry.path)}/${name}` : `${destination}/${entry.name}`;
        const moved = await host.moveCloudEntry(space.scopeId, entry.path, to);
        await onDone({ scopeId: space.scopeId, action, from: entry.path, to: moved.path });
      }
      onClose();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <Dialog label={title} busy={busy} onClose={onClose}>
      <form
        className="modal"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2>{title}</h2>
        <p>{entry.path}</p>
        {action === 'rename' && (
          <>
            <label>
              {t('新しい名前', 'New name')}
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
                required
              />
            </label>
            {!entry.directory && (
              <p className="hint">
                {t(
                  '拡張子まで含めた名前を入力します。',
                  'Enter the whole name, including its extension.',
                )}
              </p>
            )}
          </>
        )}
        {action === 'move' && (
          <>
            <label>
              {t('移動先フォルダ', 'Destination folder')}
              <input
                value={directory}
                onChange={(event) => setDirectory(event.target.value)}
                disabled={busy}
                required
              />
            </label>
            <p className="hint">
              {t(
                `${connection} の中にある既存のフォルダを指定します。`,
                `Specify an existing folder inside ${connection}.`,
              )}
            </p>
          </>
        )}
        {action === 'delete' && (
          <p>
            {entry.directory
              ? t(
                  'このフォルダを Google Drive のゴミ箱に移します。中のファイルとフォルダはそれぞれゴミ箱に入り、Google Drive のゴミ箱から 30 日以内なら元に戻せます。',
                  "This folder is moved to Google Drive's trash. The files and folders inside reach the trash one by one, and can be restored from Google Drive's trash within 30 days.",
                )
              : t(
                  'このファイルを Google Drive のゴミ箱に移します。Google Drive のゴミ箱から 30 日以内なら元に戻せます。',
                  "This file is moved to Google Drive's trash, where it can be restored within 30 days.",
                )}
          </p>
        )}
        {problem && <small role="alert">{problem}</small>}
        {error && <p role="alert">{error}</p>}
        <div className="actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {t('キャンセル', 'Cancel')}
          </button>
          <button className="primary" disabled={busy || !!problem || unchanged}>
            {action === 'delete'
              ? t('ゴミ箱に移す', 'Move to trash')
              : action === 'rename'
                ? t('名前を変更', 'Rename')
                : t('移動する', 'Move')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
