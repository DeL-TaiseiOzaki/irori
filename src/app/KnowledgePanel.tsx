import { useEffect, useRef, useState } from 'react';
import { StageView } from './StageView';
import { Crumbs } from './NoteBar';
import type { Document, Space } from '../domain/types';
import type {
  KnowledgeHistory,
  SourceVersion,
  SourceLocation,
  SourceRef,
} from '../domain/knowledge';
import { displayLocale, t } from '../domain/i18n';
import { errorText } from './ErrorMessage';
const host = window.irori;
// Names are functions so that they are read in the language of each render.
const locationNames: Record<SourceLocation['state'], () => string> = {
  matching: () => t('保持版と一致', 'Matches the kept version'),
  changed: () => t('保持版から変更あり', 'Changed from the kept version'),
  missing: () => t('現在の場所に見つかりません', 'Not found at the current location'),
  unavailable: () => t('現在のファイルにアクセス不可', 'Current file inaccessible'),
  unbound: () => t('現在の場所は未登録', 'No current location registered'),
};
export function KnowledgePanel({
  space,
  doc,
  sourceNames,
  onOpen,
  onClose,
}: {
  space: Space;
  doc?: Document;
  sourceNames: Record<string, string>;
  onOpen: (source: SourceRef) => Promise<void>;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<KnowledgeHistory>({ runs: [], artifacts: [] });
  const [runId, setRunId] = useState('');
  const [filename, setFilename] = useState(doc?.scopeId === space.scopeId ? doc.path : '');
  const [preview, setPreview] = useState<{
    source: SourceVersion;
    location: SourceLocation;
    text?: string;
  }>();
  const [query, setQuery] = useState('');
  const [destination, setDestination] = useState('');
  const [runTarget, setRunTarget] = useState<{ id: string }>();
  const previewElement = useRef<HTMLElement>(null);
  const feedbackElement = useRef<HTMLParagraphElement>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setHistory(await host.knowledgeHistory(space.scopeId));
  }
  useEffect(() => {
    void refresh().catch((e) => setError(errorText(e)));
  }, [space.scopeId]);
  useEffect(() => {
    if (!runTarget) return;
    const element = document.getElementById(`run-${runTarget.id}`) as HTMLDetailsElement | null;
    if (!element) return;
    element.open = true;
    element.scrollIntoView({ block: 'nearest' });
    element.querySelector('summary')?.focus();
  }, [runTarget]);
  useEffect(() => {
    if (!preview) return;
    previewElement.current?.scrollIntoView({ block: 'nearest' });
    previewElement.current?.focus();
  }, [preview?.source]);
  useEffect(() => {
    if (!error && !notice) return;
    feedbackElement.current?.scrollIntoView({ block: 'nearest' });
    feedbackElement.current?.focus();
  }, [error, notice]);
  function revealRun(id: string) {
    setQuery('');
    setRunTarget({ id });
  }
  const needle = query.trim().normalize('NFKC').toLocaleLowerCase('ja-JP');
  const matches = (...values: string[]) =>
    values.some((value) => value.normalize('NFKC').toLocaleLowerCase('ja-JP').includes(needle));
  const matchesSource = (source: SourceVersion) =>
    matches(source.path, source.id, source.hash, source.scopeId, sourceNames[source.scopeId] ?? '');
  const visibleArtifacts = history.artifacts.filter(
    (item) => matches(item.id, item.runId) || matchesSource(item.source),
  );
  const visibleRuns = history.runs.filter(
    (run) =>
      matches(run.id, run.agent) ||
      run.sources.some(matchesSource) ||
      visibleArtifacts.some((item) => item.runId === run.id),
  );
  async function inspectSource(source: SourceVersion, text = false) {
    const location = await host.locateSource(source);
    setPreview({ source, location, text: text ? await host.sourceText(source) : undefined });
    setDestination('');
  }
  function sourceActions(source: SourceVersion) {
    return (
      <>
        <button disabled={busy} onClick={() => void perform(() => inspectSource(source))}>
          {t('場所・記録', 'Location & records')}
        </button>{' '}
        <button disabled={busy} onClick={() => void perform(() => inspectSource(source, true))}>
          {t('保持版を見る', 'View kept version')}
        </button>{' '}
        <button disabled={busy} onClick={() => void perform(() => host.restoreSource(source))}>
          {t('別ファイルに復元', 'Restore to another file')}
        </button>
      </>
    );
  }
  async function perform(fn: () => Promise<unknown>, message = '') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      await refresh();
      setNotice(message);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <StageView
      label={t('資料と成果物', 'Materials and outputs')}
      className="records-view"
      busy={busy}
      onClose={onClose}
      crumbs={<Crumbs space={space} items={[]} here={t('資料と成果物', 'Materials and outputs')} />}
      actions={
        <label className="records-search">
          <span className="sr-only">{t('記録を検索', 'Search records')}</span>
          <input
            type="search"
            aria-label={t('資料・成果物の記録を検索', 'Search material & artifact records')}
            value={query}
            placeholder={t('パス・資料 ID・実行 ID・CLI', 'Path, material ID, run ID, CLI')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      }
    >
      <div className="records-layout">
        <div className="records-main">
          {(error || notice) && (
            <p
              ref={feedbackElement}
              tabIndex={-1}
              role={error ? 'alert' : 'status'}
              className="records-feedback"
            >
              {error || notice}
            </p>
          )}
          <section>
            <h3>{t('実行の記録', 'Run records')}</h3>
            {!!needle && !visibleRuns.length && (
              <p>{t('一致する実行はありません。', 'No matching runs.')}</p>
            )}
            {visibleRuns.map((run) => (
              <details key={run.id} id={`run-${run.id}`}>
                <summary>
                  {new Date(run.createdAt).toLocaleString(displayLocale())} · {run.agent} ·{' '}
                  {run.outcome === 'completed'
                    ? t('完了', 'Completed')
                    : run.outcome === 'cancelled'
                      ? t('停止', 'Stopped')
                      : run.outcome === 'failed'
                        ? t('失敗', 'Failed')
                        : t('完了記録なし', 'No completion recorded')}
                </summary>
                <small>
                  {t('実行 ID', 'Run ID')}: {run.id}
                </small>
                <ul>
                  {run.sources.map((source) => (
                    <li key={`${source.scopeId}:${source.id}`}>
                      <span>
                        {source.path} · {source.hash.slice(0, 12)}
                      </span>{' '}
                      {sourceActions(source)}
                    </li>
                  ))}
                </ul>
                {history.artifacts
                  .filter((item) => item.runId === run.id)
                  .map((item) => (
                    <p key={item.id}>
                      {t('登録した成果物', 'Registered artifact')}: {item.source.path} ·{' '}
                      {item.source.hash.slice(0, 12)}
                      <br />
                      <small>
                        {t('手動登録', 'Manual registration')} · {t('資料 ID', 'Material ID')}{' '}
                        {item.source.id}
                      </small>
                    </p>
                  ))}
              </details>
            ))}
          </section>
          <section aria-label={t('登録された成果物', 'Registered artifacts')}>
            <h3>{t('登録された成果物', 'Registered artifacts')}</h3>
            {!visibleArtifacts.length && (
              <p>
                {needle
                  ? t('一致する成果物はありません。', 'No matching artifacts.')
                  : t('成果物はまだ登録されていません。', 'No artifacts are registered yet.')}
              </p>
            )}
            <ul>
              {visibleArtifacts.map((item) => (
                <li key={item.id}>
                  <p>
                    {item.source.path} · {item.source.hash.slice(0, 12)}
                    <br />
                    <small>
                      {t('手動登録', 'Manual registration')} ·{' '}
                      {new Date(item.registeredAt).toLocaleString(displayLocale())}
                    </small>
                  </p>
                  {sourceActions(item.source)}
                  {history.runs.some((run) => run.id === item.runId) ? (
                    <button disabled={busy} onClick={() => revealRun(item.runId)}>
                      {t('関連する実行へ', 'Go to related run')}
                    </button>
                  ) : (
                    <p className="muted">{t('表示範囲外', 'Outside the recent range')}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
          {preview && (
            <section
              aria-label={t('保持した資料の版', 'Kept material version')}
              ref={previewElement}
              tabIndex={-1}
            >
              <h3>{preview.source.path}</h3>
              <p>
                {t('所属', 'Belongs to')}:{' '}
                {sourceNames[preview.source.scopeId] ??
                  t('現在のワークスペース外', 'Outside the current workspace')}
              </p>
              <small>
                {t('資料 ID', 'Material ID')}: {preview.source.id} · SHA-256: {preview.source.hash}
              </small>
              {preview.text !== undefined && <pre>{preview.text}</pre>}
              <p>{locationNames[preview.location.state]()}</p>
              {preview.location.state !== 'unbound' && (
                <p>
                  {t('登録先', 'Registered location')}: {preview.location.current.path}
                </p>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  void perform(() => inspectSource(preview.source, preview.text !== undefined))
                }
              >
                {t('場所を再確認', 'Recheck location')}
              </button>{' '}
              <button
                disabled={busy || !['matching', 'changed'].includes(preview.location.state)}
                onClick={() =>
                  void perform(async () => {
                    const location = await host.locateSource(preview.source);
                    setPreview({ ...preview, location });
                    if (location.state !== 'matching' && location.state !== 'changed')
                      throw Error(
                        t('現在のファイルを開けません。', 'The current file cannot be opened.'),
                      );
                    await onOpen(location.current);
                  })
                }
              >
                {t('現在のファイルを開く', 'Open current file')}
              </button>
              {preview.location.state === 'missing' && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void perform(
                      async () => {
                        await host.rebindSource(preview.source, {
                          scopeId: preview.source.scopeId,
                          path: destination,
                        });
                        await inspectSource(preview.source, preview.text !== undefined);
                      },
                      t('再接続しました。', 'Reconnected.'),
                    );
                  }}
                >
                  <label>
                    {t('同じスペース内の移動先', 'New location within the same space')}
                    <input
                      value={destination}
                      disabled={busy}
                      placeholder={t('フォルダ/資料.md', 'folder/material.md')}
                      onChange={(event) => setDestination(event.target.value)}
                    />
                  </label>
                  <button disabled={busy || !destination.trim()} type="submit">
                    {t('この移動先に再接続', 'Reconnect to this location')}
                  </button>
                </form>
              )}
              <p>{t('参照した実行', 'Referencing runs')}</p>
              {history.runs
                .filter((run) =>
                  run.sources.some(
                    (source) =>
                      source.id === preview.source.id && source.scopeId === preview.source.scopeId,
                  ),
                )
                .map((run) => (
                  <button key={run.id} disabled={busy} onClick={() => revealRun(run.id)}>
                    {run.agent} · {new Date(run.createdAt).toLocaleString(displayLocale())}{' '}
                    {run.sources.some(
                      (source) =>
                        source.id === preview.source.id &&
                        source.scopeId === preview.source.scopeId &&
                        source.hash === preview.source.hash,
                    )
                      ? t('この版', 'This version')
                      : t('別の版', 'A different version')}
                  </button>
                ))}
              <p>{t('成果物登録', 'Artifact registrations')}</p>
              {history.artifacts
                .filter(
                  (item) =>
                    item.source.id === preview.source.id &&
                    item.source.scopeId === preview.source.scopeId,
                )
                .map((item) => (
                  <p key={item.id}>
                    {t('手動登録', 'Manual registration')} ·{' '}
                    {new Date(item.registeredAt).toLocaleString(displayLocale())} ·{' '}
                    {item.source.hash === preview.source.hash
                      ? t('この版', 'This version')
                      : t('別の版', 'A different version')}
                    {history.runs.some((run) => run.id === item.runId) && (
                      <button disabled={busy} onClick={() => revealRun(item.runId)}>
                        {t('関連する実行へ', 'Go to related run')}
                      </button>
                    )}
                  </p>
                ))}
            </section>
          )}
        </div>
        <aside className="records-side">
          <section>
            <h3>{t('成果物を登録', 'Register an artifact')}</h3>
            <label>
              {t('ファイル', 'File')}
              <input value={filename} onChange={(e) => setFilename(e.target.value)} />
            </label>
            <label>
              {t('関連する実行', 'Related run')}
              <select value={runId} onChange={(e) => setRunId(e.target.value)}>
                <option value="">{t('実行を選択', 'Select a run')}</option>
                {history.runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.agent} · {new Date(run.createdAt).toLocaleString(displayLocale())} ·{' '}
                    {run.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={busy || !runId || !filename.trim()}
              onClick={() =>
                void perform(
                  () => host.registerArtifact({ scopeId: space.scopeId, path: filename }, runId),
                  t('登録しました。', 'Registered.'),
                )
              }
            >
              {t('この版を登録', 'Register this version')}
            </button>
          </section>
        </aside>
      </div>
    </StageView>
  );
}
