import { useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { githubPage, linkedRepositories, type LinkedRepository } from '../domain/git';
import type { CloudConnection, Space } from '../domain/types';
import { t } from '../domain/i18n';
import { errorText } from './ErrorMessage';
import { Icon } from './Icon';
import { useResource } from './useResource';
import './vault-repositories.css';

const host = window.irori;

const kindNames: Record<LinkedRepository['kind'], () => string> = {
  vault: () => t('この vault', 'This vault'),
  submodule: () => t('サブモジュール', 'Submodule'),
  contents: () => 'contents',
};

/**
 * The GitHub repositories and branches a vault's knowledge is tied to — its
 * own repository, its submodules and the repositories connected in contents —
 * in one list, each opening on GitHub.
 */
export function VaultRepositories({
  space,
  connections,
  className,
}: {
  space: Space;
  connections: CloudConnection[];
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const label = t('GitHub リポジトリとブランチ', 'GitHub repositories and branches');
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={className} aria-label={label} title={label}>
        <Icon name="branch" size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6}>
          <Popover.Popup
            className="vault-repositories"
            initialFocus={(interaction) => interaction === 'keyboard'}
          >
            <div className="vault-repositories-heading">
              <Popover.Title render={<strong />}>{label}</Popover.Title>
              <Popover.Close className="icon-button" aria-label={t('閉じる', 'Close')}>
                <Icon name="close" />
              </Popover.Close>
            </div>
            {open && <RepositoryList space={space} connections={connections} />}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function RepositoryList({ space, connections }: { space: Space; connections: CloudConnection[] }) {
  const [error, setError] = useState('');
  // Read when the list opens, so it names the branches checked out now.
  const status = useResource(() => host.gitStatus(space.scopeId), [space.scopeId]);
  const submodules = useResource(() => host.gitSubmodules(space.scopeId), [space.scopeId]);
  if (!status.data && !status.error)
    return <p className="vault-repositories-note">{t('確認しています…', 'Checking…')}</p>;
  const list = linkedRepositories(status.data, submodules.data?.submodules ?? [], connections);
  return (
    <>
      {!list.length && (
        <p className="vault-repositories-note">
          {status.data?.detail ?? t('Git リポジトリがありません。', 'No Git repository.')}
        </p>
      )}
      <ul className="vault-repositories-list">
        {list.map((item) => (
          <li key={`${item.kind}:${item.place}`}>
            <div className="vault-repositories-row">
              <span className="vault-repositories-name mono">
                {item.repository ??
                  (item.remote
                    ? item.remote
                    : item.kind === 'vault'
                      ? t('GitHub に未公開', 'Not on GitHub')
                      : t('GitHub 以外', 'Not on GitHub'))}
              </span>
              {item.repository && (
                <button
                  className="vault-repositories-open"
                  onClick={() =>
                    void host
                      .openUrl(githubPage(item.repository!, item.branch))
                      .catch((e) => setError(errorText(e)))
                  }
                >
                  <Icon name="link" size={13} />
                  {t('GitHub で開く', 'Open on GitHub')}
                </button>
              )}
            </div>
            <div className="vault-repositories-meta">
              <span>{kindNames[item.kind]()}</span>
              {item.place && <span className="mono">{item.place}</span>}
              <span className="vault-repositories-branch">
                <Icon name="branch" size={12} />
                {item.branch ??
                  (item.kind === 'contents'
                    ? t('既定のブランチ', 'Default branch')
                    : item.absent
                      ? t('未取得', 'Not fetched')
                      : t('ブランチなし', 'No branch'))}
              </span>
              {item.absent && item.kind === 'contents' && (
                <span>{t('このコンピューターには未取得', 'Not cloned on this computer')}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p className="vault-repositories-note" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
