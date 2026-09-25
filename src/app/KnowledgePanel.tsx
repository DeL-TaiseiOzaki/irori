import { useEffect, useRef, useState } from 'react';
import { StageView } from './StageView';
import { Crumbs } from './NoteBar';
import type { CloudConnection, Document, Space } from '../domain/types';
import type {
  KnowledgeHistory,
  PendingWrite,
  SourceVersion,
  SourceLocation,
  SourceRef,
} from '../domain/knowledge';
import { displayLocale, t } from '../domain/i18n';
const host = window.irori;
// Names are functions so that they are read in the language of each render.
const stateNames: Record<PendingWrite['state'], () => string> = {
  pending: () => t('送信待ち・端末に保持', 'Pending upload · kept on this device'),
  uploading: () =>
    t('送信完了を再確認する必要があります', 'Upload completion needs to be reconfirmed'),
  confirmed: () => t('送信先の版を確認済み', 'Destination version confirmed'),
  failed: () => t('再確認が必要・端末に保持', 'Needs reconfirmation · kept on this device'),
};
const locationNames: Record<SourceLocation['state'], () => string> = {
  matching: () =>
    t('現在のファイルは保持版と一致しています。', 'The current file matches the kept version.'),
  changed: () =>
    t(
      '現在のファイルは保持版から変更されています。',
      'The current file has changed from the kept version.',
    ),
  missing: () =>
    t('現在の場所にファイルが見つかりません。', 'No file was found at the current location.'),
  unavailable: () =>
    t(
      '現在のファイルにアクセスできません。スペースや接続を確認してください。',
      'The current file cannot be accessed. Check the space or connection.',
    ),
  unbound: () =>
    t(
      'この資料 ID の現在の場所は登録されていません。',
      'No current location is registered for this material ID.',
    ),
};
export function KnowledgePanel({
  space,
  doc,
  cloudOwner,
  sourceNames,
  onOpen,
  onClose,
}: {
  space: Space;
  doc?: Document;
  cloudOwner?: string;
  sourceNames: Record<string, string>;
  onOpen: (source: SourceRef) => Promise<void>;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<KnowledgeHistory>({ runs: [], artifacts: [] });
  const [connections, setConnections] = useState<CloudConnection[]>([]);
  const [pending, setPending] = useState<PendingWrite[]>([]);
  const [mountId, setMountId] = useState('');
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
    if (cloudOwner) {
      setConnections(await host.cloudConnections(cloudOwner));
      setPending(await host.pendingCloudWrites(cloudOwner));
    }
  }
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
  }, [space.scopeId, cloudOwner]);
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
          {t('現在の場所・関連記録', 'Current location & related records')}
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
      setError(String(error));
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
          <p className="muted">
            {t(
              `${space.name} の実行と、参照した資料の版をこの端末に保持します。`,
              `Runs of ${space.name} and the versions of referenced materials are kept on this device.`,
            )}
          </p>
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
          <p className="muted">
            {t(
              'このスペースの直近 100 件ずつの実行・成果物登録を検索します。',
              'Searches the most recent 100 runs and 100 artifact registrations in this space.',
            )}
          </p>
          <section>
            <h3>{t('実行の記録', 'Run records')}</h3>
            {!history.runs.length && (
              <p>
                {t(
                  'AI に送信すると、選んだ資料の版と実行の記録が残ります。',
                  'Sending to AI keeps a record of the run and the versions of the materials you chose.',
                )}
              </p>
            )}
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
                    <p className="muted">
                      {t(
                        '関連する実行は直近の表示範囲外です。',
                        'The related run is outside the recent range shown.',
                      )}
                    </p>
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
                  t('現在のワークスペース外の資料', 'Material outside the current workspace')}
              </p>
              <small>
                {t('資料 ID', 'Material ID')}: {preview.source.id} · SHA-256: {preview.source.hash}
              </small>
              {preview.text !== undefined && <pre>{preview.text}</pre>}
              <p>{locationNames[preview.location.state]()}</p>
              {preview.location.state !== 'unbound' && (
                <p>
                  {t('現在の登録先', 'Current registered location')}:{' '}
                  {preview.location.current.path}
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
                        t(
                          '現在のファイルを開けません。場所や接続を確認してください。',
                          'The current file cannot be opened. Check the location or connection.',
                        ),
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
                      t(
                        '資料 ID を移動先に再接続しました。過去の記録と保持版はそのまま残ります。',
                        'Reconnected the material ID to the new location. Past records and the kept version remain unchanged.',
                      ),
                    );
                  }}
                >
                  <label>
                    {t('同じスペース内の移動先', 'New location within the same space')}
                    <input
                      aria-label={t('資料の移動先のパス', 'Path to the material’s new location')}
                      value={destination}
                      disabled={busy}
                      placeholder={t('フォルダ/資料.md', 'folder/material.md')}
                      onChange={(event) => setDestination(event.target.value)}
                    />
                  </label>
                  <p className="muted">
                    {t(
                      '保持版と内容が一致する未登録のファイルに再接続します。ファイル自体は移動しません。',
                      'Reconnects to an unregistered file whose content matches the kept version. The file itself is not moved.',
                    )}
                  </p>
                  <button disabled={busy || !destination.trim()} type="submit">
                    {t('この移動先に再接続', 'Reconnect to this location')}
                  </button>
                </form>
              )}
              <p>
                {t(
                  'この資料を参照した実行（直近の記録）',
                  'Runs that referenced this material (recent records)',
                )}
              </p>
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
              <p>
                {t(
                  'この資料の成果物登録（直近の記録）',
                  'Artifact registrations for this material (recent records)',
                )}
              </p>
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
              {t('このスペース内のファイル', 'A file within this space')}
              <input
                aria-label={t('登録する成果物のパス', 'Path of the artifact to register')}
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
              />
            </label>
            <label>
              {t('関連する実行', 'Related run')}
              <select
                aria-label={t('成果物に関連する実行', 'Run related to the artifact')}
                value={runId}
                onChange={(e) => setRunId(e.target.value)}
              >
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
                  t(
                    '成果物の版と関連する実行を保持しました。',
                    'Kept the artifact version and its related run.',
                  ),
                )
              }
            >
              {t('この版を成果物として登録', 'Register this version as an artifact')}
            </button>
            <p className="muted">
              {t(
                '登録は人による関連付けです。自動生成の証明にはなりません。既存の記録は残ります。',
                'Registration is a person’s association, not proof of automatic generation. Existing records remain.',
              )}
            </p>
          </section>
          {cloudOwner && (
            <section>
              <h3>{t('Drive への送信準備', 'Pending upload to Drive')}</h3>
              <p>
                {t(
                  '編集可で接続した Drive フォルダには、ファイルを開いて直接保存できます。ここでは、送信前のファイルをこの端末に保持できます。',
                  'A Drive folder connected as editable takes saves directly when you open a file there. Here, a file can be kept on this device before it is sent.',
                )}
              </p>
              <label>
                {t('送信先', 'Destination')}
                <select
                  aria-label={t('送信準備の Drive フォルダ', 'Drive folder for pending upload')}
                  value={mountId}
                  onChange={(e) => setMountId(e.target.value)}
                >
                  <option value="">{t('フォルダを選択', 'Select a folder')}</option>
                  {connections.map((item) => (
                    <option key={item.mountId} value={item.mountId}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={busy || !mountId || !filename.trim()}
                onClick={() =>
                  void perform(
                    () =>
                      host.prepareCloudWrite(cloudOwner, mountId, {
                        scopeId: space.scopeId,
                        path: filename,
                      }),
                    t(
                      '送信前の版を端末に保持しました。Drive にはまだ送信していません。',
                      'Kept the pre-upload version on this device. It has not been sent to Drive yet.',
                    ),
                  )
                }
              >
                {t('送信準備として保持', 'Keep as pending upload')}
              </button>
              <ul>
                {pending.map((item) => (
                  <li key={item.id}>
                    {item.name} · {stateNames[item.state]()}
                    {item.detail && <p>{item.detail}</p>}{' '}
                    <button
                      disabled={busy}
                      onClick={() => void perform(() => host.restoreSource(item.source))}
                    >
                      {t('別ファイルに復元', 'Restore to another file')}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </StageView>
  );
}
