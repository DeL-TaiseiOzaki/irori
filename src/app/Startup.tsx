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
import { LanguageSwitch } from './Settings';
import { t } from '../domain/i18n';
import { ErrorMessage, errorText } from './ErrorMessage';
import { PublishFields, initialPublish, publishReady } from './GitHubPublish';
import { RestoreEnvironment } from './AccountSync';
import './startup.css';
const host = window.irori;
export function RegisterSpace({
  onRegistered,
  onCancel,
  mode = 'folder',
}: {
  onRegistered: (space: Space) => void;
  onCancel: () => void;
  mode?: 'folder' | 'clone' | 'create';
}) {
  const [folder, setFolder] = useState(''),
    [name, setName] = useState(''),
    [category, setCategory] = useState<Category>('personal');
  const [way, setWay] = useState(mode),
    [url, setUrl] = useState(''),
    [parent, setParent] = useState(''),
    [cloneName, setCloneName] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [cloneNotice, setCloneNotice] = useState('');
  const [publishing, setPublishing] = useState(false),
    [publish, setPublish] = useState(() => initialPublish('')),
    [created, setCreated] = useState<Space>();
  const cloneMode = way === 'clone',
    creating = way === 'create';
  const repository = useResource(() => host.repositories(folder), [folder], {
    enabled: !!folder && !creating,
    delay: 250,
  });
  const info = repository.data;
  const issue = error || (creating ? '' : repository.error);
  /** A new hibachi: made, registered, committed, then published when asked. */
  async function create() {
    const result = await host.createSpace({
      parent,
      folder: cloneName,
      name: name.trim() || cloneName,
      category,
    });
    if (!publishing && !result.notice) return onRegistered(result.space);
    // From here the hibachi exists; what follows can only add a notice to it.
    setCreated(result.space);
    if (result.notice) return setError(result.notice);
    try {
      const status = await host.gitStatus(result.space.scopeId);
      await host.gitPublish(result.space.scopeId, publish, status.version);
      onRegistered(result.space);
    } catch (e) {
      const [advice, ...detail] = errorText(e).split('\n\n');
      setError(
        [
          `${t(
            'hibachi は作成しましたが、GitHub への公開は完了していません。',
            'The hibachi was created, but publishing to GitHub did not finish.',
          )}\n${advice}`,
          ...detail,
        ].join('\n\n'),
      );
    }
  }
  async function submit() {
    if (created) return onRegistered(created);
    setBusy(true);
    setError('');
    try {
      if (creating) await create();
      else if (cloneMode && !folder) {
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
        <h2>{t('スペースを登録', 'Register a space')}</h2>
        {!folder && !created && (
          <MagnetTabs
            className="git-registration-mode"
            label={t('リポジトリの取得方法', 'How to get the repository')}
            value={way}
            onValueChange={(next) => {
              setWay(next);
              setError('');
            }}
            options={[
              { value: 'folder', label: t('既存のフォルダ', 'Existing folder'), disabled: busy },
              { value: 'clone', label: t('GitHub から取得', 'Clone from GitHub'), disabled: busy },
              { value: 'create', label: t('新しく作成', 'Create new'), disabled: busy },
            ]}
          />
        )}
        {creating ? (
          <>
            <label>
              {t('保存先の親フォルダ', 'Parent folder to save into')}
              <div className="actions">
                <input
                  aria-label={t('保存先の親フォルダ', 'Parent folder to save into')}
                  ref={(input) => {
                    if (input) input.autofocus = true;
                  }}
                  value={parent}
                  onChange={(e) => setParent(e.target.value)}
                  disabled={busy || !!created}
                  required
                />
                <button
                  type="button"
                  disabled={busy || !!created}
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
                onChange={(e) => {
                  const next = e.target.value;
                  // The repository name follows the folder until someone edits it.
                  if (publish.name === initialPublish(cloneName).name)
                    setPublish({ ...publish, name: initialPublish(next).name });
                  setCloneName(next);
                }}
                disabled={busy || !!created}
                required
              />
            </label>
          </>
        ) : cloneMode && !folder ? (
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
        {!creating && (
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
                            : t('確認が必要', 'Needs attention')}
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
        )}
        {(!cloneMode || folder) && (
          <>
            <label>
              {t('スペース名', 'Space name')}
              <input
                aria-label={t('スペース名', 'Space name')}
                value={name}
                placeholder={creating ? cloneName : undefined}
                required={!creating}
                disabled={busy || !!created}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <details>
              <summary>{t('分類', 'Category')}</summary>
              <label>
                <select
                  aria-label={t('スペースの種類', 'Space type')}
                  value={category}
                  disabled={busy || !!created}
                  onChange={(e) => setCategory(e.target.value as Category)}
                >
                  <option value="personal">{t('個人', 'Personal')}</option>
                  <option value="team">{t('チーム', 'Team')}</option>
                  <option value="organization">{t('組織', 'Organization')}</option>
                </select>
              </label>
            </details>
            {creating ? (
              <>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={publishing}
                    disabled={busy || !!created}
                    onChange={(e) => {
                      setPublishing(e.target.checked);
                      if (e.target.checked && !publish.name)
                        setPublish({ ...publish, name: initialPublish(cloneName).name });
                    }}
                  />
                  {t('GitHub にも作成', 'Also create on GitHub')}
                </label>
                {publishing && !created && (
                  <PublishFields value={publish} onChange={setPublish} disabled={busy} />
                )}
              </>
            ) : null}
          </>
        )}
        {issue && <ErrorMessage text={issue} />}
        {busy && (
          <p role="status">
            {creating
              ? publishing
                ? t('作成して GitHub に公開しています…', 'Creating and publishing to GitHub…')
                : t('作成しています…', 'Creating…')
              : cloneMode && !folder
                ? t('リポジトリを取得しています…', 'Cloning the repository…')
                : t('登録しています…', 'Registering…')}
          </p>
        )}
        <div className="actions">
          {/* Once the hibachi exists, closing the form opens it rather than leaving it unseen. */}
          <button
            type="button"
            disabled={busy}
            onClick={() => (created ? onRegistered(created) : onCancel())}
          >
            {created ? t('閉じる', 'Close') : t('キャンセル', 'Cancel')}
          </button>
          <ArrowFillButton
            type="submit"
            disabled={
              busy ||
              (creating
                ? !created && publishing && !publishReady(publish)
                : !(cloneMode && !folder) && (!info || info.kind === 'unavailable'))
            }
          >
            {created
              ? t('開く', 'Open')
              : creating
                ? publishing
                  ? t('作成して公開', 'Create and publish')
                  : t('作成して開く', 'Create and open')
                : cloneMode && !folder
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
  // Undefined until edited, so the suggested name follows a language change.
  const [edited, setName] = useState<string>(),
    [adding, setAdding] = useState<'folder' | 'clone' | 'create'>(),
    [restoring, setRestoring] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string>();
  const name = edited ?? t('マイワークスペース', 'My workspace');
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
          <LanguageSwitch onError={(e) => setError(errorText(e))} />
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
          </div>
        ) : (
          <p className="start-note">
            {t('まだワークスペースはありません。', 'No workspaces yet.')}
          </p>
        )}
        <hr />
        <section aria-labelledby="start-combine">
          <h3 id="start-combine">
            {editing
              ? t('ワークスペースを編集', 'Edit workspace')
              : t('hibachi を選んで組み合わせる', 'Combine hibachis')}
          </h3>
          <div className="start-library">
            {unavailable?.map((id) => (
              <label key={id} className="start-chip unavailable" title={id}>
                <Check
                  checked={selected.includes(id)}
                  disabled={busy}
                  onChange={(on) => toggle(id, on)}
                />
                <span>
                  {t('利用できない hibachi', 'Unavailable hibachi')}
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
              <p className="start-note">{t('hibachi はまだありません。', 'No hibachis yet.')}</p>
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
                  setName(undefined);
                }}
              >
                {t('編集をキャンセル', 'Cancel editing')}
              </button>
            )}
          </form>
        </section>
        <hr />
        <section aria-labelledby="start-add">
          <h3 id="start-add">{t('hibachi を追加', 'Add hibachi')}</h3>
          <div className="start-add">
            <button disabled={busy} onClick={() => setAdding('folder')}>
              <span className="start-add-icon">
                <Icon name="folderOpen" size={20} />
              </span>
              <span>
                <strong>{t('KBフォルダを開く', 'Open a KB folder')}</strong>
              </span>
            </button>
            <button disabled={busy} onClick={() => setAdding('clone')}>
              <span className="start-add-icon">
                <Icon name="download" size={20} />
              </span>
              <span>
                <strong>{t('GitHub から取得', 'Clone from GitHub')}</strong>
              </span>
            </button>
            <button disabled={busy} onClick={() => setAdding('create')}>
              <span className="start-add-icon">
                <Icon name="plus" size={20} />
              </span>
              <span>
                <strong>{t('新しく作成', 'Create new')}</strong>
              </span>
            </button>
            <button disabled={busy} onClick={() => setRestoring(true)}>
              <span className="start-add-icon">
                <Icon name="user" size={20} />
              </span>
              <span>
                <strong>{t('GitHub から環境を復元', 'Restore from GitHub')}</strong>
              </span>
            </button>
          </div>
        </section>
        {error && <p role="alert">{error}</p>}
      </main>
      {restoring && (
        <RestoreEnvironment
          onClose={() => setRestoring(false)}
          onRestored={async () => {
            await refresh();
            setProfiles(await host.workspaces());
          }}
        />
      )}
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
