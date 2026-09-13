import { useEffect, useRef, useState } from 'react';
import { Dialog } from './Dialog';
import type { CloudConnection, Document, Space } from '../domain/types';
import type {
  KnowledgeHistory,
  PendingWrite,
  SourceVersion,
  SourceLocation,
  SourceRef,
} from '../domain/knowledge';
const host = window.irori;
const stateNames = {
  pending: '送信待ち・端末に保持',
  uploading: '送信完了を再確認する必要があります',
  confirmed: '送信先の版を確認済み',
  failed: '再確認が必要・端末に保持',
};
const locationNames = {
  matching: '現在のファイルは保持版と一致しています。',
  changed: '現在のファイルは保持版から変更されています。',
  missing: '現在の場所にファイルが見つかりません。',
  unavailable: '現在のファイルにアクセスできません。スペースや接続を確認してください。',
  unbound: 'この資料 ID の現在の場所は登録されていません。',
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
          現在の場所・関連記録
        </button>{' '}
        <button disabled={busy} onClick={() => void perform(() => inspectSource(source, true))}>
          保持版を見る
        </button>{' '}
        <button disabled={busy} onClick={() => void perform(() => host.restoreSource(source))}>
          別ファイルに復元
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
    <Dialog
      label="資料と成果物"
      className="modal-dialog knowledge-dialog"
      busy={busy}
      onClose={onClose}
    >
      <div className="knowledge-heading">
        <h2>資料と成果物</h2>
        <button onClick={onClose} disabled={busy}>
          閉じる
        </button>
      </div>
      <p>{space.name} の実行と、参照した資料の版をこの端末に保持します。</p>
      {(error || notice) && (
        <p ref={feedbackElement} tabIndex={-1} role={error ? 'alert' : 'status'}>
          {error || notice}
        </p>
      )}
      <label>
        記録を検索
        <input
          type="search"
          aria-label="資料・成果物の記録を検索"
          value={query}
          placeholder="記録したパス・資料 ID・実行 ID・CLI"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <p className="muted">このスペースの直近 100 件ずつの実行・成果物登録を検索します。</p>
      <section>
        <h3>実行の記録</h3>
        {!history.runs.length && <p>AI に送信すると、選んだ資料の版と実行の記録が残ります。</p>}
        {!!needle && !visibleRuns.length && <p>一致する実行はありません。</p>}
        {visibleRuns.map((run) => (
          <details key={run.id} id={`run-${run.id}`}>
            <summary>
              {new Date(run.createdAt).toLocaleString('ja-JP')} · {run.agent} ·{' '}
              {run.outcome === 'completed'
                ? '完了'
                : run.outcome === 'cancelled'
                  ? '停止'
                  : run.outcome === 'failed'
                    ? '失敗'
                    : '完了記録なし'}
            </summary>
            <small>実行 ID: {run.id}</small>
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
                  登録した成果物: {item.source.path} · {item.source.hash.slice(0, 12)}
                  <br />
                  <small>手動登録 · 資料 ID {item.source.id}</small>
                </p>
              ))}
          </details>
        ))}
      </section>
      <section aria-label="登録された成果物">
        <h3>登録された成果物</h3>
        {!visibleArtifacts.length && (
          <p>{needle ? '一致する成果物はありません。' : '成果物はまだ登録されていません。'}</p>
        )}
        <ul>
          {visibleArtifacts.map((item) => (
            <li key={item.id}>
              <p>
                {item.source.path} · {item.source.hash.slice(0, 12)}
                <br />
                <small>手動登録 · {new Date(item.registeredAt).toLocaleString('ja-JP')}</small>
              </p>
              {sourceActions(item.source)}
              {history.runs.some((run) => run.id === item.runId) ? (
                <button disabled={busy} onClick={() => revealRun(item.runId)}>
                  関連する実行へ
                </button>
              ) : (
                <p className="muted">関連する実行は直近の表示範囲外です。</p>
              )}
            </li>
          ))}
        </ul>
      </section>
      {preview && (
        <section aria-label="保持した資料の版" ref={previewElement} tabIndex={-1}>
          <h3>{preview.source.path}</h3>
          <p>所属: {sourceNames[preview.source.scopeId] ?? '現在のワークスペース外の資料'}</p>
          <small>
            資料 ID: {preview.source.id} · SHA-256: {preview.source.hash}
          </small>
          {preview.text !== undefined && <pre>{preview.text}</pre>}
          <p>{locationNames[preview.location.state]}</p>
          {preview.location.state !== 'unbound' && (
            <p>現在の登録先: {preview.location.current.path}</p>
          )}
          <button
            disabled={busy}
            onClick={() =>
              void perform(() => inspectSource(preview.source, preview.text !== undefined))
            }
          >
            場所を再確認
          </button>{' '}
          <button
            disabled={busy || !['matching', 'changed'].includes(preview.location.state)}
            onClick={() =>
              void perform(async () => {
                const location = await host.locateSource(preview.source);
                setPreview({ ...preview, location });
                if (location.state !== 'matching' && location.state !== 'changed')
                  throw Error('現在のファイルを開けません。場所や接続を確認してください。');
                await onOpen(location.current);
              })
            }
          >
            現在のファイルを開く
          </button>
          {preview.location.state === 'missing' && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void perform(async () => {
                  await host.rebindSource(preview.source, {
                    scopeId: preview.source.scopeId,
                    path: destination,
                  });
                  await inspectSource(preview.source, preview.text !== undefined);
                }, '資料 ID を移動先に再接続しました。過去の記録と保持版はそのまま残ります。');
              }}
            >
              <label>
                同じスペース内の移動先
                <input
                  aria-label="資料の移動先のパス"
                  value={destination}
                  disabled={busy}
                  placeholder="フォルダ/資料.md"
                  onChange={(event) => setDestination(event.target.value)}
                />
              </label>
              <p className="muted">
                保持版と内容が一致する未登録のファイルに再接続します。ファイル自体は移動しません。
              </p>
              <button disabled={busy || !destination.trim()} type="submit">
                この移動先に再接続
              </button>
            </form>
          )}
          <p>この資料を参照した実行（直近の記録）</p>
          {history.runs
            .filter((run) =>
              run.sources.some(
                (source) =>
                  source.id === preview.source.id && source.scopeId === preview.source.scopeId,
              ),
            )
            .map((run) => (
              <button key={run.id} disabled={busy} onClick={() => revealRun(run.id)}>
                {run.agent} · {new Date(run.createdAt).toLocaleString('ja-JP')}{' '}
                {run.sources.some(
                  (source) =>
                    source.id === preview.source.id &&
                    source.scopeId === preview.source.scopeId &&
                    source.hash === preview.source.hash,
                )
                  ? 'この版'
                  : '別の版'}
              </button>
            ))}
          <p>この資料の成果物登録（直近の記録）</p>
          {history.artifacts
            .filter(
              (item) =>
                item.source.id === preview.source.id &&
                item.source.scopeId === preview.source.scopeId,
            )
            .map((item) => (
              <p key={item.id}>
                手動登録 · {new Date(item.registeredAt).toLocaleString('ja-JP')} ·{' '}
                {item.source.hash === preview.source.hash ? 'この版' : '別の版'}
                {history.runs.some((run) => run.id === item.runId) && (
                  <button disabled={busy} onClick={() => revealRun(item.runId)}>
                    関連する実行へ
                  </button>
                )}
              </p>
            ))}
        </section>
      )}
      <section>
        <h3>成果物を登録</h3>
        <label>
          このスペース内のファイル
          <input
            aria-label="登録する成果物のパス"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
          />
        </label>
        <label>
          関連する実行
          <select
            aria-label="成果物に関連する実行"
            value={runId}
            onChange={(e) => setRunId(e.target.value)}
          >
            <option value="">実行を選択</option>
            {history.runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.agent} · {new Date(run.createdAt).toLocaleString('ja-JP')} ·{' '}
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
              '成果物の版と関連する実行を保持しました。',
            )
          }
        >
          この版を成果物として登録
        </button>
        <p className="muted">
          登録は人による関連付けです。自動生成の証明にはなりません。既存の記録は残ります。
        </p>
      </section>
      {cloudOwner && (
        <section>
          <h3>Drive への送信準備</h3>
          <p>現在の Google 接続は読み取り専用です。送信前のファイルを端末に保持できます。</p>
          <label>
            送信先
            <select
              aria-label="送信準備の Drive フォルダ"
              value={mountId}
              onChange={(e) => setMountId(e.target.value)}
            >
              <option value="">フォルダを選択</option>
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
                '送信前の版を端末に保持しました。Drive にはまだ送信していません。',
              )
            }
          >
            送信準備として保持
          </button>
          <ul>
            {pending.map((item) => (
              <li key={item.id}>
                {item.name} · {stateNames[item.state]}
                {item.detail && <p>{item.detail}</p>}{' '}
                <button
                  disabled={busy}
                  onClick={() => void perform(() => host.restoreSource(item.source))}
                >
                  別ファイルに復元
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Dialog>
  );
}
