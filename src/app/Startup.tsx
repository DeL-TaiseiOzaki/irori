import { Dialog } from './Dialog';
import { MagnetTabs } from './obsidian/MagnetTabs';
import { ArrowFillButton } from './obsidian/ArrowFillButton';
import { useEffect, useState } from 'react';
import type { Category, Space, WorkspaceProfile } from '../domain/types';
import { appIcon, appVersion } from './branding';
import { BrainTile } from './BrainTile';
import { Icon } from './Icon';
import { useResource } from './useResource';
import { UpdateNotice } from './UpdateNotice';
import { CloudRecovery } from './CloudRecovery';
import { t } from '../domain/i18n';
import { ErrorMessage, errorText } from './ErrorMessage';
import './startup.css';
const host = window.irori;
export function RegisterSpace({
  onRegistered,
  onCancel,
  mode = 'folder',
}: {
  onRegistered: (space: Space) => void;
  onCancel: () => void;
  mode?: 'folder' | 'clone';
}) {
  const [folder, setFolder] = useState(''),
    [name, setName] = useState(''),
    [category, setCategory] = useState<Category>('personal');
  const [cloneMode, setCloneMode] = useState(mode === 'clone'),
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
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog label={t('スペース登録', 'Register space')} busy={busy} onClose={onCancel}>
      <form
        className="modal register-space"
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
                      .catch((e) => setError(errorText(e)))
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
                '選んだ保存先に新しいフォルダを作成します。Git の既存の認証設定を使用し、GitHub CLI（gh）にログイン済みならその認証でも再試行します。',
                'Creates a new folder at the chosen destination. Uses your existing Git authentication settings, and retries with the GitHub CLI (gh) if you are signed in to it.',
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
                    .catch((e) => setError(errorText(e)))
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
        {issue && <ErrorMessage text={issue} />}
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

type Brain = Pick<Space, 'scopeId' | 'name'>;

/** An example for a first launch, before any workspace combines brains. */
function sampleDiagram() {
  const brain = (id: string, name: string) => ({ scopeId: `sample-${id}`, name });
  const brains = [
    brain('notes', t('ノート', 'Notes')),
    brain('team', t('チーム', 'Team')),
    brain('research', t('研究', 'Research')),
    brain('thesis', t('論文', 'Thesis')),
  ];
  const ids = (...indexes: number[]) => indexes.map((i) => brains[i].scopeId);
  return {
    brains,
    groups: [
      { name: t('仕事', 'Work'), scopeIds: ids(0, 1, 2) },
      { name: t('論文執筆', 'Thesis writing'), scopeIds: ids(0, 2, 3) },
    ],
  };
}

/**
 * Brains above, workspaces below: one brain can belong to several workspaces.
 * Drawn in a 480 × 330 box; the whole drawing scales with the column.
 */
function Diagram({ spaces, profiles }: { spaces: Space[]; profiles: WorkspaceProfile[] }) {
  const shown = profiles
    .filter((profile) => profile.scopeIds.some((id) => spaces.some((s) => s.scopeId === id)))
    .slice(0, 2);
  const inGroup = (space: Brain) => shown.some((group) => group.scopeIds.includes(space.scopeId));
  const {
    brains,
    groups,
  }: { brains: Brain[]; groups: Pick<WorkspaceProfile, 'name' | 'scopeIds'>[] } = shown.length
    ? {
        brains: [...spaces.filter(inGroup), ...spaces.filter((s) => !inGroup(s))].slice(0, 6),
        groups: shown,
      }
    : sampleDiagram();
  const brainX = (i: number) => 240 + (i - (brains.length - 1) / 2) * 70;
  const groupX = (i: number) => (groups.length === 1 ? 240 : 120 + i * 240);
  return (
    <svg className="start-diagram" viewBox="0 0 480 330" aria-hidden="true">
      {groups.map((group, g) =>
        brains.map(
          (brain, b) =>
            group.scopeIds.includes(brain.scopeId) && (
              <g key={`${g}-${brain.scopeId}`} className={g ? 'secondary' : 'primary'}>
                <path d={`M${groupX(g)} 240 C${groupX(g)} 172 ${brainX(b)} 164 ${brainX(b)} 98`} />
                <circle cx={brainX(b)} cy={98} r={3} />
              </g>
            ),
        ),
      )}
      {brains.map((brain, b) => (
        <foreignObject key={brain.scopeId} x={brainX(b) - 36} y={28} width={72} height={80}>
          <div className="start-diagram-brain">
            <BrainTile space={brain} size={52} radius={15} />
            <small>{brain.name}</small>
          </div>
        </foreignObject>
      ))}
      {groups.map((group, g) => (
        <foreignObject key={g} x={groupX(g) - 100} y={240} width={200} height={44}>
          <div className={`start-diagram-workspace ${g ? '' : 'primary'}`}>
            <span>{group.name}</span>
            <small>{group.scopeIds.length}</small>
          </div>
        </foreignObject>
      ))}
    </svg>
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
    [adding, setAdding] = useState<'folder' | 'clone'>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string>();
  useEffect(() => {
    void host
      .workspaces()
      .then(setProfiles)
      .catch((e) => setError(errorText(e)));
  }, []);
  async function save() {
    setBusy(true);
    setError('');
    try {
      const saved = await host.saveWorkspace(name, selected, editing);
      setProfiles(await host.workspaces());
      onOpen(saved);
    } catch (e) {
      setError(errorText(e));
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
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const toggle = (id: string, on: boolean) =>
    setSelected((value) => (on ? [...value, id] : value.filter((item) => item !== id)));
  const unavailable = profiles
    .find((profile) => profile.id === editing)
    ?.scopeIds.filter((id) => !spaces.some((space) => space.scopeId === id));
  return (
    <div className="start">
      <section className="start-intro chrome">
        <div className="start-brand">
          <img className="brand-icon" src={appIcon} alt="" width="40" height="40" />
          <span>irori</span>
          <small>{appVersion} Preview</small>
        </div>
        <h1>
          {t('ノートから、', 'From your notes,')}
          <br />
          {t('次の仕事へ。', "to what's next.")}
        </h1>
        <Diagram spaces={spaces} profiles={profiles} />
        <footer className="start-footer">
          <UpdateNotice host={host} />
          <CloudRecovery />
        </footer>
      </section>
      <main className="start-main chrome">
        <h2>{t('ワークスペースを選択', 'Choose a workspace')}</h2>
        {profiles.length > 0 ? (
          <div className="start-workspaces">
            {profiles.map((profile) => {
              const members = spaces.filter((space) => profile.scopeIds.includes(space.scopeId));
              const missing = profile.scopeIds.length - members.length;
              return (
                <div
                  key={profile.id}
                  className="start-workspace"
                  data-editing={editing === profile.id || undefined}
                >
                  <button
                    className="workspace-card"
                    disabled={busy}
                    onClick={() => onOpen(profile)}
                  >
                    <span className="start-stack">
                      {members.map((space) => (
                        <BrainTile key={space.scopeId} space={space} size={30} radius={9} />
                      ))}
                    </span>
                    <span className="start-workspace-text">
                      <strong>{profile.name}</strong>
                      <small>
                        {members.map((space) => space.name).join(t('・', ' · '))}
                        {missing > 0 &&
                          (members.length ? t('・', ' · ') : '') +
                            t(`${missing} 件は利用できません`, `${missing} unavailable`)}
                      </small>
                    </span>
                    <span className="start-open">
                      <Icon name="arrow" size={17} strokeWidth={2.2} />
                    </span>
                  </button>
                  <button
                    className="start-icon-button"
                    disabled={busy}
                    title={t('編集', 'Edit')}
                    aria-label={t(`${profile.name} を編集`, `Edit ${profile.name}`)}
                    onClick={() => {
                      setEditing(profile.id);
                      setName(profile.name);
                      setSelected(profile.scopeIds);
                      setError('');
                    }}
                  >
                    <Icon name="squarePen" />
                  </button>
                  <button
                    className="start-icon-button"
                    disabled={busy}
                    title={t('登録を削除', 'Remove registration')}
                    aria-label={t(
                      `${profile.name} の登録を削除`,
                      `Remove ${profile.name} registration`,
                    )}
                    onClick={() => void remove(profile)}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              );
            })}
            <p className="start-note">
              {t(
                'KBフォルダ・ノートは残ります。Drive 接続がある場合は、接続の登録解除後にワークスペースを削除できます。',
                'The KB folder and notes remain. If there is a Drive connection, you can delete the workspace after unregistering the connection.',
              )}
            </p>
          </div>
        ) : (
          <p className="start-note">
            {t(
              'まだワークスペースはありません。Brain を組み合わせて作成します。',
              'No workspaces yet. Combine brains to create one.',
            )}
          </p>
        )}
        <hr />
        <section aria-labelledby="start-combine">
          <h3 id="start-combine">
            {editing
              ? t('ワークスペースを編集', 'Edit workspace')
              : t('Brain を選んで組み合わせる', 'Combine brains')}
          </h3>
          {editing && (
            <p className="start-note">
              {t(
                '下で名前と Brain の組み合わせを変更して保存できます。利用できない Brain も登録を保持できます。',
                'Change the name and combination of brains below and save. Unavailable brains can keep their registration too.',
              )}
            </p>
          )}
          <div className="start-library">
            {unavailable?.map((id) => (
              <label key={id} className="start-chip unavailable" title={id}>
                <Check
                  checked={selected.includes(id)}
                  disabled={busy}
                  onChange={(on) => toggle(id, on)}
                />
                <span>
                  {t('利用できない Brain（登録を保持）', 'Unavailable brain (registration kept)')}
                  <small>{id}</small>
                </span>
              </label>
            ))}
            {spaces.map((space) => (
              <label key={space.scopeId} className="start-chip" title={space.root}>
                <Check
                  checked={selected.includes(space.scopeId)}
                  disabled={busy}
                  onChange={(on) => toggle(space.scopeId, on)}
                />
                <BrainTile space={space} size={24} radius={7} />
                <span>{space.name}</span>
              </label>
            ))}
            {!spaces.length && (
              <p className="start-note">
                {t('Brain はまだありません。下で追加します。', 'No brains yet. Add one below.')}
              </p>
            )}
          </div>
          <form
            className="start-create"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label className="start-name">
              <span>{t('名前', 'Name')}</span>
              <input
                aria-label={t('ワークスペース名', 'Workspace name')}
                placeholder={t('ワークスペース名', 'Workspace name')}
                value={name}
                required
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
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
                className="start-text-button"
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
        <hr />
        <section aria-labelledby="start-add">
          <h3 id="start-add">{t('Brain を追加', 'Add brain')}</h3>
          <div className="start-add">
            <button disabled={busy} onClick={() => setAdding('folder')}>
              <span className="start-add-icon">
                <Icon name="folderOpen" size={20} />
              </span>
              <span>
                <strong>{t('KBフォルダを開く', 'Open a KB folder')}</strong>
                <small>{t('既存のフォルダ・チェックアウト', 'Existing folder or checkout')}</small>
              </span>
            </button>
            <button disabled={busy} onClick={() => setAdding('clone')}>
              <span className="start-add-icon">
                <Icon name="download" size={20} />
              </span>
              <span>
                <strong>{t('GitHub から取得', 'Clone from GitHub')}</strong>
                <small>{t('リポジトリをクローン', 'Clone a repository')}</small>
              </span>
            </button>
          </div>
          <p className="start-note">
            {t(
              'クラウドのフォルダは、開いた後に Brain の Contents から接続します。',
              "Connect cloud folders from a brain's Contents after opening.",
            )}
          </p>
        </section>
        {error && <p role="alert">{error}</p>}
      </main>
      {adding && (
        <RegisterSpace
          mode={adding}
          onCancel={() => setAdding(undefined)}
          onRegistered={(space) => {
            setSelected((value) => [...value, space.scopeId]);
            setAdding(undefined);
            void refresh().catch((e) => setError(errorText(e)));
          }}
        />
      )}
    </div>
  );
}

/** A real checkbox drawn as the canvas's rounded box. */
function Check({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <span className="start-check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <Icon name="check" size={12} strokeWidth={3} />
    </span>
  );
}
