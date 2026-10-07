import { Dialog } from './Dialog';
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { Menu } from '@base-ui/react/menu';
import type { CloudConnection, CloudRoot } from '../domain/types';
import { mountNameError } from '../domain/connections';
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

/**
 * A hibachi's connected folders: folders on this computer, usually ones a sync app
 * (Drive for desktop, Dropbox, Box, iCloud, OneDrive) keeps, shown in contents
 * (ADR 019). A Google Drive connection from before 0.1.67 is switched to one (ADR 023).
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
  const [editable, setEditable] = useState(true);
  const [name, setName] = useState(''),
    [contentsRoot, setContentsRoot] = useState(space.contents[0]),
    [localPath, setLocalPath] = useState('');
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
  const chosen = localPath && folderName(localPath);
  const invalidName = chosen ? mountNameError(name) : undefined;
  async function chooseLocal() {
    const folder = await host.chooseFolder();
    if (!folder) return;
    setLocalPath(folder);
    setName(folderName(folder));
    form.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
            <Step n={1} title={t('フォルダ', 'Folder')} done={!!localPath}>
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
                      const connection = await host.addLocalFolder({
                        scopeId: space.scopeId,
                        path: localPath,
                        contentsRoot,
                        name,
                        access: editable ? 'read-write' : 'read-only',
                      });
                      setLocalPath('');
                      setName('');
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
                    <Icon name="folder" size={15} />
                    <span className="mount-source">{chosen}</span>
                    <Icon name="arrow" size={14} />
                    <span className="mono">
                      {contentsRoot}/{name}/
                    </span>
                  </p>
                  <div className="connect-submit">
                    <button className="solid-button" disabled={disabled || !!invalidName}>
                      <Icon name="folder" size={15} />
                      {t('登録して接続', 'Register and connect')}
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
                    <Icon name={retired ? 'cloud' : 'folder'} size={16} />
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
                      {retired ? 'Google Drive' : t('このコンピューター', 'This computer')}
                    </span>
                    <span className="connect-dot" aria-hidden="true" />
                    <span>{connection.folderName}</span>
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
                      {connection.state === 'mounted' ? (
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
                        {(connection.state === 'mounted' || connection.state === 'error') && (
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
                            {t('フォルダを選び直す', 'Choose folder again')}
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
