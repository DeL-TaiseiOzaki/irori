import { useEffect, useState } from 'react';
import { suggestRepositoryName, validRepositoryName, type PublishRepository } from '../domain/git';
import { t } from '../domain/i18n';
import { Dialog } from './Dialog';
import { ErrorMessage, errorText } from './ErrorMessage';
import { ArrowFillButton } from './obsidian/ArrowFillButton';
import { useResource } from './useResource';
const host = window.irori;

/** A publication is ready once an account is chosen and the name is one GitHub accepts. */
export function publishReady(value: PublishRepository) {
  return !!value.owner && validRepositoryName(value.name);
}

export function initialPublish(from: string): PublishRepository {
  return { owner: '', name: suggestRepositoryName(from), visibility: 'private' };
}

/**
 * Where a hibachi goes on GitHub: the account or organization the GitHub CLI can
 * see, the repository name and whether others can see it (private unless chosen).
 */
export function PublishFields({
  value,
  onChange,
  disabled,
}: {
  value: PublishRepository;
  onChange: (value: PublishRepository) => void;
  disabled: boolean;
}) {
  const account = useResource(() => host.githubAccount(), []);
  const owners = account.data ? [account.data.login, ...account.data.organizations] : [];
  // The signed-in account is the default place for a new repository.
  useEffect(() => {
    if (account.data && !value.owner) onChange({ ...value, owner: account.data.login });
  }, [account.data]);
  const nameIssue = value.name && !validRepositoryName(value.name);
  return (
    <fieldset className="github-publish" disabled={disabled}>
      {account.error ? (
        <ErrorMessage text={account.error} />
      ) : (
        <label>
          {t('GitHub アカウント', 'GitHub account')}
          <select
            aria-label={t('GitHub アカウント', 'GitHub account')}
            value={value.owner}
            disabled={!account.data}
            onChange={(e) => onChange({ ...value, owner: e.target.value })}
          >
            {!account.data && <option value="">{t('確認しています…', 'Checking…')}</option>}
            {owners.map((owner) => (
              <option key={owner} value={owner}>
                {owner}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        {t('リポジトリ名', 'Repository name')}
        <input
          aria-label={t('リポジトリ名', 'Repository name')}
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder="my-knowledge"
          aria-invalid={!!nameIssue}
          required
        />
      </label>
      {nameIssue && (
        <p className="muted" role="alert">
          {t(
            '使える文字は英数字・「-」「_」「.」（末尾 .git 不可）。',
            'Use letters, digits, "-", "_" and "." (not ending in .git).',
          )}
        </p>
      )}
      <label>
        {t('公開範囲', 'Visibility')}
        <select
          aria-label={t('公開範囲', 'Visibility')}
          value={value.visibility}
          onChange={(e) =>
            onChange({ ...value, visibility: e.target.value as PublishRepository['visibility'] })
          }
        >
          <option value="private">{t('非公開（Private）', 'Private')}</option>
          <option value="public">{t('公開（Public）', 'Public')}</option>
        </select>
      </label>
      {value.visibility === 'public' && (
        <p className="muted" role="note">
          {t('公開リポジトリは誰でも閲覧できます。', 'Anyone can read a public repository.')}
        </p>
      )}
    </fieldset>
  );
}

/** Publishes a hibachi without a remote to a new GitHub repository. */
export function PublishDialog({
  suggestion,
  publish,
  onCancel,
}: {
  suggestion: string;
  /** Rejects with the reason when publishing did not finish. */
  publish: (value: PublishRepository) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(() => initialPublish(suggestion)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    try {
      await publish(value);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog label={t('GitHub に公開', 'Publish to GitHub')} busy={busy} onClose={onCancel}>
      <form
        className="modal"
        aria-label={t('GitHub に公開', 'Publish to GitHub')}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2>{t('GitHub にリポジトリを作成', 'Create a repository on GitHub')}</h2>
        <PublishFields value={value} onChange={setValue} disabled={busy} />
        {error && <ErrorMessage text={error} />}
        {busy && <p role="status">{t('GitHub に公開しています…', 'Publishing to GitHub…')}</p>}
        <div className="actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            {t('キャンセル', 'Cancel')}
          </button>
          <ArrowFillButton type="submit" disabled={busy || !publishReady(value)}>
            {t('作成して送信', 'Create and send')}
          </ArrowFillButton>
        </div>
      </form>
    </Dialog>
  );
}
