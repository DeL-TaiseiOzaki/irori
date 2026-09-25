import { Fragment, useEffect, useState, type ReactNode } from 'react';
import {
  Group as PaneGroup,
  Panel as Pane,
  Separator as PaneSeparator,
  useDefaultLayout,
  usePanelRef,
} from 'react-resizable-panels';
import type { CloudRoot, Document, Entry, Layer, Space } from '../domain/types';
import { Icon } from './Icon';
import { EntryMenu, type EntryAction } from './CloudEntryActions';
import { layoutStorage } from './device-settings';
import { useResource } from './useResource';
import { t } from '../domain/i18n';

const host = window.irori;
// A function so the category name is read in the language of each render.
function categoryLabel(category: Space['category']) {
  return {
    personal: t('個人', 'Personal'),
    team: t('チーム', 'Team'),
    organization: t('組織', 'Organization'),
  }[category];
}
type Listing = { entries: Entry[]; error?: string };

export function Tree<T extends CloudRoot>({
  space,
  layer,
  directory = '',
  roots,
  revision,
  selected,
  onOpen,
  onCreate,
  onAction,
  readEntries = host.entries,
}: {
  space: T;
  layer: Layer;
  directory?: string;
  roots: Listing;
  revision: number;
  selected?: Document;
  onOpen: (space: T, entry: Entry) => void;
  /** Adds a note to an editable Drive folder. */
  onCreate?: (space: T, entry: Entry) => void;
  /** Renames, moves or deletes an entry of an editable Drive folder. */
  onAction?: (space: T, entry: Entry, action: EntryAction) => void;
  readEntries?: (id: string, path: string) => Promise<Entry[]>;
}) {
  const listing = useResource(
    () => readEntries(space.scopeId, directory),
    [space.scopeId, directory, revision],
    { enabled: !!directory },
  );
  const [expanded, setExpanded] = useState<string[]>(
    directory ? [] : ['Knowledge_Base', ...space.contents],
  );
  const data = directory
    ? listing.data || listing.error
      ? { entries: listing.data ?? [], error: listing.error }
      : undefined
    : roots;
  const entries = data?.entries.filter((entry) => entry.layer === layer) ?? [];
  return (
    <div className="tree">
      {!data && <small className="tree-empty">{t('読み込み中…', 'Loading…')}</small>}
      {data?.error && (
        <small className="tree-error" role="alert">
          {data.error}
        </small>
      )}
      {data && !data.error && !entries.length && (
        <small className="tree-empty">{t('項目がありません', 'No items')}</small>
      )}
      {entries.map((entry) => {
        const isOpen = expanded.includes(entry.path);
        const isSelected = selected?.scopeId === space.scopeId && selected.path === entry.path;
        return (
          <div key={entry.path} className="tree-item">
            <button
              className={`tree-row ${entry.blocked ? 'muted' : ''} ${isSelected ? 'selected' : ''}`}
              aria-current={isSelected ? 'page' : undefined}
              aria-expanded={entry.directory && !entry.blocked ? isOpen : undefined}
              title={entry.blocked ? `${entry.path} · ${entry.blocked}` : entry.path}
              onClick={() =>
                entry.directory && !entry.blocked
                  ? setExpanded((value) =>
                      isOpen ? value.filter((p) => p !== entry.path) : [...value, entry.path],
                    )
                  : onOpen(space, entry)
              }
            >
              {entry.directory && (
                <Icon name="chevron" size={11} className={isOpen ? 'rotated' : ''} />
              )}
              <Icon name={entry.directory ? 'folder' : 'file'} size={14} />
              <span className="filename">{entry.name.replace(/\.md$/, '')}</span>
              {entry.blocked && (
                <span className="badge">
                  {layer === 'contents'
                    ? t('未接続', 'Not connected')
                    : t('利用不可', 'Unavailable')}
                </span>
              )}
            </button>
            {onAction && entry.writable && !entry.connection && !entry.blocked && (
              <EntryMenu entry={entry} onAction={(action) => onAction(space, entry, action)} />
            )}
            {onCreate && entry.directory && entry.writable && !entry.blocked && (
              <button
                className="tree-action"
                aria-label={t(`${entry.name} にノートを追加`, `Add a note to ${entry.name}`)}
                title={t(`${entry.name} にノートを追加`, `Add a note to ${entry.name}`)}
                onClick={() => onCreate(space, entry)}
              >
                <Icon name="plus" size={12} />
              </button>
            )}
            {entry.directory && isOpen && !entry.blocked && (
              <Tree
                space={space}
                layer={layer}
                directory={entry.path}
                roots={roots}
                revision={revision}
                selected={selected}
                onOpen={onOpen}
                onCreate={onCreate}
                onAction={onAction}
                readEntries={readEntries}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ScopeTree({
  space,
  layer,
  roots,
  revision,
  activeId,
  selected,
  locked,
  onSelect,
  onOpen,
  onConnect,
  onNote,
  onCreateIn,
  onEntryAction,
}: {
  space: Space;
  layer: Layer;
  roots?: Listing;
  revision: number;
  activeId?: string;
  selected?: Document;
  locked: boolean;
  onSelect: (space: Space) => void;
  onOpen: (space: Space, entry: Entry) => void;
  onConnect: (space: Space) => void;
  onNote: (space: Space) => void;
  onCreateIn?: (space: Space, entry: Entry) => void;
  onEntryAction?: (space: Space, entry: Entry, action: EntryAction) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <section
      className={`scope-tree ${activeId === space.scopeId ? 'active' : ''}`}
      data-scope-id={space.scopeId}
      aria-label={`${space.name} · ${layer}`}
    >
      <div className="scope-heading">
        <button
          className="scope-toggle"
          aria-label={t(
            `${space.name} の${layer}を${expanded ? '折りたたむ' : '展開'}`,
            `${expanded ? 'Collapse' : 'Expand'} ${layer} for ${space.name}`,
          )}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <Icon name="chevron" size={12} className={expanded ? 'rotated' : ''} />
        </button>
        <button
          className="space-title"
          disabled={locked}
          onClick={() => onSelect(space)}
          title={`${categoryLabel(space.category)} · ${space.root}`}
        >
          <span className="filename">{space.name}</span>
          {space.category === 'organization' && (
            <span className="badge">{t('組織', 'Organization')}</span>
          )}
        </button>
        {layer === 'contents' && (
          <button
            className="scope-action"
            disabled={locked}
            aria-label={t(`${space.name} のクラウド接続`, `Cloud connection for ${space.name}`)}
            onClick={() => onConnect(space)}
          >
            {t('接続', 'Connect')}
          </button>
        )}
        {layer === 'Knowledge_Base' && (
          <button
            className="scope-action"
            disabled={locked}
            aria-label={t(`${space.name} にノートを作成`, `Create a note in ${space.name}`)}
            onClick={() => onNote(space)}
          >
            <Icon name="plus" size={14} />
          </button>
        )}
      </div>
      {expanded &&
        (roots ? (
          <Tree
            space={space}
            layer={layer}
            roots={roots}
            revision={revision}
            selected={selected}
            onOpen={onOpen}
            onCreate={locked ? undefined : onCreateIn}
            onAction={locked ? undefined : onEntryAction}
          />
        ) : (
          <small className="tree-empty">{t('読み込み中…', 'Loading…')}</small>
        ))}
    </section>
  );
}

type PaneId = 'schema' | 'my-kb' | 'team-kb' | 'my-contents' | 'team-contents';
type RowId = 'schema' | 'knowledge' | 'contents';
type PaneSpec = { title: string; subtitle: string; layer: Layer; spaces: Space[] };
type Row = {
  id: RowId;
  panes: PaneId[];
  defaultSize: string;
  minSize: number;
  /** Names the border above this row, shared with the previous row. Read at
   * render time (not module load) so it stays in the current language. */
  handleLabel?: () => string;
  splitLabel?: () => string;
};
// A folded row keeps its heading line (the heading's min-height).
const headingHeight = 38;
// The minimum is a heading and one tree line; anything smaller folds the row.
const rows: Row[] = [
  { id: 'schema', panes: ['schema'], defaultSize: '26%', minSize: 60 },
  {
    id: 'knowledge',
    panes: ['my-kb', 'team-kb'],
    defaultSize: '40%',
    minSize: 60,
    handleLabel: () => t('Schema とナレッジの境界', 'Border between Schema and Knowledge'),
    splitLabel: () =>
      t('個人とチームのナレッジの境界', 'Border between personal and team Knowledge'),
  },
  {
    id: 'contents',
    panes: ['my-contents', 'team-contents'],
    defaultSize: '34%',
    minSize: 60,
    handleLabel: () => t('ナレッジと資料の境界', 'Border between Knowledge and Materials'),
    splitLabel: () => t('個人とチームの資料の境界', 'Border between personal and team Materials'),
  },
];
export function LayerExplorer({
  spaces,
  activeId,
  selected,
  revision,
  locked,
  onSelect,
  onOpen,
  onConnect,
  onNote,
  onCreateIn,
  onEntryAction,
  onRefresh,
}: {
  spaces: Space[];
  activeId?: string;
  selected?: Document;
  revision: number;
  locked: boolean;
  onSelect: (space: Space) => void;
  onOpen: (space: Space, entry: Entry) => void;
  onConnect: (space: Space) => void;
  onNote: (space: Space) => void;
  /** Adds a note to an editable Drive folder in a KB's materials. */
  onCreateIn?: (space: Space, entry: Entry) => void;
  /** Renames, moves or deletes an entry of an editable Drive folder in a KB's materials. */
  onEntryAction?: (space: Space, entry: Entry, action: EntryAction) => void;
  onRefresh: () => void;
}) {
  const [roots, setRoots] = useState<Record<string, Listing>>({});
  const [collapsed, setCollapsed] = useState<PaneId[]>([]);
  const scopeKey = spaces.map((space) => space.scopeId).join(':');
  useEffect(() => {
    let live = true;
    // Root listings are shared by all five panes; descendants remain lazy.
    for (const space of spaces)
      void host
        .entries(space.scopeId, '')
        .then((entries) => {
          if (live) setRoots((current) => ({ ...current, [space.scopeId]: { entries } }));
        })
        .catch((error) => {
          if (live)
            setRoots((current) => ({
              ...current,
              [space.scopeId]: { entries: [], error: String(error) },
            }));
        });
    return () => {
      live = false;
    };
  }, [scopeKey, revision]);
  const panes: Record<PaneId, PaneSpec> = {
    schema: {
      title: 'Schema',
      subtitle: t('設定・エージェントの指示', 'Settings and agent instructions'),
      layer: 'schema',
      spaces,
    },
    'my-kb': {
      title: t('個人のナレッジ', 'Personal Knowledge'),
      subtitle: t('個人のナレッジ', 'Personal Knowledge'),
      layer: 'Knowledge_Base',
      spaces: spaces.filter((s) => s.category === 'personal'),
    },
    'team-kb': {
      title: t('チームのナレッジ', 'Team Knowledge'),
      subtitle: t('チーム・組織のナレッジ', 'Team and organization Knowledge'),
      layer: 'Knowledge_Base',
      spaces: spaces.filter((s) => s.category !== 'personal'),
    },
    'my-contents': {
      title: t('個人の資料', 'Personal Materials'),
      subtitle: t('個人の資料・クラウド', 'Personal Materials and cloud'),
      layer: 'contents',
      spaces: spaces.filter((s) => s.category === 'personal'),
    },
    'team-contents': {
      title: t('チームの資料', 'Team Materials'),
      subtitle: t('チーム・組織の資料', 'Team and organization Materials'),
      layer: 'contents',
      spaces: spaces.filter((s) => s.category !== 'personal'),
    },
  };
  const rowRefs = {
    schema: usePanelRef(),
    knowledge: usePanelRef(),
    contents: usePanelRef(),
  } satisfies Record<RowId, unknown>;
  // A row folds to its headings when every pane in it is folded; that is also
  // what dragging a row below its minimum means, so both stay one state.
  function applyFolds() {
    for (const row of rows) {
      const handle = rowRefs[row.id].current;
      if (!handle || !row.panes.length) continue;
      const folded = row.panes.every((id) => collapsed.includes(id));
      if (folded && !handle.isCollapsed()) handle.collapse();
      if (!folded && handle.isCollapsed()) handle.expand();
    }
  }
  useEffect(applyFolds, [collapsed]);
  // Only a drag folds or unfolds panes: a layout pass at mount or on a window
  // resize can squeeze a row below its minimum without the reader asking.
  function syncRows() {
    setCollapsed((value) => {
      let next = value;
      for (const row of rows) {
        const handle = rowRefs[row.id].current;
        if (!handle || !row.panes.length) continue;
        const folded = handle.isCollapsed();
        const all = row.panes.every((id) => next.includes(id));
        if (folded && !all) next = [...next.filter((id) => !row.panes.includes(id)), ...row.panes];
        if (!folded && all) next = next.filter((id) => !row.panes.includes(id));
      }
      return next;
    });
  }
  const rowLayout = useDefaultLayout({
    id: 'irori-explorer-rows',
    panelIds: rows.map((row) => row.id),
    onlySaveAfterUserInteractions: true,
    storage: layoutStorage,
  });
  const renderPane = (id: PaneId) => {
    const pane = panes[id];
    return (
      <section className={`layer-pane ${id}`} aria-label={pane.title}>
        <div className="layer-heading">
          <h2>
            <button
              aria-expanded={!collapsed.includes(id)}
              onClick={() =>
                setCollapsed((value) =>
                  value.includes(id) ? value.filter((item) => item !== id) : [...value, id],
                )
              }
            >
              <Icon
                name={
                  pane.layer === 'schema' ? 'schema' : pane.layer === 'contents' ? 'cloud' : 'book'
                }
                size={14}
              />
              <span>{pane.title}</span>
              <Icon name="chevron" size={10} className={collapsed.includes(id) ? '' : 'rotated'} />
            </button>
          </h2>
          {id === 'schema' && (
            <button
              className="scope-action"
              aria-label={t('エクスプローラーを更新', 'Refresh explorer')}
              onClick={onRefresh}
            >
              <Icon name="refresh" size={14} />
            </button>
          )}
        </div>
        {!collapsed.includes(id) && (
          <div className="layer-body">
            <p className="layer-subtitle">{pane.subtitle}</p>
            {pane.spaces.length ? (
              pane.spaces.map((space) => (
                <ScopeTree
                  key={space.scopeId}
                  space={space}
                  layer={pane.layer}
                  roots={roots[space.scopeId]}
                  revision={revision}
                  activeId={activeId}
                  selected={selected}
                  locked={locked}
                  onSelect={onSelect}
                  onOpen={onOpen}
                  onConnect={onConnect}
                  onNote={onNote}
                  onCreateIn={onCreateIn}
                  onEntryAction={onEntryAction}
                />
              ))
            ) : (
              <p className="tree-empty">
                {t(
                  'スペースが未登録です。下の「スペースを追加」から登録できます。',
                  'No space is registered yet. Register one from "Add space" below.',
                )}
              </p>
            )}
          </div>
        )}
      </section>
    );
  };
  return (
    <nav className="layer-explorer" aria-label={t('レイヤー別エクスプローラー', 'Layer explorer')}>
      <PaneGroup
        className="layer-rows"
        orientation="vertical"
        defaultLayout={rowLayout.defaultLayout}
        onLayoutChanged={(layout, meta) => {
          rowLayout.onLayoutChanged(layout, meta);
          if (meta?.isUserInteraction) syncRows();
          else applyFolds();
        }}
      >
        {rows.map((row, index) => (
          <Fragment key={row.id}>
            {index > 0 && (
              <PaneSeparator
                className="pane-handle layer-handle"
                aria-label={row.handleLabel?.()}
              />
            )}
            <Pane
              id={row.id}
              className="layer-row"
              panelRef={rowRefs[row.id]}
              defaultSize={row.defaultSize}
              minSize={row.minSize}
              collapsible={row.panes.length > 0}
              collapsedSize={headingHeight}
            >
              {row.panes.length === 1 ? (
                renderPane(row.panes[0])
              ) : (
                <SplitRow row={row} render={renderPane} />
              )}
            </Pane>
          </Fragment>
        ))}
      </PaneGroup>
    </nav>
  );
}

/** Personal and team panes share a row whose split the reader moves. */
function SplitRow({ row, render }: { row: Row; render: (id: PaneId) => ReactNode }) {
  const layout = useDefaultLayout({
    id: `irori-explorer-${row.id}`,
    panelIds: row.panes,
    onlySaveAfterUserInteractions: true,
    storage: layoutStorage,
  });
  return (
    <PaneGroup
      className="layer-split"
      orientation="horizontal"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
    >
      {row.panes.map((id, index) => (
        <Fragment key={id}>
          {index > 0 && (
            <PaneSeparator className="pane-handle layer-handle" aria-label={row.splitLabel?.()} />
          )}
          <Pane id={id} className="layer-cell" minSize={96}>
            {render(id)}
          </Pane>
        </Fragment>
      ))}
    </PaneGroup>
  );
}
