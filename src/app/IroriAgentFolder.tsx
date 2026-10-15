import { t } from '../domain/i18n';
import { Icon } from './Icon';
import { ErrorMessage } from './ErrorMessage';
import { useAction } from './useAction';
import { useResource } from './useResource';
import { useState } from 'react';
import './irori-agent-folder.css';

const host = window.irori;

/**
 * Where the irori agent works for this workspace (ADR 044): `~/irori/you`
 * unless the workspace chose another folder. Its runs, its Schema and its
 * screens follow the choice at once; a run under way keeps its folder.
 */
export function IroriAgentFolderSection({
  workspaceId,
  showPath = true,
  onChanged,
}: {
  workspaceId: string;
  /** The irori agent's screen names the folder in its header already. */
  showPath?: boolean;
  onChanged: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const folder = useResource(() => host.iroriAgentFolder(workspaceId), [workspaceId], {
    refresh: revision,
  });
  const { busy, error, run } = useAction();
  const change = (operation: () => Promise<unknown>) =>
    run(async () => {
      await operation();
      setRevision((value) => value + 1);
      onChanged();
    });
  const current = folder.data;
  return (
    <section
      className="agent-folder"
      aria-label={t('irori agent の作業場所', 'Where the irori agent works')}
    >
      {showPath && (
        <span className="agent-folder-path mono" title={current?.path}>
          <bdi dir="ltr">{current?.path ?? ''}</bdi>
        </span>
      )}
      {current?.missing && (
        <small role="alert">
          {t(
            `${current.missing} が見つからないため、既定のフォルダを使っています。`,
            `${current.missing} is not there, so the default folder is used.`,
          )}
        </small>
      )}
      <div className="agent-folder-actions">
        <button
          type="button"
          className="stage-text-button framed"
          disabled={busy || !current}
          onClick={() => void run(() => host.openIroriAgentFolder(workspaceId))}
        >
          <Icon name="folder" size={15} />
          {t('開く', 'Open')}
        </button>
        <button
          type="button"
          className="stage-text-button framed"
          disabled={busy}
          onClick={() =>
            void change(async () => {
              const chosen = await host.chooseFolder();
              if (chosen) await host.setIroriAgentFolder(workspaceId, chosen);
            })
          }
        >
          {t('フォルダを選ぶ', 'Choose a folder')}
        </button>
        {current?.chosen && (
          <button
            type="button"
            className="stage-text-button framed"
            disabled={busy}
            onClick={() => void change(() => host.setIroriAgentFolder(workspaceId, null))}
          >
            {t('既定に戻す', 'Use the default')}
          </button>
        )}
      </div>
      {(error || folder.error) && <ErrorMessage text={error || folder.error!} />}
    </section>
  );
}
