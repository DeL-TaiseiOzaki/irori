import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { AgentId, Entry, Space, WorkspaceProfile } from '../domain/types';
import { agentNames } from '../domain/types';
import { categoryName } from '../domain/brains';
import { board, mapLayout, noteLabel, referenceLinks } from '../domain/overview';
import { t } from '../domain/i18n';
import { AgentRequest, eventTarget } from './AgentLog';
import { firstEntries } from './BrainHome';
import { BrainTile } from './BrainTile';
import { Icon } from './Icon';
import { MagnetTabs } from './obsidian/MagnetTabs';
import { shortcut } from './shortcuts';
import { useResource } from './useResource';
import { currentStep, lastRun, openRequest, useBrainAi, type BrainAi } from './useBrainAi';
import type { YourAi } from '../domain/you';
import { openTasks, YourAiPanel } from './YourAiPanel';
import './overview.css';

const host = window.irori;
export type OverviewView = 'map' | 'columns';
type AiState = 'running' | 'waiting' | 'queued' | 'idle';
const categoryIcons = { personal: 'user', team: 'users', organization: 'building' } as const;
const idle: BrainAi = { events: [], queued: [], running: false, ready: false, error: '' };

function aiState(ai: BrainAi): AiState {
  return openRequest(ai)
    ? 'waiting'
    : ai.running
      ? 'running'
      : ai.queued.length
        ? 'queued'
        : 'idle';
}

function StateWords({ ai }: { ai: BrainAi }) {
  const state = aiState(ai);
  return (
    <span className={`ai-state ${state}`}>
      {state === 'running' ? (
        <Icon name="loader" size={12} className="spin" />
      ) : state === 'queued' ? (
        <Icon name="clock" size={12} />
      ) : (
        <i />
      )}
      {state === 'waiting'
        ? t('許可待ち', 'Needs approval')
        : state === 'running'
          ? t('実行中', 'Running')
          : state === 'queued'
            ? t(`送信待ち ${ai.queued.length}`, `${ai.queued.length} pending`)
            : t('待機', 'Idle')}
    </span>
  );
}

/** Reads one brain's AI and hands it up, so every view of the Overview shares one reading. */
function AiWatch({
  scopeId,
  agent,
  refresh,
  onChange,
}: {
  scopeId: string;
  agent: AgentId;
  refresh: number;
  onChange: (scopeId: string, ai: BrainAi) => void;
}) {
  const ai = useBrainAi(scopeId, agent, refresh);
  useEffect(() => onChange(scopeId, ai), [scopeId, ai]);
  return null;
}

interface Actions {
  onEnter: (
    space: Space,
    options?: { ai?: boolean; entry?: Entry; origin?: { x: number; y: number } },
  ) => void;
  onResume: (scopeId: string) => Promise<void>;
  onStop: (scopeId: string) => Promise<void>;
  onError: (error: unknown) => void;
}

/**
 * A brain's AI in a few lines: the request it waits on, the step it is taking,
 * what waits to be sent, or the last thing it was asked.
 */
function AiCard({
  space,
  ai,
  agent,
  named,
  onEnter,
  onResume,
  onStop,
  onError,
}: {
  space: Space;
  ai: BrainAi;
  agent: AgentId;
  /** Names the brain, where the card stands among other brains' cards. */
  named?: boolean;
} & Actions) {
  const request = openRequest(ai);
  const step = currentStep(ai);
  const last = lastRun(ai);
  const [busy, setBusy] = useState(false);
  const act = (action: () => Promise<void>) => {
    setBusy(true);
    void action()
      .catch(onError)
      .finally(() => setBusy(false));
  };
  return (
    <section
      className={`ai-card ${aiState(ai)}`}
      role="group"
      aria-label={t(`${space.name} の AI`, `${space.name}'s AI`)}
    >
      <header>
        {named && <BrainTile space={space} size={22} radius={7} />}
        <Icon name="sparkles" size={13} className="ai-card-spark" />
        <span className="ai-card-name">
          {named ? t(`${space.name} の AI`, `${space.name}'s AI`) : agentNames[agent]}
        </span>
        <StateWords ai={ai} />
      </header>
      {ai.error ? (
        <p className="ai-card-line error" role="alert">
          {ai.error}
        </p>
      ) : request ? (
        <AgentRequest key={request.requestId} event={request} ended={false} onError={onError} />
      ) : ai.running ? (
        <>
          <p className="ai-card-line shimmer">
            {step ? step.text.slice(-160) : t('準備しています…', 'Getting ready…')}
            {step && eventTarget(step.details) && (
              <span className="mono">{eventTarget(step.details)}</span>
            )}
          </p>
          <div className="ai-card-actions">
            <button
              className="panel-button"
              disabled={busy}
              onClick={() => act(() => onStop(space.scopeId))}
            >
              <Icon name="close" size={13} />
              {t('停止', 'Stop')}
            </button>
          </div>
        </>
      ) : ai.queued.length ? (
        <>
          <p className="ai-card-line queued">
            <Icon name="clock" size={13} />
            {ai.queued[0].prompt}
          </p>
          <div className="ai-card-actions">
            <button
              className="panel-button"
              disabled={busy}
              onClick={() => act(() => onResume(space.scopeId))}
            >
              {t('送信を再開', 'Resume sending')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="ai-card-line last">
            {last.request
              ? t(`前回 · ${last.request}`, `Last · ${last.request}`)
              : t('まだ指示はありません。', 'No instructions yet.')}
          </p>
          <div className="ai-card-actions">
            <button className="ember-button" onClick={() => onEnter(space, { ai: true })}>
              <Icon name="sparkles" size={13} />
              {t('AI に相談', 'Ask AI')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function curve(from: { x: number; y: number }, to: { x: number; y: number }) {
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const control = { x: mid.x - dy * 0.18, y: mid.y + dx * 0.18 };
  return {
    d: `M ${from.x} ${from.y} Q ${control.x} ${control.y} ${to.x} ${to.y}`,
    // The curve's own middle, where its label sits.
    label: {
      x: (from.x + 2 * control.x + to.x) / 4,
      y: (from.y + 2 * control.y + to.y) / 4,
    },
  };
}
const at = (point: { x: number; y: number }): CSSProperties => ({
  left: `${(point.x / board.width) * 100}%`,
  top: `${(point.y / board.height) * 100}%`,
});

// Sparks travel along hand-offs unless the reader asks for less motion.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function OverviewMap({
  spaces,
  ais,
  refresh,
  you,
  yourAi,
  onShowYou,
  onEnter,
}: {
  spaces: Space[];
  ais: Record<string, BrainAi>;
  refresh: number;
  you?: YourAi;
  yourAi: BrainAi;
  onShowYou: () => void;
  onEnter: Actions['onEnter'];
}) {
  const layout = useMemo(() => mapLayout(spaces, { hearth: !!you }), [spaces, !!you]);
  // Your AI's hand-offs still under way: a line from the hearth to each brain.
  const tasks = openTasks(yourAi);
  const ids = spaces.map((space) => space.scopeId);
  const histories = useResource(
    async () =>
      Object.fromEntries(
        await Promise.all(
          ids.map(async (id) => [
            id,
            (await host.knowledgeHistory(id).catch(() => undefined))?.runs ?? [],
          ]),
        ),
      ),
    [ids.join()],
    { refresh },
  );
  const links = referenceLinks(histories.data ?? {}, ids);
  const node = (id: string) => layout.nodes.find((item) => item.scopeId === id)!;
  const space = (id: string) => spaces.find((item) => item.scopeId === id)!;
  return (
    <section className="map-board" aria-label={t('Brain の地図', 'Map of brains')}>
      <div className="map-canvas">
        {layout.groups.map((group) => (
          <div
            key={group.category}
            className="map-group"
            style={{
              ...at(group),
              width: `${(group.width / board.width) * 100}%`,
              height: `${(group.height / board.height) * 100}%`,
            }}
          >
            <span>{categoryName(group.category)}</span>
          </div>
        ))}
        <svg
          className="map-lines"
          viewBox={`0 0 ${board.width} ${board.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {links.map((link) => (
            <path
              key={`${link.from}>${link.to}`}
              className="map-reference"
              d={curve(node(link.from), node(link.to)).d}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {layout.hearth &&
            tasks.map((task) => {
              const d = curve(layout.hearth!, node(task.scopeId)).d;
              return (
                <g key={task.id} className={`map-hand-off ${task.state}`}>
                  <path d={d} vectorEffect="non-scaling-stroke" />
                  {!reducedMotion.matches && (
                    <circle r="4" className="map-spark">
                      <animateMotion dur="2.6s" repeatCount="indefinite" path={d} />
                    </circle>
                  )}
                </g>
              );
            })}
        </svg>
        {layout.hearth &&
          tasks.map((task) => (
            <span
              key={task.id}
              className={`map-pill hand-off ${task.state}`}
              style={at(curve(layout.hearth!, node(task.scopeId)).label)}
              title={task.label}
            >
              <Icon name="arrow" size={11} strokeWidth={2.4} />
              {task.label}
            </span>
          ))}
        {layout.hearth && you && (
          <button
            className={`map-hearth ${yourAi.running ? 'working' : ''}`}
            style={at(layout.hearth)}
            aria-label={t('あなたの AI の Schema を開く', "Open your AI's Schema")}
            onClick={onShowYou}
          >
            <span className="map-orb" aria-hidden="true">
              <Icon name="sparkles" size={30} strokeWidth={1.9} />
            </span>
            <strong>{t('あなたの AI', 'Your AI')}</strong>
            <small>
              <Icon name="schema" size={11} />
              {you.state === 'ready'
                ? t('あなたの Schema', 'Your Schema')
                : t('まだ用意されていません', 'Not set up yet')}
            </small>
          </button>
        )}
        {links.map((link) => (
          <span
            key={`${link.from}>${link.to}`}
            className="map-pill"
            style={at(curve(node(link.from), node(link.to)).label)}
            title={t(
              `${space(link.to).name} の AI が ${space(link.from).name} の ${link.path} を参照（${link.notes} 件）`,
              `${space(link.to).name}'s AI read ${link.path} in ${space(link.from).name} (${link.notes})`,
            )}
          >
            <BrainTile space={space(link.from)} size={14} radius={4} />
            {noteLabel(link.path)}
          </span>
        ))}
        {layout.nodes.map((item, index) => {
          const brain = space(item.scopeId);
          const ai = ais[item.scopeId] ?? idle;
          const handed = tasks.some((task) => task.scopeId === item.scopeId);
          return (
            <button
              key={item.scopeId}
              className={`map-node ${aiState(ai)} ${handed ? 'handed' : ''}`}
              style={at(item)}
              aria-label={t(`${brain.name} を開く`, `Open ${brain.name}`)}
              onClick={(event) => {
                // The Overview zooms away around the brain that was chosen.
                const box = event.currentTarget.getBoundingClientRect();
                onEnter(brain, {
                  origin: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
                });
              }}
            >
              {/* The brain floats inside a still button, so a pointer can hold on to it. */}
              <span className="map-node-body" style={{ animationDelay: `${-index * 1.3}s` }}>
                <BrainTile space={brain} size={64} radius={18} />
                <strong>{brain.name}</strong>
                <StateWords ai={ai} />
              </span>
            </button>
          );
        })}
      </div>
      <footer className="map-legend">
        {you && (
          <span>
            <i className="legend-hand-off" />
            {t('あなたの AI からの依頼', 'Handed over by your AI')}
          </span>
        )}
        <span>
          <i className="legend-reference" />
          {t('別の Brain のノートを参照', "Read another brain's notes")}
        </span>
        <span>
          <i className="legend-group" />
          {t('分類ごとのまとまり', 'Grouped by category')}
        </span>
      </footer>
    </section>
  );
}

function BrainColumn({
  space,
  ai,
  agent,
  revision,
  onConnect,
  ...actions
}: {
  space: Space;
  ai: BrainAi;
  agent: AgentId;
  revision: number;
  onConnect: (space: Space) => void;
} & Actions) {
  const roots = useResource(() => host.entries(space.scopeId, ''), [space.scopeId], {
    refresh: revision,
  });
  const knowledgeRoot = roots.data?.some(
    (entry) => entry.path === 'Knowledge_Base' && entry.directory,
  );
  const knowledgeRead = useResource(
    () => host.entries(space.scopeId, 'Knowledge_Base'),
    [space.scopeId],
    { enabled: !!knowledgeRoot, refresh: revision },
  );
  const skills = useResource(() => host.skills(space.scopeId), [space.scopeId], {
    refresh: revision,
  });
  const connections = useResource(() => host.cloudConnections(space.scopeId), [space.scopeId], {
    refresh: revision,
  });
  const schema = (roots.data ?? []).filter((entry) => entry.layer === 'schema' && !entry.directory);
  const knowledge = firstEntries(
    (knowledgeRoot
      ? knowledgeRead.data
      : roots.data?.filter((entry) => entry.layer === 'Knowledge_Base')) ?? [],
    6,
  );
  const open = (entry: Entry) => actions.onEnter(space, { entry });
  return (
    <section className={`brain-column ${openRequest(ai) ? 'waiting' : ''}`} aria-label={space.name}>
      <header className="column-head">
        <button
          className="column-brain"
          aria-label={t(`${space.name} を開く`, `Open ${space.name}`)}
          onClick={() => actions.onEnter(space)}
        >
          <BrainTile space={space} size={30} radius={9} />
          <span>
            <strong>{space.name}</strong>
            {space.category && (
              <small>
                <Icon name={categoryIcons[space.category]} size={11} />
                {categoryName(space.category)}
              </small>
            )}
          </span>
        </button>
      </header>
      <div className="column-cell">
        <AiCard space={space} ai={ai} agent={agent} {...actions} />
      </div>
      <div className="column-cell">
        {roots.error && <small className="column-note">{roots.error}</small>}
        {schema.map((entry) => (
          <button key={entry.path} className="column-row" onClick={() => open(entry)}>
            <Icon name="file" size={14} className="layer-icon schema" />
            {entry.name}
          </button>
        ))}
        {!roots.loading && !schema.length && !roots.error && (
          <small className="column-note">{t('指示ファイルなし', 'No instruction file')}</small>
        )}
        {!!skills.data?.skills.length && (
          <div className="column-skills">
            {skills.data.skills.map((skill) => (
              <span key={skill.name} title={skill.description}>
                {skill.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="column-cell">
        {knowledge.shown.map((entry) =>
          entry.directory ? (
            <div key={entry.path} className="column-row">
              <Icon name="folder" size={14} />
              {entry.name}
            </div>
          ) : (
            <button key={entry.path} className="column-row" onClick={() => open(entry)}>
              <Icon name="file" size={14} />
              {entry.name.replace(/\.md$/, '')}
            </button>
          ),
        )}
        {knowledge.more > 0 && (
          <small className="column-note">
            {t(`ほか ${knowledge.more} 件`, `${knowledge.more} more`)}
          </small>
        )}
      </div>
      <div className="column-cell">
        {(connections.data ?? []).map((connection) => (
          <div key={connection.mountId} className="column-row">
            <Icon name="cloud" size={14} className="layer-icon contents" />
            <span className="column-row-name">{connection.name}</span>
            {connection.access === 'read-only' ? (
              <span title={t('読み取り専用', 'Read-only')}>
                <Icon name="lock" size={12} />
              </span>
            ) : (
              !!connection.pending && (
                <span className="column-upload mono">
                  <Icon name="up" size={11} />
                  {connection.pending}
                </span>
              )
            )}
          </div>
        ))}
        {connections.data && !connections.data.length && (
          <button className="column-connect" onClick={() => onConnect(space)}>
            <Icon name="cloudConnect" size={14} />
            {t('Drive を接続', 'Connect Drive')}
          </button>
        )}
      </div>
    </section>
  );
}

function OverviewColumns({
  spaces,
  ais,
  agentFor,
  revision,
  onConnect,
  ...actions
}: {
  spaces: Space[];
  ais: Record<string, BrainAi>;
  agentFor: (scopeId: string) => AgentId;
  revision: number;
  onConnect: (space: Space) => void;
} & Actions) {
  return (
    <div
      className="overview-columns"
      role="region"
      aria-label={t('Brain の並列表示', 'Brains side by side')}
      style={{ '--columns': spaces.length } as CSSProperties}
    >
      <div className="columns-gutter" aria-hidden="true">
        <span />
        <span>
          <Icon name="sparkles" size={15} className="ai-card-spark" />
          AI
        </span>
        <span>
          <Icon name="schema" size={15} className="layer-icon schema" />
          Schema
        </span>
        <span>
          <Icon name="book" size={15} />
          Knowledge
        </span>
        <span>
          <Icon name="cloud" size={15} className="layer-icon contents" />
          Contents
        </span>
      </div>
      {spaces.map((space) => (
        <BrainColumn
          key={space.scopeId}
          space={space}
          ai={ais[space.scopeId] ?? idle}
          agent={agentFor(space.scopeId)}
          revision={revision}
          onConnect={onConnect}
          {...actions}
        />
      ))}
    </div>
  );
}

/** Sends one instruction to the chosen brain's AI, or queues it behind the run in progress. */
function OverviewComposer({
  spaces,
  ais,
  agentFor,
  onSend,
}: {
  spaces: Space[];
  ais: Record<string, BrainAi>;
  agentFor: (scopeId: string) => AgentId;
  onSend: (scopeId: string, prompt: string) => Promise<void>;
}) {
  const [target, setTarget] = useState(spaces[0]?.scopeId);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const space = spaces.find((item) => item.scopeId === target) ?? spaces[0];
  if (!space) return null;
  const ai = ais[space.scopeId] ?? idle;
  const behind = ai.running || ai.queued.length > 0;
  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      await onSend(space.scopeId, text);
      setText('');
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSending(false);
    }
  }
  return (
    <form
      className="overview-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <fieldset className="overview-targets">
        <legend className="sr-only">{t('送信先の Brain', 'Brain to send to')}</legend>
        {spaces.map((item) => (
          <label
            key={item.scopeId}
            className={`target-chip ${item.scopeId === space.scopeId ? 'on' : ''}`}
          >
            <input
              type="radio"
              name="overview-target"
              checked={item.scopeId === space.scopeId}
              onChange={() => setTarget(item.scopeId)}
            />
            <BrainTile space={item} size={16} radius={5} />
            {item.name}
          </label>
        ))}
      </fieldset>
      <textarea
        aria-label={t(`${space.name} の AI への指示`, `Instruction for ${space.name}'s AI`)}
        placeholder={t(`${space.name} の AI に指示…`, `Instruct ${space.name}'s AI…`)}
        rows={3}
        value={text}
        maxLength={32000}
        disabled={sending}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            event.keyCode !== 229
          ) {
            event.preventDefault();
            void send();
          }
        }}
      />
      {error && (
        <p className="overview-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <small>
          <Icon name="sparkles" size={12} />
          {agentNames[agentFor(space.scopeId)]}
        </small>
        <button
          type="submit"
          className="ember-button"
          disabled={!text.trim() || sending}
          aria-label={behind ? t('送信待ちに追加', 'Add to queue') : t('送信', 'Send')}
          title={behind ? t('送信待ちに追加', 'Add to queue') : t('送信', 'Send')}
        >
          <Icon name={behind ? 'clock' : 'up'} size={15} strokeWidth={2.2} />
        </button>
      </footer>
    </form>
  );
}

/**
 * The workspace at a glance: every brain and what its AI is doing, as a map or
 * side by side, with a way to answer, stop, resume and instruct each AI.
 */
export function Overview({
  scene,
  workspace,
  spaces,
  view,
  revision,
  addDisabled,
  agentFor,
  onView,
  onSearch,
  onAdd,
  onConnect,
  onSend,
  you,
  onCreateYou,
  onShowYou,
  onSendYou,
  onStopYou,
  ...actions
}: {
  workspace: WorkspaceProfile;
  spaces: Space[];
  view: OverviewView;
  revision: number;
  addDisabled: boolean;
  agentFor: (scopeId: string) => AgentId;
  onView: (view: OverviewView) => void;
  onSearch: () => void;
  onAdd: () => void;
  onConnect: (space: Space) => void;
  onSend: (scopeId: string, prompt: string) => Promise<void>;
  /** Your AI, once its record is read; `state` says whether its folder is set up. */
  you?: YourAi;
  /** The zoom into a brain (from `origin`), or back from one. */
  scene?: { kind: 'leave' | 'return'; origin?: { x: number; y: number } };
  onCreateYou: () => Promise<void>;
  onShowYou: () => void;
  onSendYou: (prompt: string) => Promise<void>;
  onStopYou: () => Promise<void>;
} & Actions) {
  const [ais, setAis] = useState<Record<string, BrainAi>>({});
  // Beside the map: your AI, or each brain's own AI.
  const [island, setIsland] = useState<'you' | 'brains'>('you');
  const yourAi = (you && ais[you.id]) ?? idle;
  // What the Overview itself did (a send, a resume) is read back at once.
  const [acted, setActed] = useState(0);
  const reread =
    <T extends unknown[]>(action: (...args: T) => Promise<void>) =>
    async (...args: T) => {
      try {
        await action(...args);
      } finally {
        setActed((value) => value + 1);
      }
    };
  const running = spaces.filter((space) => ais[space.scopeId]?.running).length;
  const waiting = spaces.filter((space) => {
    const ai = ais[space.scopeId];
    return ai && openRequest(ai);
  }).length;
  const shared = {
    ...actions,
    onResume: reread(actions.onResume),
    onStop: reread(actions.onStop),
  };
  return (
    <div
      className={`overview chrome ${view} ${scene ? `level-${scene.kind}` : ''}`}
      inert={scene?.kind === 'leave'}
      style={
        scene?.origin
          ? ({
              '--zoom-x': `${scene.origin.x}px`,
              '--zoom-y': `${scene.origin.y}px`,
            } as CSSProperties)
          : undefined
      }
    >
      {spaces.map((space) => (
        <AiWatch
          key={`${space.scopeId}:${agentFor(space.scopeId)}`}
          scopeId={space.scopeId}
          agent={agentFor(space.scopeId)}
          refresh={acted}
          onChange={(id, ai) => setAis((all) => ({ ...all, [id]: ai }))}
        />
      ))}
      {you?.state === 'ready' && (
        <AiWatch
          key={`you:${you.id}`}
          scopeId={you.id}
          agent="claude"
          refresh={acted}
          onChange={(id, ai) => setAis((all) => ({ ...all, [id]: ai }))}
        />
      )}
      <div className="overview-main">
        <header className="overview-header">
          <h1>{t('全体', 'Overview')}</h1>
          <span className="overview-sub">
            {workspace.name} ·{' '}
            {t(`${spaces.length} Brain`, `${spaces.length} brain${spaces.length === 1 ? '' : 's'}`)}
          </span>
          <MagnetTabs
            className="overview-views"
            label={t('全体の表示', 'Overview layout')}
            value={view}
            onValueChange={onView}
            options={[
              {
                value: 'map',
                label: (
                  <>
                    <Icon name="map" size={14} /> {t('地図', 'Map')}
                  </>
                ),
              },
              {
                value: 'columns',
                label: (
                  <>
                    <Icon name="columns" size={14} /> {t('並列', 'Columns')}
                  </>
                ),
              },
            ]}
          />
          <span className="overview-space" />
          <button
            className="overview-search"
            disabled={!spaces.length}
            onClick={onSearch}
            aria-label={t(
              `すべての Brain を検索（${shortcut('K')}）`,
              `Search all brains (${shortcut('K')})`,
            )}
          >
            <Icon name="search" size={15} />
            <span>{t('すべての Brain を検索', 'Search all brains')}</span>
            <kbd>{shortcut('K')}</kbd>
          </button>
          <button className="panel-button overview-add" disabled={addDisabled} onClick={onAdd}>
            <Icon name="plus" size={14} />
            {t('Brain を追加', 'Add a brain')}
          </button>
        </header>
        {!spaces.length ? (
          <div className="overview-empty">
            <p>
              {t('このワークスペースに Brain がありません。', 'This workspace has no brain yet.')}
            </p>
          </div>
        ) : view === 'map' ? (
          <OverviewMap
            spaces={spaces}
            ais={ais}
            refresh={revision}
            you={you}
            yourAi={yourAi}
            onShowYou={onShowYou}
            onEnter={actions.onEnter}
          />
        ) : (
          <OverviewColumns
            spaces={spaces}
            ais={ais}
            agentFor={agentFor}
            revision={revision}
            onConnect={onConnect}
            {...shared}
          />
        )}
      </div>
      {view === 'map' && !!spaces.length && (
        <aside
          className="overview-ai chrome"
          aria-label={
            island === 'you' ? t('あなたの AI', 'Your AI') : t('Brain の AI', 'Brain AIs')
          }
        >
          <MagnetTabs
            className="overview-island-tabs"
            label={t('全体の AI', 'AIs in the Overview')}
            value={island}
            onValueChange={setIsland}
            options={[
              { value: 'you', label: t('あなたの AI', 'Your AI') },
              { value: 'brains', label: t('Brain の AI', 'Brain AIs') },
            ]}
          />
          {island === 'you' ? (
            <YourAiPanel
              you={you}
              brains={spaces}
              ai={yourAi}
              onCreate={onCreateYou}
              onShow={onShowYou}
              onSend={reread(onSendYou)}
              onStop={reread(onStopYou)}
              onError={actions.onError}
            />
          ) : (
            <>
              <header className="overview-ai-head">
                <span className="overview-orb" aria-hidden="true">
                  <Icon name="sparkles" size={15} strokeWidth={2.1} />
                </span>
                <span>
                  <strong>{t('Brain の AI', 'Brain AIs')}</strong>
                  <small>
                    {running || waiting
                      ? [
                          running && t(`実行中 ${running}`, `${running} running`),
                          waiting && t(`許可待ち ${waiting}`, `${waiting} need approval`),
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : t('すべて待機中', 'All idle')}
                  </small>
                </span>
              </header>
              <div className="overview-ai-list">
                {spaces.map((space) => (
                  <AiCard
                    key={space.scopeId}
                    space={space}
                    ai={ais[space.scopeId] ?? idle}
                    agent={agentFor(space.scopeId)}
                    named
                    {...shared}
                  />
                ))}
              </div>
              <OverviewComposer
                spaces={spaces}
                ais={ais}
                agentFor={agentFor}
                onSend={reread(onSend)}
              />
            </>
          )}
        </aside>
      )}
    </div>
  );
}
