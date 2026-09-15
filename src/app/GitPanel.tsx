import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import type { Space } from '../domain/types';
import type { GitCommit, GitConflict, GitDiff, GitStatus, GitSyncAction } from '../domain/git';
import { Menu } from '@base-ui/react/menu';
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Icon } from './Icon';
import { useDraft } from './useDraft';
import './git-panel.css';
const host = window.irori;
const stateNames: Record<string, string> = {
  M: '変更',
  A: '追加',
  D: '削除',
  T: '種別変更',
  '?': '新規',
  U: '競合',
};

function Patch({ text }: { text: string }) {
  return (
    <pre className="git-patch" tabIndex={0} aria-label="差分">
      {text.split('\n').map((line, i) => (
        <span
          key={i}
          className={
            line.startsWith('+')
              ? 'addition'
              : line.startsWith('-')
                ? 'deletion'
                : line.startsWith('@@')
                  ? 'hunk'
                  : ''
          }
        >
          {line}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

export function GitPanel({
  spaces,
  initialScope,
  onClose,
  onChanged,
  detailTarget,
  onReviewChange,
  onBusyChange,
  revision,
  beforeAction,
}: {
  spaces: Space[];
  initialScope: string;
  onClose: () => void;
  onChanged: () => void;
  detailTarget: HTMLElement | null;
  onReviewChange: (reviewing: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  revision: number;
  beforeAction: () => Promise<boolean>;
}) {
  const [scopeId, setScopeId] = useState(initialScope),
    [busy, setBusy] = useState(false);
  return (
    <aside className="git-sidebar" aria-label="ソース管理">
      <div className="git-sidebar-heading">
        <div>
          <Icon name="branch" size={17} />
          <strong>ソース管理</strong>
        </div>
        <button aria-label="Git 画面を閉じる" disabled={busy} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <label>
        <span className="git-sr-only">リポジトリ</span>
        <select
          aria-label="Git のスペース"
          value={scopeId}
          disabled={busy}
          onChange={(e) => setScopeId(e.target.value)}
        >
          {spaces.map((s) => (
            <option key={s.scopeId} value={s.scopeId}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <RepositoryPanel
        key={scopeId}
        space={spaces.find((s) => s.scopeId === scopeId)!}
        onBusy={(value) => {
          setBusy(value);
          onBusyChange(value);
        }}
        onChanged={onChanged}
        detailTarget={detailTarget}
        onReviewChange={onReviewChange}
        externalRevision={revision}
        beforeAction={beforeAction}
      />
    </aside>
  );
}

function RepositoryPanel({
  space,
  onBusy,
  onChanged,
  detailTarget,
  onReviewChange,
  externalRevision,
  beforeAction,
}: {
  space: Space;
  onBusy: (busy: boolean) => void;
  onChanged: () => void;
  detailTarget: HTMLElement | null;
  onReviewChange: (reviewing: boolean) => void;
  externalRevision: number;
  beforeAction: () => Promise<boolean>;
}) {
  const menuHost = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<GitStatus>(),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false),
    [tab, setTab] = useState<'changes' | 'history'>('changes');
  const [selection, setSelection] = useState<{ path: string; staged: boolean }>();
  const [diff, setDiff] = useState<GitDiff>(),
    [conflict, setConflict] = useState<GitConflict>(),
    [resolution, setResolution] = useState('');
  const [confirmation, setConfirmation] = useState<'commit' | GitSyncAction>();
  const [history, setHistory] = useState<GitCommit[]>([]),
    [more, setMore] = useState(false),
    [commit, setCommit] = useState<GitCommit>(),
    [commitPatch, setCommitPatch] = useState('');
  const [revision, setRevision] = useState(0);
  const [loadingReview, setLoadingReview] = useState(false);
  const alive = useRef(true),
    active = useRef(false),
    reads = useRef(0),
    statusReads = useRef(0);
  const resolutionDraft = useRef<{ path: string; text: string } | undefined>(undefined);
  const messageDraft = useDraft({ scopeId: space.scopeId, kind: 'git-commit' }, space.root);
  const message = messageDraft.text;
  const resolutionPath =
    resolutionDraft.current?.path ??
    (selection && status?.changes.find((entry) => entry.path === selection.path)?.conflict
      ? selection.path
      : undefined);
  const storedResolution = useDraft(
    resolutionPath
      ? {
          scopeId: space.scopeId,
          kind: 'git-resolution',
          path: resolutionPath,
        }
      : null,
    space.root,
  );
  const draftBlocked =
    !messageDraft.ready ||
    messageDraft.pending ||
    !!messageDraft.error ||
    (!!resolutionPath &&
      (!storedResolution.ready || storedResolution.pending || !!storedResolution.error));
  const confirmationVersion = useRef('');
  const conflictDirty = !!conflict && resolution !== (conflict.working ?? '');
  const reviewing = tab === 'history' ? !!commit : !!selection;
  useEffect(() => {
    onReviewChange(reviewing);
  }, [reviewing, onReviewChange]);
  useEffect(
    () => () => {
      onReviewChange(false);
      onBusy(false);
    },
    [],
  );
  useEffect(() => {
    onBusy(busy || conflictDirty || draftBlocked);
  }, [busy, conflictDirty, draftBlocked]);
  function accept(value: GitStatus) {
    if (alive.current) {
      setStatus(value);
      setRevision((n) => n + 1);
    }
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      reads.current++;
    };
  }, [space.scopeId]);
  useEffect(() => {
    if (active.current || conflictDirty) return;
    let cancelled = false;
    const generation = ++statusReads.current;
    void host
      .gitStatus(space.scopeId)
      .then((value) => {
        if (!cancelled && generation === statusReads.current) accept(value);
      })
      .catch((e) => {
        if (!cancelled && generation === statusReads.current && alive.current) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [space.scopeId, externalRevision]);
  async function perform(fn: () => Promise<GitStatus | void>, success = '') {
    if (active.current) return;
    active.current = true;
    statusReads.current++;
    setBusy(true);
    onBusy(true);
    setError('');
    setNotice('');
    setConfirmation(undefined);
    try {
      if (!(await messageDraft.flush()) || !(await storedResolution.flush())) {
        throw Error('下書きを保存してから Git 操作を再試行してください。');
      }
      if (!(await beforeAction())) return;
      const value = await fn();
      if (value) accept(value);
      if (alive.current) setNotice(success);
    } catch (e) {
      if (alive.current) setError(String(e));
      // A failed command may still change Git state (for example a merge conflict).
      try {
        accept(await host.gitStatus(space.scopeId));
      } catch (e) {
        if (alive.current) setError(String(e));
      }
    } finally {
      if (alive.current) {
        setBusy(false);
      }
      active.current = false;
      onChanged();
    }
  }
  useEffect(() => {
    if (tab !== 'changes') {
      reads.current++;
      return;
    }
    if (!selection) {
      setDiff(undefined);
      setConflict(undefined);
      setLoadingReview(false);
      return;
    }
    const generation = ++reads.current;
    setLoadingReview(true);
    setDiff(undefined);
    if (!resolutionDraft.current) setConflict(undefined);
    const entry = status?.changes.find((c) => c.path === selection.path);
    if (!entry) {
      setSelection(undefined);
      return;
    }
    const fetch =
      entry.conflict && !entry.blocked
        ? host.gitConflict(space.scopeId, selection.path).then((value) => {
            if (generation === reads.current && alive.current) {
              setConflict(value);
              setResolution(
                resolutionDraft.current?.path === value.path
                  ? resolutionDraft.current.text
                  : (value.working ?? ''),
              );
            }
          })
        : host.gitDiff(space.scopeId, selection.path, selection.staged).then((value) => {
            if (generation === reads.current && alive.current) setDiff(value);
          });
    void fetch
      .catch((e) => {
        if (generation === reads.current && alive.current) setError(String(e));
      })
      .finally(() => {
        if (generation === reads.current && alive.current) setLoadingReview(false);
      });
  }, [selection, revision, tab]);
  async function loadHistory(append = false) {
    const page = await host.gitHistory(space.scopeId, append ? history.length : 0);
    if (alive.current) {
      setHistory((previous) => (append ? [...previous, ...page.commits] : page.commits));
      setMore(page.more);
    }
  }
  async function showCommit(value: GitCommit) {
    const generation = ++reads.current;
    setCommit(value);
    setCommitPatch('');
    try {
      const patch = await host.gitCommitDiff(space.scopeId, value.oid);
      if (generation === reads.current && alive.current) setCommitPatch(patch);
    } catch (e) {
      if (generation === reads.current && alive.current) setError(String(e));
    }
  }
  if (!status)
    return (
      <p className="git-empty" role={error ? 'alert' : 'status'}>
        {error || 'リポジトリを確認しています…'}
      </p>
    );
  if (!status.available)
    return (
      <div className="git-empty">
        <h2>Git リポジトリを開いてください</h2>
        <p>{status.detail}</p>
        <p>「スペースを追加」から既存リポジトリを登録するか、GitHub から取得できます。</p>
      </div>
    );
  const staged = status.changes.filter((c) => ![' ', '?'].includes(c.index) && !c.conflict);
  const unstaged = status.changes.filter((c) => c.worktree !== ' ' || c.conflict);
  const conflicts = status.changes.filter((c) => c.conflict);
  const chosen = status.changes.find((c) => c.path === selection?.path);
  const canCommit =
    !draftBlocked &&
    !!status.branch &&
    status.operation !== 'other' &&
    !conflicts.length &&
    !staged.some((c) => c.blocked) &&
    (!!staged.length || status.operation === 'merge');
  const canSync = !!status.remote && !!status.head && !!status.branch;
  const remoteLabel = `${status.remote?.label ?? 'リモート未設定'} / ${status.remote?.branch ?? ''}`;
  const confirmLabels = {
    commit: 'この内容を commit',
    fetch: 'リモートの状態を取得',
    pull: 'Pull を実行',
    merge: '履歴の統合を開始',
    push: 'Push を実行',
  };
  function confirm(action: GitSyncAction) {
    confirmationVersion.current = status!.version;
    setConfirmation(action);
  }
  async function resolveConflict(text: string | null) {
    if (!selection || !conflict) return;
    const acknowledged = storedResolution.snapshot().record?.revision;
    const value = await host.gitResolve(space.scopeId, selection.path, text, conflict.version);
    if (!(await storedResolution.clear(acknowledged)))
      throw Error(
        '統合は解決しましたが、下書きの完了を保存できませんでした。保存を再試行してください。',
      );
    resolutionDraft.current = undefined;
    return value;
  }
  return (
    <>
      <div className="git-repository-bar">
        <div>
          <span>
            <Icon name="branch" /> {status.branch ?? 'detached HEAD'}
          </span>
          <small title="取得済みのリモート履歴との比較">
            {status.ahead === undefined ? '未取得' : `↑ ${status.ahead} ↓ ${status.behind}`}
          </small>
        </div>
        <div className="git-remote">
          <small>{remoteLabel}</small>
          {status.remote && status.remote.fetchLabel !== status.remote.label && (
            <small>受信元: {status.remote.fetchLabel}</small>
          )}
          <small className="git-sr-only">
            {status.ahead === undefined
              ? '受信先の履歴は未取得です'
              : `送信待ち ${status.ahead} commit ・ 受信待ち ${status.behind} commit（取得済みの履歴）`}
          </small>
        </div>
      </div>
      <form
        className="git-commit-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canCommit || !message.trim()) return;
          void perform(async () => {
            const acknowledged = messageDraft.snapshot().record?.revision;
            const value = await host.gitCommit(space.scopeId, message, status.version);
            if (!(await messageDraft.clear(acknowledged)))
              throw Error(
                'コミットしましたが、下書きの完了を保存できませんでした。保存を再試行してください。',
              );
            return value;
          }, 'この端末の履歴に commit しました。');
        }}
      >
        <label>
          <span className="git-sr-only">commit メッセージ</span>
          <input
            aria-label="commit メッセージ"
            value={message}
            onChange={(e) => messageDraft.setText(e.target.value)}
            placeholder="メッセージを入力してコミット"
            maxLength={10000}
            disabled={busy || !messageDraft.ready}
            required
          />
        </label>
        <button
          aria-label="コミット"
          className="primary"
          disabled={busy || !canCommit || !message.trim()}
        >
          コミット{staged.length ? ` (${staged.length})` : ''}
        </button>
      </form>
      {(messageDraft.error || storedResolution.error) && (
        <div className="git-notice error" role="alert">
          <p>{messageDraft.error || storedResolution.error}</p>
          <button
            onClick={() => void Promise.all([messageDraft.retry(), storedResolution.retry()])}
          >
            下書きの保存を再試行
          </button>
        </div>
      )}
      {(messageDraft.pending || storedResolution.pending) && (
        <p className="git-notice" aria-live="polite">
          下書きをこの端末に保存中…
        </p>
      )}
      <div className="git-toolbar" ref={menuHost}>
        {/* One pressed view at a time, with the group's own roving focus. */}
        <ToggleGroup
          className="git-tabs"
          aria-label="Git の表示"
          value={[tab]}
          onValueChange={(next) => {
            const selected = next[0];
            if (!selected || selected === tab) return;
            setTab(selected as typeof tab);
            if (selected === 'history') void perform(() => loadHistory());
          }}
        >
          <Toggle value="changes" disabled={busy || conflictDirty || draftBlocked}>
            変更 <span>{status.changes.length}</span>
          </Toggle>
          <Toggle value="history" disabled={busy || conflictDirty || draftBlocked}>
            履歴
          </Toggle>
        </ToggleGroup>
        <div className="actions">
          <button
            disabled={busy || conflictDirty || draftBlocked}
            onClick={() =>
              void perform(async () => {
                if (tab === 'history') await loadHistory();
                return host.gitStatus(space.scopeId);
              })
            }
          >
            <Icon name="refresh" /> 更新
          </button>
          {/* A panel menu, not a modal surface: the rest of the panel stays usable. */}
          <Menu.Root modal={false}>
            <Menu.Trigger className="git-more-actions" aria-label="その他の Git 操作">
              その他
            </Menu.Trigger>
            {/* The menu stays inside the source-control aside so it is grouped
                with the panel it acts on. */}
            <Menu.Portal container={menuHost}>
              <Menu.Positioner side="bottom" align="start" sideOffset={6}>
                <Menu.Popup className="git-menu">
                  <Menu.Item
                    disabled={busy || conflictDirty || draftBlocked || !canSync}
                    onClick={() =>
                      void perform(
                        () => host.gitSync(space.scopeId, 'fetch', status.version),
                        'リモートの状態を取得しました。ノートは変更していません。',
                      )
                    }
                  >
                    Fetch
                  </Menu.Item>
                  <Menu.Item
                    disabled={
                      busy || !canSync || !!status.changes.length || status.operation !== 'none'
                    }
                    onClick={() => confirm('merge')}
                  >
                    履歴を統合
                  </Menu.Item>
                  {status.remote?.repository && (
                    <Menu.Item
                      disabled={busy}
                      onClick={() =>
                        void host.gitOpenRepository(space.scopeId).catch((e) => setError(String(e)))
                      }
                    >
                      GitHub を開く
                    </Menu.Item>
                  )}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
          <button
            disabled={
              busy ||
              conflictDirty ||
              !canSync ||
              !!status.changes.length ||
              status.operation !== 'none'
            }
            onClick={() => confirm('pull')}
          >
            Pull
          </button>
          <button
            className="primary"
            disabled={
              busy || conflictDirty || draftBlocked || !canSync || status.operation !== 'none'
            }
            onClick={() => confirm('push')}
          >
            Push
          </button>
        </div>
      </div>
      {error && (
        <p className="git-notice error" role="alert">
          {error}
        </p>
      )}
      {(notice || busy) && (
        <p className="git-notice" role="status">
          {busy ? 'Git 操作を実行中…' : notice}
        </p>
      )}
      {status.operation !== 'none' && (
        <p className="git-notice git-warning" role="status">
          {status.operation === 'merge'
            ? `履歴の統合中です。未解決 ${conflicts.length} 件。すべての変更を確認し、commit すると統合が完了します。`
            : 'rebase・cherry-pick 等の操作が進行中です。開始した Git ツールで完了してください。'}
        </p>
      )}
      <div className="git-list" aria-label={tab === 'changes' ? '変更ファイル' : 'commit 履歴'}>
        {tab === 'changes' ? (
          <>
            {[
              { title: 'ステージ済みの変更', entries: staged, staged: true },
              { title: '変更', entries: unstaged, staged: false },
            ].map((group) => (
              <section key={group.title}>
                <h3>
                  {group.title}
                  <span>{group.entries.length}</span>
                  <button
                    className="git-stage-all"
                    disabled={
                      busy ||
                      conflictDirty ||
                      status.operation === 'other' ||
                      !group.entries.some(
                        (entry) => !entry.conflict && (group.staged || !entry.blocked),
                      )
                    }
                    onClick={() =>
                      void perform(
                        () =>
                          host.gitStageMany(
                            space.scopeId,
                            group.entries
                              .filter(
                                (entry) => !entry.conflict && (group.staged || !entry.blocked),
                              )
                              .map((entry) => entry.path),
                            !group.staged,
                            status.version,
                          ),
                        group.staged
                          ? '対象をすべて外しました。'
                          : '保存済みの変更をまとめて追加しました。',
                      )
                    }
                  >
                    {group.staged ? 'すべて解除' : 'すべて追加'}
                  </button>
                </h3>
                {!group.entries.length && (
                  <p className="muted">
                    {group.staged ? '＋ でコミット対象に追加します。' : '変更はありません。'}
                  </p>
                )}
                {group.entries.map((entry) => (
                  <div className="git-file-row" key={entry.path}>
                    <button
                      className="git-file"
                      aria-pressed={
                        selection?.path === entry.path && selection.staged === group.staged
                      }
                      disabled={busy || conflictDirty || draftBlocked}
                      onClick={() => {
                        setError('');
                        setSelection({ path: entry.path, staged: group.staged });
                      }}
                      title={entry.path}
                    >
                      <span
                        className={
                          entry.conflict ? 'git-file-state conflict-state' : 'git-file-state'
                        }
                      >
                        {entry.conflict
                          ? '競合'
                          : (stateNames[group.staged ? entry.index : entry.worktree] ?? '変更')}
                      </span>
                      <span>{entry.path}</span>
                      {entry.blocked && <small>対象外</small>}
                    </button>
                    <button
                      className="git-stage-file"
                      aria-label={`${entry.path} を${group.staged ? 'ステージから外す' : 'ステージする'}`}
                      title={group.staged ? 'ステージから外す' : '変更全体をステージ'}
                      disabled={
                        busy ||
                        conflictDirty ||
                        entry.conflict ||
                        status.operation === 'other' ||
                        (!group.staged && !!entry.blocked)
                      }
                      onClick={() =>
                        void perform(
                          () =>
                            host.gitStageMany(
                              space.scopeId,
                              [entry.path],
                              !group.staged,
                              status.version,
                            ),
                          group.staged ? 'ステージから外しました。' : 'ステージに追加しました。',
                        )
                      }
                    >
                      {group.staged ? '−' : '+'}
                    </button>
                  </div>
                ))}
              </section>
            ))}
          </>
        ) : (
          <>
            {!history.length && <p className="git-empty">commit はまだありません。</p>}
            {history.map((item) => (
              <button
                key={item.oid}
                className="git-history-item"
                aria-pressed={commit?.oid === item.oid}
                disabled={busy}
                onClick={() => void showCommit(item)}
              >
                <strong>{item.subject}</strong>
                <small>
                  {item.author} ・ {new Date(item.date).toLocaleDateString('ja-JP')}
                </small>
                <code>{item.oid.slice(0, 8)}</code>
              </button>
            ))}
            {more && (
              <button disabled={busy} onClick={() => void perform(() => loadHistory(true))}>
                以前の履歴を表示
              </button>
            )}
          </>
        )}
      </div>
      {reviewing &&
        detailTarget &&
        createPortal(
          <section
            className="git-detail git-workspace-detail"
            aria-label="Git の差分"
            aria-busy={loadingReview}
          >
            <div className="git-review-navigation">
              <button
                disabled={busy || conflictDirty || draftBlocked}
                onClick={() => {
                  reads.current++;
                  setSelection(undefined);
                  setCommit(undefined);
                }}
              >
                ノートに戻る
              </button>
            </div>
            {tab === 'history' ? (
              commit ? (
                <>
                  <h3>{commit.subject}</h3>
                  <Patch text={commitPatch || '差分を読み込み中…'} />
                </>
              ) : (
                <div className="git-empty">
                  <Icon name="history" size={32} />
                  <h2>ノートが変わった道筋を読む</h2>
                  <p>commit を選ぶと、その時点の変更を確認できます。</p>
                </div>
              )
            ) : !selection ? (
              <div className="git-empty">
                <Icon name="branch" size={32} />
                <h2>共有する変更を選ぶ</h2>
                <p>
                  差分を確認し、まとめて、またはファイルごとに commit 対象へ追加できます。
                  <br />
                  commit はこの端末の履歴に保存されます。
                </p>
              </div>
            ) : (
              <>
                <div className="git-detail-heading">
                  <h3>{selection.path}</h3>
                  <span>
                    {chosen?.conflict
                      ? '競合'
                      : selection.staged
                        ? 'commit に含まれる差分'
                        : '作業ファイルの差分'}
                  </span>
                </div>
                {conflict ? (
                  <>
                    {storedResolution.ready &&
                      storedResolution.record?.text != null &&
                      resolutionDraft.current?.path !== conflict.path && (
                        <div
                          className="git-notice git-warning"
                          role="region"
                          aria-label="統合の下書きの復元"
                        >
                          <p>
                            {storedResolution.record.baseVersion === conflict.version
                              ? 'この端末に未完了の統合の下書きがあります。'
                              : '保存後に Git の状態が変わっています。現在の内容と下書きを比較してから編集に戻してください。'}
                          </p>
                          <details>
                            <summary>保存済みの下書きを確認</summary>
                            <pre>{storedResolution.record.text || '（空の内容）'}</pre>
                          </details>
                          <button
                            disabled={busy || draftBlocked}
                            onClick={() => {
                              const text = storedResolution.record!.text!;
                              resolutionDraft.current = { path: conflict.path, text };
                              setResolution(text);
                              storedResolution.setText(text, conflict.version);
                            }}
                          >
                            下書きを編集に戻す
                          </button>
                        </div>
                      )}
                    <div className="git-conflict-versions">
                      {[
                        { label: '共通の元データ', value: conflict.base },
                        { label: 'このブランチ', value: conflict.ours },
                        { label: '取り込むブランチ', value: conflict.theirs },
                      ].map((v) => (
                        <details key={v.label} open={v.label !== '共通の元データ'}>
                          <summary>
                            {v.label}
                            {v.value === undefined ? '（ファイルなし）' : ''}
                          </summary>
                          <pre>{v.value ?? 'この版にはファイルがありません。'}</pre>
                        </details>
                      ))}
                    </div>
                    {conflict.editable ? (
                      <div className="git-resolution">
                        <label>
                          統合する内容
                          <textarea
                            aria-label="統合する内容"
                            value={resolution}
                            disabled={busy || !storedResolution.ready}
                            onChange={(e) => {
                              resolutionDraft.current = {
                                path: conflict.path,
                                text: e.target.value,
                              };
                              setResolution(e.target.value);
                              storedResolution.setText(e.target.value, conflict.version);
                            }}
                            spellCheck={false}
                          />
                        </label>
                        <p className="muted">
                          競合マーカーを取り除き、両方の変更を確認してください。解決前の内容はこの端末に保持します。
                        </p>
                        <div className="actions">
                          {conflictDirty && (
                            <button
                              disabled={busy}
                              onClick={() => {
                                const text = conflict.working ?? '';
                                resolutionDraft.current = { path: conflict.path, text };
                                setResolution(text);
                                storedResolution.setText(text, conflict.version);
                              }}
                            >
                              統合の編集を戻す
                            </button>
                          )}
                          {(conflict.ours === undefined || conflict.theirs === undefined) && (
                            <button
                              disabled={busy || loadingReview || draftBlocked}
                              onClick={() =>
                                void perform(
                                  () => resolveConflict(null),
                                  '削除として解決しました。commit で統合を完了できます。',
                                )
                              }
                            >
                              削除として解決
                            </button>
                          )}
                          <button
                            className="primary"
                            disabled={busy || loadingReview || draftBlocked}
                            onClick={() =>
                              void perform(
                                () => resolveConflict(resolution),
                                '統合内容を保存し、commit 対象に追加しました。',
                              )
                            }
                          >
                            統合内容を保存して解決
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p role="status">{conflict.detail}</p>
                    )}
                  </>
                ) : diff ? (
                  <>
                    <Patch text={diff.patch} />
                    <div className="git-diff-actions">
                      <p className="muted">
                        {selection.staged
                          ? '表示中の差分が次の commit に含まれます。'
                          : '追加すると、このファイルの保存済みの変更全体が対象になります。'}
                      </p>
                      <button
                        disabled={
                          busy ||
                          !!chosen?.conflict ||
                          status.operation === 'other' ||
                          (!selection.staged && !!chosen?.blocked)
                        }
                        onClick={() =>
                          void perform(
                            () =>
                              host.gitStage(
                                space.scopeId,
                                selection.path,
                                !selection.staged,
                                diff.version,
                              ),
                            selection.staged
                              ? 'commit 対象から外しました。ファイルの内容は保持しています。'
                              : 'commit 対象に追加しました。',
                          )
                        }
                      >
                        {selection.staged ? 'commit 対象から外す' : 'commit 対象に追加'}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="git-empty">差分を読み込み中…</p>
                )}
              </>
            )}
          </section>,
          detailTarget,
        )}
      {confirmation && (
        <div className="git-confirmation" role="region" aria-label="Git 操作の確認">
          <div>
            <strong>
              {confirmation === 'commit'
                ? `${staged.length} 件の変更を ${space.name} に commit`
                : `${space.name} / ${status.branch} と ${confirmation === 'push' ? remoteLabel : `${status.remote?.fetchLabel} / ${status.remote?.branch}`}`}
            </strong>
            <p>
              {confirmation === 'commit'
                ? message
                : confirmation === 'push'
                  ? `commit ${status.head?.slice(0, 8)} までのこのブランチを送信します。未コミットの変更は含みません。`
                  : confirmation === 'merge'
                    ? 'リモートの最新状態を取得し、Git で統合します。分岐した履歴の統合結果は確認後に commit します。'
                    : 'リモートの最新状態を取得し、履歴が分岐していなければ作業ファイルを更新します。'}
            </p>
            {confirmation === 'commit' && (
              <ul>
                {staged.map((c) => (
                  <li key={c.path}>{c.path}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="actions">
            <button disabled={busy} onClick={() => setConfirmation(undefined)}>
              戻る
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void perform(
                  async () => {
                    if (confirmation === 'commit') {
                      const acknowledged = messageDraft.snapshot().record?.revision;
                      const value = await host.gitCommit(space.scopeId, message, status.version);
                      if (!(await messageDraft.clear(acknowledged)))
                        throw Error(
                          'コミットしましたが、下書きの完了を保存できませんでした。保存を再試行してください。',
                        );
                      return value;
                    }
                    return host.gitSync(space.scopeId, confirmation, confirmationVersion.current);
                  },
                  confirmation === 'commit'
                    ? 'この端末の履歴に commit しました。共有は別の操作です。'
                    : confirmation === 'push'
                      ? 'リモートへの送信が完了しました。'
                      : '受信結果を確認してください。',
                )
              }
            >
              {confirmLabels[confirmation]}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
