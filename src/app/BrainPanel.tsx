import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';
import { knowledgeFolder, layerLabel } from '../domain/layers';
import { Menu } from '@base-ui/react/menu';
import { ContextMenu } from '@base-ui/react/context-menu';
import {
  Group as PaneGroup,
  Panel as Pane,
  Separator as PaneSeparator,
  useDefaultLayout,
  usePanelRef,
} from 'react-resizable-panels';
import type { CloudConnection, Document, Entry, Layer, Space } from '../domain/types';
import { categoryIcon, categoryName } from '../domain/brains';
import { t } from '../domain/i18n';
import { BrainTile } from './BrainTile';
import { EntryMenu, ExplorerItems, entryActions, type Explorer } from './EntryActions';
import { entryNameError } from '../domain/connections';
import { errorText } from './ErrorMessage';
import { parentPath } from '../domain/paths';
import { readDropped } from './dropped';
import { Icon, type IconName } from './Icon';
import { MagnetTabs } from './obsidian/MagnetTabs';
import { layoutStorage } from './device-settings';
import { shortcut } from './shortcuts';
import { useResource } from './useResource';
import { useLanguage } from './useLanguage';
import './brain-panel.css';

const host = window.irori;
export type Listing = { entries: Entry[]; error?: string };
export type BrainMode = 'files' | 'changes';

const layerIcons: Record<Layer, IconName> = {
  schema: 'schema',
  Knowledge_Base: 'book',
  contents: 'cloud',
};

/** What a connected folder shows beside its name: a lock when it is read-only. */
function DriveBadge({ connection }: { connection?: CloudConnection }) {
  if (!connection) return null;
  if (connection.state === 'mounted' && !connection.writable)
    return (
      <span className="drive-badge">
        <Icon name="lock" size={12} strokeWidth={2} />
      </span>
    );
  return null;
}

/**
 * A row's name being edited in place, as in a file manager: Enter or leaving the
 * field renames, Escape keeps the name. A note's `.md` stays out of sight, and a
 * file's extension starts outside the selection.
 */
function RenameField({
  entry,
  layer,
  rename,
  onDone,
}: {
  entry: Entry;
  layer: Layer;
  rename: (entry: Entry, name: string) => Promise<void>;
  onDone: () => void;
}) {
  const note = layer !== 'schema' && !entry.directory && /\.md$/i.test(entry.name);
  const shown = note ? entry.name.replace(/\.md$/i, '') : entry.name;
  const [value, setValue] = useState(shown);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    // After the menu that started it has handed focus back to its row.
    const timer = window.setTimeout(() => {
      const field = input.current;
      if (!field) return;
      field.focus();
      const dot = entry.directory || note ? -1 : shown.lastIndexOf('.');
      field.setSelectionRange(0, dot > 0 ? dot : shown.length);
    });
    return () => clearTimeout(timer);
  }, [entry.directory, note, shown]);
  const typed = value.trim();
  const name = note && !/\.md$/i.test(typed) ? `${typed}.md` : typed;
  const problem = typed && name !== entry.name ? entryNameError(name) : undefined;
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };
  async function commit() {
    if (busy || done.current) return;
    if (!typed || name === entry.name) return finish();
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await rename(entry, name);
      finish();
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  }
  const label = t(`${entry.name} の新しい名前`, `New name for ${entry.name}`);
  return (
    <span className="tree-rename">
      <input
        ref={input}
        aria-label={label}
        value={value}
        // Read-only, not disabled, while it works: the field keeps focus for another try.
        readOnly={busy}
        spellCheck={false}
        aria-invalid={!!(error || problem)}
        onChange={(event) => {
          setValue(event.target.value);
          setError('');
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            void commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            finish();
          }
        }}
        onBlur={() => {
          // Focus that never arrived, as while the menu closes, is not leaving.
          if (document.activeElement !== input.current) void commit();
        }}
      />
      {(error || problem) && (
        <small className="tree-error" role="alert">
          {error || problem}
        </small>
      )}
    </span>
  );
}

/** The drag of an entry inside irori; a drag's data cannot be read before its drop. */
const entryDrag = 'application/x-irori-entry';
let dragged: { scopeId: string; entry: Entry } | undefined;
/** The folder a drag is over, shared by every level of one tree. */
const DropTarget = createContext<{ over?: string; setOver(path?: string): void } | null>(null);

export function Tree({
  space,
  layer,
  directory = '',
  depth = 0,
  roots,
  revision,
  selected,
  connections = [],
  explorer,
  writable = false,
  onOpen,
}: {
  space: Space;
  layer: Layer;
  directory?: string;
  depth?: number;
  roots?: Listing;
  revision: number;
  selected?: Document;
  connections?: CloudConnection[];
  /** Creating, renaming, moving and deleting, where the person may. */
  explorer?: Explorer;
  /** `directory` takes new entries. */
  writable?: boolean;
  onOpen: (space: Space, entry: Entry) => void;
}) {
  const listing = useResource(
    () => host.entries(space.scopeId, directory),
    [space.scopeId, directory],
    {
      enabled: !!directory && !roots,
      refresh: revision,
    },
  );
  const [expanded, setExpanded] = useState<string[]>(directory ? [] : [knowledgeFolder(space)]);
  const expand = (path: string) =>
    setExpanded((value) => (value.includes(path) ? value : [...value, path]));
  const shared = useContext(DropTarget);
  const [over, setOver] = useState<string>();
  const drop = shared ?? { over, setOver };
  // The row or background the context menu was opened on; undefined keeps it shut.
  const [menu, setMenu] = useState<{ entry?: Entry }>();
  const pendingMenu = useRef<{ entry?: Entry }>(undefined);
  const data =
    roots ??
    (listing.data || listing.error
      ? { entries: listing.data ?? [], error: listing.error }
      : undefined);
  const entries = data?.entries.filter((entry) => entry.layer === layer) ?? [];
  const indent = { paddingLeft: 10 + depth * 14 };
  const editable = (entry: Entry) =>
    !!explorer &&
    !entry.blocked &&
    layer !== 'schema' &&
    (layer === 'Knowledge_Base' || !!entry.writable);
  // A connected folder's name belongs to its connection; the knowledge folder's to the settings.
  const movable = (entry: Entry) =>
    editable(entry) &&
    !entry.connection &&
    !(layer === 'Knowledge_Base' && entry.path === knowledgeFolder(space));
  const actions = explorer?.actions ?? entryActions;
  // Schema's files are renamed in place, except irori's own and Git's.
  const renamable = (entry: Entry) =>
    !!explorer?.rename &&
    actions.includes('rename') &&
    (layer === 'schema'
      ? !entry.blocked && !/^\.(irori|git)(\/|$)/.test(entry.path)
      : movable(entry));
  const changeable = (entry: Entry) => movable(entry) || renamable(entry);
  // The row whose name is being edited.
  const [renaming, setRenaming] = useState<string>();
  const accepts = (event: DragEvent) => {
    const types = event.dataTransfer.types;
    if (types.includes(entryDrag))
      return dragged?.scopeId === space.scopeId
        ? dragged.entry.layer === layer
        : // Knowledge takes knowledge from the vault beside (ADR 038).
          !!dragged &&
            !!explorer?.moveFrom &&
            dragged.entry.layer === 'Knowledge_Base' &&
            layer === 'Knowledge_Base';
    return types.includes('Files');
  };
  // A closed folder held under a drag opens, so a drop can reach the folders inside.
  const opening = useRef<{ path: string; timer: number }>(undefined);
  const openLater = (path?: string) => {
    if (opening.current?.path === path) return;
    if (opening.current) clearTimeout(opening.current.timer);
    opening.current =
      path === undefined
        ? undefined
        : {
            path,
            timer: window.setTimeout(() => {
              opening.current = undefined;
              expand(path);
            }, 700),
          };
  };
  const dragOver = (event: DragEvent, folder: string) => {
    if (!explorer || !accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes(entryDrag) ? 'move' : 'copy';
    if (drop.over !== folder) drop.setOver(folder);
    openLater(folder !== directory && !expanded.includes(folder) ? folder : undefined);
  };
  function dropInto(event: DragEvent, folder: string) {
    if (!explorer || !accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    drop.setOver(undefined);
    openLater(undefined);
    if (event.dataTransfer.types.includes(entryDrag)) {
      const from = dragged;
      dragged = undefined;
      if (!from) return;
      if (from.scopeId !== space.scopeId) explorer.moveFrom?.(from.scopeId, from.entry, folder);
      else if (parentPath(from.entry.path) !== folder) explorer.moveInto(from.entry, folder);
    } else {
      // The entries are taken during the drop; what they hold is read after it.
      const entries = [...event.dataTransfer.items]
        .filter((item) => item.kind === 'file')
        .map((item) => item.webkitGetAsEntry() ?? item.getAsFile())
        .filter((entry) => entry !== null);
      if (entries.length) explorer.bringIn(folder, readDropped(entries));
    }
    if (folder !== directory) expand(folder);
  }
  // What is made in a folder shows there: the folder opens.
  const here: Explorer | undefined = explorer && {
    ...explorer,
    create: (folder, kind) => {
      if (folder !== directory) expand(folder);
      explorer.create(folder, kind);
    },
    bringIn: (folder, items) => {
      if (folder !== directory) expand(folder);
      explorer.bringIn(folder, items);
    },
    // A name is edited where it is shown, as in a file manager.
    act: (entry, action) =>
      action === 'rename' && renamable(entry)
        ? setRenaming(entry.path)
        : explorer.act(entry, action),
  };
  const levelMenu = menu && (
    <ExplorerItems
      explorer={here}
      scopeId={space.scopeId}
      onOpen={
        menu.entry && !menu.entry.directory && !menu.entry.blocked
          ? () => onOpen(space, menu.entry!)
          : undefined
      }
      folder={
        menu.entry
          ? menu.entry.directory && editable(menu.entry)
            ? menu.entry.path
            : undefined
          : directory
      }
      entry={menu.entry && changeable(menu.entry) ? menu.entry : undefined}
      path={menu.entry?.path ?? directory}
    />
  );
  const level = (
    <ContextMenu.Root
      open={!!menu}
      onOpenChange={(open) => setMenu(open ? pendingMenu.current : undefined)}
    >
      <ContextMenu.Trigger
        render={<div />}
        className={`tree ${drop.over === directory && writable ? 'drop-target' : ''}`}
        role={depth ? 'group' : undefined}
        onContextMenuCapture={(event) => {
          const row = (event.target as HTMLElement).closest<HTMLElement>('[data-entry]');
          const entry = row && entries.find((item) => item.path === row.dataset.entry);
          // Every row has a menu, as in a file manager; the empty space where entries may be made.
          pendingMenu.current = entry ? { entry } : explorer && writable ? {} : undefined;
        }}
        onDragOver={(event) => {
          if (writable) dragOver(event, directory);
        }}
        onDrop={(event) => {
          if (writable) dropInto(event, directory);
        }}
        onDragLeave={(event) => {
          // Only the outermost level clears it, when the drag leaves the tree.
          if (!shared && !event.currentTarget.contains(event.relatedTarget as Node | null))
            drop.setOver(undefined);
        }}
      >
        {!data && (
          <small className="tree-empty" style={indent}>
            {t('読み込み中…', 'Loading…')}
          </small>
        )}
        {data?.error && (
          <small className="tree-error" role="alert" style={indent}>
            {data.error}
          </small>
        )}
        {data && !data.error && !entries.length && (
          <small className="tree-empty" style={indent}>
            {layer === 'contents' && !depth
              ? t('フォルダ未接続', 'No folder connected')
              : t('項目がありません', 'No items')}
          </small>
        )}
        {entries.map((entry) => {
          const isOpen = expanded.includes(entry.path);
          const isSelected = selected?.scopeId === space.scopeId && selected.path === entry.path;
          const connection = entry.connection
            ? connections.find((item) => `${item.contentsRoot}/${item.name}` === entry.path)
            : undefined;
          const takesDrop = entry.directory && editable(entry);
          const marks = (
            <>
              {entry.directory ? (
                <Icon
                  name={isOpen ? 'chevronDown' : 'chevron'}
                  size={12}
                  className="tree-chevron"
                />
              ) : (
                <span className="tree-chevron" />
              )}
              <Icon
                name={
                  entry.repository
                    ? 'branch'
                    : entry.connection && !entry.local
                      ? 'cloud'
                      : entry.directory
                        ? 'folder'
                        : 'file'
                }
                size={15}
                className={`tree-icon ${entry.connection ? 'drive' : ''}`}
              />
            </>
          );
          return (
            <div key={entry.path} className="tree-item">
              {renaming === entry.path ? (
                <div className="tree-row renaming" style={indent} data-entry={entry.path}>
                  {marks}
                  <RenameField
                    entry={entry}
                    layer={layer}
                    rename={explorer!.rename!}
                    onDone={() => setRenaming(undefined)}
                  />
                </div>
              ) : (
                <button
                  className={`tree-row ${entry.blocked ? 'muted' : ''} ${isSelected ? 'selected' : ''} ${takesDrop && drop.over === entry.path ? 'drop-target' : ''}`}
                  style={indent}
                  data-entry={entry.path}
                  aria-current={isSelected ? 'page' : undefined}
                  aria-expanded={entry.directory && !entry.blocked ? isOpen : undefined}
                  draggable={movable(entry)}
                  onDragStart={(event) => {
                    dragged = { scopeId: space.scopeId, entry };
                    event.dataTransfer.setData(entryDrag, entry.path);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => {
                    dragged = undefined;
                    drop.setOver(undefined);
                  }}
                  onDragOver={(event) => {
                    if (takesDrop) dragOver(event, entry.path);
                  }}
                  onDrop={(event) => {
                    if (takesDrop) dropInto(event, entry.path);
                  }}
                  onKeyDown={(event) => {
                    const action =
                      event.key === 'F2'
                        ? 'rename'
                        : event.key === 'Delete' || (event.key === 'Backspace' && event.metaKey)
                          ? 'delete'
                          : undefined;
                    if (
                      !action ||
                      !actions.includes(action) ||
                      !(action === 'rename' ? renamable(entry) || movable(entry) : movable(entry))
                    )
                      return;
                    event.preventDefault();
                    here!.act(entry, action);
                  }}
                  onClick={() =>
                    entry.directory && !entry.blocked
                      ? setExpanded((value) =>
                          isOpen ? value.filter((p) => p !== entry.path) : [...value, entry.path],
                        )
                      : onOpen(space, entry)
                  }
                >
                  {marks}
                  {/* Notes read as titles; Schema files keep their names, as agents know them. */}
                  <span className="filename">
                    {layer === 'schema' ? entry.name : entry.name.replace(/\.md$/, '')}
                  </span>
                  {entry.blocked ? (
                    <span className="badge">
                      {layer === 'contents'
                        ? t('未接続', 'Not connected')
                        : t('利用不可', 'Unavailable')}
                    </span>
                  ) : (
                    <DriveBadge connection={connection} />
                  )}
                </button>
              )}
              <EntryMenu entry={entry}>
                <ExplorerItems
                  explorer={here}
                  scopeId={space.scopeId}
                  onOpen={
                    !entry.directory && !entry.blocked ? () => onOpen(space, entry) : undefined
                  }
                  folder={entry.directory && editable(entry) ? entry.path : undefined}
                  entry={changeable(entry) ? entry : undefined}
                  path={entry.path}
                />
              </EntryMenu>
              {entry.directory && isOpen && !entry.blocked && (
                <Tree
                  space={space}
                  layer={layer}
                  directory={entry.path}
                  depth={depth + 1}
                  revision={revision}
                  selected={selected}
                  connections={connections}
                  explorer={explorer}
                  writable={editable(entry)}
                  onOpen={onOpen}
                />
              )}
            </div>
          );
        })}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup className="menu">{levelMenu}</ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
  return shared ? level : <DropTarget.Provider value={drop}>{level}</DropTarget.Provider>;
}

function SectionAction({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="section-action"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

const sections: { layer: Layer; defaultSize: string }[] = [
  { layer: 'schema', defaultSize: '26%' },
  { layer: 'Knowledge_Base', defaultSize: '46%' },
  { layer: 'contents', defaultSize: '28%' },
];
// Without the vault agent the Schema layer is not shown (ADR 021).
const editorSections: { layer: Layer; defaultSize: string }[] = [
  { layer: 'Knowledge_Base', defaultSize: '62%' },
  { layer: 'contents', defaultSize: '38%' },
];
// A folded section keeps its heading line.
const headingHeight = 36;

/**
 * One brain: its Schema, Knowledge and Contents, and its changes. Memoised: it
 * re-renders for its own data, not for every keystroke in the editor.
 */
/**
 * A second vault beside the first (ADR 038): its knowledge and contents, to
 * open files from and to carry them between the two by drag and drop. Opening a
 * file here brings this vault to the main panel; the menu chooses another.
 */
export const SideBrainPanel = memo(function SideBrainPanel({
  space,
  choices,
  roots,
  revision,
  selected,
  connections,
  locked,
  explorer,
  onOpen,
  onChoose,
  onClose,
}: {
  space: Space;
  /** The other vaults of the workspace that may stand here instead. */
  choices: Space[];
  roots?: Listing;
  revision: number;
  selected?: Document;
  connections: CloudConnection[];
  /** Its own run, Git or a connection holds what would change it. */
  locked: boolean;
  explorer?: Explorer;
  onOpen: (space: Space, entry: Entry) => void;
  onChoose: (space: Space) => void;
  onClose: () => void;
}) {
  useLanguage();
  const contentRoots = roots?.entries.filter(
    (entry) => entry.layer === 'contents' && space.contents.includes(entry.path),
  );
  const layers = ['Knowledge_Base', 'contents'] as const;
  const identity = (
    <>
      <BrainTile space={space} size={34} radius={10} />
      <span className="brain-names side-names">
        <strong>{space.name}</strong>
      </span>
    </>
  );
  return (
    <section className="brain-panel side-panel chrome" aria-label={space.name}>
      <header className="brain-header">
        <div className="brain-identity">
          {choices.length ? (
            <Menu.Root modal={false}>
              <Menu.Trigger
                className="brain-home-link"
                aria-label={t(`横の vault: ${space.name}`, `vault beside: ${space.name}`)}
              >
                {identity}
                <Icon name="chevronDown" size={14} />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner side="bottom" align="start" sideOffset={4}>
                  <Menu.Popup className="menu">
                    {choices.map((choice) => (
                      <Menu.Item key={choice.scopeId} onClick={() => onChoose(choice)}>
                        <BrainTile space={choice} size={16} radius={4} />
                        {choice.name}
                      </Menu.Item>
                    ))}
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          ) : (
            <span className="brain-home-link">{identity}</span>
          )}
          <button
            className="icon-button"
            aria-label={t('横の vault を閉じる', 'Close the vault beside')}
            title={t('閉じる', 'Close')}
            onClick={onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </header>
      <div className="side-sections">
        {layers.map((layer) => (
          <section
            key={layer}
            className={`brain-section ${layer}`}
            aria-label={layerLabel(space, layer)}
          >
            <div className="section-heading">
              <span className="section-toggle">
                <Icon name={layerIcons[layer]} size={15} strokeWidth={1.9} className="layer-icon" />
                <span>{layerLabel(space, layer)}</span>
              </span>
            </div>
            <div className="section-body">
              {layer === 'Knowledge_Base' ? (
                <Tree
                  key={knowledgeFolder(space)}
                  space={space}
                  layer={layer}
                  roots={roots}
                  revision={revision}
                  selected={selected}
                  onOpen={onOpen}
                  {...(!locked && { explorer, writable: true })}
                />
              ) : !contentRoots ? (
                <small className="tree-empty">{t('読み込み中…', 'Loading…')}</small>
              ) : (
                contentRoots.map((root) => (
                  <div key={root.path} className="contents-root">
                    {contentRoots.length > 1 && (
                      <span className="contents-root-name">{root.path}</span>
                    )}
                    {root.blocked ? (
                      <small className="tree-empty">{root.blocked}</small>
                    ) : (
                      <Tree
                        space={space}
                        layer="contents"
                        directory={root.path}
                        revision={revision}
                        selected={selected}
                        connections={connections}
                        onOpen={onOpen}
                        explorer={locked ? undefined : explorer}
                      />
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
});

export const BrainPanel = memo(function BrainPanel({
  space,
  roots,
  mode,
  onModeChange,
  filesDisabled,
  changesDisabled,
  changes,
  selected,
  revision,
  locked,
  daily,
  dirty,
  connections,
  onOpen,
  onRefresh,
  onHome,
  onDaily,
  onNewNote,
  onGraph,
  onConnect,
  onTrash,
  onMaterials,
  onSettings,
  onSearch,
  explorer,
  schema,
  onSplit,
  children,
}: {
  space: Space;
  /** The brain's top-level entries, shared by the three sections; descendants load when opened. */
  roots?: Listing;
  mode: BrainMode;
  onModeChange: (mode: BrainMode) => void;
  /** A Git operation or an unsaved merge keeps the Changes view open. */
  filesDisabled: boolean;
  changesDisabled: boolean;
  /** Changed files in the brain's repository, when known. */
  changes?: number;
  selected?: Document;
  revision: number;
  /** Actions that change the brain wait (a run, Git or a connection is in progress). */
  locked: boolean;
  /** The brain declares a daily note. */
  daily: boolean;
  /** The open note has unsaved edits. */
  dirty: boolean;
  connections: CloudConnection[];
  onOpen: (space: Space, entry: Entry) => void;
  onRefresh: () => void;
  /** Shows the brain's home on the stage. */
  onHome: () => void;
  onDaily: () => void;
  onNewNote: () => void;
  onGraph: () => void;
  onConnect: () => void;
  onTrash: () => void;
  onMaterials: () => void;
  /** Opens the sheet for the brain's name, category, icon and colour. */
  onSettings: () => void;
  onSearch: () => void;
  /** Creating, renaming, moving and deleting files and folders; absent while the vault waits. */
  explorer?: Explorer;
  /**
   * The Schema section as settings; the files behind it stay one toggle away.
   * Absent while the vault agent is off, and the section with it.
   */
  schema?: ReactNode;
  /** Opens another vault beside this one (ADR 038); absent when there is none to open. */
  onSplit?: () => void;
  /** The Changes view, owned by the caller. */
  children?: ReactNode;
}) {
  useLanguage();
  const [folded, setFolded] = useState<Layer[]>([]);
  const [schemaFiles, setSchemaFiles] = useState(false);
  const refs = {
    schema: usePanelRef(),
    Knowledge_Base: usePanelRef(),
    contents: usePanelRef(),
  } satisfies Record<Layer, unknown>;
  const shown = schema === undefined ? editorSections : sections;
  const panelIds = useMemo(() => shown.map((section) => section.layer), [shown]);
  const layout = useDefaultLayout({
    id: 'irori-brain-sections',
    panelIds,
    onlySaveAfterUserInteractions: true,
    storage: layoutStorage,
  });
  const category = categoryName(space.category);
  const contentRoots = roots?.entries.filter(
    (entry) => entry.layer === 'contents' && space.contents.includes(entry.path),
  );
  const actions: Record<Layer, ReactNode> = {
    schema: (
      <>
        <button
          className="section-action"
          aria-pressed={schemaFiles}
          aria-label={t('ファイルとして表示', 'Show as files')}
          title={t('ファイルとして表示', 'Show as files')}
          onClick={() => setSchemaFiles((value) => !value)}
        >
          <Icon name={schemaFiles ? 'sliders' : 'folder'} size={14} />
        </button>
        <SectionAction
          icon="refresh"
          label={t('エクスプローラーを更新', 'Refresh explorer')}
          onClick={onRefresh}
        />
      </>
    ),
    Knowledge_Base: (
      <>
        {daily && (
          <SectionAction
            icon="calendar"
            label={t('今日のノート', "Today's note")}
            disabled={locked}
            onClick={onDaily}
          />
        )}
        <SectionAction
          icon="plus"
          label={t(`${space.name} にノートを作成`, `Create a note in ${space.name}`)}
          disabled={locked}
          onClick={onNewNote}
        />
        <SectionAction
          icon="folderPlus"
          label={t('新しいフォルダ', 'New folder')}
          disabled={locked || !explorer}
          onClick={() => explorer?.create(knowledgeFolder(space), 'folder')}
        />
        <SectionAction
          icon="graph"
          label={t('グラフ', 'Graph')}
          disabled={locked || dirty}
          onClick={onGraph}
        />
      </>
    ),
    contents: (
      <SectionAction
        icon="cloudConnect"
        label={t(`${space.name} のクラウド接続`, `Cloud connection for ${space.name}`)}
        disabled={locked || dirty}
        onClick={onConnect}
      />
    ),
  };
  function body(layer: Layer) {
    if (layer === 'schema' && !schemaFiles) return schema;
    if (layer !== 'contents')
      return (
        <Tree
          // Opened again on the knowledge folder under its new name (ADR 024).
          key={`${layer}:${knowledgeFolder(space)}`}
          space={space}
          layer={layer}
          roots={roots}
          revision={revision}
          selected={selected}
          onOpen={onOpen}
          {...(!locked &&
            (layer === 'Knowledge_Base'
              ? { explorer, writable: true }
              : // Schema's files and folders are only renamed here.
                { explorer: explorer && { ...explorer, actions: ['rename'] as const } }))}
        />
      );
    // Connected folders sit directly under the section; a second contents root names itself.
    if (!contentRoots) return <small className="tree-empty">{t('読み込み中…', 'Loading…')}</small>;
    return contentRoots.map((root) => (
      <div key={root.path} className="contents-root">
        {contentRoots.length > 1 && <span className="contents-root-name">{root.path}</span>}
        {root.blocked ? (
          <small className="tree-empty">{root.blocked}</small>
        ) : (
          <Tree
            space={space}
            layer="contents"
            directory={root.path}
            revision={revision}
            selected={selected}
            connections={connections}
            onOpen={onOpen}
            explorer={locked ? undefined : explorer}
          />
        )}
      </div>
    ));
  }
  return (
    <section className="brain-panel chrome" aria-label={space.name}>
      <header className="brain-header">
        <div className="brain-identity">
          <button className="brain-home-link" onClick={onHome}>
            <BrainTile space={space} size={34} radius={10} />
            <span className="brain-names">
              <strong>{space.name}</strong>
              {space.category && (
                <small>
                  <Icon name={categoryIcon(space.category)} size={12} />
                  {category}
                </small>
              )}
            </span>
          </button>
          {onSplit && (
            <button
              className="icon-button"
              aria-label={t('横に vault を開く', 'Open a vault beside')}
              title={t('横に vault を開く', 'Open a vault beside')}
              onClick={onSplit}
            >
              <Icon name="split" size={16} />
            </button>
          )}
          <Menu.Root modal={false}>
            <Menu.Trigger
              className="icon-button"
              aria-label={t('vault のメニュー', 'vault menu')}
              title={t('vault のメニュー', 'vault menu')}
            >
              <Icon name="more" size={16} />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner side="bottom" align="end" sideOffset={4}>
                <Menu.Popup className="menu">
                  <Menu.Item disabled={locked} onClick={onSettings}>
                    <Icon name="penLine" size={14} />
                    {t('vault の設定', 'vault settings')}
                  </Menu.Item>
                  <Menu.Item disabled={locked} onClick={onMaterials}>
                    <Icon name="archive" size={14} />
                    {t('資料と成果物', 'Materials and outputs')}
                  </Menu.Item>
                  <Menu.Item disabled={locked} onClick={onGraph}>
                    <Icon name="graph" size={14} />
                    {t('グラフ', 'Graph')}
                  </Menu.Item>
                  <Menu.Item disabled={locked} onClick={onConnect}>
                    <Icon name="cloudConnect" size={14} />
                    {t('クラウド接続', 'Cloud connection')}
                  </Menu.Item>
                  <Menu.Item disabled={locked} onClick={onTrash}>
                    <Icon name="trash" size={14} />
                    {t('削除したノートを復元', 'Restore deleted notes')}
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
        <button className="brain-search" onClick={onSearch}>
          <Icon name="search" size={15} />
          <span>{t('検索', 'Search')}</span>
          <kbd>{shortcut('K')}</kbd>
        </button>
        <MagnetTabs
          className="brain-modes"
          label={t('vault の表示', 'vault view')}
          value={mode}
          onValueChange={onModeChange}
          options={[
            {
              value: 'files',
              label: (
                <>
                  <Icon name="layers" size={14} /> {t('ファイル', 'Files')}
                </>
              ),
              disabled: filesDisabled,
            },
            {
              value: 'changes',
              label: (
                <>
                  <Icon name="branch" size={14} /> {t('変更', 'Changes')}
                  {!!changes && <span className="count">{changes}</span>}
                </>
              ),
              disabled: changesDisabled,
            },
          ]}
        />
      </header>
      {mode === 'changes' && <div className="brain-changes">{children}</div>}
      {/* The files stay mounted behind the changes, so open folders stay open. */}
      <div className="brain-files" hidden={mode === 'changes'}>
        <PaneGroup
          className="brain-sections"
          orientation="vertical"
          defaultLayout={layout.defaultLayout}
          onLayoutChanged={layout.onLayoutChanged}
        >
          {shown.map(({ layer, defaultSize }, index) => {
            const open = !folded.includes(layer);
            return [
              index > 0 && (
                <PaneSeparator
                  key={`${layer}-handle`}
                  className="section-handle"
                  aria-label={t(
                    `${layerLabel(space, shown[index - 1].layer)} と ${layerLabel(space, layer)} の境界`,
                    `Border between ${layerLabel(space, shown[index - 1].layer)} and ${layerLabel(space, layer)}`,
                  )}
                />
              ),
              <Pane
                key={layer}
                id={layer}
                className="brain-section-pane"
                panelRef={refs[layer]}
                defaultSize={defaultSize}
                minSize={72}
                collapsible
                collapsedSize={headingHeight}
                onResize={(size) => {
                  const collapsed = size.inPixels <= headingHeight + 1;
                  setFolded((value) =>
                    collapsed === value.includes(layer)
                      ? value
                      : collapsed
                        ? [...value, layer]
                        : value.filter((item) => item !== layer),
                  );
                }}
              >
                <section className={`brain-section ${layer}`} aria-label={layerLabel(space, layer)}>
                  <div className="section-heading">
                    <button
                      className="section-toggle"
                      aria-expanded={open}
                      onClick={() => {
                        const handle = refs[layer].current;
                        if (open) handle?.collapse();
                        else handle?.expand();
                      }}
                    >
                      <Icon name={open ? 'chevronDown' : 'chevron'} size={12} />
                      <Icon
                        name={layerIcons[layer]}
                        size={15}
                        strokeWidth={1.9}
                        className="layer-icon"
                      />
                      <span>{layerLabel(space, layer)}</span>
                    </button>
                    {actions[layer]}
                  </div>
                  {open && <div className="section-body">{body(layer)}</div>}
                </section>
              </Pane>,
            ];
          })}
        </PaneGroup>
      </div>
    </section>
  );
});
