import { Dialog } from './Dialog';
import { useEffect, useRef, useState } from 'react';
import type { Space } from '../domain/types';
import type { GitCommit, GitConflict, GitDiff, GitStatus, GitSyncAction } from '../domain/git';
import { Icon } from './Icon';
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
}: {
  spaces: Space[];
  initialScope: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [scopeId, setScopeId] = useState(initialScope),
    [busy, setBusy] = useState(false);
  return (
    <Dialog className="git-dialog" label="Git の変更と履歴" busy={busy} onClose={onClose}>
      <div className="git-dialog-heading">
        <div>
          <Icon name="branch" size={21} />
          <strong>変更と履歴</strong>
        </div>
        <label>
          スペース
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
        <button aria-label="Git 画面を閉じる" disabled={busy} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <RepositoryPanel
        key={scopeId}
        space={spaces.find((s) => s.scopeId === scopeId)!}
        onBusy={setBusy}
        onChanged={onChanged}
      />
    </Dialog>
  );
}

function RepositoryPanel({
  space,
  onBusy,
  onChanged,
}: {
  space: Space;
  onBusy: (busy: boolean) => void;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<GitStatus>(),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false),
    [tab, setTab] = useState<'changes' | 'history'>('changes');
  const [selection, setSelection] = useState<{ path: string; staged: boolean }>();
  const [diff, setDiff] = useState<GitDiff>(),
    [conflict, setConflict] = useState<GitConflict>(),
    [resolution, setResolution] = useState('');
  const [message, setMessage] = useState(''),
    [confirmation, setConfirmation] = useState<'commit' | GitSyncAction>();
  const [history, setHistory] = useState<GitCommit[]>([]),
    [more, setMore] = useState(false),
    [commit, setCommit] = useState<GitCommit>(),
    [commitPatch, setCommitPatch] = useState('');
  const [revision, setRevision] = useState(0);
  const [loadingReview, setLoadingReview] = useState(false);
  const alive = useRef(true),
    active = useRef(false),
    reads = useRef(0);
  const resolutionDraft = useRef<{ path: string; text: string } | undefined>(undefined);
  const conflictDirty = !!conflict && resolution !== (conflict.working ?? '');
  useEffect(() => {
    onBusy(busy || conflictDirty);
  }, [busy, conflictDirty]);
  function accept(value: GitStatus) {
    if (alive.current) {
      setStatus(value);
      setRevision((n) => n + 1);
    }
  }
  useEffect(() => {
    alive.current = true;
    void host
      .gitStatus(space.scopeId)
      .then(accept)
      .catch((e) => {
        if (alive.current) setError(String(e));
      });
    return () => {
      alive.current = false;
      reads.current++;
    };
  }, [space.scopeId]);
  async function perform(fn: () => Promise<GitStatus | void>, success = '') {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    setNotice('');
    setConfirmation(undefined);
    try {
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
    pull: '変更を受信',
    merge: '履歴の統合を開始',
    push: 'このブランチを共有',
  };
  return (
    <>
      <div className="git-repository-bar">
        <div>
          <strong>{space.name}</strong>
          <span>
            <Icon name="branch" /> {status.branch ?? 'detached HEAD'}
          </span>
          <small>{status.head ? status.head.slice(0, 8) : '最初の commit を作成できます'}</small>
        </div>
        <div className="git-remote">
          <strong>{remoteLabel}</strong>
          {status.remote && status.remote.fetchLabel !== status.remote.label && (
            <small>受信元: {status.remote.fetchLabel}</small>
          )}
          <small>
            {status.ahead === undefined
              ? '受信先の履歴は未取得です'
              : `送信待ち ${status.ahead} commit ・ 受信待ち ${status.behind} commit（取得済みの履歴）`}
          </small>
        </div>
        {status.remote?.repository && (
          <button
            disabled={busy}
            onClick={() =>
              void host.gitOpenRepository(space.scopeId).catch((e) => setError(String(e)))
            }
          >
            GitHub を開く
          </button>
        )}
      </div>
      <div className="git-toolbar">
        <div className="git-tabs" role="group" aria-label="Git の表示">
          <button
            aria-pressed={tab === 'changes'}
            disabled={busy || conflictDirty}
            onClick={() => setTab('changes')}
          >
            変更 <span>{status.changes.length}</span>
          </button>
          <button
            aria-pressed={tab === 'history'}
            disabled={busy || conflictDirty}
            onClick={() => {
              setTab('history');
              void perform(() => loadHistory());
            }}
          >
            履歴
          </button>
        </div>
        <div className="actions">
          <button
            disabled={busy || conflictDirty}
            onClick={() =>
              void perform(async () => {
                if (tab === 'history') await loadHistory();
                return host.gitStatus(space.scopeId);
              })
            }
          >
            <Icon name="refresh" /> 更新
          </button>
          <button
            disabled={busy || conflictDirty || !canSync}
            onClick={() =>
              void perform(
                () => host.gitSync(space.scopeId, 'fetch', status.version),
                'リモートの状態を取得しました。ノートは変更していません。',
              )
            }
          >
            取得
          </button>
          <button
            disabled={busy || !canSync || !!status.changes.length || status.operation !== 'none'}
            onClick={() => setConfirmation('pull')}
          >
            受信
          </button>
          <button
            disabled={busy || !canSync || !!status.changes.length || status.operation !== 'none'}
            onClick={() => setConfirmation('merge')}
          >
            履歴を統合
          </button>
          <button
            className="primary"
            disabled={busy || !canSync || status.operation !== 'none'}
            onClick={() => setConfirmation('push')}
          >
            共有内容を確認
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
      <div className="git-review">
        <div className="git-list" aria-label={tab === 'changes' ? '変更ファイル' : 'commit 履歴'}>
          {tab === 'changes' ? (
            <>
              {[
                { title: '作業中の変更', entries: unstaged, staged: false },
                { title: 'commit 対象', entries: staged, staged: true },
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
                      {group.staged ? '差分を開いて対象を追加します。' : '変更はありません。'}
                    </p>
                  )}
                  {group.entries.map((entry) => (
                    <button
                      key={entry.path}
                      className="git-file"
                      aria-pressed={
                        selection?.path === entry.path && selection.staged === group.staged
                      }
                      disabled={busy || conflictDirty}
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
        <div className="git-detail" aria-busy={loadingReview}>
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
                          disabled={busy}
                          onChange={(e) => {
                            resolutionDraft.current = { path: conflict.path, text: e.target.value };
                            setResolution(e.target.value);
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
                              resolutionDraft.current = undefined;
                              setResolution(conflict.working ?? '');
                            }}
                          >
                            統合の編集を戻す
                          </button>
                        )}
                        {(conflict.ours === undefined || conflict.theirs === undefined) && (
                          <button
                            disabled={busy || loadingReview}
                            onClick={() =>
                              void perform(
                                () =>
                                  host
                                    .gitResolve(
                                      space.scopeId,
                                      selection.path,
                                      null,
                                      conflict.version,
                                    )
                                    .then((value) => {
                                      resolutionDraft.current = undefined;
                                      return value;
                                    }),
                                '削除として解決しました。commit で統合を完了できます。',
                              )
                            }
                          >
                            削除として解決
                          </button>
                        )}
                        <button
                          className="primary"
                          disabled={busy || loadingReview}
                          onClick={() =>
                            void perform(
                              () =>
                                host
                                  .gitResolve(
                                    space.scopeId,
                                    selection.path,
                                    resolution,
                                    conflict.version,
                                  )
                                  .then((value) => {
                                    resolutionDraft.current = undefined;
                                    return value;
                                  }),
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
        </div>
      </div>
      {confirmation ? (
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
                      const value = await host.gitCommit(space.scopeId, message, status.version);
                      setMessage('');
                      return value;
                    }
                    return host.gitSync(space.scopeId, confirmation, status.version);
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
      ) : (
        <form
          className="git-commit-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canCommit || !message.trim()) return;
            void perform(async () => {
              const value = await host.gitCommit(space.scopeId, message, status.version);
              setMessage('');
              return value;
            }, 'この端末の履歴に commit しました。');
          }}
        >
          <label>
            commit メッセージ
            <input
              aria-label="commit メッセージ"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="何を変更しましたか？"
              maxLength={10000}
              disabled={busy}
              required
            />
          </label>
          <span>{staged.length} 件を対象に選択</span>
          <button className="primary" disabled={busy || !canCommit || !message.trim()}>
            コミット
          </button>
        </form>
      )}
    </>
  );
}
