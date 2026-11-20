import { memo, useEffect, useState } from 'react';
import { agentNames, type Space } from '../domain/types';
import { t } from '../domain/i18n';
import {
  boardCards,
  sessionLanes,
  type SessionCard,
  type SessionLane,
  type SessionState,
  type SubAgent,
} from '../domain/session-board';
import { BrainTile } from './BrainTile';
import { Icon } from './Icon';
import { countLabel, sinceWords } from './display';
import './session-board.css';

const laneNames: Record<SessionLane, () => string> = {
  attention: () => t('要対応', 'Needs you'),
  working: () => t('実行中', 'Working'),
  done: () => t('完了', 'Done'),
  open: () => t('開いている', 'Open'),
};

export function sessionStateWords(state: SessionState | SubAgent['state'], queued = 0) {
  switch (state) {
    case 'waiting':
      return t('許可待ち', 'Needs approval');
    case 'failed':
      return t('失敗', 'Failed');
    case 'running':
    case 'working':
      return t('実行中', 'Running');
    case 'queued':
      return t(`送信待ち ${queued}`, `${queued} pending`);
    case 'done':
      return t('完了', 'Done');
    case 'stopped':
      return t('中断', 'Stopped');
    case 'idle':
      return t('待機', 'Idle');
  }
}

function Dot({ state, queued }: { state: SessionState | SubAgent['state']; queued?: number }) {
  return (
    <i
      className={`session-dot ${state}`}
      role="img"
      aria-label={sessionStateWords(state, queued)}
    />
  );
}

/**
 * The session board (ADR 069): a narrow column left of the agents' columns that
 * holds every conversation of the workspace that is doing something, as a small
 * card in its lane. A hand-off and a CLI's own sub-agent show under the card of
 * the conversation that started them, framed in the sub-session colour.
 */
export const SessionBoard = memo(function SessionBoard({
  lanes,
  spaces,
  youId,
  current,
  onOpen,
}: {
  lanes: Record<SessionLane, SessionCard[]>;
  spaces: Space[];
  youId?: string;
  /** The conversations on show in a column. */
  current: readonly string[];
  /** Shows a conversation in a column; a sub-agent opens the conversation it works for. */
  onOpen: (card: SessionCard) => void;
}) {
  // The idle lane folds away on request, as Orca keeps its idle lane out of the way.
  const [openLane, setOpenLane] = useState(true);
  // Times say "how long ago": they move on once a minute.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const total = boardCards(lanes).length;
  const shown = sessionLanes.filter((lane) => lanes[lane].length);
  const owner = (scopeId: string) =>
    scopeId === youId ? undefined : spaces.find((space) => space.scopeId === scopeId);

  const renderCard = (item: SessionCard, sub = false) => {
    const space = owner(item.scopeId);
    const ownerName = space?.name ?? 'irori agent';
    const working = item.state === 'running' || item.state === 'waiting';
    const subAgents =
      working || item.state === 'done' || item.state === 'stopped' || item.state === 'failed'
        ? item.subAgents
        : [];
    return (
      <li key={item.id}>
        <button
          className={`session-card ${item.state} ${sub ? 'sub hand-off' : ''} ${current.includes(item.id) ? 'current' : ''}`}
          title={`${item.title} · ${ownerName} · ${agentNames[item.agent]}`}
          aria-label={`${item.title} · ${sessionStateWords(item.state, item.queued)}`}
          onClick={() => onOpen(item)}
        >
          <span className="session-card-head">
            {space ? (
              <BrainTile space={space} size={16} radius={5} />
            ) : (
              <span className="session-owner-mark" aria-hidden="true">
                <Icon name="agent" size={10} strokeWidth={2.2} />
              </span>
            )}
            <span className="session-card-title">{item.title}</span>
            <Dot state={item.state} queued={item.queued} />
          </span>
          {item.prompt && item.state !== 'idle' && (
            <span className="session-card-prompt">
              {t('依頼', 'You')}: {item.prompt}
            </span>
          )}
          {item.line && <span className="session-card-line">{item.line}</span>}
          <span className="session-card-foot">
            {sub && <span className="session-kind">{t('引き継ぎ', 'Hand-off')}</span>}
            <span className="session-card-owner">{ownerName}</span>
            <span>{agentNames[item.agent]}</span>
            <span className="session-card-time">{sinceWords(item.changedAt, now)}</span>
          </span>
        </button>
        {(item.children.length > 0 || subAgents.length > 0) && (
          <ul
            className="session-subs"
            aria-label={t(`${item.title} のサブセッション`, `${item.title}'s sub-sessions`)}
          >
            {item.children.map((child) => renderCard(child, true))}
            {subAgents.map((agent) => (
              <li key={agent.call}>
                <button
                  className={`session-card sub sub-agent ${agent.state}`}
                  title={t(
                    `${item.title} のサブエージェント · 親の会話を開きます`,
                    `A sub-agent of ${item.title} · opens its conversation`,
                  )}
                  aria-label={`${agent.label || agent.kind || t('サブエージェント', 'Sub-agent')} · ${sessionStateWords(agent.state)}`}
                  onClick={() => onOpen(item)}
                >
                  <span className="session-card-head">
                    <Icon name="users" size={12} className="session-sub-mark" />
                    <span className="session-card-title">
                      {agent.label || agent.kind || t('サブエージェント', 'Sub-agent')}
                    </span>
                    <Dot state={agent.state} />
                  </span>
                  <span className="session-card-foot">
                    <span className="session-kind">{t('サブエージェント', 'Sub-agent')}</span>
                    {agent.kind && agent.label && <span>{agent.kind}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <aside className="session-board" aria-label={t('セッションボード', 'Session board')}>
      <header className="session-board-head">
        <span>{t('セッション', 'Sessions')}</span>
        {total > 0 && <span className="session-count">{countLabel(total)}</span>}
      </header>
      <div className="session-lanes">
        {!shown.length && (
          <p className="session-empty">
            {t(
              '動いている会話はありません。会話を始めると、ここにカードが出ます。',
              'No conversation is doing anything. Start one and its card shows here.',
            )}
          </p>
        )}
        {shown.map((lane) => {
          const folded = lane === 'open' && !openLane;
          return (
            <section key={lane} className={`session-lane ${lane}`} aria-label={laneNames[lane]()}>
              <h3>
                {lane === 'open' ? (
                  <button aria-expanded={!folded} onClick={() => setOpenLane((value) => !value)}>
                    <Icon name="chevron" size={11} className="session-lane-chevron" />
                    {laneNames[lane]()}
                  </button>
                ) : (
                  <span>{laneNames[lane]()}</span>
                )}
                <span className="session-count">{countLabel(lanes[lane].length)}</span>
              </h3>
              {!folded && <ul>{lanes[lane].map((item) => renderCard(item))}</ul>}
            </section>
          );
        })}
      </div>
    </aside>
  );
});
