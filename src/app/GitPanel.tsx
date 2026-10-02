import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import type { Space } from '../domain/types';
import { classify } from '../domain/scopes';
import { Crumbs } from './NoteBar';
import type {
  GitCommit,
  GitConflict,
  GitDiff,
  GitStatus,
  GitSubmodule,
  GitSyncAction,
  GitTarget,
} from '../domain/git';
import { Menu } from '@base-ui/react/menu';
import { MagnetTabs } from './obsidian/MagnetTabs';
import { Icon } from './Icon';
import { useDraft } from './useDraft';
import { displayLocale, t } from '../domain/i18n';
import { ErrorMessage, errorText } from './ErrorMessage';
import { PublishDialog } from './GitHubPublish';
import { AddSubmoduleDialog, RepositoryPicker, UnfetchedSubmodule } from './GitSubmodules';
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

type PatchRow = {
  kind: 'hunk' | 'add' | 'del' | 'context' | 'note';
  old?: number;
  new?: number;
  text: string;
};
type PatchFile = { path: string; rows: PatchRow[]; added: number; removed: number };

/** A path as Git writes it in a patch: quoted with octal bytes when not plain ASCII. */
function gitPath(written: string) {
  if (written === '/dev/null') return '';
  let value = written;
  if (value.startsWith('"') && value.endsWith('"')) {
    const bytes: number[] = [];
    const inner = value.slice(1, -1);
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] !== '\\') {
        bytes.push(...new TextEncoder().encode(inner[i]));
        continue;
      }
      const octal = /^[0-7]{3}/.exec(inner.slice(i + 1));
      if (octal) {
        bytes.push(parseInt(octal[0], 8));
        i += 3;
      } else {
        const next = inner[++i];
        bytes.push(
          ({ n: 10, t: 9, '"': 34, '\\': 92 } as Record<string, number>)[next] ??
            next.charCodeAt(0),
        );
      }
    }
    value = new TextDecoder().decode(new Uint8Array(bytes));
  }
  return value.replace(/^[ab]\//, '');
}

/** Splits a patch into its files, numbering each line on the old and the new side. */
function parsePatch(text: string) {
  const header: string[] = [];
  const files: PatchFile[] = [];
  let file: PatchFile | undefined;
  let before = 0;
  let after = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = { path: '', rows: [], added: 0, removed: 0 };
      files.push(file);
      continue;
    }
    // Before any file, `git show` writes the commit it describes.
    if (!file) {
      header.push(line);
      continue;
    }
    // The new side names the file; a deleted file is named by its old side.
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      const named = gitPath(line.slice(4));
      if (named && (line.startsWith('+++ ') || !file.path)) file.path = named;
      continue;
    }
    if (/^(index |new file|deleted file|similarity|rename |old mode|new mode)/.test(line)) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      before = Number(hunk[1]);
      after = Number(hunk[2]);
      file.rows.push({ kind: 'hunk', text: line });
    } else if (line.startsWith('+')) {
      file.rows.push({ kind: 'add', new: after++, text: line.slice(1) });
      file.added++;
    } else if (line.startsWith('-')) {
      file.rows.push({ kind: 'del', old: before++, text: line.slice(1) });
      file.removed++;
    } else if (line.startsWith(' ')) {
      file.rows.push({ kind: 'context', old: before++, new: after++, text: line.slice(1) });
    } else if (line) file.rows.push({ kind: 'note', text: line });
  }
  return { header: header.join('\n').trim(), files };
}

/** A diff as cards: one per file, with line numbers on both sides and washed changes. */
function Patch({ text, path }: { text: string; path?: string }) {
  const { header, files } = parsePatch(text);
  return (
    <div className="git-patch" tabIndex={0} aria-label={t('差分', 'Diff')}>
      {header && <pre className="git-commit-header">{header}</pre>}
      {!files.length && !header && (
        <p className="git-empty">{t('差分はありません。', 'There is no difference.')}</p>
      )}
      {files.map((file, index) => (
        <section className="diff-card" key={index}>
          <header>
            <Icon name="file" size={14} />
            <span className="diff-path">{file.path || path}</span>
            <span className="diff-count added">+{file.added}</span>
            <span className="diff-count removed">−{file.removed}</span>
          </header>
          <div className="diff-rows">
            {file.rows.map((row, i) => (
              <div key={i} className={`diff-row ${row.kind}`}>
                <span className="diff-number">{row.old ?? ''}</span>
                <span className="diff-number">{row.new ?? ''}</span>
                <span className="diff-mark">
                  {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}
                </span>
                <span className="diff-text">{row.text}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The layer's icon for a changed path, so a Schema change reads as one at a glance. */
function layerIcon(space: Space, path: string) {
  return ({ schema: 'schema', Knowledge_Base: 'book', contents: 'cloud' } as const)[
    classify(space, path)
  ];
}

/** The folder part shown dimmed before the name, without the Knowledge layer's own root. */
function shortFolder(space: Space, folder: string) {
  return classify(space, folder + 'x') === 'Knowledge_Base' && folder.startsWith('Knowledge_Base/')
    ? folder.slice('Knowledge_Base/'.length)
    : folder;
}

/**
 * The Changes view of the brain on show: its repository, commits and diffs, and
 * those of each repository it holds as a submodule (ADR 022).
 */
export function GitPanel({
  space,
  onChanged,
  detailTarget,
  onReviewChange,
  onBusyChange,
  revision,
  beforeAction,
}: {
  space: Space;
  onChanged: () => void;
  detailTarget: HTMLElement | null;
  onReviewChange: (reviewing: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  revision: number;
  beforeAction: () => Promise<boolean>;
}) {
  const [submodules, setSubmodules] = useState<GitSubmodule[]>([]),
    [repository, setRepository] = useState(''),
    [adding, setAdding] = useState(false),
    [fetching, setFetching] = useState(false),
    [fetchError, setFetchError] = useState(''),
    [panelBusy, setPanelBusy] = useState(false),
    [own, setOwn] = useState(0);
  useEffect(() => {
    setRepository('');
    setSubmodules([]);
  }, [space.scopeId]);
  useEffect(() => {
    let cancelled = false;
    void host
      .gitSubmodules(space.scopeId)
      .then((value) => {
        if (!cancelled) setSubmodules(value.submodules);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [space.scopeId, revision, own]);
  const shown = submodules.find((m) => m.path === repository);
  // A submodule that went away (another device removed it) shows the hibachi again.
  useEffect(() => {
    if (repository && submodules.length && !shown) setRepository('');
  }, [submodules]);
  function busy(value: boolean) {
    setPanelBusy(value);
    onBusyChange(value);
  }
  async function fetchSubmodule(path: string) {
    if (fetching || !(await beforeAction())) return;
    setFetching(true);
    setFetchError('');
    onBusyChange(true);
    try {
      setSubmodules((await host.gitSubmoduleInit(space.scopeId, path)).submodules);
    } catch (e) {
      setFetchError(errorText(e));
    } finally {
      setFetching(false);
      onBusyChange(false);
      setOwn((n) => n + 1);
      onChanged();
    }
  }
  return (
    <div className="git-sidebar" role="region" aria-label={t('ソース管理', 'Source control')}>
      {submodules.length > 0 && (
        <RepositoryPicker
          name={space.name}
          submodules={submodules}
          value={repository}
          disabled={panelBusy || fetching}
          onChange={(value) => {
            setFetchError('');
            setRepository(value);
          }}
        />
      )}
      {shown && !shown.initialized ? (
        <UnfetchedSubmodule
          submodule={shown}
          busy={fetching}
          error={fetchError}
          onFetch={() => void fetchSubmodule(shown.path)}
        />
      ) : (
        <RepositoryPanel
          key={`${space.scopeId}\0${shown ? shown.path : ''}`}
          space={space}
          repository={shown ? shown.path : ''}
          onBusy={busy}
          onChanged={() => {
            setOwn((n) => n + 1);
            onChanged();
          }}
          onAddSubmodule={() => setAdding(true)}
          detailTarget={detailTarget}
          onReviewChange={onReviewChange}
          externalRevision={revision}
          beforeAction={beforeAction}
        />
      )}
      {adding && (
        <AddSubmoduleDialog
          onCancel={() => setAdding(false)}
          add={async (value) => {
            if (panelBusy || !(await beforeAction()))
              throw Error(t('別の操作を実行中です。', 'Another operation is running.'));
            onBusyChange(true);
            try {
              const next = await host.gitSubmoduleAdd(space.scopeId, value);
              setSubmodules(next.submodules);
              setAdding(false);
            } finally {
              onBusyChange(false);
              setOwn((n) => n + 1);
              onChanged();
            }
          }}
        />
      )}
    </div>
  );
}

function RepositoryPanel({
  space,
  repository,
  onBusy,
  onChanged,
  onAddSubmodule,
  detailTarget,
  onReviewChange,
  externalRevision,
  beforeAction,
}: {
  space: Space;
  /** A submodule's folder, or empty for the hibachi's own repository. */
  repository: string;
  onBusy: (busy: boolean) => void;
  onChanged: () => void;
  onAddSubmodule: () => void;
  detailTarget: HTMLElement | null;
  onReviewChange: (reviewing: boolean) => void;
  externalRevision: number;
  beforeAction: () => Promise<boolean>;
}) {
  const menuHost = useRef<HTMLDivElement>(null);
  const target: GitTarget = repository ? { scopeId: space.scopeId, repository } : space.scopeId;
  // Paths Git reports are the repository's; the hibachi's layers are decided from its root.
  const prefix = repository ? repository + '/' : '';
  const label = repository ? `${space.name} / ${repository}` : space.name;
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
  const [publishing, setPublishing] = useState(false);
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
  const messageDraft = useDraft(
    repository
      ? { scopeId: space.scopeId, kind: 'git-commit', repository }
      : { scopeId: space.scopeId, kind: 'git-commit' },
    space.root,
  );
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
          path: prefix + resolutionPath,
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
  // A refresh of the conflict on screen keeps it resolvable: the host compares
  // versions, so a click is never lost to a brief re-read. Only a conflict that is
  // not the selected file's (still loading, or another file's) cannot be resolved.
  const conflictShown = !!conflict && conflict.path === selection?.path;
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
      .gitStatus(target)
      .then((value) => {
        if (!cancelled && generation === statusReads.current) accept(value);
      })
      .catch((e) => {
        if (!cancelled && generation === statusReads.current && alive.current)
          setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [space.scopeId, externalRevision, conflictDirty]);
  async function perform(fn: () => Promise<GitStatus | void>, success = '') {
    if (active.current) {
      setNotice(t('別の Git 操作を実行中です。', 'Another Git operation is running.'));
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
        throw Error(t('下書きを保存できませんでした。', 'Could not save the draft.'));
      }
      if (!(await beforeAction())) return;
      const value = await fn();
      if (value) accept(value);
      if (alive.current) setNotice(value?.notice ? `${success} ${value.notice}` : success);
    } catch (e) {
      if (alive.current) setError(errorText(e));
      // A failed command may still change Git state (for example a merge conflict).
      try {
        accept(await host.gitStatus(target));
      } catch (e) {
        if (alive.current) setError(errorText(e));
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
      // reports one (aria-busy) must not survive.
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
    const reviewed = `${selection.path}:${selection.staged}`;
    // A file event re-reads the same target. Replace what is on screen only when
    // the target itself changed; otherwise refresh it in place, so a burst of
    // events cannot leave the reader looking at the loading text.
    // A refresh of the file already being read waits for that read instead of
    // restarting it, and queues one repeat so the newest state still arrives.
    if (reviewInFlight.current?.target === reviewed) {
      reviewInFlight.current.again = true;
      return;
    }
    const replacing = shownReview.current !== reviewed;
    shownReview.current = reviewed;
    const entry = status?.changes.find((c) => c.path === selection.path);
    if (!entry) {
      shownReview.current = '';
      reviewInFlight.current = undefined;
      setSelection(undefined);
      return;
    }
    const conflicted = !!entry.conflict && !entry.blocked;
    const generation = ++reads.current;
    reviewInFlight.current = { target: reviewed, again: false };
    // The read is still in flight either way — callers and assistive technology
    // read that from aria-busy — but only a new target blanks what is shown.
    setLoadingReview(true);
    if (replacing) setDiff(undefined);
    // A resolved file must lose its conflict state even during an in-place
    // refresh: it is what re-enables the ordinary status reads.
    if (!resolutionDraft.current && (replacing || !conflicted)) setConflict(undefined);
    const fetch = conflicted
      ? host.gitConflict(target, selection.path).then((value) => {
          if (generation === reads.current && alive.current) {
            setConflict(value);
            setResolution(
              resolutionDraft.current?.path === value.path
                ? resolutionDraft.current.text
                : (value.working ?? ''),
            );
          }
        })
      : host.gitDiff(target, selection.path, selection.staged).then((value) => {
          if (generation === reads.current && alive.current) setDiff(value);
        });
    void fetch
      .catch((e) => {
        if (generation === reads.current && alive.current) setError(errorText(e));
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
    const page = await host.gitHistory(target, append ? history.length : 0);
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
      const patch = await host.gitCommitDiff(target, value.oid);
      if (generation === commitReads.current && alive.current) setCommitPatch(patch);
    } catch (e) {
      if (generation === commitReads.current && alive.current) setError(errorText(e));
    }
  }
  if (!status)
    return (
      <p className="git-empty" role={error ? 'alert' : 'status'}>
        {error || t('リポジトリを確認しています…', 'Checking the repository…')}
      </p>
    );
  if (!status.available)
    return status.initializable ? (
      <div className="git-empty">
        <h2>{t('Git 未設定', 'Not in Git')}</h2>
        {error && <ErrorMessage className="git-notice error" text={error} />}
        <button
          className="solid-button"
          disabled={busy}
          onClick={() =>
            void perform(() => host.gitInit(space.scopeId), t('Git を始めました。', 'Git started.'))
          }
        >
          {t('Git を始める', 'Start Git')}
        </button>
      </div>
    ) : (
      <div className="git-empty">
        <h2>{t('Git リポジトリがありません', 'No Git repository')}</h2>
        <p>{status.detail}</p>
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
    commit: t('コミット', 'Commit'),
    fetch: t('取得', 'Fetch'),
    pull: t('Pull', 'Pull'),
    merge: t('統合', 'Merge'),
    push: t('Push', 'Push'),
  };
  function confirm(action: GitSyncAction) {
    confirmationVersion.current = status!.version;
    setConfirmation(action);
  }
  async function resolveConflict(text: string | null) {
    if (!selection || !conflict) return;
    const acknowledged = storedResolution.snapshot().record?.revision;
    // A re-read of this conflict still in flight would describe the file before this
    // resolution. Drop it; the status refresh that follows reads the file again.
    reads.current++;
    reviewInFlight.current = undefined;
    setLoadingReview(false);
    let value: GitStatus;
    try {
      value = await host.gitResolve(target, selection.path, text, conflict.version);
    } catch (error) {
      // The file may have changed underneath. A conflicted file's status stays
      // the same, so read the conflict itself again now: the next attempt then
      // compares with what is on disk, not with a file event still on its way.
      const fresh = await host.gitConflict(target, selection.path).catch(() => undefined);
      if (fresh && alive.current && fresh.path === selection.path) setConflict(fresh);
      throw error;
    }
    if (!(await storedResolution.clear(acknowledged)))
      throw Error(t('下書きの完了を保存できませんでした。', 'Could not mark the draft complete.'));
    resolutionDraft.current = undefined;
    return value;
  }
  return (
    <>
      <div className="git-repository-bar">
        <div className="git-branch">
          <Icon name="branch" size={14} />
          <strong>{status.branch ?? 'detached HEAD'}</strong>
          <Icon name="arrow" size={12} className="git-arrow" />
          <span className="git-remote">{remoteLabel}</span>
          <span className="git-ahead">
            {status.ahead === undefined
              ? t('未取得', 'Not fetched')
              : `↑${status.ahead} ↓${status.behind}`}
          </span>
        </div>
        {status.remote && status.remote.fetchLabel !== status.remote.label && (
          <small>
            {t('受信元', 'Fetches from')}: {status.remote.fetchLabel}
          </small>
        )}
        {!status.remote &&
          !repository &&
          (status.head && status.branch ? (
            <button
              className="panel-button git-publish"
              disabled={busy || conflictDirty || draftBlocked || status.operation !== 'none'}
              onClick={() => setPublishing(true)}
            >
              <Icon name="up" size={14} />
              {t('GitHub に公開…', 'Publish to GitHub…')}
            </button>
          ) : null)}
        <small className="git-sr-only">
          {status.ahead === undefined
            ? t('未取得', 'Not fetched')
            : t(
                `送信待ち ${status.ahead} commit ・ 受信待ち ${status.behind} commit`,
                `${status.ahead} commit to send, ${status.behind} commit to receive`,
              )}
        </small>
      </div>
      <div className="git-toolbar" ref={menuHost}>
        <button
          className="icon-button framed"
          aria-label={t('更新', 'Refresh')}
          title={t('更新', 'Refresh')}
          disabled={busy || conflictDirty || draftBlocked}
          onClick={() =>
            void perform(async () => {
              if (tab === 'history') await loadHistory();
              return host.gitStatus(target);
            })
          }
        >
          <Icon name="refresh" size={14} />
        </button>
        {/* A panel menu, not a modal surface: the rest of the panel stays usable. */}
        <Menu.Root modal={false}>
          <Menu.Trigger
            className="icon-button framed git-more-actions"
            aria-label={t('その他の Git 操作', 'More Git actions')}
            title={t('その他の Git 操作', 'More Git actions')}
          >
            <Icon name="more" size={15} />
          </Menu.Trigger>
          {/* The menu stays inside the Changes view so it is grouped with what it acts on. */}
          <Menu.Portal container={menuHost}>
            <Menu.Positioner side="bottom" align="start" sideOffset={6}>
              <Menu.Popup className="menu git-menu">
                <Menu.Item
                  disabled={busy || conflictDirty || draftBlocked || !canSync}
                  onClick={() =>
                    void perform(
                      () => host.gitSync(target, 'fetch', status.version),
                      t('取得しました。', 'Fetched.'),
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
                      void host.gitOpenRepository(target).catch((e) => setError(errorText(e)))
                    }
                  >
                    {t('GitHub を開く', 'Open on GitHub')}
                  </Menu.Item>
                )}
                {!repository && (
                  <Menu.Item
                    disabled={busy || conflictDirty || draftBlocked || status.operation !== 'none'}
                    onClick={onAddSubmodule}
                  >
                    {t('submodule を追加…', 'Add a submodule…')}
                  </Menu.Item>
                )}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
        <button
          className="panel-button git-pull"
          disabled={
            busy ||
            conflictDirty ||
            !canSync ||
            !!status.changes.length ||
            status.operation !== 'none'
          }
          onClick={() => confirm('pull')}
        >
          <Icon name="down" size={14} />
          Pull
        </button>
        <button
          className="solid-button git-push"
          disabled={
            busy || conflictDirty || draftBlocked || !canSync || status.operation !== 'none'
          }
          onClick={() => confirm('push')}
        >
          <Icon name="up" size={14} />
          Push
        </button>
      </div>
      <form
        className="git-commit-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canCommit || !message.trim()) return;
          void perform(
            async () => {
              const acknowledged = messageDraft.snapshot().record?.revision;
              const value = await host.gitCommit(target, message, status.version);
              if (!(await messageDraft.clear(acknowledged)))
                throw Error(
                  t('下書きの完了を保存できませんでした。', 'Could not mark the draft complete.'),
                );
              return value;
            },
            t('コミットしました。', 'Committed.'),
          );
        }}
      >
        <input
          aria-label={t('commit メッセージ', 'Commit message')}
          value={message}
          onChange={(e) => messageDraft.setText(e.target.value)}
          placeholder={t('メッセージ', 'Message')}
          maxLength={10000}
          disabled={busy || !messageDraft.ready}
          required
        />
        <button
          aria-label={t('コミット', 'Commit')}
          className="solid-button"
          disabled={busy || !canCommit || !message.trim()}
        >
          <Icon name="check" size={14} />
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
            {t('再試行', 'Retry')}
          </button>
        </div>
      )}
      {(messageDraft.pending || storedResolution.pending) && (
        <p className="git-notice" aria-live="polite">
          {t('下書きを保存中…', 'Saving the draft…')}
        </p>
      )}
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
            label: (
              <>
                <Icon name="history" size={13} />
                {t('履歴', 'History')}
              </>
            ),
            disabled: busy || conflictDirty || draftBlocked,
          },
        ]}
      />
      {error && <ErrorMessage className="git-notice error" text={error} />}
      {(notice || busy) && (
        <p className="git-notice" role="status">
          {busy ? t('Git 操作を実行中…', 'Running Git operation…') : notice}
        </p>
      )}
      {status.operation !== 'none' && (
        <p className="git-notice git-warning" role="status">
          {status.operation === 'merge'
            ? t(
                `履歴の統合中です（未解決 ${conflicts.length} 件）。`,
                `Merging history (${conflicts.length} unresolved).`,
              )
            : t('rebase・cherry-pick 等が進行中です。', 'A rebase or cherry-pick is in progress.')}
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
                            target,
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
                          : t('すべて追加しました。', 'Staged all.'),
                      )
                    }
                  >
                    {group.staged ? t('すべて解除', 'Unstage all') : t('すべて追加', 'Stage all')}
                  </button>
                </h3>
                {!group.entries.length && (
                  <p className="muted">{t('変更はありません。', 'There are no changes.')}</p>
                )}
                {group.entries.map((entry) => {
                  const folder = entry.path.includes('/')
                    ? entry.path.slice(0, entry.path.lastIndexOf('/') + 1)
                    : '';
                  const state = entry.conflict ? 'U' : group.staged ? entry.index : entry.worktree;
                  return (
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
                        <Icon
                          name={layerIcon(space, prefix + entry.path)}
                          size={14}
                          className={`git-layer ${classify(space, prefix + entry.path)}`}
                        />
                        <span className="git-path">
                          <span className="git-folder">
                            {prefix ? folder : shortFolder(space, folder)}
                          </span>
                          {entry.path.slice(folder.length)}
                        </span>
                        <span className={`git-file-state state-${state === '?' ? 'new' : state}`}>
                          {entry.conflict
                            ? t('競合', 'Conflict')
                            : (stateNames()[state] ?? t('変更', 'Modified'))}
                        </span>
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
                          group.staged ? t('ステージから外す', 'Unstage') : t('ステージ', 'Stage')
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
                                target,
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
                        <Icon name={group.staged ? 'minus' : 'plus'} size={13} />
                      </button>
                    </div>
                  );
                })}
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
              <button
                className="git-more-history"
                disabled={busy}
                onClick={() => void perform(() => loadHistory(true))}
              >
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
            <header className="stage-bar">
              <Crumbs
                space={space}
                items={[
                  { icon: 'branch', label: t('変更', 'Changes') },
                  ...(tab === 'history'
                    ? [{ icon: 'history' as const, label: t('履歴', 'History') }]
                    : []),
                ]}
                here={tab === 'history' ? commit?.subject : selection?.path.split('/').at(-1)}
              />
              <div className="stage-actions git-review-navigation">
                {tab === 'changes' && selection && (
                  <span className={`diff-kind ${chosen?.conflict ? 'conflict' : ''}`}>
                    {chosen?.conflict
                      ? t('競合', 'Conflict')
                      : selection.staged
                        ? t('ステージ済み差分', 'Staged diff')
                        : t('作業差分', 'Working diff')}
                  </span>
                )}
                {selection && diff && !chosen?.conflict && (
                  <button
                    className="stage-text-button framed"
                    disabled={
                      busy ||
                      status.operation === 'other' ||
                      (!selection.staged && !!chosen?.blocked)
                    }
                    onClick={() =>
                      void perform(
                        () =>
                          host.gitStage(target, selection.path, !selection.staged, diff.version),
                        selection.staged
                          ? t('ステージから外しました。', 'Unstaged.')
                          : t('ステージに追加しました。', 'Staged.'),
                      )
                    }
                  >
                    <Icon name={selection.staged ? 'minus' : 'plus'} size={14} />
                    {selection.staged ? t('ステージから外す', 'Unstage') : t('ステージ', 'Stage')}
                  </button>
                )}
                <button
                  className="stage-text-button"
                  disabled={busy || conflictDirty || draftBlocked}
                  onClick={() => {
                    reads.current++;
                    commitReads.current++;
                    setSelection(undefined);
                    setCommit(undefined);
                  }}
                >
                  <Icon name="back" size={14} />
                  {t('ノートに戻る', 'Back to the note')}
                </button>
              </div>
            </header>
            <div className="git-detail-body">
              {tab === 'history' ? (
                commit ? (
                  commitPatch ? (
                    <Patch text={commitPatch} />
                  ) : (
                    <p className="git-empty">{t('差分を読み込み中…', 'Loading the diff…')}</p>
                  )
                ) : (
                  <div className="git-empty">
                    <Icon name="history" size={32} />
                    <h2>{t('commit を選ぶ', 'Choose a commit')}</h2>
                  </div>
                )
              ) : !selection ? (
                <div className="git-empty">
                  <Icon name="branch" size={32} />
                  <h2>{t('共有する変更を選ぶ', 'Choose a change to share')}</h2>
                </div>
              ) : conflict ? (
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
                            ? t('未完了の下書きがあります。', 'There is an unfinished draft.')
                            : t('Git の状態が変わりました。', 'The Git state has changed.')}
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
                            disabled={busy || !conflictShown || draftBlocked}
                            onClick={() =>
                              void perform(
                                () => resolveConflict(null),
                                t('削除として解決しました。', 'Resolved as deleted.'),
                              )
                            }
                          >
                            {t('削除として解決', 'Resolve as deleted')}
                          </button>
                        )}
                        <button
                          className="primary"
                          disabled={busy || !conflictShown || draftBlocked}
                          onClick={() =>
                            void perform(
                              () => resolveConflict(resolution),
                              t('保存しました。', 'Saved.'),
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
                <Patch text={diff.patch} path={selection.path} />
              ) : (
                <p className="git-empty">{t('差分を読み込み中…', 'Loading the diff…')}</p>
              )}
            </div>
          </section>,
          detailTarget,
        )}
      {publishing && (
        <PublishDialog
          suggestion={space.root.split(/[/\\]/).at(-1) ?? space.name}
          onCancel={() => setPublishing(false)}
          publish={async (value) => {
            if (active.current || !(await beforeAction()))
              throw Error(t('別の操作を実行中です。', 'Another operation is running.'));
            active.current = true;
            onBusy(true);
            try {
              const next = await host.gitPublish(space.scopeId, value, status.version);
              accept(next);
              setPublishing(false);
              setError('');
              setNotice(
                [
                  t(
                    `${value.owner}/${value.name} を公開しました。`,
                    `Published ${value.owner}/${value.name}.`,
                  ),
                  next.notice,
                ]
                  .filter(Boolean)
                  .join(' '),
              );
            } catch (e) {
              // A repository may exist on GitHub now even though sending failed.
              await host.gitStatus(target).then(accept, () => {});
              throw e;
            } finally {
              active.current = false;
              onBusy(false);
            }
          }}
        />
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
                    `${staged.length} 件の変更を ${label} に commit`,
                    `Commit ${staged.length} change${staged.length === 1 ? '' : 's'} to ${label}`,
                  )
                : `${label} / ${status.branch} ${t('と', 'and')} ${confirmation === 'push' ? remoteLabel : `${status.remote?.fetchLabel} / ${status.remote?.branch}`}`}
            </strong>
            <p>
              {confirmation === 'commit'
                ? message
                : confirmation === 'push'
                  ? t(
                      `commit ${status.head?.slice(0, 8)} までを送信します。`,
                      `Sends up to commit ${status.head?.slice(0, 8)}.`,
                    )
                  : confirmation === 'merge'
                    ? t('リモートを取得して統合します。', 'Fetches remote and merges.')
                    : t(
                        'リモートを取得し、分岐していなければ更新します。',
                        'Fetches remote and updates if history has not diverged.',
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
                      const value = await host.gitCommit(target, message, status.version);
                      if (!(await messageDraft.clear(acknowledged)))
                        throw Error(
                          t(
                            '下書きの完了を保存できませんでした。',
                            'Could not mark the draft complete.',
                          ),
                        );
                      return value;
                    }
                    return host.gitSync(target, confirmation, confirmationVersion.current);
                  },
                  confirmation === 'commit'
                    ? t('コミットしました。', 'Committed.')
                    : confirmation === 'push'
                      ? t('送信しました。', 'Pushed.')
                      : t('受信しました。', 'Fetched.'),
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
