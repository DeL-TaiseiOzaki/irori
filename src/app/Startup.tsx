import { Dialog } from './Dialog';
import { MagnetTabs } from './obsidian/MagnetTabs';
import { ArrowFillButton } from './obsidian/ArrowFillButton';
import { useEffect, useState } from 'react';
import type { Category, Space, WorkspaceProfile } from '../domain/types';
import { appIcon, appVersion } from './branding';
import { Icon } from './Icon';
import { useResource } from './useResource';
import { UpdateNotice } from './UpdateNotice';
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
    <Dialog label="スペース登録" busy={busy} onClose={onCancel}>
      <form
        className="modal"
        aria-label="スペース登録"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2>リポジトリ・KBフォルダを登録</h2>
        {!folder && (
          <MagnetTabs
            className="git-registration-mode"
            label="リポジトリの取得方法"
            value={cloneMode ? 'clone' : 'folder'}
            onValueChange={(next) => setCloneMode(next === 'clone')}
            options={[
              { value: 'folder', label: '既存のフォルダ', disabled: busy },
              { value: 'clone', label: 'GitHub から取得', disabled: busy },
            ]}
          />
        )}
        {cloneMode && !folder ? (
          <>
            <label>
              GitHub リポジトリ URL
              <input
                aria-label="GitHub リポジトリ URL"
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
              保存先の親フォルダ
              <div className="actions">
                <input
                  aria-label="保存先の親フォルダ"
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
                  選択
                </button>
              </div>
            </label>
            <label>
              新しいフォルダ名
              <input
                aria-label="新しいフォルダ名"
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                disabled={busy}
                required
              />
            </label>
            <p className="muted">
              選んだ保存先に新しいフォルダを作成します。Git の既存の認証設定を使用します。
            </p>
          </>
        ) : (
          <label>
            KBフォルダ
            <div className="actions">
              <input
                aria-label="KBフォルダ"
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
                選択
              </button>
            </div>
          </label>
        )}
        <div className="repository-preview" aria-live="polite">
          {cloneNotice && <p role="alert">{cloneNotice}</p>}
          {folder && !info
            ? 'フォルダを確認しています…'
            : info && (
                <>
                  <strong>
                    {info.kind === 'github'
                      ? `GitHub · ${info.repository}`
                      : info.kind === 'git'
                        ? 'Gitリポジトリ'
                        : info.kind === 'folder'
                          ? 'ローカルのKBフォルダ'
                          : '登録先を確認してください'}
                  </strong>
                  {info.branch && (
                    <p>
                      {info.branch} ·{' '}
                      {info.changed ? '未コミットの変更あり（保持します）' : '変更なし'}
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
              スペース名
              <input
                aria-label="スペース名"
                value={name}
                required
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <details>
              <summary>表示分類（任意）</summary>
              <label>
                種類
                <select
                  aria-label="スペースの種類"
                  value={category}
                  disabled={busy}
                  onChange={(e) => setCategory(e.target.value as Category)}
                >
                  <option value="personal">個人</option>
                  <option value="team">チーム</option>
                  <option value="organization">組織</option>
                </select>
              </label>
            </details>
            <p className="muted">
              登録に必要な識別情報を .irori に作成し、contents
              をGitの対象外にします。既存ノートとGitの変更は保持します。
            </p>
          </>
        )}
        {issue && <p role="alert">{issue}</p>}
        {busy && (
          <p role="status">
            {cloneMode && !folder ? 'リポジトリを取得しています…' : '登録しています…'}
          </p>
        )}
        <div className="actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            キャンセル
          </button>
          <ArrowFillButton
            type="submit"
            disabled={busy || (!(cloneMode && !folder) && (!info || info.kind === 'unavailable'))}
          >
            {cloneMode && !folder ? 'リポジトリを取得' : '登録して開く'}
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
  const [name, setName] = useState('マイワークスペース'),
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
        <UpdateNotice check={host.checkForUpdates} open={host.openUpdatePage} />
        <div className="intro-content">
          <h2>
            手元のノートと、
            <br />
            チームの資料を。
          </h2>
          <p>
            リポジトリとクラウドをつないで、
            <br />
            知識を育てる作業場。
          </p>
          <div className="intro-layer">
            <Icon name="schema" />
            <span>
              Schema<small>エージェントのルール</small>
            </span>
          </div>
          <div className="intro-layer">
            <Icon name="book" />
            <span>
              Knowledge Base<small>書いて、育てるノート</small>
            </span>
          </div>
          <div className="intro-layer">
            <Icon name="cloud" />
            <span>
              Contents<small>つながる資料とソース</small>
            </span>
          </div>
        </div>
        <p className="intro-footnote">あなたのファイル。あなたのワークスペース。</p>
      </aside>
      <div className="startup-content">
        <h1>ワークスペースを選択</h1>
        <p className="startup-lead">
          保存した環境を開くか、スペースを組み合わせて新しく始めましょう。
        </p>
        {profiles.length > 0 && (
          <section>
            <h2>登録済みのワークスペース</h2>
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
                        {available.length} スペース
                        {available.length !== profile.scopeIds.length &&
                          ` · ${profile.scopeIds.length - available.length} 件は利用できません`}
                      </span>
                      <Icon name="arrow" className="workspace-arrow" />
                    </button>
                    <div className="actions">
                      <button
                        disabled={busy}
                        aria-label={`${profile.name} を編集`}
                        onClick={() => {
                          setEditing(profile.id);
                          setName(profile.name);
                          setSelected(profile.scopeIds);
                          setError('');
                        }}
                      >
                        編集
                      </button>
                      <button
                        disabled={busy}
                        aria-label={`${profile.name} の登録を削除`}
                        onClick={() => void remove(profile)}
                      >
                        登録を削除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="muted">
              KBフォルダ・ノートは残ります。Drive
              接続がある場合は、接続の登録解除後にワークスペースを削除できます。
            </p>
          </section>
        )}
        <section>
          <h2>{editing ? 'ワークスペースを編集' : '新しい組み合わせで開く'}</h2>
          {editing && (
            <p className="muted">
              下で名前とスペースの組み合わせを変更して保存できます。利用できないスペースも登録を保持できます。
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
                    利用できないスペース（登録を保持）<small>{id}</small>
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
            <Icon name="plus" /> KBフォルダを開く
          </button>
          <p className="muted">
            クローン済みのリポジトリや既存フォルダを追加できます。クラウドのアカウント・フォルダは、開いた後に「クラウド接続」から登録します。
          </p>
          <form
            className="actions"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <input
              aria-label="ワークスペース名"
              placeholder="ワークスペース名"
              value={name}
              required
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
            <ArrowFillButton type="submit" disabled={busy}>
              {editing
                ? spaces.some((space) => selected.includes(space.scopeId))
                  ? '変更を保存して開く'
                  : '変更を保存'
                : selected.length
                  ? '選択したスペースを開く'
                  : 'ワークスペースを作成'}
            </ArrowFillButton>
            {editing && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing(undefined);
                  setSelected([]);
                  setName('マイワークスペース');
                }}
              >
                編集をキャンセル
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
