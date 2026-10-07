import { useState } from 'react';
import { repositoryFolder, type AddSubmodule, type GitSubmodule } from '../domain/git';
import { t } from '../domain/i18n';
import { Dialog } from './Dialog';
import { ErrorMessage } from './ErrorMessage';
import { useAction } from './useAction';
import { Icon } from './Icon';
import { ArrowFillButton } from './obsidian/ArrowFillButton';

/** Chooses which of the hibachi's repositories the Changes view shows (ADR 022). */
export function RepositoryPicker({
  name,
  submodules,
  value,
  disabled,
  onChange,
}: {
  name: string;
  submodules: GitSubmodule[];
  value: string;
  disabled: boolean;
  onChange: (repository: string) => void;
}) {
  return (
    <label className="git-repositories">
      <Icon name="layers" size={14} />
      <select
        aria-label={t('リポジトリ', 'Repository')}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{name}</option>
        {submodules.map((m) => (
          <option key={m.path} value={m.path}>
            {m.path}
            {!m.initialized ? t('（未取得）', ' (not fetched)') : m.changed ? ' ●' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A submodule whose files are not here yet. */
export function UnfetchedSubmodule({
  submodule,
  busy,
  error,
  onFetch,
}: {
  submodule: GitSubmodule;
  busy: boolean;
  error: string;
  onFetch: () => void;
}) {
  return (
    <div className="git-empty">
      <h2>{t('未取得', 'Not fetched')}</h2>
      <p>{submodule.repository ?? submodule.path}</p>
      {error && <ErrorMessage className="git-notice error" text={error} />}
      <button className="solid-button" disabled={busy} onClick={onFetch}>
        <Icon name="down" size={14} />
        {busy ? t('取得しています…', 'Fetching…') : t('取得', 'Fetch')}
      </button>
    </div>
  );
}

/** Clones a GitHub repository into a new folder of the hibachi as a submodule. */
export function AddSubmoduleDialog({
  add,
  onCancel,
}: {
  /** Rejects with the reason when the submodule was not added. */
  add: (value: AddSubmodule) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<AddSubmodule>({ url: '', path: '' }),
    [named, setNamed] = useState(false);
  const { busy, error, run } = useAction();
  async function submit() {
    await run(() =>
      add({ url: value.url.trim(), path: value.path.trim().replace(/^\/+|\/+$/g, '') }),
    );
  }
  return (
    <Dialog label={t('submodule を追加', 'Add a submodule')} busy={busy} onClose={onCancel}>
      <form
        className="modal"
        aria-label={t('submodule を追加', 'Add a submodule')}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2>{t('submodule を追加', 'Add a submodule')}</h2>
        <fieldset disabled={busy}>
          <label>
            {t('GitHub のリポジトリ URL', 'GitHub repository URL')}
            <input
              aria-label={t('GitHub のリポジトリ URL', 'GitHub repository URL')}
              value={value.url}
              onChange={(e) => {
                const url = e.target.value;
                // The folder follows the repository's name until it is named by hand.
                setValue({ url, path: named ? value.path : repositoryFolder(url) });
              }}
              placeholder="https://github.com/owner/repository"
              required
            />
          </label>
          <label>
            {t('フォルダ', 'Folder')}
            <input
              aria-label={t('フォルダ', 'Folder')}
              value={value.path}
              onChange={(e) => {
                setNamed(true);
                setValue({ ...value, path: e.target.value });
              }}
              placeholder="projects/repository"
              required
            />
          </label>
        </fieldset>
        {error && <ErrorMessage text={error} />}
        {busy && <p role="status">{t('取得しています…', 'Fetching…')}</p>}
        <div className="actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            {t('キャンセル', 'Cancel')}
          </button>
          <ArrowFillButton type="submit" disabled={busy || !value.url.trim() || !value.path.trim()}>
            {t('追加', 'Add')}
          </ArrowFillButton>
        </div>
      </form>
    </Dialog>
  );
}
