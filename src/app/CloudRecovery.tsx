import { useState } from 'react';
import { Dialog } from './Dialog';
import type { CloudWriteRecovery, SourceVersion } from '../domain/knowledge';

/** Available even on startup, with no currently registered workspace or account. */
export function CloudRecovery() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<CloudWriteRecovery>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    setOpen(true);
    setResult(undefined);
    setError('');
    setBusy(true);
    try {
      setResult(await window.irori.recoverableCloudWrites());
    } catch {
      setError('送信準備を読み込めませんでした。端末のデータへのアクセスを確認してください。');
    } finally {
      setBusy(false);
    }
  }
  async function restore(source: SourceVersion) {
    setBusy(true);
    setError('');
    try {
      await window.irori.restoreSource(source);
    } catch {
      setError(
        '復元できませんでした。保持版と保存先を確認してください。既存ファイルは上書きできません。',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="cloud-recovery-trigger" onClick={() => void load()}>
        端末の送信準備を復元
      </button>
      {open && (
        <Dialog label="端末の送信準備" busy={busy} onClose={() => setOpen(false)}>
          <header className="actions">
            <h2>端末の送信準備</h2>
            <button disabled={busy} onClick={() => setOpen(false)}>
              閉じる
            </button>
          </header>
          <p>
            接続やワークスペースの登録を削除した後も、送信準備として保持した版を別ファイルに復元できます。
          </p>
          <p>復元後、送信先を確認して準備し直してください。この操作では Drive へ送信しません。</p>
          {error && <p role="alert">{error}</p>}
          {!result && busy && <p role="status">読み込み中…</p>}
          {result && result.unreadable > 0 && (
            <p role="alert">
              読み込めない記録があります（{result.unreadable} 件）。読み込めた記録は復元できます。
            </p>
          )}
          {result && !result.entries.length && <p>復元できる送信準備はありません。</p>}
          <ul>
            {result?.entries.map((item) => (
              <li key={`${item.ownerId}/${item.id}`}>
                <strong>{item.name}</strong>
                <p>
                  {item.source.path} · {new Date(item.createdAt).toLocaleString()}
                </p>
                <button disabled={busy} onClick={() => void restore(item.source)}>
                  別ファイルに復元
                </button>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
    </>
  );
}
