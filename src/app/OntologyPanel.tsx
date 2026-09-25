import { useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Position,
  MarkerType,
  type Node,
  type Edge,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';
import { StageView } from './StageView';
import { Crumbs } from './NoteBar';
import { Icon } from './Icon';
import { useResource } from './useResource';
import { selectSubgraph, type OntologyView } from '../domain/ontology';
import type { GraphIndexStatus } from '../domain/graph-index';
import type { Space } from '../domain/types';
import { t } from '../domain/i18n';

function Graph({
  view,
  onSelect,
}: {
  view: Pick<OntologyView, 'entities' | 'edges'>;
  onSelect: (id: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    // Library layout/DOM IDs are disposable. CSV entity IDs remain unchanged, including punctuation.
    const ids = new Map(view.entities.map((entity, index) => [entity.id, `n${index}`]));
    const graph = new dagre.graphlib.Graph({ multigraph: true })
      .setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 80 })
      .setDefaultEdgeLabel(() => ({}));
    view.entities.forEach((entity) =>
      graph.setNode(ids.get(entity.id)!, { width: 148, height: 42 }),
    );
    view.edges.forEach((edge, index) =>
      graph.setEdge(ids.get(edge.source)!, ids.get(edge.target)!, {}, `e${index}`),
    );
    dagre.layout(graph);
    const nodes: Node[] = view.entities.map((entity) => {
      const { x, y } = graph.node(ids.get(entity.id)!);
      return {
        id: ids.get(entity.id)!,
        position: { x: x - 74, y: y - 21 },
        data: { label: entity.label, entityId: entity.id },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        style: { width: 148, height: 42 },
        ariaLabel: `${entity.label} · ${entity.id}`,
        focusable: true,
      };
    });
    const edges: Edge[] = view.edges.map((edge, index) => ({
      id: `e${index}`,
      source: ids.get(edge.source)!,
      target: ids.get(edge.target)!,
      label: edge.hierarchy ? undefined : edge.label,
      type: 'smoothstep',
      className: edge.hierarchy ? 'hierarchy' : 'relation',
      markerEnd: edge.hierarchy ? undefined : { type: MarkerType.ArrowClosed },
    }));
    return { nodes, edges };
  }, [view]);
  return (
    <div
      className="ontology-graph"
      aria-label={t('オントロジーの階層グラフ', 'Ontology hierarchy graph')}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
        onNodeClick={(_event, node) => onSelect(String(node.data.entityId))}
        onSelectionChange={({ nodes }) => {
          if (nodes.length === 1) onSelect(String(nodes[0].data.entityId));
        }}
        ariaLabelConfig={{
          'controls.zoomIn.ariaLabel': t('拡大', 'Zoom in'),
          'controls.zoomOut.ariaLabel': t('縮小', 'Zoom out'),
          'controls.fitView.ariaLabel': t('全体を表示', 'Fit view'),
        }}
      >
        <Background color="var(--stage-3)" gap={22} size={1.6} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function OntologyContent({
  view,
  table,
  onOpen,
}: {
  view: OntologyView;
  /** The entity list and the CSV files, shown instead of the canvas's foot. */
  table: boolean;
  onOpen: (path: string) => void;
}) {
  const [group, setGroup] = useState(''),
    [root, setRoot] = useState(''),
    [hierarchy, setHierarchy] = useState(false),
    [selectedId, setSelectedId] = useState(''),
    [page, setPage] = useState(0);
  const groups = [
    ...new Set(
      view.entities.map((entity) => entity.group).filter((value): value is string => !!value),
    ),
  ].sort();
  const subgraph = useMemo(
    () => selectSubgraph(view, group, root, hierarchy),
    [view, group, root, hierarchy],
  );
  const selected = subgraph.entities.find((entity) => entity.id === selectedId);
  const current = Math.min(page, Math.max(0, Math.ceil(subgraph.entities.length / 100) - 1));
  const tooLarge = subgraph.entities.length > 250 || subgraph.edges.length > 1000;
  return (
    <>
      <div className="ontology-controls">
        <label>
          {t('サブグラフ', 'Subgraph')}
          <select
            aria-label={t('サブグラフ', 'Subgraph')}
            value={group}
            onChange={(event) => setGroup(event.target.value)}
          >
            <option value="">{t('すべてのグループ', 'All groups')}</option>
            {groups.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          {t('階層の起点', 'Hierarchy root')}
          <select
            aria-label={t('階層の起点', 'Hierarchy root')}
            value={root}
            onChange={(event) => setRoot(event.target.value)}
          >
            <option value="">{t('全階層', 'All hierarchy')}</option>
            {view.entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.label}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={hierarchy}
            onChange={(event) => setHierarchy(event.target.checked)}
          />
          {t('親子関係だけを表示', 'Show only parent-child relations')}
        </label>
        <button
          onClick={() => {
            setGroup('');
            setRoot('');
            setHierarchy(false);
          }}
        >
          {t('絞り込みを解除', 'Clear filters')}
        </button>
        <span
          className="graph-counts"
          role="status"
          title={t(
            'グループ外・階層外の関係は非表示です。',
            'Relations outside the group or hierarchy are hidden.',
          )}
        >
          {t(
            `${subgraph.entities.length} / ${view.entities.length} エンティティ · ${subgraph.edges.length} / ${view.edges.length} 関係`,
            `${subgraph.entities.length} / ${view.entities.length} entities · ${subgraph.edges.length} / ${view.edges.length} relations`,
          )}
        </span>
      </div>
      <div className="graph-canvas">
        {tooLarge ? (
          <p className="hint">
            {t(
              'グラフは 250 エンティティ・1,000 関係まで表示できます。サブグラフや階層で絞り込んでください。下の一覧からもノートを開けます。',
              'The graph can show up to 250 entities and 1,000 relations. Narrow it with a subgraph or hierarchy. Notes can also be opened from the list below.',
            )}
          </p>
        ) : subgraph.entities.length ? (
          <Graph key={`${group}:${root}:${hierarchy}`} view={subgraph} onSelect={setSelectedId} />
        ) : (
          <p>
            {t('この条件に一致するエンティティはありません。', 'No entities match this condition.')}
          </p>
        )}
        <div className="ontology-selection" aria-live="polite">
          {selected ? (
            <>
              <strong>{selected.label}</strong>
              <dl>
                <dt>ID</dt>
                <dd>
                  <code>{selected.id}</code>
                </dd>
                {selected.group && (
                  <>
                    <dt>{t('グループ', 'Group')}</dt>
                    <dd>{selected.group}</dd>
                  </>
                )}
                {selected.parent && (
                  <>
                    <dt>{t('親', 'Parent')}</dt>
                    <dd>
                      {view.entities.find((entity) => entity.id === selected.parent)?.label ??
                        selected.parent}
                    </dd>
                  </>
                )}
                {selected.note && (
                  <>
                    <dt>{t('ノート', 'Note')}</dt>
                    <dd>
                      <code>{selected.note}</code>
                    </dd>
                  </>
                )}
              </dl>
              {selected.note ? (
                <button className="solid-button" onClick={() => onOpen(selected.note!)}>
                  <Icon name="file" size={14} />
                  {t('関連ノートを開く', 'Open related note')}
                </button>
              ) : (
                <span className="muted">
                  {t('関連ノートは未登録です', 'No related note is registered')}
                </span>
              )}
            </>
          ) : (
            <span className="muted">
              {t(
                'グラフのエンティティを選ぶと、ここに詳しく表示します。',
                'Select an entity in the graph to see it here.',
              )}
            </span>
          )}
        </div>
        <div className="graph-legend" aria-hidden="true">
          <span>
            <i className="solid" />
            {t('親子', 'Parent')}
          </span>
          <span>
            <i className="dashed" />
            {t('関係', 'Relation')}
          </span>
        </div>
      </div>
      {table && (
        <div className="graph-table">
          <details className="ontology-list" open>
            <summary>{t('エンティティとノートの一覧', 'List of entities and notes')}</summary>
            <div className="actions">
              <button disabled={!current} onClick={() => setPage(current - 1)}>
                {t('前の 100 件', 'Previous 100')}
              </button>
              <span>
                {current * 100 + (subgraph.entities.length ? 1 : 0)}–
                {Math.min(subgraph.entities.length, (current + 1) * 100)}
              </span>
              <button
                disabled={(current + 1) * 100 >= subgraph.entities.length}
                onClick={() => setPage(current + 1)}
              >
                {t('次の 100 件', 'Next 100')}
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('エンティティ', 'Entity')}</th>
                  <th scope="col">ID</th>
                  <th scope="col">{t('グループ', 'Group')}</th>
                  <th scope="col">{t('ノート', 'Note')}</th>
                </tr>
              </thead>
              <tbody>
                {subgraph.entities.slice(current * 100, (current + 1) * 100).map((entity) => (
                  <tr key={entity.id}>
                    <td>{entity.label}</td>
                    <td>
                      <code>{entity.id}</code>
                    </td>
                    <td>{entity.group}</td>
                    <td>
                      {entity.note ? (
                        <button onClick={() => onOpen(entity.note!)}>{entity.note}</button>
                      ) : (
                        t('未登録', 'Not registered')
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <div className="actions">
            <button onClick={() => onOpen(view.entitiesPath)}>
              {t('エンティティ CSV を開く', 'Open entities CSV')}
            </button>
            {view.relationsPath && (
              <button onClick={() => onOpen(view.relationsPath!)}>
                {t('関係 CSV を開く', 'Open relations CSV')}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** The freshness line for the graph index the KB carries, as the host reports it. */
function describeGraphIndex(status: GraphIndexStatus) {
  const detailJa = [
    status.excluded
      ? `リンク先のページがない・URL などの関係 ${status.excluded} 件は除外しています。`
      : '',
    status.unreadable ? `frontmatter を読めないページが ${status.unreadable} 件あります。` : '',
  ].join('');
  const detailEn = [
    status.excluded
      ? `Excludes ${status.excluded} relations with no linked page or a URL target.`
      : '',
    status.unreadable ? `${status.unreadable} pages have unreadable frontmatter.` : '',
  ].join(' ');
  if (status.current)
    return t(
      `グラフ索引（Knowledge_Base/ontology/）はページと一致しています。${detailJa}`,
      `The graph index (Knowledge_Base/ontology/) matches the pages.${detailEn ? ` ${detailEn}` : ''}`,
    );
  return t(
    `グラフ索引（Knowledge_Base/ontology/）はページと一致しません。更新するとエンティティ +${status.entities.added} / −${status.entities.removed}、` +
      `関係 +${status.relations.added} / −${status.relations.removed}。${detailJa}`,
    `The graph index (Knowledge_Base/ontology/) does not match the pages. Updating would change entities +${status.entities.added} / −${status.entities.removed}, ` +
      `relations +${status.relations.added} / −${status.relations.removed}.${detailEn ? ` ${detailEn}` : ''}`,
  );
}

export function OntologyPanel({
  space,
  revision,
  onClose,
  onOpen,
  onConfigure,
}: {
  space: Space;
  revision: number;
  onClose: () => void;
  onOpen: (path: string) => void;
  onConfigure: () => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const [table, setTable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const { data, error, loading } = useResource(
    () => window.irori.ontology(space.scopeId),
    [space.scopeId, revision, refresh],
  );
  const module = data?.source === 'module';
  // The graph shows first; the freshness check walks every page and arrives when it does.
  const status = useResource(
    () => window.irori.graphIndexStatus(space.scopeId),
    [space.scopeId, revision, refresh],
    { enabled: module || !!error },
  );
  // An unreadable generated table must still be replaceable from its pages.
  // The host's independent declaration check keeps declared CSV pairs protected.
  const repairModule = !!error && !!status.data && !status.data.declared;
  async function generate() {
    setBusy(true);
    setFailure('');
    try {
      await window.irori.updateGraphIndex(space.scopeId);
      setNotice(
        t(
          'Knowledge_Base/ontology/ をコミットすると、ほかの端末でも同じグラフが表示されます。',
          'Committing Knowledge_Base/ontology/ shows the same graph on other devices.',
        ),
      );
      setRefresh((value) => value + 1);
    } catch (error) {
      setFailure(String(error));
    } finally {
      setBusy(false);
    }
  }
  const indexed = module || repairModule;
  return (
    <StageView
      label={t('オントロジー', 'Ontology')}
      className="graph-view"
      busy={busy}
      onClose={onClose}
      crumbs={
        <Crumbs
          space={space}
          items={[{ icon: 'book', label: 'Knowledge', className: 'layer Knowledge_Base' }]}
          here={t('グラフ', 'Graph')}
        />
      }
      actions={
        <>
          {indexed && status.data && (
            <span
              className={`index-state ${status.data.current ? 'current' : ''}`}
              title={describeGraphIndex(status.data)}
            >
              <Icon name={status.data.current ? 'checkCircle' : 'refresh'} size={13} />
              {status.data.current
                ? t('ページと一致', 'Matches the pages')
                : t('ページと不一致', 'Differs from the pages')}
            </span>
          )}
          {indexed && (
            <button className="stage-text-button framed" disabled={busy} onClick={generate}>
              <Icon name="refresh" size={14} />
              {repairModule
                ? t('ページからグラフ索引を再生成', 'Regenerate graph index from pages')
                : t('グラフ索引を更新', 'Update graph index')}
            </button>
          )}
          {data && (
            <button
              className="stage-button"
              aria-label={t('エンティティとノートの一覧', 'List of entities and notes')}
              title={t('エンティティとノートの一覧', 'List of entities and notes')}
              aria-pressed={table}
              onClick={() => setTable((value) => !value)}
            >
              <Icon name="table" size={16} />
            </button>
          )}
          <button
            className="stage-button"
            aria-label={t('再読み込み', 'Reload')}
            title={t('再読み込み', 'Reload')}
            onClick={() => setRefresh((value) => value + 1)}
          >
            <Icon name="refresh" size={16} />
          </button>
          <button
            className="stage-text-button ask-ai"
            title={t(
              '構築・表示設定をエージェントに相談',
              'Ask an agent about building or display settings',
            )}
            onClick={onConfigure}
          >
            <Icon name="sparkles" size={14} />
            {t('AI に相談', 'Ask AI')}
          </button>
        </>
      }
    >
      {indexed && (
        <p className="graph-index-line muted" role="status">
          {status.loading
            ? t(
                'グラフ索引（Knowledge_Base/ontology/）とページの整合性を確認しています…',
                'Checking that the graph index (Knowledge_Base/ontology/) matches the pages…',
              )
            : status.error
              ? t(
                  `グラフ索引を確認できません: ${status.error}`,
                  `Cannot check the graph index: ${status.error}`,
                )
              : status.data && describeGraphIndex(status.data)}
        </p>
      )}
      {notice && <p className="hint">{notice}</p>}
      {failure && (
        <p role="alert" className="error">
          {failure}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading ? (
        <p className="hint">{t('CSV を読み込んでいます…', 'Loading CSV…')}</p>
      ) : data ? (
        <OntologyContent
          key={JSON.stringify(data.revisions)}
          view={data}
          table={table}
          onOpen={onOpen}
        />
      ) : (
        !error && (
          <div className="graph-empty">
            <Icon name="graph" size={32} />
            <p>
              {t(
                'この KB にはオントロジーの表示設定がありません。ページの frontmatter（type・title・relations）からグラフ索引を作成できます。',
                'This KB has no ontology display settings. A graph index can be created from page frontmatter (type, title, relations).',
              )}
            </p>
            <button className="solid-button" disabled={busy} onClick={generate}>
              {t('グラフ索引を作成', 'Create graph index')}
            </button>
          </div>
        )
      )}
    </StageView>
  );
}
