import { Dialog } from './Dialog';
import { MagnetTabs } from './obsidian/MagnetTabs';
import { ArrowFillButton } from './obsidian/ArrowFillButton';
import { useEffect, useState } from 'react';
import type { Category, Space, WorkspaceProfile } from '../domain/types';
import { appIcon, appVersion } from './branding';
import { Icon } from './Icon';
import { useResource } from './useResource';
import { UpdateNotice } from './UpdateNotice';
import { CloudRecovery } from './CloudRecovery';
import { t } from '../domain/i18n';
const host = window.irori;
export function RegisterSpace({
  onRegistered,
  onCancel,
}: {
  onRegistered: (space: Space) => void;
  onCancel: () => void;
}) {
  const [folder, setFolder] = useState(''),
    [name, setName] = useState(''),
    [category, setCategory] = useState<Category>('personal');
  const [cloneMode, setCloneMode] = useState(false),
    [url, setUrl] = useState(''),
    [parent, setParent] = useState(''),
    [cloneName, setCloneName] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [cloneNotice, setCloneNotice] = useState('');
  const repository = useResource(() => host.repositories(folder), [folder], {
    enabled: !!folder,
    delay: 250,
  });
  const info = repository.data;
  const issue = error || repository.error;
  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (cloneMode && !folder) {
        const result = await host.gitClone({ url, parent, name: cloneName });
        setFolder(result.path);
        setCloneNotice(result.notice ?? '');
        if (!name) setName(cloneName);
      } else onRegistered(await host.register(folder, name, category));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog label={t('スペース登録', 'Register space')} busy={busy} onClose={onCancel}>
      <form
        className="modal"
        aria-label={t('スペース登録', 'Register space')}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2>{t('リポジトリ・KBフォルダを登録', 'Register a repository or KB folder')}</h2>
        {!folder && (
          <MagnetTabs
            className="git-registration-mode"
            label={t('リポジトリの取得方法', 'How to get the repository')}
            value={cloneMode ? 'clone' : 'folder'}
            onValueChange={(next) => setCloneMode(next === 'clone')}
            options={[
              { value: 'folder', label: t('既存のフォルダ', 'Existing folder'), disabled: busy },
              { value: 'clone', label: t('GitHub から取得', 'Clone from GitHub'), disabled: busy },
            ]}
          />
        )}
        {cloneMode && !folder ? (
          <>
            <label>
              {t('GitHub リポジトリ URL', 'GitHub repository URL')}
              <input
                aria-label={t('GitHub リポジトリ URL', 'GitHub repository URL')}
                // Set native autofocus before showModal; React's autoFocus runs while hidden.
                ref={(input) => {
                  if (input) input.autofocus = true;
                }}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/team/knowledge.git"
                disabled={busy}
                required
              />
            </label>
            <label>
              {t('保存先の親フォルダ', 'Parent folder to save into')}
              <div className="actions">
                <input
                  aria-label={t('保存先の親フォルダ', 'Parent folder to save into')}
                  value={parent}
                  onChange={(e) => setParent(e.target.value)}
                  disabled={busy}
                  required
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void host
                      .chooseFolder()
                      .then((value) => {
                        if (value) setParent(value);
                      })
                      .catch((e) => setError(String(e)))
                  }
                >
                  {t('選択', 'Choose')}
                </button>
              </div>
            </label>
            <label>
              {t('新しいフォルダ名', 'New folder name')}
              <input
                aria-label={t('新しいフォルダ名', 'New folder name')}
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                disabled={busy}
                required
              />
            </label>
            <p className="muted">
              {t(
                '選んだ保存先に新しいフォルダを作成します。Git の既存の認証設定を使用します。',
                'Creates a new folder at the chosen destination. Uses your existing Git authentication settings.',
              )}
            </p>
          </>
        ) : (
          <label>
            {t('KBフォルダ', 'KB folder')}
            <div className="actions">
              <input
                aria-label={t('KBフォルダ', 'KB folder')}
                // Set native autofocus before showModal; React's autoFocus runs while hidden.
                ref={(input) => {
                  if (input) input.autofocus = true;
                }}
                value={folder}
                disabled={busy}
                required
                onChange={(e) => setFolder(e.target.value)}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void host
                    .chooseFolder()
                    .then((value) => {
                      if (value) {
                        setFolder(value);
                        if (!name) setName(value.split(/[/\\]/).at(-1) ?? 'My KB');
                      }
                    })
                    .catch((e) => setError(String(e)))
                }
              >
                {t('選択', 'Choose')}
              </button>
            </div>
          </label>
        )}
        <div className="repository-preview" aria-live="polite">
          {cloneNotice && <p role="alert">{cloneNotice}</p>}
          {folder && !info
            ? t('フォルダを確認しています…', 'Checking the folder…')
            : info && (
                <>
                  <strong>
                    {info.kind === 'github'
                      ? `GitHub · ${info.repository}`
                      : info.kind === 'git'
                        ? t('Gitリポジトリ', 'Git repository')
                        : info.kind === 'folder'
                          ? t('ローカルのKBフォルダ', 'Local KB folder')
                          : t('登録先を確認してください', 'Check the registration destination')}
                  </strong>
                  {info.branch && (
                    <p>
                      {info.branch} ·{' '}
                      {info.changed
                        ? t('未コミットの変更あり（保持します）', 'Uncommitted changes (kept)')
                        : t('変更なし', 'No changes')}
                    </p>
                  )}
                  {info.detail && <p>{info.detail}</p>}
                  {info.root !== folder && <p>{info.root}</p>}
                </>
              )}
        </div>
        {(!cloneMode || folder) && (
          <>
            <label>
              {t('スペース名', 'Space name')}
              <input
                aria-label={t('スペース名', 'Space name')}
                value={name}
                required
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <details>
              <summary>{t('表示分類（任意）', 'Display category (optional)')}</summary>
              <label>
                {t('種類', 'Type')}
                <select
                  aria-label={t('スペースの種類', 'Space type')}
                  value={category}
                  disabled={busy}
                  onChange={(e) => setCategory(e.target.value as Category)}
                >
                  <option value="personal">{t('個人', 'Personal')}</option>
                  <option value="team">{t('チーム', 'Team')}</option>
                  <option value="organization">{t('組織', 'Organization')}</option>
                </select>
              </label>
            </details>
            <p className="muted">
              {t(
                '登録に必要な識別情報を .irori に作成し、contents をGitの対象外にします。既存ノートとGitの変更は保持します。',
                'Creates the identifying information needed for registration in .irori and excludes contents from Git. Existing notes and Git changes are kept.',
              )}
            </p>
          </>
        )}
        {issue && <p role="alert">{issue}</p>}
        {busy && (
          <p role="status">
            {cloneMode && !folder
              ? t('リポジトリを取得しています…', 'Cloning the repository…')
              : t('登録しています…', 'Registering…')}
          </p>
        )}
        <div className="actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            {t('キャンセル', 'Cancel')}
          </button>
          <ArrowFillButton
            type="submit"
            disabled={busy || (!(cloneMode && !folder) && (!info || info.kind === 'unavailable'))}
          >
            {cloneMode && !folder
              ? t('リポジトリを取得', 'Clone repository')
              : t('登録して開く', 'Register and open')}
          </ArrowFillButton>
        </div>
      </form>
    </Dialog>
  );
}

export function Startup({
  spaces,
  refresh,
  onOpen,
}: {
  spaces: Space[];
  refresh: () => Promise<void>;
  onOpen: (workspace: WorkspaceProfile) => void;
}) {
  const [profiles, setProfiles] = useState<WorkspaceProfile[]>([]),
    [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState(t('マイワークスペース', 'My workspace')),
    [adding, setAdding] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string>();
  useEffect(() => {
    void host
      .workspaces()
      .then(setProfiles)
      .catch((e) => setError(String(e)));
  }, []);
  async function save() {
    setBusy(true);
    setError('');
    try {
      const saved = await host.saveWorkspace(name, selected, editing);
      setProfiles(await host.workspaces());
      onOpen(saved);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(profile: WorkspaceProfile) {
    setBusy(true);
    setError('');
    try {
      await host.removeWorkspace(profile.id);
      setProfiles(await host.workspaces());
      if (editing === profile.id) setEditing(undefined);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="startup">
      <aside className="startup-intro">
        <div className="brand">
          <img className="brand-icon" src={appIcon} alt="" width="40" height="40" />
          irori<span className="preview">{appVersion} Preview</span>
        </div>
        <UpdateNotice host={host} />
        <CloudRecovery />
        <div className="intro-content">
          <h2>
            {t('手元のノートと、', 'Your notes,')}
            <br />
            {t('チームの資料を。', "and your team's materials.")}
          </h2>
          <p>
            {t('リポジトリとクラウドをつないで、', 'Connect repositories and the cloud,')}
            <br />
            {t('知識を育てる作業場。', 'a workspace where knowledge grows.')}
          </p>
          <div className="intro-layer">
            <Icon name="schema" />
            <span>
              Schema<small>{t('エージェントのルール', 'Agent rules')}</small>
            </span>
          </div>
          <div className="intro-layer">
            <Icon name="book" />
            <span>
              Knowledge Base<small>{t('書いて、育てるノート', 'Notes you write and grow')}</small>
            </span>
          </div>
          <div className="intro-layer">
            <Icon name="cloud" />
            <span>
              Contents<small>{t('つながる資料とソース', 'Connected materials and sources')}</small>
            </span>
          </div>
        </div>
        <p className="intro-footnote">
          {t('あなたのファイル。あなたのワークスペース。', 'Your files. Your workspace.')}
        </p>
      </aside>
      <div className="startup-content">
        <h1>{t('ワークスペースを選択', 'Choose a workspace')}</h1>
        <p className="startup-lead">
          {t(
            '保存した環境を開くか、スペースを組み合わせて新しく始めましょう。',
            'Open a saved environment, or combine spaces to start something new.',
          )}
        </p>
        {profiles.length > 0 && (
          <section>
            <h2>{t('登録済みのワークスペース', 'Registered workspaces')}</h2>
            <div className="workspace-cards">
              {profiles.map((profile) => {
                const available = profile.scopeIds.filter((id) =>
                  spaces.some((space) => space.scopeId === id),
                );
                return (
                  <div key={profile.id}>
                    <button
                      className="workspace-card"
                      key={profile.id}
                      disabled={busy}
                      onClick={() => onOpen(profile)}
                    >
                      <Icon name="grid" size={22} />
                      <strong>{profile.name}</strong>
                      <span>
                        {t(
                          `${available.length} スペース`,
                          `${available.length} space${available.length === 1 ? '' : 's'}`,
                        )}
                        {available.length !== profile.scopeIds.length &&
                          t(
                            ` · ${profile.scopeIds.length - available.length} 件は利用できません`,
                            ` · ${profile.scopeIds.length - available.length} unavailable`,
                          )}
                      </span>
                      <Icon name="arrow" className="workspace-arrow" />
                    </button>
                    <div className="actions">
                      <button
                        disabled={busy}
                        aria-label={t(`${profile.name} を編集`, `Edit ${profile.name}`)}
                        onClick={() => {
                          setEditing(profile.id);
                          setName(profile.name);
                          setSelected(profile.scopeIds);
                          setError('');
                        }}
                      >
                        {t('編集', 'Edit')}
                      </button>
                      <button
                        disabled={busy}
                        aria-label={t(
                          `${profile.name} の登録を削除`,
                          `Remove ${profile.name} registration`,
                        )}
                        onClick={() => void remove(profile)}
                      >
                        {t('登録を削除', 'Remove registration')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="muted">
              {t(
                'KBフォルダ・ノートは残ります。Drive 接続がある場合は、接続の登録解除後にワークスペースを削除できます。',
                'The KB folder and notes remain. If there is a Drive connection, you can delete the workspace after unregistering the connection.',
              )}
            </p>
          </section>
        )}
        <section>
          <h2>
            {editing
              ? t('ワークスペースを編集', 'Edit workspace')
              : t('新しい組み合わせで開く', 'Open a new combination')}
          </h2>
          {editing && (
            <p className="muted">
              {t(
                '下で名前とスペースの組み合わせを変更して保存できます。利用できないスペースも登録を保持できます。',
                'Change the name and combination of spaces below and save. Unavailable spaces can keep their registration too.',
              )}
            </p>
          )}
          <div className="startup-spaces">
            {profiles
              .find((profile) => profile.id === editing)
              ?.scopeIds.filter((id) => !spaces.some((space) => space.scopeId === id))
              .map((id) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={selected.includes(id)}
                    onChange={(e) =>
                      setSelected((value) =>
                        e.target.checked ? [...value, id] : value.filter((item) => item !== id),
                      )
                    }
                  />
                  <span>
                    {t(
                      '利用できないスペース（登録を保持）',
                      'Unavailable space (registration kept)',
                    )}
                    <small>{id}</small>
                  </span>
                </label>
              ))}
            {spaces.map((space) => (
              <label key={space.scopeId}>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={selected.includes(space.scopeId)}
                  onChange={(e) =>
                    setSelected((value) =>
                      e.target.checked
                        ? [...value, space.scopeId]
                        : value.filter((id) => id !== space.scopeId),
                    )
                  }
                />
                <span>
                  <strong>{space.name}</strong>
                  <small>{space.root}</small>
                </span>
              </label>
            ))}
          </div>
          <button disabled={busy} onClick={() => setAdding(true)}>
            <Icon name="plus" /> {t('KBフォルダを開く', 'Open a KB folder')}
          </button>
          <p className="muted">
            {t(
              'クローン済みのリポジトリや既存フォルダを追加できます。クラウドのアカウント・フォルダは、開いた後に「クラウド接続」から登録します。',
              'You can add an already-cloned repository or an existing folder. Register cloud accounts and folders from "Cloud connection" after opening.',
            )}
          </p>
          <form
            className="actions"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <input
              aria-label={t('ワークスペース名', 'Workspace name')}
              placeholder={t('ワークスペース名', 'Workspace name')}
              value={name}
              required
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
            <ArrowFillButton type="submit" disabled={busy}>
              {editing
                ? spaces.some((space) => selected.includes(space.scopeId))
                  ? t('変更を保存して開く', 'Save changes and open')
                  : t('変更を保存', 'Save changes')
                : selected.length
                  ? t('選択したスペースを開く', 'Open the selected spaces')
                  : t('ワークスペースを作成', 'Create workspace')}
            </ArrowFillButton>
            {editing && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing(undefined);
                  setSelected([]);
                  setName(t('マイワークスペース', 'My workspace'));
                }}
              >
                {t('編集をキャンセル', 'Cancel editing')}
              </button>
            )}
          </form>
        </section>
        {error && <p role="alert">{error}</p>}
      </div>
      {adding && (
        <RegisterSpace
          onCancel={() => setAdding(false)}
          onRegistered={(space) => {
            setSelected((value) => [...value, space.scopeId]);
            setAdding(false);
            void refresh().catch((e) => setError(String(e)));
          }}
        />
      )}
    </div>
  );
}
