import { useRef, useState, useEffect } from 'react';
import type { UpdateCheck, UpdateTarget } from '../domain/updates';
import './update-notice.css';

export function UpdateNotice({
  check,
  open,
}: {
  check: () => Promise<UpdateCheck>;
  open: (target: UpdateTarget) => Promise<void>;
}) {
  const [result, setResult] = useState<UpdateCheck>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch {
      if (alive.current) setError('更新情報を開けませんでした。もう一度お試しください。');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="update-notice" aria-label="アプリの更新">
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const value = await check();
            if (alive.current) setResult(value);
          })
        }
      >
        {busy ? '確認中…' : '更新を確認'}
      </button>
      {(result || error) && (
        <div
          className="update-notice-result"
          role={error || result?.status === 'error' ? 'alert' : 'status'}
        >
          <p>{error || result?.detail}</p>
          {result?.status === 'available' && (
            <>
              <p className="update-notice-version">
                使用中 {result.currentVersion} → 公開版 {result.release?.version}
              </p>
              <div className="update-notice-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => open('download'))}
                >
                  インストーラーを取得
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => open('release'))}
                >
                  変更点を見る
                </button>
              </div>
              <p className="update-notice-version">
                ブラウザで開きます。取得後、アプリを終了してインストールしてください。
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
