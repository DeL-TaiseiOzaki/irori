import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import type { CloudWriteRecovery, SourceVersion } from '../domain/knowledge';
import { displayLocale, t } from '../domain/i18n';

/** Available even on startup, with no currently registered workspace or account. */
export function CloudRecovery() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="cloud-recovery-trigger" onClick={() => setOpen(true)}>
        {t('送信待ちを復元', 'Restore pending uploads')}
      </button>
      {open && <CloudRecoveryDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/** The kept versions of pending uploads, each restorable to a separate file. */
export function CloudRecoveryDialog({ onClose }: { onClose: () => void }) {
  const [result, setResult] = useState<CloudWriteRecovery>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    void load();
  }, []);
  async function load() {
    setResult(undefined);
    setError('');
    setBusy(true);
    try {
      setResult(await window.irori.recoverableCloudWrites());
    } catch {
      setError(t('送信待ちを読み込めませんでした。', 'Could not load pending uploads.'));
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
          '復元できませんでした（既存のファイルは上書きできません）。',
          'Could not restore (an existing file cannot be overwritten).',
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog label={t('送信待ち', 'Pending uploads')} busy={busy} onClose={onClose}>
      <div className="modal">
        <header className="actions">
          <h2>{t('送信待ち', 'Pending uploads')}</h2>
          <button disabled={busy} onClick={onClose}>
            {t('閉じる', 'Close')}
          </button>
        </header>
        {error && <p role="alert">{error}</p>}
        {!result && busy && <p role="status">{t('読み込み中…', 'Loading…')}</p>}
        {result && result.unreadable > 0 && (
          <p role="alert">
            {t(
              `読み込めない記録があります（${result.unreadable} 件）。`,
              `Some records could not be read (${result.unreadable}).`,
            )}
          </p>
        )}
        {result && !result.entries.length && (
          <p>{t('送信待ちはありません。', 'No pending uploads.')}</p>
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
  );
}
