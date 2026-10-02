import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import type { CloudWriteRecovery } from '../domain/knowledge';
import { displayLocale, t } from '../domain/i18n';
import { errorText } from './ErrorMessage';

const host = window.irori;

/**
 * What Google Drive connections left on this device when irori stopped connecting
 * to Drive itself (ADR 023). Shown on the start screen only while there is any.
 */
export function CloudRecovery() {
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState(0);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    void Promise.all([host.unsentDriveChanges(), host.recoverableCloudWrites()])
      .then(([unsent, prepared]) => {
        if (current) setLeft(unsent + prepared.entries.length + prepared.unreadable);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [revision]);
  if (!left && !open) return null;
  return (
    <>
      <button className="cloud-recovery-trigger" onClick={() => setOpen(true)}>
        {t(`Drive の未送信分 ${left}`, `${left} not sent to Drive`)}
      </button>
      {open && (
        <CloudRecoveryDialog
          onClose={() => {
            setOpen(false);
            setRevision((value) => value + 1);
          }}
        />
      )}
    </>
  );
}

/** Saves changes that never reached Drive, and restores copies once kept for upload. */
export function CloudRecoveryDialog({ onClose }: { onClose: () => void }) {
  const [unsent, setUnsent] = useState<number>();
  const [prepared, setPrepared] = useState<CloudWriteRecovery>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  useEffect(() => {
    void load();
  }, []);
  async function load() {
    setError('');
    setBusy(true);
    try {
      setUnsent(await host.unsentDriveChanges());
      setPrepared(await host.recoverableCloudWrites());
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog label={t('Drive の未送信分', 'Not sent to Drive')} busy={busy} onClose={onClose}>
      <div className="modal">
        <header className="actions">
          <h2>{t('Drive の未送信分', 'Not sent to Drive')}</h2>
          <button disabled={busy} onClick={onClose}>
            {t('閉じる', 'Close')}
          </button>
        </header>
        {error && <p role="alert">{error}</p>}
        {unsent === undefined && busy && <p role="status">{t('読み込み中…', 'Loading…')}</p>}
        {!!unsent && (
          <section>
            <p>{t(`変更されたファイル ${unsent}`, `${unsent} changed files`)}</p>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const result = await host.exportUnsentDriveChanges();
                  if (result) setSaved(result.folder);
                  await load();
                })
              }
            >
              {t('フォルダに保存', 'Save to a folder')}
            </button>
          </section>
        )}
        {saved && (
          <p role="status" className="mono">
            {saved}
          </p>
        )}
        {prepared && prepared.unreadable > 0 && (
          <p role="alert">
            {t(
              `読み込めない記録 ${prepared.unreadable}`,
              `${prepared.unreadable} unreadable records`,
            )}
          </p>
        )}
        {unsent === 0 && prepared && !prepared.entries.length && (
          <p>{t('ありません。', 'Nothing left.')}</p>
        )}
        <ul>
          {prepared?.entries.map((item) => (
            <li key={`${item.ownerId}/${item.id}`}>
              <strong>{item.name}</strong>
              <p>
                {item.source.path} · {new Date(item.createdAt).toLocaleString(displayLocale())}
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    host.restoreSource(item.source).catch(() => {
                      throw Error(
                        t(
                          '復元できませんでした（既存のファイルは上書きできません）。',
                          'Could not restore (an existing file cannot be overwritten).',
                        ),
                      );
                    }),
                  )
                }
              >
                {t('別ファイルに復元', 'Restore to a separate file')}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
