import type { ReactNode } from 'react';
import type { Space } from '../domain/types';
import { t } from '../domain/i18n';
import { appIcon } from './branding';
import { BrainTile } from './BrainTile';
import { Icon } from './Icon';
import { shortcut } from './shortcuts';

export type BrainAiState = 'running' | 'waiting' | 'idle';

export function aiStateWords(state: BrainAiState) {
  return {
    running: t('実行中', 'Running'),
    waiting: t('許可待ち', 'Needs approval'),
    idle: t('待機', 'Idle'),
  }[state];
}

/**
 * The workspace's brains in their owner's order, with the way back to the
 * workspace choice, the Overview, adding a brain, search and settings.
 */
export function Rail({
  spaces,
  activeId,
  aiState,
  locked,
  homeDisabled,
  addDisabled,
  searchDisabled,
  onHome,
  onSelect,
  onAdd,
  onSearch,
  settings,
}: {
  spaces: Space[];
  activeId?: string;
  aiState: (scopeId: string) => BrainAiState;
  /** Another brain cannot be chosen now (a run, a send or a connection is in progress). */
  locked: boolean;
  homeDisabled: boolean;
  addDisabled: boolean;
  searchDisabled: boolean;
  onHome: () => void;
  onSelect: (space: Space) => void;
  onAdd: () => void;
  onSearch: () => void;
  settings: ReactNode;
}) {
  return (
    <nav className="rail chrome" aria-label={t('Brain', 'Brains')}>
      <button
        className="rail-home"
        aria-label={t('ワークスペースを選択', 'Choose a workspace')}
        title={t('ワークスペース', 'Workspaces')}
        disabled={homeDisabled}
        onClick={onHome}
      >
        <img src={appIcon} alt="" width="28" height="28" />
      </button>
      <div className="rail-slot">
        {/* The Overview arrives with parallel brain AIs; its place is kept. */}
        <button
          className="rail-button rail-overview"
          aria-label={t('全体（準備中）', 'Overview (coming soon)')}
          disabled
        >
          <Icon name="map" size={19} />
        </button>
        <span className="rail-label" aria-hidden="true">
          {t('全体', 'Overview')}
          <span className="rail-label-state">{t('準備中', 'Coming soon')}</span>
        </span>
      </div>
      <span className="rail-rule" aria-hidden="true" />
      {spaces.map((space) => {
        const active = space.scopeId === activeId;
        const state = aiState(space.scopeId);
        return (
          <div
            key={space.scopeId}
            className={`rail-slot rail-brain-slot ${active ? 'active' : ''}`}
            data-ai={state}
          >
            {active && <span className="rail-bar" aria-hidden="true" />}
            <button
              className="rail-brain"
              aria-label={t(
                `${space.name}・AI ${aiStateWords(state)}`,
                `${space.name} · AI ${aiStateWords(state).toLowerCase()}`,
              )}
              aria-current={active ? 'true' : undefined}
              disabled={locked && !active}
              onClick={() => onSelect(space)}
            >
              {state === 'running' && (
                <span className="rail-ring" aria-hidden="true">
                  <span />
                </span>
              )}
              <BrainTile space={space} size={40} radius={12} ring={active ? 'active' : 'panel'} />
              {state === 'waiting' && <span className="rail-dot" aria-hidden="true" />}
            </button>
            <span className="rail-label" aria-hidden="true">
              {space.name}
              <span className="rail-label-state">
                <i />
                {aiStateWords(state)}
              </span>
            </span>
          </div>
        );
      })}
      <button
        className="rail-add"
        aria-label={t('Brain を追加', 'Add a brain')}
        title={t('Brain を追加', 'Add a brain')}
        disabled={addDisabled}
        onClick={onAdd}
      >
        <Icon name="plus" size={17} />
      </button>
      <span className="rail-spacer" />
      <button
        className="rail-button"
        aria-label={t(`検索（${shortcut('K')}）`, `Search (${shortcut('K')})`)}
        title={t(`検索（${shortcut('K')}）`, `Search (${shortcut('K')})`)}
        disabled={searchDisabled}
        onClick={onSearch}
      >
        <Icon name="search" size={18} />
      </button>
      {settings}
    </nav>
  );
}
