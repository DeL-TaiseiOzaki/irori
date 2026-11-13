import { useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  BaseEdge,
  Controls,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';
import { StageView } from './StageView';
import { Crumbs } from './NoteBar';
import { Icon } from './Icon';
import { useResource } from './useResource';
import type { FolderIndexStatus } from '../domain/bundle';
import type {
  OntologyFinding,
  OntologyRelation,
  OntologyReport,
  UndeclaredName,
} from '../domain/ontology';
import { layerLabel } from '../domain/layers';
import { propertyDeclarationFile } from '../domain/properties';
import type { Space } from '../domain/types';
import { t } from '../domain/i18n';
import { useAction } from './useAction';

/** The stand-ins a relation's ends take when it names no type. */
const anyFrom = '\0from';
const anyTo = '\0to';
const url = '\0url';

const nodeWidth = 148;
const nodeHeight = 42;

/** A relation from a type to itself: an arc round the node's right side, from its foot back to its head. */
function LoopEdge({ sourceX, sourceY, targetX, targetY, label, markerEnd }: EdgeProps) {
  const out = nodeWidth / 2 + 64;
  const path = `M ${sourceX} ${sourceY} C ${sourceX + out} ${sourceY + 34}, ${targetX + out} ${targetY - 34}, ${targetX} ${targetY}`;
  return (
    <BaseEdge
      path={path}
      label={label}
      labelX={sourceX + out * 0.74}
      labelY={(sourceY + targetY) / 2}
      markerEnd={markerEnd}
    />
  );
}
const edgeTypes = { loop: LoopEdge };

/**
 * The declaration as a diagram: a node for each type, and a line for each
 * relation from the types that may carry it to the types it points at. The
 * pages are not drawn: the ontology is what kinds there are, not what there is.
 */
function Diagram({ report }: { report: OntologyReport }) {
  const { nodes, edges } = useMemo(() => {
    const declared = new Map(report.types.map((type) => [type.name, type]));
    // Lines between the same two ends share one label.
    const lines = new Map<string, { from: string; to: string; names: string[] }>();
    for (const relation of report.relations) {
      const sources = relation.from === 'any' ? [anyFrom] : relation.from;
      const targets =
        relation.to === 'url' ? [url] : relation.to === 'page' ? [anyTo] : relation.to;
      for (const from of sources)
        for (const to of targets) {
          const key = `${from}\0\0${to}`;
          const line = lines.get(key);
          if (line) line.names.push(relation.name);
          else lines.set(key, { from, to, names: [relation.name] });
        }
    }
    const ends = new Set([...lines.values()].flatMap(({ from, to }) => [from, to]));
    const names = [...new Set([...declared.keys(), ...ends])];
    const ids = new Map(names.map((name, index) => [name, `n${index}`]));
    const graph = new dagre.graphlib.Graph({ multigraph: true })
      .setGraph({ rankdir: 'TB', nodesep: 34, ranksep: 62 })
      .setDefaultEdgeLabel(() => ({}));
    names.forEach((name) =>
      graph.setNode(ids.get(name)!, { width: nodeWidth, height: nodeHeight }),
    );
    [...lines.values()].forEach(({ from, to }, index) => {
      if (from !== to) graph.setEdge(ids.get(from)!, ids.get(to)!, {}, `e${index}`);
    });
    dagre.layout(graph);
    const stand = (name: string) =>
      name === anyFrom
        ? t('どのページからも', 'From any page')
        : name === anyTo
          ? t('どのページへも', 'To any page')
          : name === url
            ? 'URL'
            : undefined;
    const nodes: Node[] = names.map((name) => {
      const { x, y } = graph.node(ids.get(name)!);
      const type = declared.get(name);
      const label = stand(name) ?? name;
      return {
        id: ids.get(name)!,
        position: { x: x - nodeWidth / 2, y: y - nodeHeight / 2 },
        data: {
          label: type ? (
            <>
              <strong title={type.description}>{name}</strong>
              <span>{type.pages.toLocaleString('en-US')}</span>
            </>
          ) : (
            label
          ),
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        style: { width: nodeWidth, height: nodeHeight },
        className: type ? 'type' : stand(name) ? 'stand-in' : 'undeclared',
        ariaLabel: type
          ? t(`${name}、${type.pages} ページ`, `${name}, ${type.pages} pages`)
          : label,
        focusable: false,
        selectable: false,
      };
    });
    const edges: Edge[] = [...lines.values()].map(({ from, to, names }, index) => ({
      id: `e${index}`,
      source: ids.get(from)!,
      target: ids.get(to)!,
      label: names.join(', '),
      type: from === to ? 'loop' : 'smoothstep',
      className: 'relation',
      markerEnd: { type: MarkerType.ArrowClosed },
    }));
    return { nodes, edges };
  }, [report]);
  return (
    <div
      className="ontology-graph"
      aria-label={t('種類と関係の図', 'Diagram of types and relations')}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        edgeTypes={edgeTypes}
        fitView
        // A small diagram shows at its own size instead of filling the view.
        fitViewOptions={{ maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        ariaLabelConfig={{
          'controls.zoomIn.ariaLabel': t('拡大', 'Zoom in'),
          'controls.zoomOut.ariaLabel': t('縮小', 'Zoom out'),
          'controls.fitView.ariaLabel': t('全体を表示', 'Fit view'),
        }}
      >
        <Background color="var(--stage-3)" gap={22} size={1.6} />
        <Controls showInteractive={false} fitViewOptions={{ maxZoom: 1 }} />
      </ReactFlow>
    </div>
  );
}

const quoted = (name: string) => t(`「${name}」`, `"${name}"`);
const instead = (use: string | undefined) =>
  use ? t(`（代わりに ${use}）`, ` (use ${use} instead)`) : '';

/** One finding in words. */
function describeFinding(finding: OntologyFinding) {
  switch (finding.kind) {
    case 'unreadable':
      return t('frontmatter を読めません。', 'The frontmatter cannot be read.');
    case 'type-missing':
      return t('種類（type）がありません。', 'It has no type.');
    case 'type-undeclared':
      return t(
        `宣言にない種類${quoted(finding.name)}です${instead(finding.use)}。`,
        `Its type ${quoted(finding.name)} is not declared${instead(finding.use)}.`,
      );
    case 'key-missing':
      return t(
        `必須のプロパティ${quoted(finding.name)}がありません。`,
        `The required property ${quoted(finding.name)} is missing.`,
      );
    case 'relation-incomplete':
      return t('関係に rel か target がありません。', 'A relation has no rel or no target.');
    case 'relation-undeclared':
      return t(
        `宣言にない関係${quoted(finding.name)}です${instead(finding.use)}。`,
        `The relation ${quoted(finding.name)} is not declared${instead(finding.use)}.`,
      );
    case 'relation-from':
      return t(
        `関係${quoted(finding.name)}は、種類${quoted(finding.type)}のページからは使えません。`,
        `The relation ${quoted(finding.name)} does not go from a page of type ${quoted(finding.type)}.`,
      );
    case 'relation-not-url':
      return t(
        `関係${quoted(finding.name)}の相手は URL です（${finding.target}）。`,
        `The relation ${quoted(finding.name)} points at a URL (${finding.target}).`,
      );
    case 'relation-not-page':
      return t(
        `関係${quoted(finding.name)}の相手が、この KB のページではありません（${finding.target}）。`,
        `The relation ${quoted(finding.name)} points at no page of this KB (${finding.target}).`,
      );
    case 'relation-target-type':
      return t(
        `関係${quoted(finding.name)}の相手の種類が違います（${finding.target} は ${finding.type ?? '種類なし'}）。`,
        `The relation ${quoted(finding.name)} points at a page of another type (${finding.target} is ${finding.type ?? 'untyped'}).`,
      );
    case 'relation-repeated':
      return t(
        `関係${quoted(finding.name)}が同じ相手に重複しています（${finding.target}）。`,
        `The relation ${quoted(finding.name)} is stated twice for the same target (${finding.target}).`,
      );
  }
}

const anyPage = () => t('どのページでも', 'any page');
const fromText = (relation: OntologyRelation) =>
  relation.from === 'any' ? anyPage() : relation.from.join(', ');
const toText = (relation: OntologyRelation) =>
  relation.to === 'url' ? 'URL' : relation.to === 'page' ? anyPage() : relation.to.join(', ');

function Undeclared({ label, names }: { label: string; names: UndeclaredName[] }) {
  if (!names.length) return null;
  return (
    <p className="ontology-undeclared">
      <strong>{label}</strong>
      {names.map(({ name, count, use }) => (
        <span key={name}>
          <code>{name}</code> × {count.toLocaleString('en-US')}
          {instead(use)}
        </span>
      ))}
    </p>
  );
}

function OntologyContent({
  report,
  onOpen,
}: {
  report: OntologyReport;
  onOpen: (path: string) => void;
}) {
  const [page, setPage] = useState(0);
  const current = Math.min(page, Math.max(0, Math.ceil(report.findings.length / 100) - 1));
  return (
    <>
      <div className="graph-canvas">
        {report.types.length || report.relations.length ? (
          <Diagram report={report} />
        ) : (
          <p>
            {t('宣言に種類も関係もありません。', 'The declaration has no types and no relations.')}
          </p>
        )}
      </div>
      <div className="graph-table">
        <details className="ontology-list" open>
          <summary>{t('種類', 'Types')}</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">{t('種類', 'Type')}</th>
                <th scope="col">{t('意味', 'Meaning')}</th>
                <th scope="col">{t('必須', 'Required')}</th>
                <th scope="col">{t('ページ', 'Pages')}</th>
              </tr>
            </thead>
            <tbody>
              {report.types.map((type) => (
                <tr key={type.name}>
                  <td>
                    <code>{type.name}</code>
                  </td>
                  <td>{type.description}</td>
                  <td>{type.required.join(', ')}</td>
                  <td>{type.pages.toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
        <details className="ontology-list" open>
          <summary>{t('関係', 'Relations')}</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">{t('関係', 'Relation')}</th>
                <th scope="col">{t('意味', 'Meaning')}</th>
                <th scope="col">{t('どの種類から', 'From')}</th>
                <th scope="col">{t('どの種類へ', 'To')}</th>
                <th scope="col">{t('使用', 'Uses')}</th>
                <th scope="col">{t('宣言と違う', 'Differ')}</th>
              </tr>
            </thead>
            <tbody>
              {report.relations.map((relation) => (
                <tr key={relation.name}>
                  <td>
                    <code>{relation.name}</code>
                  </td>
                  <td>{relation.description}</td>
                  <td>{fromText(relation)}</td>
                  <td>{toText(relation)}</td>
                  <td>{relation.uses.toLocaleString('en-US')}</td>
                  <td>{relation.findings.toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
        <Undeclared
          label={t('宣言にない種類', 'Types not declared')}
          names={report.undeclaredTypes}
        />
        <Undeclared
          label={t('宣言にない関係', 'Relations not declared')}
          names={report.undeclaredRelations}
        />
        <details className="ontology-list" open>
          <summary>
            {t(
              `宣言と違うページ（${report.findingCount.toLocaleString('en-US')} 件）`,
              `Pages that differ from the declaration (${report.findingCount.toLocaleString('en-US')})`,
            )}
          </summary>
          {report.findings.length ? (
            <>
              {report.findingCount > report.findings.length && (
                <p className="hint">
                  {t(
                    `最初の ${report.findings.length.toLocaleString('en-US')} 件を表示しています。`,
                    `Showing the first ${report.findings.length.toLocaleString('en-US')}.`,
                  )}
                </p>
              )}
              {report.findings.length > 100 && (
                <div className="actions">
                  <button disabled={!current} onClick={() => setPage(current - 1)}>
                    {t('前の 100 件', 'Previous 100')}
                  </button>
                  <span>
                    {current * 100 + 1}–{Math.min(report.findings.length, (current + 1) * 100)}
                  </span>
                  <button
                    disabled={(current + 1) * 100 >= report.findings.length}
                    onClick={() => setPage(current + 1)}
                  >
                    {t('次の 100 件', 'Next 100')}
                  </button>
                </div>
              )}
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('ページ', 'Page')}</th>
                    <th scope="col">{t('宣言と違う点', 'How it differs')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.findings.slice(current * 100, (current + 1) * 100).map((finding, row) => (
                    <tr key={`${current}:${row}`}>
                      <td>
                        <button onClick={() => onOpen(finding.path)}>{finding.path}</button>
                      </td>
                      <td>{describeFinding(finding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="hint">
              {t('すべてのページが宣言どおりです。', 'Every page follows the declaration.')}
            </p>
          )}
        </details>
      </div>
    </>
  );
}

/** The freshness of the folder indexes of an OKF bundle (ADR 028). */
function describeFolderIndexes(indexes: FolderIndexStatus) {
  if (!indexes.added && !indexes.changed)
    return t('フォルダの索引はページと一致しています。', 'The folder indexes match the pages.');
  return t(
    `フォルダの索引: 追加 ${indexes.added}・変更 ${indexes.changed}。`,
    `Folder indexes: ${indexes.added} to add, ${indexes.changed} to change.`,
  );
}

/**
 * A knowledge base's ontology (ADR 060): the types and relations it declares,
 * how many pages use each, and where pages part from the declaration.
 */
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
  /** Asks the vault agent to review the ontology; absent while it is off. */
  onConfigure?: () => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const { busy, error: failure, run } = useAction();
  const [notice, setNotice] = useState('');
  // A file change applies the declaration again behind the view on show.
  const read = useResource(() => window.irori.ontology(space.scopeId), [space.scopeId], {
    refresh: revision + refresh,
  });
  const { error, loading } = read;
  const data = error ? undefined : read.data;
  const report = data?.report;
  const indexes = data?.indexes;
  async function updateIndexes() {
    await run(async () => {
      await window.irori.updateIndexes(space.scopeId);
      setNotice(t('コミットすると共有されます。', 'Commit it to share.'));
      setRefresh((value) => value + 1);
    });
  }
  // Nothing the button writes is there yet.
  const fresh = !!indexes && indexes.folders > 0 && indexes.added === indexes.folders;
  const updateLabel = fresh ? t('索引を作成', 'Create indexes') : t('索引を更新', 'Update indexes');
  const follows = !!report && report.findingCount === 0;
  return (
    <StageView
      label={t('オントロジー', 'Ontology')}
      className="graph-view"
      busy={busy}
      onClose={onClose}
      crumbs={
        <Crumbs
          space={space}
          items={[
            {
              icon: 'book',
              label: layerLabel(space, 'Knowledge_Base'),
              className: 'layer Knowledge_Base',
            },
          ]}
          here={t('オントロジー', 'Ontology')}
        />
      }
      actions={
        <>
          {report && (
            <span className={`index-state ${follows ? 'current' : ''}`}>
              <Icon name={follows ? 'checkCircle' : 'refresh'} size={13} />
              {follows
                ? t('宣言どおり', 'Follows the declaration')
                : t(
                    `宣言と違う点 ${report.findingCount.toLocaleString('en-US')} 件`,
                    `${report.findingCount.toLocaleString('en-US')} differ`,
                  )}
            </span>
          )}
          {indexes && (
            <button className="stage-text-button framed" disabled={busy} onClick={updateIndexes}>
              <Icon name="refresh" size={14} />
              {updateLabel}
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
          {onConfigure && (
            <button className="stage-text-button ask-ai" onClick={onConfigure}>
              <Icon name="agent" size={14} />
              {t('vault agent', 'vault agent')}
            </button>
          )}
        </>
      }
    >
      {report && (
        <p className="graph-index-line muted" role="status">
          {t(
            `${propertyDeclarationFile} の宣言を ${report.pages.toLocaleString('en-US')} ページに当てはめました: 種類 ${report.types.length}・関係 ${report.relations.length}。`,
            `Applied the declaration in ${propertyDeclarationFile} to ${report.pages.toLocaleString('en-US')} pages: ${report.types.length} types, ${report.relations.length} relations.`,
          )}
        </p>
      )}
      {indexes && (
        <p className="graph-index-line muted" role="status">
          {describeFolderIndexes(indexes)}
        </p>
      )}
      {data?.formerGraphIndex && (
        <p className="graph-index-line muted">
          {t(
            `以前の irori が作ったグラフ索引（${data.formerGraphIndex}）が残っています。今は読み書きしないので、削除できます。`,
            `The graph index an earlier irori generated (${data.formerGraphIndex}) is still here. Nothing reads or writes it now, so it can be deleted.`,
          )}
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
      {loading && !data ? (
        <p className="hint">{t('ページを確認しています…', 'Checking the pages…')}</p>
      ) : report ? (
        <OntologyContent report={report} onOpen={onOpen} />
      ) : (
        data && (
          <div className="graph-empty">
            <Icon name="graph" size={32} />
            <p>
              {t(
                'この KB は種類と関係を宣言していません。',
                'This KB declares no types and relations.',
              )}
            </p>
            <p className="muted">
              {data.problem ??
                t(
                  `${propertyDeclarationFile} に種類と関係を宣言すると、irori がページに当てはめます。`,
                  `Declare types and relations in ${propertyDeclarationFile}, and irori applies them to the pages.`,
                )}
            </p>
          </div>
        )
      )}
    </StageView>
  );
}
