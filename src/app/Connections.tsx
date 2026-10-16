import { Dialog } from './Dialog';
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { Menu } from '@base-ui/react/menu';
import type { CloudConnection, CloudRoot } from '../domain/types';
import { mountNameError } from '../domain/connections';
import { githubCloneURL, githubRepository, isBranchName, repositoryFolder } from '../domain/git';
import { useAction } from './useAction';
import { useResource } from './useResource';
import { t } from '../domain/i18n';
import { BrainTile } from './BrainTile';
import { Icon } from './Icon';
import './connections.css';
const host = window.irori;
// States are looked up inside render so they resolve in the current language.
function states(): Record<CloudConnection['state'], string> {
  return {
    unconfigured: t('フォルダ未選択', 'No folder chosen'),
    disconnected: t('未接続', 'Not connected'),
    connecting: t('接続中', 'Connecting'),
    waiting: t('フォルダを待っています', 'Waiting for the folder'),
    mounted: t('接続済み', 'Connected'),
    error: t('接続エラー', 'Connection error'),
    retired: t('終了', 'Ended'),
  };
}
function stateLabel(connection: CloudConnection) {
  return states()[connection.state];
}

/** One numbered step of the connection, joined to the next by a guide line. */
function Step({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="connect-step">
      <div className="step-rail" aria-hidden="true">
        <span className={`step-mark${done ? ' done' : ''}`}>
          {done ? <Icon name="check" size={13} strokeWidth={3} /> : n}
        </span>
        <span className="step-line" />
      </div>
      <div className="step-body">
        <h3>{title}</h3>
        {children}
      </div>
    </section>
  );
}

/** The less frequent actions of a connection. */
function MoreMenu({
  label,
  host: container,
  children,
}: {
  label: string;
  host: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className="stage-button connect-more" aria-label={label} title={label}>
        <Icon name="more" size={15} />
      </Menu.Trigger>
      {/* Inside the sheet: a modal dialog leaves everything outside it inert. */}
      <Menu.Portal container={container}>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} positionMethod="fixed">
          <Menu.Popup className="menu on-stage">{children}</Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** The last component of a folder path on any system. */
function folderName(folder: string) {
  return folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder;
}

/** The icon of a connection's kind. */
function sourceIcon(connection: CloudConnection) {
  return connection.provider === 'github'
    ? 'branch'
    : connection.provider === 'local'
      ? 'folder'
      : 'cloud';
}

/**
 * A vault's connected folders: folders on this computer, usually ones a sync app
 * (Drive for desktop, Dropbox, Box, iCloud, OneDrive) keeps, shown in contents
 * (ADR 019), and GitHub repositories cloned on this computer (ADR 046). A Google
 * Drive connection from before 0.1.67 is switched to a folder (ADR 023).
 */
export function Connections({
  space,
  running,
  onClose,
}: {
  space: CloudRoot;
  running: boolean;
  onClose: () => void;
}) {
  // Materials are worked on in the IDE; a folder can still be kept read-only.
  // A repository is there to be read, so it starts read-only.
  const [editable, setEditable] = useState(true);
  const [source, setSource] = useState<'local' | 'github'>('local');
  const [url, setUrl] = useState(''),
    [branch, setBranch] = useState('');
  // For a repository: `localPath` is a clone of it, or where irori clones it.
  const [existing, setExisting] = useState(false);
  const [name, setName] = useState(''),
    [contentsRoot, setContentsRoot] = useState(space.contents[0]),
    [localPath, setLocalPath] = useState('');
  const [updated, setUpdated] = useState<{ mountId: string; text: string }>();
  const [revision, setRevision] = useState(0);
  const { busy, error, run: perform } = useAction({ after: () => setRevision((v) => v + 1) });
  const [editing, setEditing] = useState<string>(),
    [newName, setNewName] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const overview = useResource(
    () => host.cloudConnections(space.scopeId),
    [space.scopeId, revision],
  );
  const connections = overview.data ?? [];
  const issue = error || overview.error;
  const disabled = busy || running;
  const repository = source === 'github' ? githubRepository(url.trim()) : undefined;
  const validURL = !!repository && githubCloneURL(url.trim());
  const validBranch = !branch.trim() || isBranchName(branch.trim());
  const chosen = localPath && (source === 'github' ? repository : folderName(localPath));
  const invalidName = chosen ? mountNameError(name) : undefined;
  function scrollToForm() {
    form.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  async function chooseLocal() {
    const folder = await host.chooseFolder();
    if (!folder) return;
    setLocalPath(folder);
    setName(folderName(folder));
    scrollToForm();
  }
  /** For a repository: a clone of it (`clone`), or the folder irori clones it into. */
  async function chooseRepositoryFolder(clone: boolean) {
    const folder = await host.chooseFolder();
    if (!folder) return;
    setExisting(clone);
    setLocalPath(folder);
    setName(repositoryFolder(url.trim()));
    scrollToForm();
  }
  function chooseSource(value: 'local' | 'github') {
    setSource(value);
    setEditable(value === 'local');
    setLocalPath('');
    setName('');
  }
  return (
    <Dialog
      label={t('クラウド接続', 'Cloud connection')}
      busy={busy}
      onClose={onClose}
      className="modal-dialog connect-dialog"
    >
      <div
        className="connections connect-sheet"
        aria-busy={!overview.data && !overview.error}
        ref={sheet}
      >
        <header className="connect-head">
          <Icon name="cloud" size={20} className="connect-mark" />
          <h2>
            <BrainTile space={space} size={22} radius={6} ring="stage" />
            <span className="connect-title">
              <strong>{space.name}</strong>{' '}
              {t('の Contents にフォルダを接続', '· Connect folders to Contents')}
            </span>
          </h2>
          <button
            className="stage-button connect-close"
            aria-label={t('閉じる', 'Close')}
            title={t('閉じる', 'Close')}
            disabled={busy}
            onClick={onClose}
          >
            <Icon name="close" size={17} />
          </button>
        </header>
        <div className="connect-body">
          <div className="connect-steps">
            {issue && (
              <p className="error" role="alert">
                {issue}
              </p>
            )}
            <Step
              n={1}
              title={source === 'github' ? t('リポジトリ', 'Repository') : t('フォルダ', 'Folder')}
              done={!!localPath}
            >
              <div className="connect-source" role="group" aria-label={t('接続元', 'Source')}>
                {(
                  [
                    ['local', 'folder', t('このコンピューター', 'This computer')],
                    ['github', 'branch', 'GitHub'],
                  ] as const
                ).map(([value, icon, label]) => (
                  <button
                    key={value}
                    className="stage-text-button framed small"
                    aria-pressed={source === value}
                    disabled={disabled}
                    onClick={() => chooseSource(value)}
                  >
                    <Icon name={icon} size={14} />
                    {label}
                  </button>
                ))}
              </div>
              {source === 'local' ? (
                <div className="local-pick">
                  <button
                    className="stage-text-button framed small"
                    disabled={disabled}
                    onClick={() => void perform(chooseLocal)}
                  >
                    <Icon name="folderOpen" size={14} />
                    {t('フォルダを選ぶ', 'Choose folder')}
                  </button>
                  {localPath && <span className="mono local-path">{localPath}</span>}
                </div>
              ) : (
                <>
                  <div className="connect-fields">
                    <label className="connect-field">
                      URL
                      <input
                        value={url}
                        placeholder="https://github.com/owner/repository"
                        disabled={disabled}
                        spellCheck={false}
                        onChange={(e) => {
                          setUrl(e.target.value);
                          setLocalPath('');
                        }}
                      />
                    </label>
                    <label className="connect-field repository-branch">
                      {t('ブランチ', 'Branch')}
                      <input
                        value={branch}
                        placeholder={t('既定', 'Default')}
                        disabled={disabled || existing}
                        spellCheck={false}
                        onChange={(e) => setBranch(e.target.value)}
                      />
                    </label>
                  </div>
                  {url.trim() && !validURL && (
                    <p className="connect-invalid" role="alert">
                      {t(
                        'GitHub の HTTPS または SSH のリポジトリ URL を入力してください。',
                        'Enter a GitHub HTTPS or SSH repository URL.',
                      )}
                    </p>
                  )}
                  <div className="local-pick">
                    <button
                      className="stage-text-button framed small"
                      disabled={disabled || !validURL}
                      onClick={() => void perform(() => chooseRepositoryFolder(false))}
                    >
                      <Icon name="download" size={14} />
                      {t('保存先を選ぶ', 'Choose where to clone')}
                    </button>
                    <button
                      className="stage-text-button framed small"
                      disabled={disabled || !validURL}
                      onClick={() => void perform(() => chooseRepositoryFolder(true))}
                    >
                      <Icon name="folderOpen" size={14} />
                      {t('手元のクローンを選ぶ', 'Choose a clone')}
                    </button>
                    {localPath && (
                      <span className="mono local-path">
                        {existing ? localPath : `${localPath}/${repositoryFolder(url.trim())}`}
                      </span>
                    )}
                  </div>
                </>
              )}
            </Step>
            <Step n={2} title={t('Contents に置く', 'Place in Contents')}>
              {chosen ? (
                <form
                  ref={form}
                  className="attachment-form"
                  aria-label={t('接続先の登録', 'Register connection')}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void perform(async () => {
                      const access = editable ? 'read-write' : 'read-only';
                      const connection =
                        source === 'github'
                          ? await host.addRepository({
                              scopeId: space.scopeId,
                              url: url.trim(),
                              ...(branch.trim() && !existing && { branch: branch.trim() }),
                              folder: localPath,
                              existing,
                              contentsRoot,
                              name,
                              access,
                            })
                          : await host.addLocalFolder({
                              scopeId: space.scopeId,
                              path: localPath,
                              contentsRoot,
                              name,
                              access,
                            });
                      setLocalPath('');
                      setName('');
                      setUrl('');
                      setBranch('');
                      await host.connectCloud(space.scopeId, connection.mountId);
                    });
                  }}
                >
                  <div className="connect-fields">
                    {space.contents.length > 1 && (
                      <label className="connect-field">
                        {t('contents の配置先', 'Materials location')}
                        <span className="connect-select">
                          <select
                            aria-label={t('contents の配置先', 'Materials location')}
                            value={contentsRoot}
                            disabled={disabled}
                            onChange={(e) => setContentsRoot(e.target.value)}
                          >
                            {space.contents.map((root) => (
                              <option key={root}>{root}</option>
                            ))}
                          </select>
                          <Icon name="chevronDown" size={13} />
                        </span>
                      </label>
                    )}
                    <label className="connect-field">
                      {t('フォルダ名', 'Folder name')}
                      <input
                        value={name}
                        disabled={disabled}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </label>
                  </div>
                  {invalidName && (
                    <p className="connect-invalid" role="alert">
                      {invalidName}
                    </p>
                  )}
                  <label className="connect-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={editable}
                      disabled={disabled}
                      onChange={(e) => setEditable(e.target.checked)}
                    />
                    <span className="switch-track" aria-hidden="true" />
                    {t('編集を許可', 'Allow editing')}
                  </label>
                  <p className="mount-preview" aria-live="polite">
                    <Icon name={source === 'github' ? 'branch' : 'folder'} size={15} />
                    <span className="mount-source">{chosen}</span>
                    <Icon name="arrow" size={14} />
                    <span className="mono">
                      {contentsRoot}/{name}/
                    </span>
                  </p>
                  <div className="connect-submit">
                    <button
                      className="solid-button"
                      disabled={disabled || !!invalidName || (source === 'github' && !validBranch)}
                    >
                      <Icon name={source === 'github' ? 'branch' : 'folder'} size={15} />
                      {source === 'github' && !existing
                        ? t('取得して接続', 'Clone and connect')
                        : t('登録して接続', 'Register and connect')}
                    </button>
                  </div>
                </form>
              ) : null}
            </Step>
          </div>
          <aside
            className="connect-registered"
            aria-label={t('登録済みの接続先', 'Registered connections')}
          >
            <h3>
              {t('登録済み', 'Registered')}
              <span className="connect-count">{connections.length}</span>
            </h3>
            {connections.length === 0 && (
              <p className="connect-hint">{t('まだ接続先がありません。', 'No connections yet.')}</p>
            )}
            {connections.map((connection) => {
              const retired = connection.state === 'retired';
              return (
                <div className="connection-card" key={connection.mountId}>
                  <div className="connection-head">
                    <Icon name={sourceIcon(connection)} size={16} />
                    <strong>{connection.name}</strong>
                    <span className="connection-state" data-state={connection.state}>
                      {stateLabel(connection)}
                    </span>
                  </div>
                  <span className="connection-path mono">
                    {connection.contentsRoot}/{connection.name}/
                  </span>
                  <div className="connection-meta">
                    <span>
                      {retired
                        ? 'Google Drive'
                        : connection.provider === 'github'
                          ? 'GitHub'
                          : t('このコンピューター', 'This computer')}
                    </span>
                    <span className="connect-dot" aria-hidden="true" />
                    <span>
                      {connection.provider === 'github'
                        ? `${githubRepository(connection.url)}${connection.branch ? ` · ${connection.branch}` : ''}`
                        : connection.folderName}
                    </span>
                    <span className="connect-dot" aria-hidden="true" />
                    <span className="connection-access">
                      <Icon
                        name={connection.access === 'read-write' ? 'penLine' : 'lock'}
                        size={12}
                      />
                      {connection.access === 'read-write'
                        ? t('編集可', 'Editable')
                        : t('読み取り専用', 'Read-only')}
                    </span>
                  </div>
                  {connection.detail && <p className="connect-hint">{connection.detail}</p>}
                  {updated?.mountId === connection.mountId && (
                    <p className="connect-hint" role="status">
                      {updated.text}
                    </p>
                  )}
                  {retired ? (
                    <div className="connection-actions">
                      <button
                        className="stage-text-button framed"
                        disabled={disabled}
                        onClick={() =>
                          void perform(async () => {
                            const folder = await host.chooseFolder();
                            if (!folder) return;
                            await host.switchCloudToLocal(
                              space.scopeId,
                              connection.mountId,
                              folder,
                            );
                            await host.connectCloud(space.scopeId, connection.mountId);
                          })
                        }
                      >
                        {t('フォルダに切り替える', 'Switch to a folder')}
                      </button>
                      <MoreMenu label={t('接続先の操作', 'Connection actions')} host={sheet}>
                        <Menu.Item
                          disabled={disabled}
                          onClick={() =>
                            void perform(() => host.removeCloud(space.scopeId, connection.mountId))
                          }
                        >
                          {t('登録を解除', 'Remove registration')}
                        </Menu.Item>
                      </MoreMenu>
                    </div>
                  ) : (
                    <div className="connection-actions">
                      {connection.provider === 'github' && connection.state === 'unconfigured' ? (
                        <button
                          className="stage-text-button framed"
                          disabled={disabled}
                          onClick={() =>
                            void perform(async () => {
                              const folder = await host.chooseFolder();
                              if (!folder) return;
                              await host.cloneRepository(space.scopeId, connection.mountId, folder);
                              await host.connectCloud(space.scopeId, connection.mountId);
                            })
                          }
                        >
                          {t('取得', 'Clone')}
                        </button>
                      ) : connection.state === 'mounted' ? (
                        <>
                          <button
                            className="stage-text-button framed"
                            disabled={disabled}
                            onClick={() =>
                              void perform(() =>
                                host.openCloudFolder(space.scopeId, connection.mountId),
                              )
                            }
                          >
                            {t('フォルダを開く', 'Open folder')}
                          </button>
                          {connection.provider === 'github' && (
                            <button
                              className="stage-text-button framed"
                              disabled={disabled}
                              onClick={() =>
                                void perform(async () => {
                                  setUpdated(undefined);
                                  const result = await host.updateRepository(
                                    space.scopeId,
                                    connection.mountId,
                                  );
                                  setUpdated({
                                    mountId: connection.mountId,
                                    text: result.commits
                                      ? t(
                                          `${result.branch} に ${result.commits} 件のコミットを取り込みました。`,
                                          `Brought ${result.commits} commits into ${result.branch}.`,
                                        )
                                      : t(
                                          `${result.branch} は最新です。`,
                                          `${result.branch} is up to date.`,
                                        ),
                                  });
                                })
                              }
                            >
                              <Icon name="refresh" size={13} />
                              {t('最新にする', 'Update')}
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          className="stage-text-button framed"
                          disabled={disabled || connection.state === 'unconfigured'}
                          onClick={() =>
                            void perform(() => host.connectCloud(space.scopeId, connection.mountId))
                          }
                        >
                          {t('再接続', 'Reconnect')}
                        </button>
                      )}
                      <button
                        className="stage-text-button framed"
                        disabled={disabled || connection.state === 'connecting'}
                        onClick={() =>
                          void perform(() =>
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
                          : t('編集を許可', 'Allow editing')}
                      </button>
                      <MoreMenu label={t('接続先の操作', 'Connection actions')} host={sheet}>
                        {(connection.state === 'mounted' ||
                          connection.state === 'waiting' ||
                          connection.state === 'error') && (
                          <Menu.Item
                            disabled={disabled}
                            onClick={() =>
                              void perform(() =>
                                host.disconnectCloud(space.scopeId, connection.mountId),
                              )
                            }
                          >
                            {t('接続を解除', 'Disconnect')}
                          </Menu.Item>
                        )}
                        {connection.state !== 'mounted' && (
                          <Menu.Item
                            disabled={disabled}
                            onClick={() =>
                              void perform(async () => {
                                const folder = await host.chooseFolder();
                                if (folder)
                                  await host.bindLocalFolder(
                                    space.scopeId,
                                    connection.mountId,
                                    folder,
                                  );
                              })
                            }
                          >
                            {connection.provider === 'github'
                              ? t('手元のクローンを選ぶ', 'Choose a clone')
                              : t('フォルダを選び直す', 'Choose folder again')}
                          </Menu.Item>
                        )}
                        <Menu.Item
                          disabled={
                            disabled ||
                            connection.state === 'mounted' ||
                            connection.state === 'connecting'
                          }
                          onClick={() => {
                            setEditing(connection.mountId);
                            setNewName(connection.name);
                          }}
                        >
                          {t('名前を変更', 'Rename')}
                        </Menu.Item>
                        <Menu.Item
                          disabled={
                            disabled ||
                            connection.state === 'mounted' ||
                            connection.state === 'connecting'
                          }
                          onClick={() =>
                            void perform(() => host.removeCloud(space.scopeId, connection.mountId))
                          }
                        >
                          {t('登録を解除', 'Remove registration')}
                        </Menu.Item>
                      </MoreMenu>
                    </div>
                  )}
                  {editing === connection.mountId && (
                    <form
                      className="connection-rename"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void perform(async () => {
                          await host.renameCloud(space.scopeId, connection.mountId, newName);
                          setEditing(undefined);
                        });
                      }}
                    >
                      <input
                        aria-label={t('新しい名前', 'New name')}
                        value={newName}
                        disabled={disabled}
                        onChange={(e) => setNewName(e.target.value)}
                        required
                      />
                      <div className="connection-actions">
                        <button
                          type="button"
                          className="stage-text-button framed small"
                          disabled={disabled}
                          onClick={() => setEditing(undefined)}
                        >
                          {t('キャンセル', 'Cancel')}
                        </button>
                        <button
                          className="solid-button"
                          disabled={disabled || !!mountNameError(newName)}
                        >
                          {t('保存', 'Save')}
                        </button>
                      </div>
                      {mountNameError(newName) && (
                        <small role="alert">{mountNameError(newName)}</small>
                      )}
                    </form>
                  )}
                </div>
              );
            })}
          </aside>
        </div>
      </div>
    </Dialog>
  );
}
