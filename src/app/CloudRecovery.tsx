import { useState } from 'react';
import { Dialog } from './Dialog';
import { displayLocale, t } from '../domain/i18n';
import { useAction } from './useAction';
import { useResource } from './useResource';

const host = window.irori;

/** What is left: changes never sent, and copies once kept for upload. */
const readLeft = () => Promise.all([host.unsentDriveChanges(), host.recoverableCloudWrites()]);

/**
 * What Google Drive connections left on this device when irori stopped connecting
 * to Drive itself (ADR 023). Shown on the start screen only while there is any.
 */
export function CloudRecovery() {
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const { data } = useResource(readLeft, [], { refresh: revision });
  const left = data ? data[0] + data[1].entries.length + data[1].unreadable : 0;
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
  const [revision, setRevision] = useState(0);
  const read = useResource(readLeft, [], { refresh: revision });
  const [unsent, prepared] = read.data ?? [];
  const action = useAction();
  const act = action.run;
  const busy = action.busy || read.loading;
  const error = action.error || read.error;
  const [saved, setSaved] = useState('');
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
                  setRevision((value) => value + 1);
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
