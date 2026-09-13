import { useEffect, useState } from 'react';
import type {
  CloudAccount,
  CloudConnection,
  CloudFolder,
  CloudSetup,
  Space,
} from '../domain/types';
import { mountNameError } from '../domain/connections';
const host = window.irori;
const states = {
  unconfigured: 'アカウント未設定',
  disconnected: '未接続',
  connecting: '接続中',
  mounted: '接続済み・読み取り専用',
  error: '接続を確認してください',
};

export function Connections({
  space,
  running,
  onClose,
}: {
  space: Space;
  running: boolean;
  onClose: () => void;
}) {
  const [setup, setSetup] = useState<CloudSetup>(),
    [accounts, setAccounts] = useState<CloudAccount[]>([]),
    [connections, setConnections] = useState<CloudConnection[]>([]);
  const [accountId, setAccountId] = useState(''),
    [accountName, setAccountName] = useState('');
  const [drives, setDrives] = useState<CloudFolder[]>([]),
    [trail, setTrail] = useState<CloudFolder[]>([]),
    [folders, setFolders] = useState<CloudFolder[]>([]);
  const [selected, setSelected] = useState<CloudFolder>(),
    [name, setName] = useState(''),
    [contentsRoot, setContentsRoot] = useState(space.contents[0]);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loadingDrives, setLoadingDrives] = useState(false),
    [loadingFolders, setLoadingFolders] = useState(false),
    [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<string>(),
    [newName, setNewName] = useState('');
  const current = trail.at(-1);
  const loading = loadingDrives || loadingFolders;
  useEffect(() => {
    let live = true;
    void host
      .cloudSetup()
      .then((value) => {
        if (live) setSetup(value);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      void Promise.all([host.cloudAccounts(), host.cloudConnections(space.scopeId)])
        .then(([a, c]) => {
          if (live) {
            setAccounts(a);
            setConnections(c);
          }
        })
        .catch((e) => {
          if (live) setError(String(e));
        })
        .finally(() => {
          if (live) timer = setTimeout(update, 2000);
        });
    };
    update();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [space.scopeId, revision]);
  useEffect(() => {
    let live = true;
    setDrives([]);
    setTrail([]);
    setFolders([]);
    setSelected(undefined);
    setName('');
    setLoadingDrives(false);
    if (accountId) {
      setLoadingDrives(true);
      void host
        .cloudDrives(accountId)
        .then((value) => {
          if (live) {
            setDrives(value);
            setTrail(value.length ? [value[0]] : []);
          }
        })
        .catch((e) => {
          if (live) setError(String(e));
        })
        .finally(() => {
          if (live) setLoadingDrives(false);
        });
    }
    return () => {
      live = false;
    };
  }, [accountId]);
  useEffect(() => {
    let live = true;
    setFolders([]);
    setSelected(undefined);
    setName('');
    setLoadingFolders(false);
    if (accountId && current) {
      setLoadingFolders(true);
      void host
        .cloudFolders(accountId, current.id, current.driveId)
        .then((value) => {
          if (live) setFolders(value);
        })
        .catch((e) => {
          if (live) setError(String(e));
        })
        .finally(() => {
          if (live) setLoadingFolders(false);
        });
    }
    return () => {
      live = false;
    };
  }, [accountId, current?.id, current?.driveId]);
  async function perform(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      setRevision((v) => v + 1);
    } catch (e) {
      setError(String(e));
      setRevision((v) => v + 1);
    } finally {
      setBusy(false);
    }
  }
  const disabled = busy || running;
  const invalidName = selected ? mountNameError(name) : undefined;
  return (
    <div className="modal-backdrop">
      <div className="modal connections" role="dialog" aria-modal="true" aria-label="クラウド接続">
        <div className="actions">
          <h2>{space.name} のクラウド接続</h2>
          <button disabled={busy} onClick={onClose}>
            閉じる
          </button>
        </div>
        <p>Google Driveのフォルダを、このスペースのcontentsに接続します。</p>
        <p className="setup-state" role="status">
          {setup
            ? `${setup.version ? `rclone ${setup.version} · ` : ''}${setup.detail}`
            : '接続機能を確認しています…'}
        </p>
        {setup && !setup.oauthConfigured && (
          <p>
            このビルドではGoogleログインの配布設定が未完了です。新しいアカウントの追加は利用できません。
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <section>
          <h3>1. アカウント</h3>
          {accounts.map((account) => (
            <div className="account-row" key={account.id}>
              <span>
                <strong>{account.name}</strong> ·{' '}
                {account.state === 'ready'
                  ? '認証済み'
                  : account.state === 'authorizing'
                    ? 'ブラウザでログインしてください'
                    : '認証未完了'}
                {account.detail && <small>{account.detail}</small>}
              </span>
              {account.state !== 'ready' && (
                <button
                  disabled={disabled}
                  onClick={() => void perform(() => host.cancelCloudAccount(account.id))}
                >
                  認証を取り消す
                </button>
              )}
              {account.state === 'ready' && (
                <button
                  disabled={disabled || accounts.some((item) => item.state === 'authorizing')}
                  onClick={() =>
                    void perform(async () => {
                      await host.removeCloudAccount(account.id);
                      if (accountId === account.id) setAccountId('');
                    })
                  }
                >
                  アカウントの登録解除
                </button>
              )}
            </div>
          ))}
          <form
            className="actions"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                await host.addCloudAccount(accountName);
                setAccountName('');
              });
            }}
          >
            <input
              aria-label="アカウントの表示名"
              placeholder="個人用、仕事用など"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              required
            />
            <button
              disabled={
                disabled ||
                !setup?.available ||
                !setup.oauthConfigured ||
                accounts.some((item) => item.state === 'authorizing')
              }
            >
              Googleアカウントを追加
            </button>
          </form>
        </section>
        <section>
          <h3>2. フォルダとマウント先</h3>
          <label>
            使用するアカウント
            <select
              aria-label="使用するクラウドアカウント"
              value={accountId}
              disabled={disabled}
              onChange={(e) => {
                setTrail([]);
                setSelected(undefined);
                setDrives([]);
                setFolders([]);
                setError('');
                setAccountId(e.target.value);
              }}
            >
              <option value="">アカウントを選択</option>
              {accounts
                .filter((a) => a.state === 'ready')
                .map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          {drives.length > 0 && (
            <label>
              ドライブ
              <select
                aria-label="ドライブ"
                disabled={disabled || loading}
                value={trail[0]?.id ?? ''}
                onChange={(e) => setTrail([drives.find((drive) => drive.id === e.target.value)!])}
              >
                {drives.map((drive) => (
                  <option key={drive.id} value={drive.id}>
                    {drive.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {current && (
            <>
              <div className="folder-trail">
                {trail.map((folder, i) => (
                  <button
                    disabled={disabled}
                    key={`${folder.id}-${i}`}
                    onClick={() => setTrail((all) => all.slice(0, i + 1))}
                  >
                    {folder.name}
                  </button>
                ))}
              </div>
              {loading ? (
                <p>フォルダを読み込んでいます…</p>
              ) : (
                <div className="cloud-folders">
                  {folders.map((folder) => (
                    <div className="folder-row" key={folder.id}>
                      <label>
                        <input
                          type="radio"
                          name="cloud-folder"
                          checked={selected?.id === folder.id}
                          disabled={disabled}
                          onChange={() => {
                            setSelected(folder);
                            setName(folder.name);
                          }}
                        />
                        <span>
                          {folder.name}
                          <small>…{folder.id.slice(-8)}</small>
                        </span>
                      </label>
                      <button
                        disabled={disabled}
                        onClick={() => setTrail((all) => [...all, folder])}
                      >
                        開く
                      </button>
                    </div>
                  ))}
                  {folders.length === 0 && (
                    <p className="muted">この場所にはフォルダがありません。</p>
                  )}
                </div>
              )}
            </>
          )}
          {selected && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void perform(async () => {
                  const connection = await host.addCloudAttachment({
                    scopeId: space.scopeId,
                    accountId,
                    folder: selected,
                    contentsRoot,
                    name,
                  });
                  setSelected(undefined);
                  setName('');
                  if (setup?.mountAvailable)
                    await host.connectCloud(space.scopeId, connection.mountId);
                });
              }}
            >
              {space.contents.length > 1 && (
                <label>
                  contentsの配置先
                  <select
                    aria-label="contentsの配置先"
                    value={contentsRoot}
                    disabled={disabled}
                    onChange={(e) => setContentsRoot(e.target.value)}
                  >
                    {space.contents.map((root) => (
                      <option key={root}>{root}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                contents内のフォルダ名
                <input
                  aria-label="contents内のフォルダ名"
                  value={name}
                  disabled={disabled}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
              <p className="mount-preview" aria-live="polite">
                マウント先: {contentsRoot}/{name}/
              </p>
              {invalidName && <p role="alert">{invalidName}</p>}
              <p className="muted">
                読み取り専用で登録します。この名前をKBの接続情報に保存し、再接続時にも使用します。
              </p>
              <button className="primary" disabled={disabled || !!invalidName}>
                {setup?.mountAvailable ? '登録して接続' : '接続先を登録'}
              </button>
            </form>
          )}
        </section>
        <section>
          <h3>登録済みの接続先</h3>
          {connections.length === 0 && <p className="muted">まだ接続先がありません。</p>}
          {connections.map((connection) => (
            <div className="connection-card" key={connection.mountId}>
              <strong>
                {connection.contentsRoot}/{connection.name}/
              </strong>
              <small>
                {connection.accountName ?? 'アカウント未設定'} · {connection.folderName}
              </small>
              <p>{states[connection.state]}</p>
              {connection.detail && <p>{connection.detail}</p>}
              <div className="actions">
                {connection.state === 'mounted' || connection.state === 'error' ? (
                  <button
                    disabled={disabled}
                    onClick={() =>
                      void perform(() => host.disconnectCloud(space.scopeId, connection.mountId))
                    }
                  >
                    接続を解除
                  </button>
                ) : null}
                {connection.state !== 'mounted' && (
                  <button
                    disabled={
                      disabled || connection.state === 'unconfigured' || !setup?.mountAvailable
                    }
                    onClick={() =>
                      void perform(() => host.connectCloud(space.scopeId, connection.mountId))
                    }
                  >
                    再接続
                  </button>
                )}
                {connection.state !== 'mounted' && (
                  <button
                    disabled={disabled || !accountId}
                    onClick={() =>
                      void perform(() =>
                        host.bindCloud(space.scopeId, connection.mountId, accountId),
                      )
                    }
                  >
                    選択中のアカウントに紐づける
                  </button>
                )}
                <button
                  disabled={
                    disabled || connection.state === 'mounted' || connection.state === 'connecting'
                  }
                  onClick={() => {
                    setEditing(connection.mountId);
                    setNewName(connection.name);
                  }}
                >
                  名前を変更
                </button>
                <button
                  disabled={
                    disabled || connection.state === 'mounted' || connection.state === 'connecting'
                  }
                  onClick={() =>
                    void perform(() => host.removeCloud(space.scopeId, connection.mountId))
                  }
                >
                  登録を解除
                </button>
              </div>
              {editing === connection.mountId && (
                <form
                  className="actions"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void perform(async () => {
                      await host.renameCloud(space.scopeId, connection.mountId, newName);
                      setEditing(undefined);
                    });
                  }}
                >
                  <input
                    aria-label="新しいマウント先のフォルダ名"
                    value={newName}
                    disabled={disabled}
                    onChange={(e) => setNewName(e.target.value)}
                    required
                  />
                  <button disabled={disabled || !!mountNameError(newName)}>名前を保存</button>
                  <button type="button" disabled={disabled} onClick={() => setEditing(undefined)}>
                    キャンセル
                  </button>
                  {mountNameError(newName) && <small role="alert">{mountNameError(newName)}</small>}
                </form>
              )}
            </div>
          ))}
          {connections.length > 0 && (
            <p className="muted">
              名前変更・登録解除は接続を解除してから行います。登録解除後もGoogle
              Driveの元フォルダと既存のローカルデータは残ります。
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
