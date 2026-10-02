import type { GitStatus } from '../domain/git';
import type { Space } from '../domain/types';
import { t } from '../domain/i18n';
import { appVersion } from './branding';
import { BrainTile } from './BrainTile';
import { Icon } from './Icon';

/**
 * The workspace, the brain on show with its branch, the AI
 * across brains, the terminal and the version, along the window's foot.
 */
export function StatusBar({
  workspace,
  space,
  git,
  running,
  waiting,
  status,
  workspaceDisabled,
  terminalOpen,
  terminalDisabled,
  onWorkspace,
  onAi,
  onTerminal,
}: {
  workspace: string;
  space?: Space;
  git?: GitStatus;
  running: number;
  waiting: number;
  /** The latest message about the workspace, such as a save or a move. */
  status: string;
  workspaceDisabled: boolean;
  terminalOpen: boolean;
  terminalDisabled: boolean;
  onWorkspace: () => void;
  onAi: () => void;
  onTerminal: () => void;
}) {
  return (
    <footer className="status-bar chrome">
      <button className="status-item" disabled={workspaceDisabled} onClick={onWorkspace}>
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
        <span className="status-item plain">
          <Icon name="branch" size={12} />
          {git.branch}
          {!!git.ahead && <span className="mono">↑{git.ahead}</span>}
          {!!git.behind && <span className="mono">↓{git.behind}</span>}
        </span>
      )}
      <span className="status-message" role="status">
        {status}
      </span>
      <button className="status-item ai-summary" onClick={onAi}>
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
        onClick={onTerminal}
      >
        <Icon name="terminal" size={12} />
        {t('ターミナル', 'Terminal')}
      </button>
      <span className="status-version">{appVersion}</span>
    </footer>
  );
}
