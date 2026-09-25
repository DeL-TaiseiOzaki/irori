import { useState, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import {
  Group as PaneGroup,
  Panel as Pane,
  Separator as PaneSeparator,
  useDefaultLayout,
  usePanelRef,
} from 'react-resizable-panels';
import type { CloudConnection, Document, Entry, Layer, Space } from '../domain/types';
import { categoryName } from '../domain/brains';
import { t } from '../domain/i18n';
import { BrainTile } from './BrainTile';
import { EntryMenu, type EntryAction } from './CloudEntryActions';
import { Icon, type IconName } from './Icon';
import { MagnetTabs } from './obsidian/MagnetTabs';
import { layoutStorage } from './device-settings';
import { shortcut } from './shortcuts';
import { useResource } from './useResource';
import './brain-panel.css';

const host = window.irori;
export type Listing = { entries: Entry[]; error?: string };
export type BrainMode = 'files' | 'changes';

const layerIcons: Record<Layer, IconName> = {
  schema: 'schema',
  Knowledge_Base: 'book',
  contents: 'cloud',
};
export const layerNames: Record<Layer, string> = {
  schema: 'Schema',
  Knowledge_Base: 'Knowledge',
  contents: 'Contents',
};
const categoryIcons = { personal: 'user', team: 'users', organization: 'building' } as const;

/** What a Drive folder shows beside its name: changes on their way up, or read-only. */
function DriveBadge({ connection }: { connection?: CloudConnection }) {
  if (!connection) return null;
  if (connection.pending)
    return (
      <span
        className="drive-badge pending"
        title={t(
          `Google Drive へ送信待ち ${connection.pending} 件`,
          `${connection.pending} waiting to upload to Google Drive`,
        )}
      >
        <span className="drive-badge-arrow">
          <Icon name="up" size={11} strokeWidth={2.4} />
        </span>
        {connection.pending}
      </span>
    );
  if (connection.state === 'mounted' && !connection.writable)
    return (
      <span className="drive-badge" title={t('読み取り専用', 'Read-only')}>
        <Icon name="lock" size={12} strokeWidth={2} />
      </span>
    );
  return null;
}

export function Tree({
  space,
  layer,
  directory = '',
  depth = 0,
  roots,
  revision,
  selected,
  connections = [],
  onOpen,
  onCreate,
  onAction,
}: {
  space: Space;
  layer: Layer;
  directory?: string;
  depth?: number;
  roots?: Listing;
  revision: number;
  selected?: Document;
  connections?: CloudConnection[];
  onOpen: (space: Space, entry: Entry) => void;
  /** Adds a note to an editable Drive folder. */
  onCreate?: (space: Space, entry: Entry) => void;
  /** Renames, moves or deletes an entry of an editable Drive folder. */
  onAction?: (space: Space, entry: Entry, action: EntryAction) => void;
}) {
  const listing = useResource(
    () => host.entries(space.scopeId, directory),
    [space.scopeId, directory],
    {
      enabled: !!directory && !roots,
      refresh: revision,
    },
  );
  const [expanded, setExpanded] = useState<string[]>(directory ? [] : ['Knowledge_Base']);
  const data =
    roots ??
    (listing.data || listing.error
      ? { entries: listing.data ?? [], error: listing.error }
      : undefined);
  const entries = data?.entries.filter((entry) => entry.layer === layer) ?? [];
  const indent = { paddingLeft: 10 + depth * 14 };
  return (
    <div className="tree" role={depth ? 'group' : undefined}>
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
            ? t(
                'Google Drive のフォルダを接続すると、ここに表示されます。',
                'Connect a Google Drive folder to see it here.',
              )
            : t('項目がありません', 'No items')}
        </small>
      )}
      {entries.map((entry) => {
        const isOpen = expanded.includes(entry.path);
        const isSelected = selected?.scopeId === space.scopeId && selected.path === entry.path;
        const connection = entry.connection
          ? connections.find((item) => `${item.contentsRoot}/${item.name}` === entry.path)
          : undefined;
        return (
          <div key={entry.path} className="tree-item">
            <button
              className={`tree-row ${entry.blocked ? 'muted' : ''} ${isSelected ? 'selected' : ''}`}
              style={indent}
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
                name={entry.connection ? 'cloud' : entry.directory ? 'folder' : 'file'}
                size={15}
                className={`tree-icon ${entry.connection ? 'drive' : ''}`}
              />
              <span className="filename">{entry.name.replace(/\.md$/, '')}</span>
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
                depth={depth + 1}
                revision={revision}
                selected={selected}
                connections={connections}
                onOpen={onOpen}
                onCreate={onCreate}
                onAction={onAction}
              />
            )}
          </div>
        );
      })}
    </div>
  );
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
// A folded section keeps its heading line.
const headingHeight = 36;

/** One brain: its Schema, Knowledge and Contents, and its changes. */
export function BrainPanel({
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
  onSearch,
  onCreateIn,
  onEntryAction,
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
  onSearch: () => void;
  onCreateIn: (space: Space, entry: Entry) => void;
  onEntryAction: (space: Space, entry: Entry, action: EntryAction) => void;
  /** The Changes view, owned by the caller. */
  children?: ReactNode;
}) {
  const [folded, setFolded] = useState<Layer[]>([]);
  const refs = {
    schema: usePanelRef(),
    Knowledge_Base: usePanelRef(),
    contents: usePanelRef(),
  } satisfies Record<Layer, unknown>;
  const layout = useDefaultLayout({
    id: 'irori-brain-sections',
    panelIds: sections.map((section) => section.layer),
    onlySaveAfterUserInteractions: true,
    storage: layoutStorage,
  });
  const category = categoryName(space.category);
  const contentRoots = roots?.entries.filter(
    (entry) => entry.layer === 'contents' && space.contents.includes(entry.path),
  );
  const actions: Record<Layer, ReactNode> = {
    schema: (
      <SectionAction
        icon="refresh"
        label={t('エクスプローラーを更新', 'Refresh explorer')}
        onClick={onRefresh}
      />
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
          icon="graph"
          label={t('グラフ（オントロジー）', 'Graph (ontology)')}
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
    if (layer !== 'contents')
      return (
        <Tree
          space={space}
          layer={layer}
          roots={roots}
          revision={revision}
          selected={selected}
          onOpen={onOpen}
        />
      );
    // Drive folders sit directly under the section; a second contents root names itself.
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
            onCreate={locked ? undefined : onCreateIn}
            onAction={locked ? undefined : onEntryAction}
          />
        )}
      </div>
    ));
  }
  return (
    <section className="brain-panel chrome" aria-label={space.name}>
      <header className="brain-header">
        <div className="brain-identity">
          <button
            className="brain-home-link"
            title={t(
              `Brain のホーム · ${category} · ${space.root}`,
              `The brain's home · ${category} · ${space.root}`,
            )}
            onClick={onHome}
          >
            <BrainTile space={space} size={34} radius={10} />
            <span className="brain-names">
              <strong>{space.name}</strong>
              <small>
                <Icon name={categoryIcons[space.category]} size={12} />
                {category}
              </small>
            </span>
          </button>
          <Menu.Root modal={false}>
            <Menu.Trigger
              className="icon-button"
              aria-label={t('Brain のメニュー', 'Brain menu')}
              title={t('Brain のメニュー', 'Brain menu')}
            >
              <Icon name="more" size={16} />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner side="bottom" align="end" sideOffset={4}>
                <Menu.Popup className="menu">
                  <Menu.Item disabled={locked} onClick={onMaterials}>
                    <Icon name="archive" size={14} />
                    {t('資料と成果物', 'Materials and outputs')}
                  </Menu.Item>
                  <Menu.Item disabled={locked} onClick={onGraph}>
                    <Icon name="graph" size={14} />
                    {t('グラフ（オントロジー）', 'Graph (ontology)')}
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
          label={t('Brain の表示', 'Brain view')}
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
          {sections.map(({ layer, defaultSize }, index) => {
            const open = !folded.includes(layer);
            return [
              index > 0 && (
                <PaneSeparator
                  key={`${layer}-handle`}
                  className="section-handle"
                  aria-label={t(
                    `${layerNames[sections[index - 1].layer]} と ${layerNames[layer]} の境界`,
                    `Border between ${layerNames[sections[index - 1].layer]} and ${layerNames[layer]}`,
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
                <section className={`brain-section ${layer}`} aria-label={layerNames[layer]}>
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
                      <span>{layerNames[layer]}</span>
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
}
