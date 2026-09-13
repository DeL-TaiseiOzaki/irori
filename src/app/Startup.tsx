import { useEffect, useState } from 'react';
import type { Category, RepositoryInfo, Space, WorkspaceProfile } from '../domain/types';
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
  const [info, setInfo] = useState<RepositoryInfo>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    setInfo(undefined);
    const timer = setTimeout(() => {
      if (folder)
        void host
          .repositories(folder)
          .then((value) => {
            if (current) setInfo(value);
          })
          .catch((e) => {
            if (current) setError(String(e));
          });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [folder]);
  async function submit() {
    setBusy(true);
    setError('');
    try {
      onRegistered(await host.register(folder, name, category));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        aria-label="スペース登録"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2>リポジトリ・KBフォルダを登録</h2>
        <label>
          KBフォルダ
          <div className="actions">
            <input
              aria-label="KBフォルダ"
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
        <div className="repository-preview" aria-live="polite">
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
        <p className="muted">
          登録に必要な識別情報を .irori に作成し、contents
          をGitの対象外にします。既存ノートとGitの変更は保持します。
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            キャンセル
          </button>
          <button className="primary" disabled={busy || !info || info.kind === 'unavailable'}>
            登録して開く
          </button>
        </div>
      </form>
    </div>
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
      if (spaces.some((space) => saved.scopeIds.includes(space.scopeId))) onOpen(saved);
      else setEditing(undefined);
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
      <div className="brand">
        <span className="hearth">▪</span>irori<span className="preview">preview</span>
      </div>
      <div className="startup-content">
        <p className="eyebrow">REPOSITORIES + CLOUD FOLDERS</p>
        <h1>ワークスペースを選択</h1>
        <p>複数のリポジトリとクラウドの資料を、ひとつの作業環境に。</p>
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
                      disabled={busy || !available.length}
                      onClick={() => onOpen(profile)}
                    >
                      <strong>{profile.name}</strong>
                      <span>
                        {available.length} スペース
                        {available.length !== profile.scopeIds.length &&
                          ` · ${profile.scopeIds.length - available.length} 件は利用できません`}
                      </span>
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
            <p className="muted">登録を削除しても、KBフォルダ・ノート・クラウド接続は残ります。</p>
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
            KBフォルダを開く
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
            <button className="primary" disabled={busy || !selected.length}>
              {editing
                ? spaces.some((space) => selected.includes(space.scopeId))
                  ? '変更を保存して開く'
                  : '変更を保存'
                : '選択したスペースを開く'}
            </button>
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
