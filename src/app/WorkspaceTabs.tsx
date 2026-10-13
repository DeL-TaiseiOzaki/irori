import { memo } from 'react';
import type { WorkspaceProfile } from '../domain/types';
import { t } from '../domain/i18n';
import { Icon } from './Icon';
import { useLanguage } from './useLanguage';

/**
 * The open workspaces along the window's top, as a browser keeps its pages:
 * one on show, the others still running. + shows the start screen to open another.
 * Memoised: it re-renders for its own data, not for every keystroke in the editor.
 */
export const WorkspaceTabs = memo(function WorkspaceTabs({
  tabs,
  shown,
  running,
  waiting,
  disabled,
  onShow,
  onClose,
  onAdd,
}: {
  tabs: WorkspaceProfile[];
  /** The tab on show; none while the start screen is. */
  shown?: string;
  running: string[];
  waiting: string[];
  disabled: boolean;
  onShow: (profile: WorkspaceProfile) => void;
  onClose: (profile: WorkspaceProfile) => void;
  onAdd: () => void;
}) {
  useLanguage();
  const state = (profile: WorkspaceProfile) =>
    profile.scopeIds.some((id) => waiting.includes(id))
      ? 'waiting'
      : profile.scopeIds.some((id) => running.includes(id))
        ? 'running'
        : undefined;
  return (
    <nav className="workspace-tabs chrome" aria-label={t('ワークスペース', 'Workspaces')}>
      <div className="workspace-tab-list">
        {tabs.map((profile) => {
          const ai = state(profile);
          const current = profile.id === shown;
          return (
            <div key={profile.id} className="workspace-tab" data-current={current || undefined}>
              <button
                aria-current={current ? 'page' : undefined}
                className="workspace-tab-name"
                disabled={disabled}
                title={profile.name}
                aria-label={
                  ai === 'waiting'
                    ? t(`${profile.name}・許可待ち`, `${profile.name} · waiting`)
                    : ai === 'running'
                      ? t(`${profile.name}・実行中`, `${profile.name} · running`)
                      : profile.name
                }
                onClick={() => onShow(profile)}
              >
                {ai && <i className="workspace-tab-ai" data-ai={ai} aria-hidden="true" />}
                <span>{profile.name}</span>
              </button>
              <button
                className="workspace-tab-close"
                disabled={disabled}
                title={t('閉じる', 'Close')}
                aria-label={t(`${profile.name} を閉じる`, `Close ${profile.name}`)}
                onClick={() => onClose(profile)}
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        className="workspace-tab-add"
        disabled={disabled}
        title={t('ワークスペースを開く', 'Open a workspace')}
        aria-label={t('ワークスペースを開く', 'Open a workspace')}
        aria-pressed={!shown}
        onClick={onAdd}
      >
        <Icon name="plus" size={15} />
      </button>
    </nav>
  );
});
