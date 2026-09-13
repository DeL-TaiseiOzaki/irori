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
import { Dialog } from './Dialog';
import { useResource } from './useResource';
import { selectSubgraph, type OntologyView } from '../domain/ontology';
import type { Space } from '../domain/types';

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
      .setGraph({ rankdir: 'TB', nodesep: 35, ranksep: 75 })
      .setDefaultEdgeLabel(() => ({}));
    view.entities.forEach((entity) =>
      graph.setNode(ids.get(entity.id)!, { width: 184, height: 58 }),
    );
    view.edges.forEach((edge, index) =>
      graph.setEdge(ids.get(edge.source)!, ids.get(edge.target)!, {}, `e${index}`),
    );
    dagre.layout(graph);
    const nodes: Node[] = view.entities.map((entity) => {
      const { x, y } = graph.node(ids.get(entity.id)!);
      return {
        id: ids.get(entity.id)!,
        position: { x: x - 92, y: y - 29 },
        data: { label: entity.label, entityId: entity.id },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        style: { width: 184, height: 58 },
        ariaLabel: `${entity.label} · ${entity.id}`,
        focusable: true,
      };
    });
    const edges: Edge[] = view.edges.map((edge, index) => ({
      id: `e${index}`,
      source: ids.get(edge.source)!,
      target: ids.get(edge.target)!,
      label: edge.label,
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed },
      style: {
        stroke: edge.hierarchy ? '#956021' : '#626c76',
        strokeDasharray: edge.hierarchy ? undefined : '5 3',
      },
    }));
    return { nodes, edges };
  }, [view]);
  return (
    <div className="ontology-graph" aria-label="オントロジーの階層グラフ">
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
          'controls.zoomIn.ariaLabel': '拡大',
          'controls.zoomOut.ariaLabel': '縮小',
          'controls.fitView.ariaLabel': '全体を表示',
        }}
      >
        <Background color="#d1d4d5" gap={22} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function OntologyContent({ view, onOpen }: { view: OntologyView; onOpen: (path: string) => void }) {
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
          サブグラフ
          <select
            aria-label="サブグラフ"
            value={group}
            onChange={(event) => setGroup(event.target.value)}
          >
            <option value="">すべてのグループ</option>
            {groups.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          階層の起点
          <select
            aria-label="階層の起点"
            value={root}
            onChange={(event) => setRoot(event.target.value)}
          >
            <option value="">全階層</option>
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
          親子関係だけを表示
        </label>
        <button
          onClick={() => {
            setGroup('');
            setRoot('');
            setHierarchy(false);
          }}
        >
          絞り込みを解除
        </button>
      </div>
      <p className="muted" role="status">
        {subgraph.entities.length} / {view.entities.length} エンティティ · {subgraph.edges.length} /{' '}
        {view.edges.length} 関係を表示。グループ外・階層外の関係は非表示です。
      </p>
      {tooLarge ? (
        <p className="hint">
          グラフは 250 エンティティ・1,000
          関係まで表示できます。サブグラフや階層で絞り込んでください。下の一覧からもノートを開けます。
        </p>
      ) : subgraph.entities.length ? (
        <Graph key={`${group}:${root}:${hierarchy}`} view={subgraph} onSelect={setSelectedId} />
      ) : (
        <p>この条件に一致するエンティティはありません。</p>
      )}
      <div className="ontology-selection" aria-live="polite">
        {selected ? (
          <>
            <strong>{selected.label}</strong>
            <code>{selected.id}</code>
            {selected.note ? (
              <button onClick={() => onOpen(selected.note!)}>関連ノートを開く</button>
            ) : (
              <span className="muted">関連ノートは未登録です</span>
            )}
          </>
        ) : (
          <span className="muted">
            グラフのエンティティを選ぶか、下の一覧からノートを開けます。
          </span>
        )}
      </div>
      <details className="ontology-list" open>
        <summary>エンティティとノートの一覧</summary>
        <div className="actions">
          <button disabled={!current} onClick={() => setPage(current - 1)}>
            前の 100 件
          </button>
          <span>
            {current * 100 + (subgraph.entities.length ? 1 : 0)}–
            {Math.min(subgraph.entities.length, (current + 1) * 100)}
          </span>
          <button
            disabled={(current + 1) * 100 >= subgraph.entities.length}
            onClick={() => setPage(current + 1)}
          >
            次の 100 件
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th scope="col">エンティティ</th>
              <th scope="col">ID</th>
              <th scope="col">グループ</th>
              <th scope="col">ノート</th>
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
                    '未登録'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <div className="actions">
        <button onClick={() => onOpen(view.entitiesPath)}>エンティティ CSV を開く</button>
        {view.relationsPath && (
          <button onClick={() => onOpen(view.relationsPath!)}>関係 CSV を開く</button>
        )}
      </div>
    </>
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
  const { data, error, loading } = useResource(
    () => window.irori.ontology(space.scopeId),
    [space.scopeId, revision, refresh],
  );
  return (
    <Dialog label="オントロジー" onClose={onClose}>
      <section className="modal ontology-panel">
        <div className="actions">
          <h2>{space.name} のオントロジー</h2>
          <button onClick={() => setRefresh((value) => value + 1)}>再読み込み</button>
          <button onClick={onClose}>閉じる</button>
        </div>
        <p>CSV の保存内容を表示します。構築・整理は CLI エージェントと協調して進められます。</p>
        <button onClick={onConfigure}>構築・表示設定をエージェントに相談</button>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {loading ? (
          <p>CSV を読み込んでいます…</p>
        ) : data ? (
          <OntologyContent key={JSON.stringify(data.revisions)} view={data} onOpen={onOpen} />
        ) : (
          !error && (
            <p>
              この KB にはオントロジーの表示設定がありません。CLI エージェントに CSV
              の作成と表示設定を依頼できます。
            </p>
          )
        )}
      </section>
    </Dialog>
  );
}
