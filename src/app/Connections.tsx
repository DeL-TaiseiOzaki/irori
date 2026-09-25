import { Dialog } from './Dialog';
import { useEffect, useRef, useState } from 'react';
import type { CloudConnection, CloudFolder, CloudRoot } from '../domain/types';
import { mountNameError } from '../domain/connections';
import { useResource } from './useResource';
import { t } from '../domain/i18n';
const host = window.irori;
// States are looked up inside render so they resolve in the current language.
function states(): Record<CloudConnection['state'], string> {
  return {
    unconfigured: t('アカウント未設定', 'Account not set'),
    disconnected: t('未接続', 'Not connected'),
    connecting: t('接続中', 'Connecting'),
    mounted: t('接続済み・読み取り専用', 'Connected · read-only'),
    error: t('接続を確認してください', 'Check the connection'),
  };
}
function stateLabel(connection: CloudConnection) {
  if (connection.state === 'mounted' && connection.writable)
    return t('接続済み・編集できます', 'Connected · editable');
  return states()[connection.state];
}

export function Connections({
  space,
  workspaceId,
  running,
  onClose,
}: {
  space: CloudRoot;
  /** The open workspace, whose own Drive connections from earlier versions can be moved here. */
  workspaceId?: string;
  running: boolean;
  onClose: () => void;
}) {
  const [accountId, setAccountId] = useState(''),
    [accountName, setAccountName] = useState('');
  // Materials are worked on in the IDE; a folder can still be kept read-only.
  const [editable, setEditable] = useState(true);
  const [trail, setTrail] = useState<CloudFolder[]>([]);
  const [selected, setSelected] = useState<CloudFolder>(),
    [name, setName] = useState(''),
    [contentsRoot, setContentsRoot] = useState(space.contents[0]);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<string>(),
    [newName, setNewName] = useState('');
  // A folder with changes still waiting is only taken away after the person agrees.
  const [leaving, setLeaving] = useState<{ mountId: string; action: 'disconnect' | 'read-only' }>();
  const current = trail.at(-1);
  const form = useRef<HTMLFormElement>(null);
  const setupRead = useResource(() => host.cloudSetup(), [space.scopeId, revision]);
  const overview = useResource(
    () =>
      Promise.all([
        host.cloudAccounts(),
        host.cloudConnections(space.scopeId),
        workspaceId && !space.workspace ? host.cloudConnections(workspaceId) : [],
      ]),
    [space.scopeId, workspaceId, revision],
    { interval: 2000 },
  );
  const driveRead = useResource(() => host.cloudDrives(accountId), [accountId], {
    enabled: !!accountId,
  });
  const folderRead = useResource(
    () => host.cloudFolders(accountId, current!.id, current!.driveId),
    [accountId, current?.id, current?.driveId],
    { enabled: !!accountId && !!current },
  );
  const setup = setupRead.data;
  const [accounts = [], connections = [], earlier = []] = overview.data ?? [];
  const [moved, setMoved] = useState('');
  const drives = driveRead.data ?? [],
    folders = folderRead.data ?? [];
  const loading = driveRead.loading || folderRead.loading;
  const issue = error || setupRead.error || overview.error || driveRead.error || folderRead.error;
  useEffect(() => {
    setTrail(driveRead.data?.slice(0, 1) ?? []);
  }, [driveRead.data]);
  useEffect(() => {
    setSelected(undefined);
    setName('');
  }, [accountId, current?.id, current?.driveId]);
  async function perform(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setRevision((v) => v + 1);
      setBusy(false);
    }
  }
  useEffect(() => {
    // The form opens below a scrolled folder list; bring it to the reader.
    if (selected) form.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected?.id]);
  function choose(folder: CloudFolder) {
    setSelected(folder);
    setName(folder.name);
  }
  const disabled = busy || running;
  const invalidName = selected ? mountNameError(name) : undefined;
  return (
    <Dialog label={t('クラウド接続', 'Cloud connection')} busy={busy} onClose={onClose}>
      <div className="modal connections" aria-busy={!setup}>
        <div className="actions">
          <h2>{t(`${space.name} のクラウド接続`, `Cloud connections for ${space.name}`)}</h2>
          <button disabled={busy} onClick={onClose}>
            {t('閉じる', 'Close')}
          </button>
        </div>
        <p>
          {t(
            'Google Drive のフォルダを、この KB の資料（contents）に接続します。この KB で作業するエージェントからも使えます。',
            "Connects a Google Drive folder to this KB's materials (contents). Agents working in this KB can use it too.",
          )}
        </p>
        {moved && (
          <p className="moved-notice" role="status">
            {moved}
          </p>
        )}
        {earlier.length > 0 && workspaceId && (
          <section className="earlier-connections">
            <h3>
              {t(
                'ワークスペースに接続されている Drive フォルダ',
                'Drive folders connected to the workspace',
              )}
            </h3>
            <p className="muted">
              {t(
                'Drive フォルダは KB の資料に接続するようになりました。以前ワークスペースに接続したフォルダは、この KB に移すと資料として表示されます。フォルダの ID・名前・編集の設定はそのままです。',
                "Drive folders are now connected to a KB's materials. Move a folder connected to the workspace earlier into this KB to see it among the materials; its ID, name and editing setting stay.",
              )}
            </p>
            {earlier.map((connection) => (
              <div className="connection-card" key={connection.mountId}>
                <strong>{connection.name}/</strong>
                <small>
                  {connection.accountName ?? t('アカウント未設定', 'Account not set')} ·{' '}
                  {connection.folderName}
                </small>
                <div className="actions">
                  <button
                    disabled={disabled}
                    onClick={() =>
                      void perform(async () => {
                        const { duplicate } = await host.moveCloudConnection(
                          workspaceId,
                          connection.mountId,
                          space.scopeId,
                        );
                        setMoved(
                          duplicate
                            ? t(
                                `この KB にはすでに同じフォルダが接続されているため、ワークスペース側の「${connection.name}」の登録だけを解除しました。`,
                                `This KB already connects the same folder, so only the workspace's “${connection.name}” was unregistered.`,
                              )
                            : t(
                                `「${connection.name}」をこの KB の資料に移しました。`,
                                `Moved “${connection.name}” into this KB's materials.`,
                              ),
                        );
                      })
                    }
                  >
                    {t('この KB に移す', 'Move to this KB')}
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}
        {setup?.prerequisite && (
          <div className="actions">
            <button
              onClick={() => void perform(() => host.openCloudSetupHelp())}
              disabled={disabled}
            >
              {setup.prerequisite === 'winfsp'
                ? t('WinFsp のダウンロードページを開く', 'Open the WinFsp download page')
                : t('マウント機能の導入手順を開く', 'Open the mount feature setup instructions')}
            </button>
            <button onClick={() => setRevision((value) => value + 1)} disabled={disabled}>
              {t('導入後に再確認', 'Recheck after installing')}
            </button>
          </div>
        )}
        {/* Only a missing prerequisite or an unusable mount is worth a line here;
            that folders connect read-only is said where one is registered. */}
        {setup && (!setup.available || !setup.mountAvailable) && (
          <p className="setup-state" role="status">
            {setup.detail}
          </p>
        )}
        {setup && !setup.oauthConfigured && (
          <p>
            {t(
              'この検証版では Google 接続の配布準備が未完了です。接続対応版への更新が必要です。Google アカウント側の設定変更は不要です。',
              'Distribution setup for Google connections is not yet complete in this preview. An update to a connection-enabled build is required. No change to Google account settings is needed.',
            )}
          </p>
        )}
        {issue && (
          <p className="error" role="alert">
            {issue}
          </p>
        )}
        <section>
          <h3>{t('1. アカウント', '1. Account')}</h3>
          {accounts.map((account) => (
            <div className="account-row" key={account.id}>
              <span>
                <strong>{account.name}</strong> ·{' '}
                {account.state === 'ready'
                  ? account.writable
                    ? t('認証済み', 'Authenticated')
                    : t('認証済み・読み取りのみ許可', 'Authenticated · read access only')
                  : account.state === 'authorizing'
                    ? t('ブラウザでログインしてください', 'Please sign in via the browser')
                    : t('認証未完了', 'Authentication incomplete')}
                {account.detail && <small>{account.detail}</small>}
                {account.state === 'ready' && !account.writable && (
                  <small>
                    {t(
                      'フォルダを編集するには、書き込みを許可してもう一度ログインしてください。',
                      'To edit folders, allow writing and sign in again.',
                    )}
                  </small>
                )}
              </span>
              {(account.state === 'incomplete' ||
                (account.state === 'ready' && !account.writable)) && (
                <button
                  disabled={
                    disabled ||
                    !setup?.oauthConfigured ||
                    accounts.some((item) => item.state === 'authorizing')
                  }
                  onClick={() => void perform(() => host.reauthorizeCloudAccount(account.id))}
                >
                  {account.state === 'ready'
                    ? t('書き込みを許可', 'Allow writing')
                    : t('再ログイン', 'Sign in again')}
                </button>
              )}
              {account.state !== 'ready' && (
                <button
                  disabled={disabled}
                  onClick={() => void perform(() => host.cancelCloudAccount(account.id))}
                >
                  {t('認証を取り消す', 'Cancel authentication')}
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
                  {t('アカウントの登録解除', 'Remove account')}
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
              aria-label={t('アカウントの表示名', 'Account display name')}
              placeholder={t('個人用、仕事用など', 'e.g. Personal, Work')}
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
              {t('Googleアカウントを追加', 'Add Google account')}
            </button>
          </form>
        </section>
        <section>
          <h3>{t('2. フォルダとマウント先', '2. Folder and mount location')}</h3>
          <label>
            {t('使用するアカウント', 'Account to use')}
            <select
              aria-label={t('使用するクラウドアカウント', 'Cloud account to use')}
              value={accountId}
              disabled={disabled}
              onChange={(e) => {
                setTrail([]);
                setSelected(undefined);
                setError('');
                setAccountId(e.target.value);
              }}
            >
              <option value="">{t('アカウントを選択', 'Select an account')}</option>
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
              {t('ドライブ', 'Drive')}
              <select
                aria-label={t('ドライブ', 'Drive')}
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
                {/* A drive root has no parent to verify it against, so only folders
                    reached by opening can be chosen as the folder being viewed. */}
                {current.parentId && (
                  <button
                    className="choose-current"
                    aria-pressed={selected?.id === current.id}
                    disabled={disabled}
                    onClick={() => choose(current)}
                  >
                    {t(
                      `「${current.name}」を接続先にする`,
                      `Use "${current.name}" as the connection`,
                    )}
                  </button>
                )}
              </div>
              {loading ? (
                <p>{t('フォルダを読み込んでいます…', 'Loading folders…')}</p>
              ) : (
                <div className="cloud-folders">
                  {folders.map((folder) => (
                    <div
                      className={`folder-row ${selected?.id === folder.id ? 'selected' : ''}`}
                      key={folder.id}
                    >
                      <label>
                        <input
                          type="radio"
                          name="cloud-folder"
                          checked={selected?.id === folder.id}
                          disabled={disabled}
                          onChange={() => choose(folder)}
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
                        {t('開く', 'Open')}
                      </button>
                    </div>
                  ))}
                  {folders.length === 0 && (
                    <p className="muted">
                      {t(
                        'この場所にはフォルダがありません。',
                        'There are no folders in this location.',
                      )}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
          {current && !selected && (
            <p className="muted">
              {t(
                '接続するフォルダを一覧で選ぶか、開いたフォルダの「接続先にする」を押すと、ここに接続ボタンが表示されます。',
                'Choose a folder from the list, or open a folder and press "Use as the connection" — the connect button then appears here.',
              )}
            </p>
          )}
          {selected && (
            <form
              ref={form}
              className="attachment-form"
              aria-label={t('接続先の登録', 'Register connection')}
              onSubmit={(e) => {
                e.preventDefault();
                void perform(async () => {
                  const connection = await host.addCloudAttachment({
                    scopeId: space.scopeId,
                    accountId,
                    folder: selected,
                    contentsRoot,
                    name,
                    access: editable ? 'read-write' : 'read-only',
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
                  {t('contentsの配置先', 'Materials location')}
                  <select
                    aria-label={t('contentsの配置先', 'Materials location')}
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
                {t('contents内のフォルダ名', 'Folder name within Materials')}
                <input
                  aria-label={t('contents内のフォルダ名', 'Folder name within Materials')}
                  value={name}
                  disabled={disabled}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
              <p className="mount-preview" aria-live="polite">
                {t('接続するフォルダ', 'Folder to connect')}: {selected.name}
                <br />
                {t('マウント先', 'Mount location')}: {contentsRoot}/{name}/
              </p>
              {invalidName && <p role="alert">{invalidName}</p>}
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={editable}
                  disabled={disabled}
                  onChange={(e) => setEditable(e.target.checked)}
                />
                {t(
                  'このフォルダを irori から編集できるようにする',
                  'Allow editing this folder from irori',
                )}
              </label>
              <p className="muted">
                {editable
                  ? t(
                      '保存した変更はこの端末に一時保存され、Google Drive へ自動で送信されます。選んだ名前は接続情報に保存し、再接続時にも使用します。',
                      'Saved changes are kept on this device briefly and uploaded to Google Drive automatically. The chosen name is saved with the connection and reused on reconnection.',
                    )
                  : t(
                      '読み取り専用で登録します。選んだ名前を接続情報に保存し、再接続時にも使用します。',
                      'Registers as read-only. The chosen name is saved with the connection and reused on reconnection.',
                    )}
              </p>
              <button className="primary" disabled={disabled || !!invalidName}>
                {setup?.mountAvailable
                  ? t('登録して接続', 'Register and connect')
                  : t('接続先を登録', 'Register connection')}
              </button>
            </form>
          )}
        </section>
        <section>
          <h3>{t('登録済みの接続先', 'Registered connections')}</h3>
          {connections.length === 0 && (
            <p className="muted">{t('まだ接続先がありません。', 'No connections yet.')}</p>
          )}
          {connections.map((connection) => (
            <div className="connection-card" key={connection.mountId}>
              <strong>
                {connection.contentsRoot}/{connection.name}/
              </strong>
              <small>
                {connection.accountName ?? t('アカウント未設定', 'Account not set')} ·{' '}
                {connection.folderName} ·{' '}
                {connection.access === 'read-write'
                  ? t('編集可', 'Editable')
                  : t('読み取り専用', 'Read-only')}
              </small>
              <p>{stateLabel(connection)}</p>
              {connection.detail && <p>{connection.detail}</p>}
              {connection.access === 'read-write' &&
                connection.accountName &&
                !connection.accountWritable && (
                  <p className="muted">
                    {t(
                      'このアカウントは読み取りのみ許可されているため、読み取り専用で接続します。アカウントの「書き込みを許可」で再ログインすると編集できます。',
                      'This account may only read, so the folder connects read-only. Sign in again with “Allow writing” on the account to edit it.',
                    )}
                  </p>
                )}
              {!!connection.pending && (
                <p role="status">
                  {t(
                    `Google Drive への送信待ち ${connection.pending} 件`,
                    `${connection.pending} changes waiting to upload to Google Drive`,
                  )}
                </p>
              )}
              {connection.uploadError && (
                <p className="error" role="alert">
                  {connection.uploadError}
                </p>
              )}
              <div className="actions">
                {connection.state === 'mounted' && (
                  <button
                    disabled={disabled}
                    onClick={() =>
                      void perform(() => host.openCloudFolder(space.scopeId, connection.mountId))
                    }
                  >
                    {t('フォルダを開く', 'Open folder')}
                  </button>
                )}
                <button
                  disabled={disabled || connection.state === 'connecting'}
                  onClick={() =>
                    connection.pending && connection.access === 'read-write'
                      ? setLeaving({ mountId: connection.mountId, action: 'read-only' })
                      : void perform(() =>
                          host.setCloudAccess(
                            space.scopeId,
                            connection.mountId,
                            connection.access === 'read-write' ? 'read-only' : 'read-write',
                          ),
                        )
                  }
                >
                  {connection.access === 'read-write'
                    ? t('読み取り専用にする', 'Make read-only')
                    : t('編集できるようにする', 'Allow editing')}
                </button>
                {connection.state === 'mounted' || connection.state === 'error' ? (
                  <button
                    disabled={disabled}
                    onClick={() =>
                      connection.pending
                        ? setLeaving({ mountId: connection.mountId, action: 'disconnect' })
                        : void perform(() =>
                            host.disconnectCloud(space.scopeId, connection.mountId),
                          )
                    }
                  >
                    {t('接続を解除', 'Disconnect')}
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
                    {t('再接続', 'Reconnect')}
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
                    {t('選択中のアカウントに紐づける', 'Bind to the selected account')}
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
                  {t('名前を変更', 'Rename')}
                </button>
                <button
                  disabled={
                    disabled || connection.state === 'mounted' || connection.state === 'connecting'
                  }
                  onClick={() =>
                    void perform(() => host.removeCloud(space.scopeId, connection.mountId))
                  }
                >
                  {t('登録を解除', 'Remove registration')}
                </button>
              </div>
              {leaving?.mountId === connection.mountId && (
                <div className="leave-pending" role="alert">
                  <p>
                    {t(
                      `Google Drive への送信待ちが ${connection.pending ?? 0} 件あります。待たずに${leaving.action === 'disconnect' ? '接続を解除' : '読み取り専用に'}すると、変更はこの端末に残り、次にこのフォルダを編集可で接続したときに送信されます。`,
                      `${connection.pending ?? 0} changes are still waiting to upload to Google Drive. If you ${leaving.action === 'disconnect' ? 'disconnect' : 'make the folder read-only'} without waiting, they stay on this device and are uploaded the next time this folder is connected as editable.`,
                    )}
                  </p>
                  <div className="actions">
                    <button disabled={disabled} onClick={() => setLeaving(undefined)}>
                      {t('キャンセル', 'Cancel')}
                    </button>
                    <button
                      disabled={disabled}
                      onClick={() => {
                        const action = leaving.action;
                        setLeaving(undefined);
                        void perform(() =>
                          action === 'disconnect'
                            ? host.disconnectCloud(space.scopeId, connection.mountId, true)
                            : host.setCloudAccess(
                                space.scopeId,
                                connection.mountId,
                                'read-only',
                                true,
                              ),
                        );
                      }}
                    >
                      {leaving.action === 'disconnect'
                        ? t('待たずに接続を解除', 'Disconnect without waiting')
                        : t('待たずに読み取り専用にする', 'Make read-only without waiting')}
                    </button>
                  </div>
                </div>
              )}
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
                    aria-label={t('新しいマウント先のフォルダ名', 'New mount folder name')}
                    value={newName}
                    disabled={disabled}
                    onChange={(e) => setNewName(e.target.value)}
                    required
                  />
                  <button disabled={disabled || !!mountNameError(newName)}>
                    {t('名前を保存', 'Save name')}
                  </button>
                  <button type="button" disabled={disabled} onClick={() => setEditing(undefined)}>
                    {t('キャンセル', 'Cancel')}
                  </button>
                  {mountNameError(newName) && <small role="alert">{mountNameError(newName)}</small>}
                </form>
              )}
            </div>
          ))}
          {connections.length > 0 && (
            <p className="muted">
              {t(
                '名前変更・登録解除は接続を解除してから行います。登録解除後もGoogle Driveの元フォルダと既存のローカルデータは残ります。',
                'Rename and removal require disconnecting first. The original Google Drive folder and existing local data remain after removal.',
              )}
            </p>
          )}
        </section>
      </div>
    </Dialog>
  );
}
