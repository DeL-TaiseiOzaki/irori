import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Category, Space } from '../domain/types';
import type { RemoteFolders, RemoteHost } from '../domain/remote-hosts';
import { remotePath, sshDestination } from '../domain/remote-hosts';
import { categoryChoices, categoryName, categoryValue } from '../domain/brains';
import { baseName } from '../domain/paths';
import { t } from '../domain/i18n';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { ErrorMessage, errorText } from './ErrorMessage';
import { CategoryField } from './BrainSettings';
import { hostEvents } from './host-events';
import { useAction } from './useAction';
import { useResource } from './useResource';
import { sameStructure } from '../domain/structural';
import './remote-hosts.css';

const host = window.irori;

/*
 * The SSH hosts this device knows (ADR 061), read once for every part of the
 * window that shows them and read again on each `hosts` event: a host added,
 * changed or removed, its connection or its progress, or its vaults.
 */
type HostsState = { hosts?: RemoteHost[]; error?: string; version: number };
let state: HostsState = { version: 0 };
const listeners = new Set<() => void>();
let reading = false,
  again = false;
let stop: (() => void) | undefined;
function read() {
  if (reading) {
    again = true;
    return;
  }
  reading = true;
  void host
    .remoteHosts()
    .then(
      (hosts): HostsState => ({ hosts, version: state.version + 1 }),
      (error: unknown) => ({ ...state, error: errorText(error), version: state.version + 1 }),
    )
    .then((next) => {
      reading = false;
      // The same hosts as before leave every part that shows them as it is.
      if (!sameStructure(next.hosts, state.hosts) || next.error !== state.error) {
        state = next;
        for (const listener of listeners) listener();
      }
      if (again) {
        again = false;
        read();
      }
    });
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!stop) {
    stop = hostEvents.onEvent((event) => {
      if (event.type === 'hosts') read();
    });
    read();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    stop?.();
    stop = undefined;
  };
}

/** The SSH hosts as the window knows them, kept current by the host's events. */
export function useRemoteHosts() {
  return useSyncExternalStore(subscribe, () => state);
}

/** The SSH host a vault lives on, as last read; undefined for a vault of this computer. */
export function useHostOf(space?: Space) {
  const { hosts } = useRemoteHosts();
  return space?.host && hosts?.find((item) => item.id === space.host!.id);
}

const destinationOf = (remote: Pick<RemoteHost, 'destination' | 'port'>) =>
  remote.port ? `${remote.destination}:${remote.port}` : remote.destination;

/** A host's connection in a few words, with what irori is doing or why it could not. */
export function hostStateText(remote: RemoteHost) {
  switch (remote.state) {
    case 'connected':
      return remote.about
        ? t(
            `接続済み・${remote.about.user}@${remote.about.hostname}（${remote.about.platform} ${remote.about.arch}）`,
            `Connected · ${remote.about.user}@${remote.about.hostname} (${remote.about.platform} ${remote.about.arch})`,
          )
        : t('接続済み', 'Connected');
    case 'connecting':
      return remote.detail
        ? t(`接続中・${remote.detail}`, `Connecting · ${remote.detail}`)
        : t('接続中…', 'Connecting…');
    case 'error':
      return remote.detail
        ? t(`エラー・${remote.detail}`, `Error · ${remote.detail}`)
        : t('エラー', 'Error');
    default:
      return t('未接続', 'Not connected');
  }
}

function HostStateLine({ remote }: { remote: RemoteHost }) {
  return (
    <span className={`remote-state ${remote.state}`} role="status">
      {remote.state === 'connecting' ? (
        <Icon name="loader" size={12} className="remote-spin" />
      ) : (
        <i aria-hidden="true" />
      )}
      <span>{hostStateText(remote)}</span>
    </span>
  );
}

/** Connects to a host now, which the person asked for; the first time uploads irori's files there. */
function useConnect(id: string) {
  const action = useAction();
  return {
    ...action,
    connect: () => action.run(() => host.connectRemoteHost(id)),
  };
}

/** Adds an SSH host, or changes one: its name, what `ssh` is given, and a port. */
export function HostForm({
  remote,
  onSaved,
  onCancel,
}: {
  /** The host being changed; a new one without. */
  remote?: RemoteHost;
  onSaved: (remote: RemoteHost) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(remote?.name ?? ''),
    [destination, setDestination] = useState(remote?.destination ?? ''),
    [port, setPort] = useState(remote?.port ? String(remote.port) : '');
  const { busy, error, setError, run } = useAction();
  const label = remote
    ? t('SSH ホストを編集', 'Edit the SSH host')
    : t('SSH ホストを追加', 'Add an SSH host');
  function problem() {
    if (!name.trim()) return t('名前を入力してください。', 'Enter a name.');
    if (name.trim().length > 60)
      return t('名前は 60 文字までです。', 'Use 60 characters or fewer.');
    if (!sshDestination.safeParse(destination).success)
      return t(
        '接続先は user@host か、ssh の設定にある Host 名にしてください（空白や記号で始まる名前は使えません）。',
        'Use user@host or a Host of your ssh configuration, without spaces or a leading symbol.',
      );
    const value = Number(port);
    if (port.trim() && !(Number.isInteger(value) && value >= 1 && value <= 65535))
      return t('ポートは 1〜65535 の数にしてください。', 'Use a port from 1 to 65535.');
    return '';
  }
  async function submit() {
    const issue = problem();
    if (issue) return setError(issue);
    await run(async () => {
      const saved = await host.saveRemoteHost({
        ...(remote && { id: remote.id }),
        name: name.trim(),
        destination: destination.trim(),
        ...(port.trim() && { port: Number(port) }),
      });
      onSaved(saved);
    });
  }
  return (
    <form
      className="remote-host-form"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void submit();
      }}
    >
      <label>
        <span>{t('名前', 'Name')}</span>
        <input
          aria-label={t('SSH ホストの名前', 'SSH host name')}
          value={name}
          maxLength={60}
          placeholder={t('研究室のサーバー', 'Lab server')}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        <span>{t('接続先', 'Destination')}</span>
        <input
          aria-label={t('SSH の接続先', 'SSH destination')}
          className="mono"
          value={destination}
          placeholder={t(
            'user@host または ssh の設定の Host 名',
            'user@host, or a Host of your ssh configuration',
          )}
          spellCheck={false}
          autoCapitalize="off"
          disabled={busy}
          onChange={(event) => setDestination(event.target.value)}
        />
      </label>
      <label className="remote-port">
        <span>{t('ポート（省略可）', 'Port (optional)')}</span>
        <input
          aria-label={t('SSH のポート', 'SSH port')}
          className="mono"
          inputMode="numeric"
          value={port}
          placeholder="22"
          disabled={busy}
          onChange={(event) => setPort(event.target.value)}
        />
      </label>
      {error && <ErrorMessage text={error} />}
      <div className="remote-actions">
        {onCancel && (
          <button type="button" disabled={busy} onClick={onCancel}>
            {t('キャンセル', 'Cancel')}
          </button>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? t('保存しています…', 'Saving…') : remote ? t('保存', 'Save') : t('追加', 'Add')}
        </button>
      </div>
    </form>
  );
}

/** What a person must know before adding an SSH host: the settings part's lead says it too. */
export function sshHostsLead() {
  return t(
    'vault を SSH ホストに置けます。irori はこのコンピューターの ssh を、その鍵と設定のまま使います。パスワードやパスフレーズの入力には答えられないため、先にターミナルで「ssh 接続先」がそれだけでつながることを確かめてください。対応するのは Linux（x64・arm64）のホストで、irori は自分のファイルをホストの ~/.irori-host に置きます。SSH ホストの vault は、いまは読み取り専用で表示します。その vault のエージェントは irori agent が仕事を任せたときにホストで動くため、ホストに CLI（Claude Code、Codex など）をインストールしてログインしておいてください。',
    "A vault can live on an SSH host. irori uses this computer's ssh with its keys and configuration. It cannot answer a password or passphrase prompt, so first check in a terminal that `ssh <destination>` connects by itself. Hosts run Linux (x64 or arm64), and irori keeps its own files in ~/.irori-host there. A vault on an SSH host is shown read-only for now. Its agent runs on the host when the irori agent hands it work, so install the CLI there (Claude Code, Codex…) and sign in.",
  );
}

/**
 * The settings part for SSH hosts (ADR 061): each host with its connection and
 * its vaults, and a host to add. A vault added here joins the workspace on show.
 */
export function RemoteHostsSettings({
  onVaultAdded,
  onVaultRemoved,
}: {
  /** A vault on a host was registered here. */
  onVaultAdded?: (space: Space) => void;
  /** A vault on a host left this device's list. */
  onVaultRemoved?: (scopeId: string) => void;
}) {
  const { hosts, error, version } = useRemoteHosts();
  // The vaults on hosts, read again whenever the hosts change (their vaults with them).
  const spaces = useResource(() => host.spaces(), [], { refresh: version });
  const [adding, setAdding] = useState(false);
  const [choosing, setChoosing] = useState<RemoteHost>();
  return (
    <>
      <div className="settings-block">
        <div className="settings-group">
          {!hosts ? (
            <p className="settings-item settings-empty" role="status">
              {error ?? t('SSH ホストを読み込んでいます…', 'Reading the SSH hosts…')}
            </p>
          ) : !hosts.length ? (
            <p className="settings-item settings-empty">
              {t('SSH ホストはまだありません。', 'No SSH hosts yet.')}
            </p>
          ) : (
            hosts.map((remote) => (
              <HostRow
                key={remote.id}
                remote={remote}
                vaults={(spaces.data ?? []).filter((space) => space.host?.id === remote.id)}
                onAddVault={() => setChoosing(remote)}
                onVaultRemoved={onVaultRemoved}
              />
            ))
          )}
        </div>
      </div>
      <div className="settings-block">
        <h4>{t('SSH ホストを追加', 'Add an SSH host')}</h4>
        <div className="settings-group">
          <div className="settings-item">
            {adding ? (
              <HostForm onSaved={() => setAdding(false)} onCancel={() => setAdding(false)} />
            ) : (
              <button type="button" className="settings-action" onClick={() => setAdding(true)}>
                <Icon name="plus" size={14} />
                {t('SSH ホストを追加', 'Add an SSH host')}
              </button>
            )}
          </div>
        </div>
      </div>
      {choosing && (
        <RemoteFolderDialog
          remote={choosing}
          categories={categoryChoices(spaces.data ?? [])}
          onCancel={() => setChoosing(undefined)}
          onRegistered={(space) => {
            setChoosing(undefined);
            onVaultAdded?.(space);
          }}
        />
      )}
    </>
  );
}

function HostRow({
  remote,
  vaults,
  onAddVault,
  onVaultRemoved,
}: {
  remote: RemoteHost;
  vaults: Space[];
  onAddVault: () => void;
  onVaultRemoved?: (scopeId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const connection = useConnect(remote.id);
  const removal = useAction();
  const unlisting = useAction();
  const connecting = remote.state === 'connecting' || connection.busy;
  return (
    <section className="settings-item remote-host" aria-label={remote.name}>
      <div className="settings-row settings-row-flat">
        <div className="settings-row-text">
          <span className="settings-row-label">
            <Icon name="server" size={14} />
            {remote.name}
          </span>
          <span className="settings-description mono remote-destination">
            {destinationOf(remote)}
          </span>
          <HostStateLine remote={remote} />
        </div>
        <span className="settings-row-aside">
          {t(
            `vault ${remote.vaults} 件`,
            `${remote.vaults} vault${remote.vaults === 1 ? '' : 's'}`,
          )}
        </span>
        <span className="settings-row-actions">
          {remote.state !== 'connected' && (
            <button
              type="button"
              className="settings-action"
              disabled={connecting}
              onClick={() => void connection.connect()}
            >
              {t('接続', 'Connect')}
            </button>
          )}
          <button
            type="button"
            className="settings-action"
            aria-label={t(`${remote.name} を編集`, `Edit ${remote.name}`)}
            disabled={editing}
            onClick={() => setEditing(true)}
          >
            {t('編集', 'Edit')}
          </button>
          <button
            type="button"
            className="settings-action"
            aria-label={t(`${remote.name} を削除`, `Remove ${remote.name}`)}
            disabled={removal.busy}
            onClick={() => void removal.run(() => host.removeRemoteHost(remote.id))}
          >
            {t('削除', 'Remove')}
          </button>
        </span>
      </div>
      {connection.error && <ErrorMessage text={connection.error} />}
      {removal.error && <ErrorMessage text={removal.error} />}
      {editing && (
        <HostForm
          remote={remote}
          onSaved={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      )}
      <ul
        className="remote-vaults"
        aria-label={t(`${remote.name} の vault`, `Vaults on ${remote.name}`)}
      >
        {vaults.map((vault) => (
          <li key={vault.scopeId}>
            <span className="remote-vault-name" title={vault.root}>
              <strong>{vault.name}</strong>
              <small className="mono">
                <bdi>{vault.root}</bdi>
              </small>
            </span>
            <button
              type="button"
              className="settings-action"
              aria-label={t(`${vault.name} を一覧から外す`, `Take ${vault.name} off the list`)}
              disabled={unlisting.busy}
              onClick={() =>
                void unlisting.run(async () => {
                  await host.removeSpace(vault.scopeId, false);
                  onVaultRemoved?.(vault.scopeId);
                })
              }
            >
              {t('一覧から外す', 'Take off the list')}
            </button>
          </li>
        ))}
      </ul>
      {unlisting.error && <ErrorMessage text={unlisting.error} />}
      <button
        type="button"
        className="settings-action remote-add-vault"
        aria-label={t(`${remote.name} に vault を追加`, `Add a vault on ${remote.name}`)}
        onClick={onAddVault}
      >
        <Icon name="plus" size={14} />
        {t('vault を追加', 'Add vault')}
      </button>
    </section>
  );
}

/**
 * Choosing an SSH host to add a vault from, where vaults are added: a host
 * known already, or one added here first.
 */
export function RemoteHostChoice({ onChoose }: { onChoose: (remote: RemoteHost) => void }) {
  const { hosts, error } = useRemoteHosts();
  const [adding, setAdding] = useState(false);
  if (!hosts) return <p role="status">{error ?? t('読み込み中…', 'Loading…')}</p>;
  return (
    <div className="remote-choice">
      {hosts.length > 0 && (
        <ul aria-label={t('SSH ホスト', 'SSH hosts')}>
          {hosts.map((remote) => (
            <li key={remote.id}>
              <button type="button" className="remote-choice-host" onClick={() => onChoose(remote)}>
                <Icon name="server" size={16} />
                <span>
                  <strong>{remote.name}</strong>
                  <small className="mono">{destinationOf(remote)}</small>
                  <small>{hostStateText(remote)}</small>
                </span>
                <Icon name="chevron" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!hosts.length && !adding && (
        <p className="hint">
          {t(
            'SSH ホストがまだありません。追加すると、そのホストのフォルダを vault にできます。設定の「SSH ホスト」でも管理できます。',
            'There are no SSH hosts yet. Add one to make a folder there a vault; Settings → SSH hosts manages them too.',
          )}
        </p>
      )}
      {adding || !hosts.length ? (
        <>
          <p className="remote-lead">{sshHostsLead()}</p>
          <HostForm
            onSaved={(remote) => {
              setAdding(false);
              onChoose(remote);
            }}
            onCancel={hosts.length ? () => setAdding(false) : undefined}
          />
        </>
      ) : (
        <button type="button" className="remote-choice-add" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} />
          {t('SSH ホストを追加', 'Add an SSH host')}
        </button>
      )}
    </div>
  );
}

/**
 * Choosing a folder of an SSH host to make a vault: the folder on show, the one
 * above, the folders in it (those that are vaults marked) and a path to type;
 * then the vault's name and category. The host connects first when it has not.
 */
export function RemoteFolderDialog({
  remote: chosen,
  categories,
  onRegistered,
  onCancel,
}: {
  remote: RemoteHost;
  categories?: readonly Category[];
  onRegistered: (space: Space) => void;
  onCancel: () => void;
}) {
  const remote = useRemoteHosts().hosts?.find((item) => item.id === chosen.id) ?? chosen;
  const [folder, setFolder] = useState<string>();
  const [typed, setTyped] = useState('');
  const [name, setName] = useState(''),
    [category, setCategory] = useState('');
  const [retry, setRetry] = useState(0);
  const listing = useResource(
    // The host's home without a folder: the request then names none, not an empty one.
    () => (folder ? host.remoteFolders(chosen.id, folder) : host.remoteFolders(chosen.id)),
    [chosen.id, folder],
    { refresh: retry },
  );
  const shown: RemoteFolders | undefined = listing.data;
  const [pathProblem, setPathProblem] = useState('');
  const { busy, error, run } = useAction();
  useEffect(() => {
    if (shown) setTyped(shown.path);
  }, [shown?.path]);
  const fallback = shown ? baseName(shown.path) || shown.path : '';
  const label = t(
    `${remote.name} のフォルダを vault にする`,
    `Make a folder on ${remote.name} a vault`,
  );
  function go(path: string) {
    setPathProblem('');
    setFolder(path);
  }
  async function register() {
    if (!shown) return;
    await run(async () =>
      onRegistered(
        await host.registerRemote(
          chosen.id,
          shown.path,
          name.trim() || fallback,
          categoryValue(category) ?? 'personal',
        ),
      ),
    );
  }
  return createPortal(
    <Dialog label={label} busy={busy} onClose={onCancel}>
      <form
        className="modal register-space remote-folders"
        aria-label={label}
        onSubmit={(event) => {
          event.preventDefault();
          void register();
        }}
      >
        <h2>{label}</h2>
        <p className="remote-destination-line">
          <Icon name="server" size={14} />
          <span className="mono">{destinationOf(remote)}</span>
          <HostStateLine remote={remote} />
        </p>
        <div className="remote-path">
          <input
            aria-label={t('ホストのフォルダのパス', 'Folder path on the host')}
            className="mono"
            value={typed}
            spellCheck={false}
            placeholder="/home/user/notes"
            disabled={busy}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              const value = typed.trim();
              if (remotePath.safeParse(value).success) go(value);
              else
                setPathProblem(
                  t('/ で始まるパスを入力してください。', 'Enter a path that starts with /.'),
                );
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const value = typed.trim();
              if (remotePath.safeParse(value).success) go(value);
              else
                setPathProblem(
                  t('/ で始まるパスを入力してください。', 'Enter a path that starts with /.'),
                );
            }}
          >
            {t('移動', 'Go')}
          </button>
        </div>
        {pathProblem && <p role="alert">{pathProblem}</p>}
        <div
          className="remote-folder-list"
          role="list"
          aria-label={t('ホストのフォルダ', 'Folders on the host')}
        >
          {listing.error ? (
            <div className="remote-folder-problem">
              <ErrorMessage text={listing.error} />
              <button type="button" onClick={() => setRetry((value) => value + 1)}>
                {t('再試行', 'Retry')}
              </button>
            </div>
          ) : !shown ? (
            <p className="hint" role="status">
              {remote.state === 'connecting'
                ? hostStateText(remote)
                : t('フォルダを読み込んでいます…', 'Reading the folders…')}
            </p>
          ) : (
            <>
              {shown.parent && (
                <FolderRow icon="back" onClick={() => go(shown.parent!)}>
                  {t('上のフォルダへ', 'Up one folder')}
                </FolderRow>
              )}
              {shown.folders.map((item) => (
                <FolderRow key={item.path} icon="folder" onClick={() => go(item.path)}>
                  <span>{item.name}</span>
                  {item.vault && <span className="remote-vault-mark">vault</span>}
                </FolderRow>
              ))}
              {!shown.folders.length && (
                <p className="hint">{t('フォルダはありません。', 'No folders here.')}</p>
              )}
              {shown.more && (
                <p className="hint">
                  {t(
                    'ほかにもフォルダがあります。パスを入力して移動してください。',
                    'There are more folders; type a path to go there.',
                  )}
                </p>
              )}
            </>
          )}
        </div>
        {shown && (
          <>
            <p className="remote-chosen">
              {t('vault にするフォルダ', 'Folder to make a vault')}
              <strong className="mono" title={shown.path}>
                <bdi>{shown.path}</bdi>
              </strong>
            </p>
            <label>
              {t('スペース名', 'Space name')}
              <input
                aria-label={t('スペース名', 'Space name')}
                value={name}
                placeholder={fallback}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <details>
              <summary>{t('分類', 'Category')}</summary>
              <label>
                <CategoryField
                  label={t('スペースの種類', 'Space type')}
                  value={category}
                  choices={categories}
                  placeholder={categoryName('personal')}
                  disabled={busy}
                  onChange={setCategory}
                />
              </label>
            </details>
            <p className="remote-note">
              {t(
                'まだ vault でないフォルダを vault にすると、このコンピューターと同じく、そこに .irori/scope.json を書き、.gitignore に /contents/ を加えます。ほかのファイルは変更しません。',
                'Making a folder that is not a vault yet a vault writes .irori/scope.json there and adds /contents/ to its .gitignore, as on this computer. Nothing else there changes.',
              )}
            </p>
          </>
        )}
        {error && <ErrorMessage text={error} />}
        {busy && <p role="status">{t('登録しています…', 'Registering…')}</p>}
        <div className="actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            {t('キャンセル', 'Cancel')}
          </button>
          <button type="submit" className="primary" disabled={busy || !shown}>
            {t('vault にする', 'Make it a vault')}
          </button>
        </div>
      </form>
    </Dialog>,
    document.body,
  );
}

function FolderRow({
  icon,
  onClick,
  children,
}: {
  icon: 'folder' | 'back';
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" role="listitem" className="remote-folder" onClick={onClick}>
      <Icon name={icon} size={15} />
      {children}
    </button>
  );
}

/**
 * Above a vault on an SSH host while its host is not connected: what stands in
 * the way, and the button that connects.
 */
export function RemoteVaultState({ space }: { space: Space }) {
  const remote = useHostOf(space);
  const connection = useConnect(space.host?.id ?? '');
  if (!space.host || !remote || remote.state === 'connected') return null;
  const connecting = remote.state === 'connecting' || connection.busy;
  return (
    <div className="remote-vault-state" role="status">
      <p>
        {remote.state === 'connecting'
          ? t(
              `SSH ホスト「${remote.name}」に接続しています…`,
              `Connecting to the SSH host ${remote.name}…`,
            )
          : t(
              `SSH ホスト「${remote.name}」に接続していません。`,
              `Not connected to the SSH host ${remote.name}.`,
            )}
      </p>
      {remote.detail && <small>{remote.detail}</small>}
      {connection.error && connection.error !== remote.detail && (
        <ErrorMessage text={connection.error} />
      )}
      <button
        type="button"
        className="stage-text-button framed"
        disabled={connecting}
        onClick={() => void connection.connect()}
      >
        <Icon name={connecting ? 'loader' : 'server'} size={14} />
        {t('接続', 'Connect')}
      </button>
    </div>
  );
}

/** Where a vault on an SSH host is: its host's name, with its folder there on hover. */
export function RemoteVaultPlace({ space }: { space: Space }) {
  if (!space.host) return null;
  const where = t(
    `SSH ホスト「${space.host.name}」の ${space.root}`,
    `${space.root} on the SSH host ${space.host.name}`,
  );
  return (
    <span className="remote-place" title={where} aria-label={where}>
      <Icon name="server" size={12} />
      {space.host.name}
    </span>
  );
}

/** In place of a vault agent's instruction box, for a vault on an SSH host. */
export function RemoteAgentNote({ space }: { space: Space }) {
  return (
    <div className="remote-agent-note" role="note">
      <Icon name="server" size={18} />
      <strong>{t(`${space.name} の vault agent`, `${space.name}'s vault agent`)}</strong>
      <p>
        {t(
          `この vault のエージェントは SSH ホスト「${space.host?.name ?? ''}」で動きます。irori モードで irori agent に依頼してください。`,
          `This vault's agent runs on its SSH host, ${space.host?.name ?? ''}. Ask the irori agent in irori mode.`,
        )}
      </p>
    </div>
  );
}
