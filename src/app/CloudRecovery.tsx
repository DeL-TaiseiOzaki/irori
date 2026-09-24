import { useState } from 'react';
import { Dialog } from './Dialog';
import type { CloudWriteRecovery, SourceVersion } from '../domain/knowledge';
import { displayLocale, t } from '../domain/i18n';

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
      setError(
        t(
          '送信準備を読み込めませんでした。端末のデータへのアクセスを確認してください。',
          'Could not load pending uploads. Check access to the device data.',
        ),
      );
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
        t(
          '復元できませんでした。保持版と保存先を確認してください。既存ファイルは上書きできません。',
          'Could not restore. Check the kept version and destination. An existing file cannot be overwritten.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="cloud-recovery-trigger" onClick={() => void load()}>
        {t('端末の送信準備を復元', 'Restore pending uploads on this device')}
      </button>
      {open && (
        <Dialog
          label={t('端末の送信準備', 'Pending uploads on this device')}
          busy={busy}
          onClose={() => setOpen(false)}
        >
          <div className="modal">
            <header className="actions">
              <h2>{t('端末の送信準備', 'Pending uploads on this device')}</h2>
              <button disabled={busy} onClick={() => setOpen(false)}>
                {t('閉じる', 'Close')}
              </button>
            </header>
            <p>
              {t(
                '接続やワークスペースの登録を削除した後も、送信準備として保持した版を別ファイルに復元できます。',
                'Even after removing a connection or workspace registration, a version kept as a pending upload can be restored to a separate file.',
              )}
            </p>
            <p>
              {t(
                '復元後、送信先を確認して準備し直してください。この操作では Drive へ送信しません。',
                'After restoring, check the destination and prepare it again. This does not send anything to Drive.',
              )}
            </p>
            {error && <p role="alert">{error}</p>}
            {!result && busy && <p role="status">{t('読み込み中…', 'Loading…')}</p>}
            {result && result.unreadable > 0 && (
              <p role="alert">
                {t(
                  `読み込めない記録があります（${result.unreadable} 件）。読み込めた記録は復元できます。`,
                  `Some records could not be read (${result.unreadable}). Records that could be read can be restored.`,
                )}
              </p>
            )}
            {result && !result.entries.length && (
              <p>
                {t('復元できる送信準備はありません。', 'There are no pending uploads to restore.')}
              </p>
            )}
            <ul>
              {result?.entries.map((item) => (
                <li key={`${item.ownerId}/${item.id}`}>
                  <strong>{item.name}</strong>
                  <p>
                    {item.source.path} · {new Date(item.createdAt).toLocaleString(displayLocale())}
                  </p>
                  <button disabled={busy} onClick={() => void restore(item.source)}>
                    {t('別ファイルに復元', 'Restore to a separate file')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Dialog>
      )}
    </>
  );
}
