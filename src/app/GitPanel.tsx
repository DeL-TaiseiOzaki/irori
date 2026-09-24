import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import type { Space } from '../domain/types';
import type { GitCommit, GitConflict, GitDiff, GitStatus, GitSyncAction } from '../domain/git';
import { Menu } from '@base-ui/react/menu';
import { MagnetTabs } from './obsidian/MagnetTabs';
import { Icon } from './Icon';
import { useDraft } from './useDraft';
import { displayLocale, t } from '../domain/i18n';
import './git-panel.css';
const host = window.irori;
// A function so each entry is read in the language of the current render.
const stateNames = (): Record<string, string> => ({
  M: t('変更', 'Modified'),
  A: t('追加', 'Added'),
  D: t('削除', 'Deleted'),
  T: t('種別変更', 'Type changed'),
  '?': t('新規', 'New'),
  U: t('競合', 'Conflict'),
});

function Patch({ text }: { text: string }) {
  return (
    <pre className="git-patch" tabIndex={0} aria-label={t('差分', 'Diff')}>
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
    <aside className="git-sidebar" aria-label={t('ソース管理', 'Source control')}>
      <div className="git-sidebar-heading">
        <div>
          <Icon name="branch" size={17} />
          <strong>{t('ソース管理', 'Source control')}</strong>
        </div>
        <button
          aria-label={t('Git 画面を閉じる', 'Close Git view')}
          disabled={busy}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <label>
        <span className="git-sr-only">{t('リポジトリ', 'Repository')}</span>
        <select
          aria-label={t('Git のスペース', 'Git space')}
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
    commitReads = useRef(0),
    statusReads = useRef(0),
    shownReview = useRef(''),
    reviewInFlight = useRef<{ target: string; again: boolean }>(undefined);
  const [reviewRepeat, setReviewRepeat] = useState(0);
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
      commitReads.current++;
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
  }, [space.scopeId, externalRevision, conflictDirty]);
  async function perform(fn: () => Promise<GitStatus | void>, success = '') {
    if (active.current) {
      setNotice(
        t(
          '別の Git 操作を実行中です。完了してから再度実行してください。',
          'Another Git operation is running. Try again once it finishes.',
        ),
      );
      return;
    }
    active.current = true;
    statusReads.current++;
    setBusy(true);
    onBusy(true);
    setError('');
    setNotice('');
    setConfirmation(undefined);
    try {
      if (!(await messageDraft.flush()) || !(await storedResolution.flush())) {
        throw Error(
          t(
            '下書きを保存してから Git 操作を再試行してください。',
            'Save the draft, then try the Git operation again.',
          ),
        );
      }
      if (!(await beforeAction())) return;
      const value = await fn();
      if (value) accept(value);
      if (alive.current) setNotice(value?.notice ? `${success} ${value.notice}` : success);
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
      // Leaving the changes view discards its in-flight read, so the flag that
      // reports one must not survive: it also disables the conflict actions.
      reads.current++;
      shownReview.current = '';
      reviewInFlight.current = undefined;
      setLoadingReview(false);
      return;
    }
    if (!selection) {
      shownReview.current = '';
      reviewInFlight.current = undefined;
      setDiff(undefined);
      setConflict(undefined);
      setLoadingReview(false);
      return;
    }
    const target = `${selection.path}:${selection.staged}`;
    // A file event re-reads the same target. Replace what is on screen only when
    // the target itself changed; otherwise refresh it in place, so a burst of
    // events cannot leave the reader looking at the loading text.
    // A refresh of the file already being read waits for that read instead of
    // restarting it, and queues one repeat so the newest state still arrives.
    if (reviewInFlight.current?.target === target) {
      reviewInFlight.current.again = true;
      return;
    }
    const replacing = shownReview.current !== target;
    shownReview.current = target;
    const entry = status?.changes.find((c) => c.path === selection.path);
    if (!entry) {
      shownReview.current = '';
      reviewInFlight.current = undefined;
      setSelection(undefined);
      return;
    }
    const conflicted = !!entry.conflict && !entry.blocked;
    const generation = ++reads.current;
    reviewInFlight.current = { target, again: false };
    // The read is still in flight either way — callers and assistive technology
    // read that from aria-busy — but only a new target blanks what is shown.
    setLoadingReview(true);
    if (replacing) setDiff(undefined);
    // A resolved file must lose its conflict state even during an in-place
    // refresh: it is what re-enables the ordinary status reads.
    if (!resolutionDraft.current && (replacing || !conflicted)) setConflict(undefined);
    const fetch = conflicted
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
        if (generation !== reads.current || !alive.current) return;
        const repeat = reviewInFlight.current?.again;
        reviewInFlight.current = undefined;
        // The queued repeat re-runs this effect, so the branch between a diff
        // and a conflict is decided from the state that exists by then.
        if (repeat) setReviewRepeat((value) => value + 1);
        else setLoadingReview(false);
      });
  }, [selection, revision, tab, reviewRepeat]);
  async function loadHistory(append = false) {
    const page = await host.gitHistory(space.scopeId, append ? history.length : 0);
    if (alive.current) {
      setHistory((previous) => (append ? [...previous, ...page.commits] : page.commits));
      setMore(page.more);
    }
  }
  async function showCommit(value: GitCommit) {
    const generation = ++commitReads.current;
    setCommit(value);
    setCommitPatch('');
    try {
      const patch = await host.gitCommitDiff(space.scopeId, value.oid);
      if (generation === commitReads.current && alive.current) setCommitPatch(patch);
    } catch (e) {
      if (generation === commitReads.current && alive.current) setError(String(e));
    }
  }
  if (!status)
    return (
      <p className="git-empty" role={error ? 'alert' : 'status'}>
        {error || t('リポジトリを確認しています…', 'Checking the repository…')}
      </p>
    );
  if (!status.available)
    return (
      <div className="git-empty">
        <h2>{t('Git リポジトリを開いてください', 'Open a Git repository')}</h2>
        <p>{status.detail}</p>
        <p>
          {t(
            '「スペースを追加」から既存リポジトリを登録するか、GitHub から取得できます。',
            'Register an existing repository from "Add space", or clone one from GitHub.',
          )}
        </p>
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
  const remoteLabel = `${status.remote?.label ?? t('リモート未設定', 'No remote set')} / ${status.remote?.branch ?? ''}`;
  const confirmLabels = {
    commit: t('この内容を commit', 'Commit these changes'),
    fetch: t('リモートの状態を取得', 'Fetch remote state'),
    pull: t('Pull を実行', 'Run pull'),
    merge: t('履歴の統合を開始', 'Start merging history'),
    push: t('Push を実行', 'Run push'),
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
        t(
          '統合は解決しましたが、下書きの完了を保存できませんでした。保存を再試行してください。',
          'The merge was resolved, but the draft could not be marked complete. Try saving again.',
        ),
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
          <small
            title={t(
              '取得済みのリモート履歴との比較',
              'Compared with the last fetched remote history',
            )}
          >
            {status.ahead === undefined
              ? t('未取得', 'Not fetched')
              : `↑ ${status.ahead} ↓ ${status.behind}`}
          </small>
        </div>
        <div className="git-remote">
          <small>{remoteLabel}</small>
          {status.remote && status.remote.fetchLabel !== status.remote.label && (
            <small>
              {t('受信元', 'Fetches from')}: {status.remote.fetchLabel}
            </small>
          )}
          <small className="git-sr-only">
            {status.ahead === undefined
              ? t('受信先の履歴は未取得です', 'The incoming history has not been fetched yet')
              : t(
                  `送信待ち ${status.ahead} commit ・ 受信待ち ${status.behind} commit（取得済みの履歴）`,
                  `${status.ahead} commit to send, ${status.behind} commit to receive (last fetched history)`,
                )}
          </small>
        </div>
      </div>
      <form
        className="git-commit-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canCommit || !message.trim()) return;
          void perform(
            async () => {
              const acknowledged = messageDraft.snapshot().record?.revision;
              const value = await host.gitCommit(space.scopeId, message, status.version);
              if (!(await messageDraft.clear(acknowledged)))
                throw Error(
                  t(
                    'コミットしましたが、下書きの完了を保存できませんでした。保存を再試行してください。',
                    'Committed, but the draft could not be marked complete. Try saving again.',
                  ),
                );
              return value;
            },
            t('この端末の履歴に commit しました。', 'Committed to this device’s history.'),
          );
        }}
      >
        <label>
          <span className="git-sr-only">{t('commit メッセージ', 'Commit message')}</span>
          <input
            aria-label={t('commit メッセージ', 'Commit message')}
            value={message}
            onChange={(e) => messageDraft.setText(e.target.value)}
            placeholder={t('メッセージを入力してコミット', 'Enter a message and commit')}
            maxLength={10000}
            disabled={busy || !messageDraft.ready}
            required
          />
        </label>
        <button
          aria-label={t('コミット', 'Commit')}
          className="primary"
          disabled={busy || !canCommit || !message.trim()}
        >
          {t('コミット', 'Commit')}
          {staged.length ? ` (${staged.length})` : ''}
        </button>
      </form>
      {(messageDraft.error || storedResolution.error) && (
        <div className="git-notice error" role="alert">
          <p>{messageDraft.error || storedResolution.error}</p>
          <button
            onClick={() => void Promise.all([messageDraft.retry(), storedResolution.retry()])}
          >
            {t('下書きの保存を再試行', 'Retry saving the draft')}
          </button>
        </div>
      )}
      {(messageDraft.pending || storedResolution.pending) && (
        <p className="git-notice" aria-live="polite">
          {t('下書きをこの端末に保存中…', 'Saving the draft on this device…')}
        </p>
      )}
      <div className="git-toolbar" ref={menuHost}>
        {/* One pressed view at a time, with the group's own roving focus. */}
        <MagnetTabs
          className="git-tabs"
          label={t('Git の表示', 'Git view')}
          value={tab}
          onValueChange={(selected) => {
            setTab(selected);
            if (selected === 'history') void perform(() => loadHistory());
          }}
          options={[
            {
              value: 'changes',
              label: (
                <>
                  {t('変更', 'Changes')}{' '}
                  <span className="git-tab-count">{status.changes.length}</span>
                </>
              ),
              disabled: busy || conflictDirty || draftBlocked,
            },
            {
              value: 'history',
              label: t('履歴', 'History'),
              disabled: busy || conflictDirty || draftBlocked,
            },
          ]}
        />
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
            <Icon name="refresh" /> {t('更新', 'Refresh')}
          </button>
          {/* A panel menu, not a modal surface: the rest of the panel stays usable. */}
          <Menu.Root modal={false}>
            <Menu.Trigger
              className="git-more-actions"
              aria-label={t('その他の Git 操作', 'More Git actions')}
            >
              {t('その他', 'More')}
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
                        t(
                          'リモートの状態を取得しました。ノートは変更していません。',
                          'Fetched the remote state. Your notes were not changed.',
                        ),
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
                    {t('履歴を統合', 'Merge history')}
                  </Menu.Item>
                  {status.remote?.repository && (
                    <Menu.Item
                      disabled={busy}
                      onClick={() =>
                        void host.gitOpenRepository(space.scopeId).catch((e) => setError(String(e)))
                      }
                    >
                      {t('GitHub を開く', 'Open on GitHub')}
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
          {busy ? t('Git 操作を実行中…', 'Running Git operation…') : notice}
        </p>
      )}
      {status.operation !== 'none' && (
        <p className="git-notice git-warning" role="status">
          {status.operation === 'merge'
            ? t(
                `履歴の統合中です。未解決 ${conflicts.length} 件。すべての変更を確認し、commit すると統合が完了します。`,
                `Merging history: ${conflicts.length} unresolved. Review all changes and commit to complete the merge.`,
              )
            : t(
                'rebase・cherry-pick 等の操作が進行中です。開始した Git ツールで完了してください。',
                'A rebase, cherry-pick, or similar operation is in progress. Finish it in the Git tool that started it.',
              )}
        </p>
      )}
      <div
        className="git-list"
        aria-label={
          tab === 'changes'
            ? t('変更ファイル', 'Changed files')
            : t('commit 履歴', 'Commit history')
        }
      >
        {tab === 'changes' ? (
          <>
            {[
              { title: t('ステージ済みの変更', 'Staged changes'), entries: staged, staged: true },
              { title: t('変更', 'Changes'), entries: unstaged, staged: false },
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
                          ? t('対象をすべて外しました。', 'Unstaged everything.')
                          : t(
                              '保存済みの変更をまとめて追加しました。',
                              'Staged all saved changes.',
                            ),
                      )
                    }
                  >
                    {group.staged ? t('すべて解除', 'Unstage all') : t('すべて追加', 'Stage all')}
                  </button>
                </h3>
                {!group.entries.length && (
                  <p className="muted">
                    {group.staged
                      ? t('＋ でコミット対象に追加します。', 'Use + to add it to the commit.')
                      : t('変更はありません。', 'There are no changes.')}
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
                          ? t('競合', 'Conflict')
                          : (stateNames()[group.staged ? entry.index : entry.worktree] ??
                            t('変更', 'Modified'))}
                      </span>
                      <span>{entry.path}</span>
                      {entry.blocked && <small>{t('対象外', 'Excluded')}</small>}
                    </button>
                    <button
                      className="git-stage-file"
                      aria-label={
                        group.staged
                          ? t(`${entry.path} をステージから外す`, `Unstage ${entry.path}`)
                          : t(`${entry.path} をステージする`, `Stage ${entry.path}`)
                      }
                      title={
                        group.staged
                          ? t('ステージから外す', 'Unstage')
                          : t('変更全体をステージ', 'Stage the whole change')
                      }
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
                          group.staged
                            ? t('ステージから外しました。', 'Unstaged.')
                            : t('ステージに追加しました。', 'Staged.'),
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
            {!history.length && (
              <p className="git-empty">
                {t('commit はまだありません。', 'There are no commits yet.')}
              </p>
            )}
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
                  {item.author} ・ {new Date(item.date).toLocaleDateString(displayLocale())}
                </small>
                <code>{item.oid.slice(0, 8)}</code>
              </button>
            ))}
            {more && (
              <button disabled={busy} onClick={() => void perform(() => loadHistory(true))}>
                {t('以前の履歴を表示', 'Show earlier history')}
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
            aria-label={t('Git の差分', 'Git diff')}
            aria-busy={loadingReview}
          >
            <div className="git-review-navigation">
              <button
                disabled={busy || conflictDirty || draftBlocked}
                onClick={() => {
                  reads.current++;
                  commitReads.current++;
                  setSelection(undefined);
                  setCommit(undefined);
                }}
              >
                {t('ノートに戻る', 'Back to the note')}
              </button>
            </div>
            {tab === 'history' ? (
              commit ? (
                <>
                  <h3>{commit.subject}</h3>
                  <Patch text={commitPatch || t('差分を読み込み中…', 'Loading the diff…')} />
                </>
              ) : (
                <div className="git-empty">
                  <Icon name="history" size={32} />
                  <h2>{t('ノートが変わった道筋を読む', 'Read how the notes have changed')}</h2>
                  <p>
                    {t(
                      'commit を選ぶと、その時点の変更を確認できます。',
                      'Choose a commit to see the changes at that point.',
                    )}
                  </p>
                </div>
              )
            ) : !selection ? (
              <div className="git-empty">
                <Icon name="branch" size={32} />
                <h2>{t('共有する変更を選ぶ', 'Choose a change to share')}</h2>
                <p>
                  {t(
                    '差分を確認し、まとめて、またはファイルごとに commit 対象へ追加できます。',
                    'Review the diff and add it to the commit, either all at once or file by file.',
                  )}
                  <br />
                  {t(
                    'commit はこの端末の履歴に保存されます。',
                    'A commit is saved to this device’s history.',
                  )}
                </p>
              </div>
            ) : (
              <>
                <div className="git-detail-heading">
                  <h3>{selection.path}</h3>
                  <span>
                    {chosen?.conflict
                      ? t('競合', 'Conflict')
                      : selection.staged
                        ? t('commit に含まれる差分', 'Diff included in the commit')
                        : t('作業ファイルの差分', 'Diff of the working file')}
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
                          aria-label={t('統合の下書きの復元', 'Restore the merge draft')}
                        >
                          <p>
                            {storedResolution.record.baseVersion === conflict.version
                              ? t(
                                  'この端末に未完了の統合の下書きがあります。',
                                  'This device has an unfinished merge draft.',
                                )
                              : t(
                                  '保存後に Git の状態が変わっています。現在の内容と下書きを比較してから編集に戻してください。',
                                  'The Git state changed after this was saved. Compare the current content with the draft before restoring it.',
                                )}
                          </p>
                          <details>
                            <summary>{t('保存済みの下書きを確認', 'View the saved draft')}</summary>
                            <pre>
                              {storedResolution.record.text || t('（空の内容）', '(empty content)')}
                            </pre>
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
                            {t('下書きを編集に戻す', 'Restore the draft to editing')}
                          </button>
                        </div>
                      )}
                    <div className="git-conflict-versions">
                      {[
                        {
                          id: 'base',
                          label: t('共通の元データ', 'Common ancestor'),
                          value: conflict.base,
                        },
                        {
                          id: 'ours',
                          label: t('このブランチ', 'This branch'),
                          value: conflict.ours,
                        },
                        {
                          id: 'theirs',
                          label: t('取り込むブランチ', 'Incoming branch'),
                          value: conflict.theirs,
                        },
                      ].map((v) => (
                        <details key={v.id} open={v.id !== 'base'}>
                          <summary>
                            {v.label}
                            {v.value === undefined ? t('（ファイルなし）', '(no file)') : ''}
                          </summary>
                          <pre>
                            {v.value ??
                              t('この版にはファイルがありません。', 'This version has no file.')}
                          </pre>
                        </details>
                      ))}
                    </div>
                    {conflict.editable ? (
                      <div className="git-resolution">
                        <label>
                          {t('統合する内容', 'Merged content')}
                          <textarea
                            aria-label={t('統合する内容', 'Merged content')}
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
                          {t(
                            '競合マーカーを取り除き、両方の変更を確認してください。解決前の内容はこの端末に保持します。',
                            'Remove the conflict markers and review both changes. The pre-resolution content is kept on this device.',
                          )}
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
                              {t('統合の編集を戻す', 'Revert the merge edit')}
                            </button>
                          )}
                          {(conflict.ours === undefined || conflict.theirs === undefined) && (
                            <button
                              disabled={busy || loadingReview || draftBlocked}
                              onClick={() =>
                                void perform(
                                  () => resolveConflict(null),
                                  t(
                                    '削除として解決しました。commit で統合を完了できます。',
                                    'Resolved as a deletion. Commit to complete the merge.',
                                  ),
                                )
                              }
                            >
                              {t('削除として解決', 'Resolve as deleted')}
                            </button>
                          )}
                          <button
                            className="primary"
                            disabled={busy || loadingReview || draftBlocked}
                            onClick={() =>
                              void perform(
                                () => resolveConflict(resolution),
                                t(
                                  '統合内容を保存し、commit 対象に追加しました。',
                                  'Saved the merged content and added it to the commit.',
                                ),
                              )
                            }
                          >
                            {t('統合内容を保存して解決', 'Save and resolve')}
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
                          ? t(
                              '表示中の差分が次の commit に含まれます。',
                              'The diff shown will be included in the next commit.',
                            )
                          : t(
                              '追加すると、このファイルの保存済みの変更全体が対象になります。',
                              'Adding it includes this file’s entire saved change.',
                            )}
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
                              ? t(
                                  'commit 対象から外しました。ファイルの内容は保持しています。',
                                  'Removed from the commit. The file content is kept.',
                                )
                              : t('commit 対象に追加しました。', 'Added to the commit.'),
                          )
                        }
                      >
                        {selection.staged
                          ? t('commit 対象から外す', 'Remove from commit')
                          : t('commit 対象に追加', 'Add to commit')}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="git-empty">{t('差分を読み込み中…', 'Loading the diff…')}</p>
                )}
              </>
            )}
          </section>,
          detailTarget,
        )}
      {confirmation && (
        <div
          className="git-confirmation"
          role="region"
          aria-label={t('Git 操作の確認', 'Confirm Git action')}
        >
          <div>
            <strong>
              {confirmation === 'commit'
                ? t(
                    `${staged.length} 件の変更を ${space.name} に commit`,
                    `Commit ${staged.length} change${staged.length === 1 ? '' : 's'} to ${space.name}`,
                  )
                : `${space.name} / ${status.branch} ${t('と', 'and')} ${confirmation === 'push' ? remoteLabel : `${status.remote?.fetchLabel} / ${status.remote?.branch}`}`}
            </strong>
            <p>
              {confirmation === 'commit'
                ? message
                : confirmation === 'push'
                  ? t(
                      `commit ${status.head?.slice(0, 8)} までのこのブランチを送信します。未コミットの変更は含みません。作者情報ノート（refs/notes/ai）があれば一緒に送信します。`,
                      `This sends this branch up to commit ${status.head?.slice(0, 8)}. Uncommitted changes are not included. The authorship note (refs/notes/ai) is sent along with it if present.`,
                    )
                  : confirmation === 'merge'
                    ? t(
                        'リモートの最新状態を取得し、Git で統合します。分岐した履歴の統合結果は確認後に commit します。',
                        'Fetches the latest remote state and merges it with Git. Review the merge result before committing it.',
                      )
                    : t(
                        'リモートの最新状態を取得し、履歴が分岐していなければ作業ファイルを更新します。',
                        'Fetches the latest remote state and updates the working files if the history has not diverged.',
                      )}
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
              {t('戻る', 'Back')}
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
                          t(
                            'コミットしましたが、下書きの完了を保存できませんでした。保存を再試行してください。',
                            'Committed, but the draft could not be marked complete. Try saving again.',
                          ),
                        );
                      return value;
                    }
                    return host.gitSync(space.scopeId, confirmation, confirmationVersion.current);
                  },
                  confirmation === 'commit'
                    ? t(
                        'この端末の履歴に commit しました。共有は別の操作です。',
                        'Committed to this device’s history. Sharing it is a separate action.',
                      )
                    : confirmation === 'push'
                      ? t('リモートへの送信が完了しました。', 'The push to the remote is complete.')
                      : t(
                          '受信結果を確認してください。',
                          'Review the result of what was received.',
                        ),
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
