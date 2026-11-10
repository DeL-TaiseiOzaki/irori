import { memo } from 'react';
import { countLabel } from './display';
import type { GitStatus } from '../domain/git';
import type { Space } from '../domain/types';
import { t } from '../domain/i18n';
import { appVersion } from './branding';
import { BrainTile } from './BrainTile';
import { Icon } from './Icon';
import { useLanguage } from './useLanguage';
import { useWindowItems } from './useWindowItems';

/**
 * The brain on show and the AI across brains, along the window's foot. Its branch, the
 * terminal and the version are there when the settings show them (ADR 059); an open
 * terminal keeps its button, so what is open can always be closed from here.
 * Memoised: it re-renders for its own data, not for every keystroke in the editor.
 */
export const StatusBar = memo(function StatusBar({
  space,
  git,
  running,
  waiting,
  status,
  terminalOpen,
  terminalDisabled,
  onAi,
  onTerminal,
}: {
  space?: Space;
  git?: GitStatus;
  running: number;
  waiting: number;
  /** The latest message about the workspace, such as a save or a move. */
  status: string;
  terminalOpen: boolean;
  terminalDisabled: boolean;
  onAi: () => void;
  onTerminal: () => void;
}) {
  useLanguage();
  const shown = useWindowItems();
  return (
    <footer className="status-bar chrome">
      {space && (
        <span className="status-item plain status-vault" title={space.name}>
          <BrainTile space={space} size={15} radius={4} />
          <span>{space.name}</span>
        </span>
      )}
      {shown.branch && git?.available && git.branch && (
        <span className="status-item plain">
          <Icon name="branch" size={12} />
          {git.branch}
          {!!git.ahead && <span className="mono">↑{countLabel(git.ahead)}</span>}
          {!!git.behind && <span className="mono">↓{countLabel(git.behind)}</span>}
        </span>
      )}
      <span className="status-message" role="status">
        {status}
      </span>
      <button className="status-item ai-summary" onClick={onAi}>
        <Icon name="agent" size={13} />
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
      {(shown.terminal || terminalOpen) && (
        <button
          className="status-item"
          aria-pressed={terminalOpen}
          disabled={terminalDisabled}
          onClick={onTerminal}
        >
          <Icon name="terminal" size={12} />
          {t('ターミナル', 'Terminal')}
        </button>
      )}
      {shown.version && <span className="status-version">{appVersion}</span>}
    </footer>
  );
});
