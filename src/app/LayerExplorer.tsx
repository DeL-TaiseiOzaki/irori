import { useEffect, useState } from 'react';
import type { CloudRoot, Document, Entry, Layer, Space } from '../domain/types';
import { Icon } from './Icon';
import { useResource } from './useResource';

const host = window.irori;
const categories = { personal: '個人', team: 'チーム', organization: '組織' };
type Listing = { entries: Entry[]; error?: string };

export function Tree<T extends CloudRoot>({
  space,
  layer,
  directory = '',
  roots,
  revision,
  selected,
  onOpen,
  readEntries = host.entries,
}: {
  space: T;
  layer: Layer;
  directory?: string;
  roots: Listing;
  revision: number;
  selected?: Document;
  onOpen: (space: T, entry: Entry) => void;
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
      {!data && <small className="tree-empty">読み込み中…</small>}
      {data?.error && (
        <small className="tree-error" role="alert">
          {data.error}
        </small>
      )}
      {data && !data.error && !entries.length && (
        <small className="tree-empty">項目がありません</small>
      )}
      {entries.map((entry) => {
        const isOpen = expanded.includes(entry.path);
        const isSelected = selected?.scopeId === space.scopeId && selected.path === entry.path;
        return (
          <div key={entry.path}>
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
                <span className="badge">{layer === 'contents' ? '未接続' : '利用不可'}</span>
              )}
            </button>
            {entry.directory && isOpen && !entry.blocked && (
              <Tree
                space={space}
                layer={layer}
                directory={entry.path}
                roots={roots}
                revision={revision}
                selected={selected}
                onOpen={onOpen}
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
          aria-label={`${space.name} の${layer}を${expanded ? '折りたたむ' : '展開'}`}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <Icon name="chevron" size={12} className={expanded ? 'rotated' : ''} />
        </button>
        <button
          className="space-title"
          disabled={locked}
          onClick={() => onSelect(space)}
          title={`${categories[space.category]} · ${space.root}`}
        >
          <span className="filename">{space.name}</span>
          {space.category === 'organization' && <span className="badge">組織</span>}
        </button>
        {layer === 'contents' && (
          <button
            className="scope-action"
            disabled={locked}
            aria-label={`${space.name} のクラウド接続`}
            onClick={() => onConnect(space)}
          >
            接続
          </button>
        )}
        {layer === 'Knowledge_Base' && (
          <button
            className="scope-action"
            disabled={locked}
            aria-label={`${space.name} にノートを作成`}
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
          />
        ) : (
          <small className="tree-empty">読み込み中…</small>
        ))}
    </section>
  );
}

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
  onRefresh: () => void;
}) {
  const [roots, setRoots] = useState<Record<string, Listing>>({});
  const [collapsed, setCollapsed] = useState<string[]>([]);
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
  const panes: { id: string; title: string; subtitle: string; layer: Layer; spaces: Space[] }[] = [
    {
      id: 'schema',
      title: 'Schema',
      subtitle: '設定・エージェントの指示',
      layer: 'schema',
      spaces,
    },
    {
      id: 'my-kb',
      title: '個人のナレッジ',
      subtitle: '個人のナレッジ',
      layer: 'Knowledge_Base',
      spaces: spaces.filter((s) => s.category === 'personal'),
    },
    {
      id: 'team-kb',
      title: 'チームのナレッジ',
      subtitle: 'チーム・組織のナレッジ',
      layer: 'Knowledge_Base',
      spaces: spaces.filter((s) => s.category !== 'personal'),
    },
    {
      id: 'my-contents',
      title: '個人の資料',
      subtitle: '個人の資料・クラウド',
      layer: 'contents',
      spaces: spaces.filter((s) => s.category === 'personal'),
    },
    {
      id: 'team-contents',
      title: 'チームの資料',
      subtitle: 'チーム・組織の資料',
      layer: 'contents',
      spaces: spaces.filter((s) => s.category !== 'personal'),
    },
  ];
  return (
    <nav
      className="layer-explorer"
      aria-label="レイヤー別エクスプローラー"
      style={{
        gridTemplateRows: [
          collapsed.includes('schema') ? '38px' : 'minmax(130px, 0.8fr)',
          ['my-kb', 'team-kb'].every((id) => collapsed.includes(id))
            ? '38px'
            : 'minmax(160px, 1.2fr)',
          ['my-contents', 'team-contents'].every((id) => collapsed.includes(id))
            ? '38px'
            : 'minmax(145px, 1fr)',
        ].join(' '),
      }}
    >
      {panes.map((pane) => (
        <section key={pane.id} className={`layer-pane ${pane.id}`} aria-label={pane.title}>
          <div className="layer-heading">
            <h2>
              <button
                aria-expanded={!collapsed.includes(pane.id)}
                onClick={() =>
                  setCollapsed((value) =>
                    value.includes(pane.id)
                      ? value.filter((id) => id !== pane.id)
                      : [...value, pane.id],
                  )
                }
              >
                <Icon
                  name={
                    pane.layer === 'schema'
                      ? 'schema'
                      : pane.layer === 'contents'
                        ? 'cloud'
                        : 'book'
                  }
                  size={14}
                />
                <span>{pane.title}</span>
                <Icon
                  name="chevron"
                  size={10}
                  className={collapsed.includes(pane.id) ? '' : 'rotated'}
                />
              </button>
            </h2>
            {pane.id === 'schema' && (
              <button
                className="scope-action"
                aria-label="エクスプローラーを更新"
                onClick={onRefresh}
              >
                <Icon name="refresh" size={14} />
              </button>
            )}
          </div>
          {!collapsed.includes(pane.id) && (
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
                  />
                ))
              ) : (
                <p className="tree-empty">
                  スペースが未登録です。下の「スペースを追加」から登録できます。
                </p>
              )}
            </div>
          )}
        </section>
      ))}
    </nav>
  );
}
