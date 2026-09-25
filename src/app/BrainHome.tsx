import { useState, type ReactNode } from 'react';
import type { CloudConnection, Entry, Layer, Space } from '../domain/types';
import type { GitStatus } from '../domain/git';
import type { AgentSkill } from '../domain/skills';
import { agentNames } from '../domain/types';
import { categoryName } from '../domain/brains';
import { classify } from '../domain/scopes';
import { displayLocale, t } from '../domain/i18n';
import { BrainTile } from './BrainTile';
import { Icon, type IconName } from './Icon';
import { SkillReach } from './SkillReach';
import { useResource } from './useResource';
import type { Listing } from './BrainPanel';

const host = window.irori;
const layerIcons: Record<Layer, IconName> = {
  schema: 'schema',
  Knowledge_Base: 'book',
  contents: 'cloud',
};
const categoryIcons = { personal: 'user', team: 'users', organization: 'building' } as const;
// A function so each state name is read in the language of the current render.
const changeNames = (): Record<string, string> => ({
  M: t('変更', 'Modified'),
  A: t('追加', 'Added'),
  D: t('削除', 'Deleted'),
  T: t('種別変更', 'Type changed'),
  '?': t('新規', 'New'),
  U: t('競合', 'Conflict'),
});

/** Folders before files, each by name, as a short list with the rest counted. */
function firstEntries(entries: Entry[], limit: number) {
  const sorted = [...entries].sort(
    (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
  );
  return { shown: sorted.slice(0, limit), more: Math.max(0, sorted.length - limit) };
}

function Card({
  layer,
  icon,
  title,
  count,
  action,
  children,
}: {
  layer?: Layer;
  icon?: IconName;
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`home-card ${layer ?? ''}`}>
      <header>
        <Icon name={layer ? layerIcons[layer] : icon!} size={layer ? 19 : 17} strokeWidth={1.9} />
        <h2>{title}</h2>
        {!!count && <span className="home-count">{count}</span>}
        <span className="home-card-space" />
        {action}
      </header>
      <div className="home-card-body">{children}</div>
    </section>
  );
}

function EntryRow({ entry, onOpen }: { entry: Entry; onOpen: (entry: Entry) => void }) {
  const content = (
    <>
      <Icon name={entry.directory ? 'folder' : 'file'} size={16} className="home-row-icon" />
      <span className="home-row-name">{entry.name}</span>
    </>
  );
  // Folders open in the brain panel's tree; a file opens on the stage.
  return entry.directory ? (
    <div className="home-row">{content}</div>
  ) : (
    <button className="home-row" onClick={() => onOpen(entry)}>
      {content}
    </button>
  );
}

/**
 * A brain's home: who it is, its three layers at a glance, and what changed and
 * ran lately — the stage before a note is open.
 */
export function BrainHome({
  space,
  roots,
  git,
  connections,
  skills,
  daily,
  locked,
  revision,
  onOpen,
  onDaily,
  onNewNote,
  onTerminal,
  onRefresh,
  onGraph,
  onConnect,
  onChanges,
  onMaterials,
}: {
  space: Space;
  roots?: Listing;
  git?: GitStatus;
  connections: CloudConnection[];
  skills: AgentSkill[];
  daily: boolean;
  /** Actions that change the brain wait (a run, Git or a connection is in progress). */
  locked: boolean;
  revision: number;
  onOpen: (entry: Entry) => void;
  onDaily: () => void;
  onNewNote: () => void;
  onTerminal: () => void;
  onRefresh: () => void;
  onGraph: () => void;
  onConnect: () => void;
  onChanges: () => void;
  onMaterials: () => void;
}) {
  const [reach, setReach] = useState(false);
  const knowledgeRoot = roots?.entries.some(
    (entry) => entry.path === 'Knowledge_Base' && entry.directory,
  );
  const knowledgeRead = useResource(
    () => host.entries(space.scopeId, 'Knowledge_Base'),
    [space.scopeId],
    { enabled: !!knowledgeRoot, refresh: revision },
  );
  const history = useResource(() => host.knowledgeHistory(space.scopeId), [space.scopeId], {
    refresh: revision,
  });
  const schema = firstEntries(roots?.entries.filter((entry) => entry.layer === 'schema') ?? [], 6);
  const knowledge = firstEntries(
    (knowledgeRoot
      ? knowledgeRead.data
      : roots?.entries.filter((entry) => entry.layer === 'Knowledge_Base')) ?? [],
    8,
  );
  const runs = [...(history.data?.runs ?? [])]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3);
  const changes = git?.available ? git.changes : [];
  const category = categoryName(space.category);
  return (
    <div className="brain-home">
      <header className="home-header">
        <BrainTile space={space} size={64} radius={19} ring="stage" />
        <div className="home-title">
          <h1>{space.name}</h1>
          <div className="home-meta">
            <span>
              <Icon name={categoryIcons[space.category]} size={14} />
              {category}
            </span>
            <i />
            <span className="mono" title={space.root}>
              {space.root}
            </span>
            {git?.available && git.branch && (
              <>
                <i />
                <span>
                  <Icon name="branch" size={14} />
                  {git.branch}
                  {git.ahead !== undefined && (
                    <span className="mono">
                      ↑{git.ahead} ↓{git.behind}
                    </span>
                  )}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="home-actions">
          {daily && (
            <button className="solid-button home-button" disabled={locked} onClick={onDaily}>
              <Icon name="calendar" size={15} />
              {t('今日のノート', "Today's note")}
            </button>
          )}
          <button className="stage-text-button framed" disabled={locked} onClick={onNewNote}>
            <Icon name="plus" size={15} />
            {t('ノートを作成', 'Create note')}
          </button>
          <button className="stage-text-button" onClick={onTerminal}>
            <Icon name="terminal" size={15} />
            {t('ターミナル', 'Terminal')}
          </button>
        </div>
      </header>
      <div className="home-layers">
        <Card
          layer="schema"
          title="Schema"
          action={
            <button
              className="stage-button"
              aria-label={t('エクスプローラーを更新', 'Refresh explorer')}
              title={t('エクスプローラーを更新', 'Refresh explorer')}
              onClick={onRefresh}
            >
              <Icon name="refresh" size={15} />
            </button>
          }
        >
          {schema.shown.map((entry) => (
            <EntryRow key={entry.path} entry={entry} onOpen={onOpen} />
          ))}
          {schema.more > 0 && (
            <small className="home-more">
              {t(`ほか ${schema.more} 件`, `${schema.more} more`)}
            </small>
          )}
          <div className="home-row home-skills-row">
            <Icon name="zap" size={16} className="home-row-icon" />
            <span className="home-row-name">{t('スキル', 'Skills')}</span>
            <button className="stage-text-button small" onClick={() => setReach(true)}>
              <Icon name="checkCircle" size={13} />
              {t('到達確認', 'Check reach')}
            </button>
          </div>
          <div className="home-skills">
            {skills.length ? (
              skills.map((skill) => (
                <span key={skill.name} className="home-skill" title={skill.description}>
                  {skill.name}
                </span>
              ))
            ) : (
              <small className="home-more">
                {t('.agents/skills にスキルはありません。', 'No skills in .agents/skills.')}
              </small>
            )}
          </div>
        </Card>
        <Card
          layer="Knowledge_Base"
          title="Knowledge"
          action={
            <button className="stage-text-button framed small" disabled={locked} onClick={onGraph}>
              <Icon name="graph" size={14} />
              {t('グラフ', 'Graph')}
            </button>
          }
        >
          {knowledge.shown.map((entry) => (
            <EntryRow key={entry.path} entry={entry} onOpen={onOpen} />
          ))}
          {!knowledge.shown.length && (
            <small className="home-more">{t('ノートはまだありません。', 'No notes yet.')}</small>
          )}
          {knowledge.more > 0 && (
            <small className="home-more">
              {t(`ほか ${knowledge.more} 件`, `${knowledge.more} more`)}
            </small>
          )}
        </Card>
        <Card
          layer="contents"
          title="Contents"
          action={
            <button
              className="stage-text-button framed small"
              disabled={locked}
              onClick={onConnect}
            >
              <Icon name="cloudConnect" size={14} />
              {t('接続', 'Connect')}
            </button>
          }
        >
          {connections.map((connection) => (
            <div key={connection.mountId} className="home-drive">
              <div className="home-drive-name">
                <Icon name="cloud" size={16} />
                <span>{connection.name}</span>
                {!!connection.pending && (
                  <span className="home-uploads">
                    <Icon name="up" size={12} strokeWidth={2.4} />
                    {t(`送信待ち ${connection.pending}`, `${connection.pending} to upload`)}
                  </span>
                )}
              </div>
              <div className="home-drive-meta">
                {connection.state !== 'mounted' ? (
                  <span>{connection.detail ?? t('未接続', 'Not connected')}</span>
                ) : connection.writable ? (
                  <span>
                    <Icon name="penLine" size={12} strokeWidth={2} />
                    {t('編集可', 'Editable')}
                  </span>
                ) : (
                  <span>
                    <Icon name="lock" size={12} strokeWidth={2} />
                    {t('読み取り専用', 'Read-only')}
                  </span>
                )}
                {connection.accountName && (
                  <>
                    <i />
                    <span>{connection.accountName}</span>
                  </>
                )}
              </div>
            </div>
          ))}
          {!connections.length && (
            <small className="home-more">
              {t(
                'Google Drive のフォルダを接続すると、エージェントも資料として使えます。',
                'Connect a Google Drive folder and agents can use it as material too.',
              )}
            </small>
          )}
        </Card>
      </div>
      <div className="home-recent">
        <Card
          icon="branch"
          title={t('変更', 'Changes')}
          count={changes.length}
          action={
            <button className="stage-text-button small" onClick={onChanges}>
              {t('コミット', 'Commit')}
              <Icon name="arrow" size={13} />
            </button>
          }
        >
          {changes.slice(0, 4).map((change) => {
            const state = change.conflict
              ? 'U'
              : change.index !== ' ' && change.index !== '?'
                ? change.index
                : change.worktree;
            return (
              <button key={change.path} className="home-row" onClick={onChanges}>
                <Icon
                  name={layerIcons[classify(space, change.path)]}
                  size={15}
                  className={`home-row-icon layer ${classify(space, change.path)}`}
                />
                <span className="home-row-name mono">{change.path}</span>
                <span className={`home-state state-${state === '?' ? 'new' : state}`}>
                  {changeNames()[state] ?? t('変更', 'Modified')}
                </span>
              </button>
            );
          })}
          {!changes.length && (
            <small className="home-more">
              {git && !git.available
                ? git.detail
                : t('変更はありません。', 'There are no changes.')}
            </small>
          )}
        </Card>
        <Card
          icon="archive"
          title={t('実行の記録', 'Run records')}
          action={
            <button className="stage-text-button small" onClick={onMaterials}>
              {t('資料と成果物', 'Materials and outputs')}
              <Icon name="arrow" size={13} />
            </button>
          }
        >
          {runs.map((run) => (
            <button key={run.id} className="home-row" onClick={onMaterials}>
              <Icon name="sparkles" size={15} className="home-row-icon ember" />
              <span className="home-run-agent">{agentNames[run.agent]}</span>
              <span className="mono home-run-date">
                {new Date(run.createdAt).toLocaleString(displayLocale(), {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span className="home-card-space" />
              <span className={`home-outcome ${run.outcome ?? ''}`}>
                <Icon name={run.outcome === 'completed' ? 'checkCircle' : 'clock'} size={13} />
                {run.outcome === 'completed'
                  ? t('完了', 'Completed')
                  : run.outcome === 'cancelled'
                    ? t('停止', 'Stopped')
                    : run.outcome === 'failed'
                      ? t('失敗', 'Failed')
                      : t('完了記録なし', 'No completion recorded')}
              </span>
            </button>
          ))}
          {!runs.length && (
            <small className="home-more">
              {t(
                'AI に送信すると、実行と参照した資料の版がここに残ります。',
                'Sending to AI keeps its runs and the versions of the materials here.',
              )}
            </small>
          )}
        </Card>
      </div>
      {reach && <SkillReach scopeId={space.scopeId} onClose={() => setReach(false)} />}
    </div>
  );
}
