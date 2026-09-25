import type { GitStatus } from '../domain/git';
import type { Space } from '../domain/types';
import { t } from '../domain/i18n';
import { appVersion } from './branding';
import { BrainTile } from './BrainTile';
import { Icon } from './Icon';

/**
 * The workspace, the brain on show with its branch, Drive uploads, the AI
 * across brains, the terminal and the version, along the window's foot.
 */
export function StatusBar({
  workspace,
  space,
  git,
  uploads,
  running,
  waiting,
  status,
  workspaceDisabled,
  terminalOpen,
  terminalDisabled,
  aiTarget,
  onWorkspace,
  onAi,
  onTerminal,
}: {
  workspace: string;
  space?: Space;
  git?: GitStatus;
  /** Saved changes waiting to reach Google Drive in this brain. */
  uploads: number;
  running: number;
  waiting: number;
  /** The latest message about the workspace, such as a save or a move. */
  status: string;
  workspaceDisabled: boolean;
  terminalOpen: boolean;
  terminalDisabled: boolean;
  /** Where the AI summary leads: the Overview while other brains' AIs work, else the AI panel. */
  aiTarget: 'overview' | 'panel';
  onWorkspace: () => void;
  onAi: () => void;
  onTerminal: () => void;
}) {
  return (
    <footer className="status-bar chrome">
      <button
        className="status-item"
        title={t('ワークスペースを切り替え', 'Switch workspace')}
        disabled={workspaceDisabled}
        onClick={onWorkspace}
      >
        <Icon name="grid" size={13} />
        {workspace}
      </button>
      {space && (
        <span className="status-item plain">
          <BrainTile space={space} size={15} radius={4} />
          {space.name}
        </span>
      )}
      {git?.available && git.branch && (
        <span
          className="status-item plain"
          title={t(
            '取得済みのリモート履歴との比較',
            'Compared with the last fetched remote history',
          )}
        >
          <Icon name="branch" size={12} />
          {git.branch}
          {!!git.ahead && <span className="mono">↑{git.ahead}</span>}
          {!!git.behind && <span className="mono">↓{git.behind}</span>}
        </span>
      )}
      {uploads > 0 && (
        <span className="status-item plain uploads">
          <Icon name="cloudUp" size={12} className="blink" />
          {t(`Drive へ送信待ち ${uploads}`, `${uploads} waiting for Drive`)}
        </span>
      )}
      <span className="status-message" role="status">
        {status}
      </span>
      <button
        className="status-item ai-summary"
        title={
          aiTarget === 'overview'
            ? t('全体で AI を見る', 'See the AIs in the Overview')
            : t('AI パネルを開く', 'Open the AI panel')
        }
        onClick={onAi}
      >
        <Icon name="sparkles" size={13} />
        {running > 0 && (
          <span className="ai-count">
            <i className="blink" />
            {t(`実行中 ${running}`, `${running} running`)}
          </span>
        )}
        {waiting > 0 && (
          <span className="ai-count waiting">
            <i />
            {t(`許可待ち ${waiting}`, `${waiting} needs approval`)}
          </span>
        )}
        {!running && !waiting && <span>AI</span>}
      </button>
      <button
        className="status-item"
        aria-pressed={terminalOpen}
        disabled={terminalDisabled}
        title={t('ターミナル', 'Terminal') + ' (Ctrl+`)'}
        onClick={onTerminal}
      >
        <Icon name="terminal" size={12} />
        {t('ターミナル', 'Terminal')}
      </button>
      <span className="status-version">{appVersion}</span>
    </footer>
  );
}
