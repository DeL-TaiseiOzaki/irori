import { useState, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import type { Entry, EntryMove, Layer } from '../domain/types';
import { entryNameError } from '../domain/connections';
import type { LinkUpdate } from '../domain/note-links';
import { Dialog } from './Dialog';
import { Icon, type IconName } from './Icon';
import { t } from '../domain/i18n';
import { parentPath } from '../domain/paths';
import { useAction } from './useAction';
import type { Brought } from './dropped';

const host = window.irori;
export const entryActions = ['rename', 'move', 'delete'] as const;
export type EntryAction = (typeof entryActions)[number];
/** What the explorer adds to a folder; a note goes through the note dialog. */
export type CreateKind = 'note' | 'file' | 'folder';
/** What an action did, so the application can follow with its open document and references. */
export type EntryChange =
  | {
      scopeId: string;
      action: 'rename' | 'move';
      from: string;
      to: string;
      notice?: string;
      /** The vault it moved into, when another (ADR 038). */
      toScopeId?: string;
    }
  | { scopeId: string; action: 'delete'; from: string };
/** The vault an entry belongs to, as the dialogs need it. */
export interface EntrySpace {
  scopeId: string;
  contents: string[];
}

// Labels are read at render time so they follow the interface language.
export function actionLabel(action: EntryAction) {
  return {
    rename: t('名前を変更', 'Rename'),
    move: t('移動', 'Move'),
    delete: t('削除', 'Delete'),
  }[action];
}
function createLabel(kind: CreateKind) {
  return {
    note: t('新しいノート', 'New note'),
    file: t('新しいファイル', 'New file'),
    folder: t('新しいフォルダ', 'New folder'),
  }[kind];
}
const createIcons: Record<CreateKind, IconName> = {
  note: 'file',
  file: 'filePlus',
  folder: 'folderPlus',
};
/** The system file manager by its name on this platform. */
export function fileManagerName() {
  const platform = navigator.platform || navigator.userAgent;
  return /Mac/i.test(platform)
    ? 'Finder'
    : /Win/i.test(platform)
      ? t('エクスプローラー', 'Explorer')
      : t('ファイルマネージャー', 'file manager');
}
export const revealLabel = () => t(`${fileManagerName()} で表示`, `Show in ${fileManagerName()}`);

/** What links a move rewrote, for the status line. */
export function linkNotice(update: LinkUpdate) {
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

/** What the explorer does, handed down to its rows by the application. */
export interface Explorer {
  create(directory: string, kind: CreateKind): void;
  /**
   * Copies files and folders from elsewhere into `directory`, as they are read;
   * without them, the person picks files.
   */
  bringIn(directory: string, items?: Promise<Brought[]>): void;
  act(entry: Entry, action: EntryAction): void;
  /** Moves an entry into `directory`, keeping its name: a drag and drop. */
  moveInto(entry: Entry, directory: string): void;
  /** Moves an entry of another vault's knowledge into `directory`: a drop across vaults. */
  moveFrom?(scopeId: string, entry: Entry, directory: string): void;
  reveal(path: string): void;
}

/**
 * The explorer's menu items for a folder (`folder`), an entry (`entry`), or both:
 * what goes into the folder, what changes the entry, and the file manager.
 */
export function ExplorerItems({
  explorer,
  folder,
  entry,
  path,
}: {
  explorer: Explorer;
  /** The folder new entries go into, when they may. */
  folder?: string;
  /** The entry that may be renamed, moved and deleted. */
  entry?: Entry;
  path: string;
}) {
  const item = (key: string, icon: IconName, label: ReactNode, run: () => void) => (
    <Menu.Item key={key} onClick={run}>
      <Icon name={icon} size={14} />
      {label}
    </Menu.Item>
  );
  return (
    <>
      {folder !== undefined && (
        <>
          {(['note', 'file', 'folder'] as const).map((kind) =>
            item(kind, createIcons[kind], createLabel(kind), () => explorer.create(folder, kind)),
          )}
          {item('bring', 'upload', t('ファイルを追加…', 'Add files…'), () =>
            explorer.bringIn(folder),
          )}
          <Menu.Separator className="menu-separator" />
        </>
      )}
      {entry && (
        <>
          {entryActions.map((action) =>
            item(
              action,
              action === 'delete' ? 'trash' : action === 'move' ? 'move' : 'penLine',
              actionLabel(action),
              () => explorer.act(entry, action),
            ),
          )}
          <Menu.Separator className="menu-separator" />
        </>
      )}
      {item('reveal', 'folderOpen', revealLabel(), () => explorer.reveal(path))}
    </>
  );
}

/** The row menu of a file or folder the explorer may change. */
export function EntryMenu({ entry, children }: { entry: Entry; children: ReactNode }) {
  const label = t(`${entry.name} の操作`, `Actions for ${entry.name}`);
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className="tree-action" aria-label={label} title={label}>
        <Icon name="more" size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4}>
          <Menu.Popup className="menu" aria-label={label}>
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
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

/** Names a new empty file or folder; the host checks the name again. */
export function NewEntryDialog({
  scopeId,
  directory,
  kind,
  onDone,
  onClose,
}: {
  scopeId: string;
  directory: string;
  kind: 'file' | 'folder';
  onDone: (entry: Entry) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const { busy, error, run } = useAction();
  const title = createLabel(kind);
  const problem = name ? entryNameError(name) : undefined;
  return (
    <Dialog label={title} busy={busy} onClose={onClose}>
      <form
        className="modal"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || problem) return;
          void run(async () => {
            onDone(await host.createEntry(scopeId, directory, { kind, name }));
            onClose();
          });
        }}
      >
        <h2>{title}</h2>
        <input
          aria-label={
            kind === 'file' ? t('ファイル名', 'File name') : t('フォルダ名', 'Folder name')
          }
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={
            kind === 'file' ? t('例: data.csv', 'e.g. data.csv') : t('フォルダ名', 'Folder name')
          }
          disabled={busy}
          autoFocus
          required
        />
        <p className="mount-preview">
          {t('保存先', 'Destination')}: {directory ? `${directory}/` : './'}
        </p>
        {problem && <small role="alert">{problem}</small>}
        {error && <p role="alert">{error}</p>}
        <div className="actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {t('キャンセル', 'Cancel')}
          </button>
          <button className="primary" disabled={busy || !!problem}>
            {t('作成', 'Create')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Renames, moves or deletes one file or folder of the vault's knowledge or of an
 * editable connected folder. The host checks everything again; the checks here
 * only answer before a round trip.
 */
export function EntryDialog({
  space,
  entry,
  action,
  beforeChange,
  onBusyChange,
  onDone,
  onClose,
}: {
  space: EntrySpace;
  entry: Entry;
  action: EntryAction;
  /** Saves the open document first; false when it could not be saved. */
  beforeChange: () => Promise<boolean>;
  onBusyChange: (busy: boolean) => void;
  onDone: (change: EntryChange) => Promise<void> | void;
  onClose: () => void;
}) {
  const [name, setName] = useState(entry.name);
  const [directory, setDirectory] = useState(parentPath(entry.path));
  const { busy, error, run } = useAction();
  const layer: Layer = entry.layer;
  const connection = connectionOf(space.contents, entry.path);
  const title = actionLabel(action);
  const destination = directory.trim().replace(/^\/+|\/+$/g, '');
  const problem =
    action === 'rename'
      ? name === entry.name
        ? ''
        : (entryNameError(name) ?? '')
      : action === 'move' &&
          layer === 'contents' &&
          destination !== connection &&
          !destination.startsWith(`${connection}/`)
        ? t(
            `${connection} の中のフォルダを指定してください。`,
            `Choose a folder inside ${connection}.`,
          )
        : '';
  const unchanged =
    action === 'rename'
      ? name === entry.name
      : action === 'move'
        ? destination === parentPath(entry.path)
        : false;
  const inFolder = (folder: string, item: string) => (folder ? `${folder}/${item}` : item);
  async function submit() {
    if (busy || problem || unchanged) return;
    onBusyChange(true);
    await run(async () => {
      if (!(await beforeChange()))
        throw Error(t('開いているノートを保存してください。', 'Save the open note first.'));
      if (action === 'delete') {
        await host.trashEntry(space.scopeId, entry.path);
        await onDone({ scopeId: space.scopeId, action, from: entry.path });
      } else {
        const to =
          action === 'rename'
            ? inFolder(parentPath(entry.path), name)
            : inFolder(destination, entry.name);
        const moved: EntryMove = await host.moveEntry(space.scopeId, entry.path, to);
        await onDone({
          scopeId: space.scopeId,
          action,
          from: entry.path,
          to: moved.entry.path,
          notice: movedNotice(moved),
        });
      }
      onClose();
    });
    onBusyChange(false);
  }
  // A note of knowledge goes to irori's deleted notes; anything else to the system trash.
  const knowledgeNote = layer === 'Knowledge_Base' && !entry.directory && /\.md$/i.test(entry.name);
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
          <label>
            {t('新しい名前', 'New name')}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
              autoFocus
              required
            />
          </label>
        )}
        {action === 'move' && (
          <label>
            {t('移動先フォルダ', 'Destination folder')}
            <input
              value={directory}
              onChange={(event) => setDirectory(event.target.value)}
              disabled={busy}
              autoFocus
              required={layer === 'contents'}
            />
          </label>
        )}
        {action === 'delete' && (
          <p>
            {knowledgeNote
              ? t('削除済みノートから復元できます。', 'You can restore it from Deleted notes.')
              : layer === 'contents'
                ? entry.directory
                  ? t(
                      'フォルダをゴミ箱に移します（30 日以内なら復元可）。',
                      'Moves the folder to trash (restorable within 30 days).',
                    )
                  : t(
                      'ファイルをゴミ箱に移します（30 日以内なら復元可）。',
                      'Moves the file to trash (restorable within 30 days).',
                    )
                : entry.directory
                  ? t(
                      'フォルダを中身ごとシステムのゴミ箱に移します。',
                      'Moves the folder and everything in it to the system trash.',
                    )
                  : t(
                      'ファイルをシステムのゴミ箱に移します。',
                      'Moves the file to the system trash.',
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
              ? knowledgeNote
                ? t('削除済みに移す', 'Move to deleted')
                : t('ゴミ箱に移す', 'Move to trash')
              : title}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** What a move carried, for the status line: the links rewritten and anything left behind. */
export function movedNotice(moved: EntryMove) {
  const links = moved.links;
  const touched = links && (links.self || links.links || links.skipped.length || links.incomplete);
  return [touched && linkNotice(links), moved.notice].filter(Boolean).join(' ');
}
