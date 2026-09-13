import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import type { CloudConnection, Document, Space } from '../domain/types';
import type { KnowledgeHistory, PendingWrite, SourceVersion } from '../domain/knowledge';
const host = window.irori;
const stateNames = {
  pending: '送信待ち・端末に保持',
  uploading: '送信完了を再確認する必要があります',
  confirmed: '送信先の版を確認済み',
  failed: '再確認が必要・端末に保持',
};
export function KnowledgePanel({
  space,
  doc,
  cloudOwner,
  onClose,
}: {
  space: Space;
  doc?: Document;
  cloudOwner?: string;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<KnowledgeHistory>({ runs: [], artifacts: [] });
  const [connections, setConnections] = useState<CloudConnection[]>([]);
  const [pending, setPending] = useState<PendingWrite[]>([]);
  const [mountId, setMountId] = useState('');
  const [runId, setRunId] = useState('');
  const [filename, setFilename] = useState(doc?.scopeId === space.scopeId ? doc.path : '');
  const [preview, setPreview] = useState<{ source: SourceVersion; text: string }>();
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
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <section>
        <h3>実行の記録</h3>
        {!history.runs.length && <p>AI に送信すると、選んだ資料の版と実行の記録が残ります。</p>}
        {history.runs.map((run) => (
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
                <li key={source.id}>
                  <span>
                    {source.path} · {source.hash.slice(0, 12)}
                  </span>{' '}
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(async () =>
                        setPreview({ source, text: await host.sourceText(source) }),
                      )
                    }
                  >
                    保持版を見る
                  </button>{' '}
                  <button
                    disabled={busy}
                    onClick={() => void perform(() => host.restoreSource(source))}
                  >
                    別ファイルに復元
                  </button>
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
      {preview && (
        <section aria-label="保持した資料の版">
          <h3>{preview.source.path}</h3>
          <small>
            資料 ID: {preview.source.id} · SHA-256: {preview.source.hash}
          </small>
          <pre>{preview.text}</pre>
          <p>この資料を参照した実行</p>
          {history.runs
            .filter((run) => run.sources.some((source) => source.id === preview.source.id))
            .map((run) => (
              <a key={run.id} href={`#run-${run.id}`}>
                {run.agent} · {new Date(run.createdAt).toLocaleString('ja-JP')}{' '}
              </a>
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
