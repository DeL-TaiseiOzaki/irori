import { useRef, useState, useEffect } from 'react';
import type { HostAPI } from '../domain/types';
import type { UpdateCheck, UpdateState, UpdateTarget } from '../domain/updates';
import { t } from '../domain/i18n';
import './update-notice.css';

export type UpdateHost = Pick<
  HostAPI,
  | 'checkForUpdates'
  | 'openUpdatePage'
  | 'updateState'
  | 'installUpdate'
  | 'cancelUpdate'
  | 'restartToUpdate'
  | 'onEvent'
>;

const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
const message = (error: unknown) => String(error).replace(/^(?:Error: )+/, '');

/** What the host knows about updates, including a check irori made by itself. */
export function useUpdateState(host: UpdateHost) {
  const [state, setState] = useState<UpdateState>({ install: { phase: 'idle' } });
  useEffect(() => {
    let alive = true;
    let heard = false;
    const stop = host.onEvent((event) => {
      if (event.type !== 'update') return;
      heard = true;
      setState(event.state);
    });
    void host.updateState().then(
      (value) => {
        if (alive && !heard) setState(value);
      },
      () => {},
    );
    return () => {
      alive = false;
      stop();
    };
  }, [host]);
  return state;
}

/** Whether an update waits for the person: found, downloading, or ready to restart into. */
export function updateWaiting(state: UpdateState) {
  return state.check?.status === 'available' || state.install.phase !== 'idle';
}

export function UpdateNotice({ host }: { host: UpdateHost }) {
  const state = useUpdateState(host);
  // The person's own check, beside what the host knows.
  const [checked, setChecked] = useState<UpdateCheck>();
  const [busy, setBusy] = useState<'' | 'check' | 'open' | 'update'>('');
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function run(kind: 'check' | 'open' | 'update', action: () => Promise<void>) {
    if (busy) return;
    setBusy(kind);
    setError('');
    try {
      await action();
    } catch (e) {
      if (alive.current)
        setError(
          kind === 'update'
            ? message(e)
            : t(
                '更新情報を開けませんでした。もう一度お試しください。',
                'Could not open update information. Please try again.',
              ),
        );
    } finally {
      if (alive.current) setBusy('');
    }
  }
  const open = (target: UpdateTarget) => void run('open', () => host.openUpdatePage(target));
  // One button: download, verify and stage, then close irori as the window would and start
  // the new version. Staying (a running agent the person keeps) leaves the restart button.
  const update = () =>
    void run('update', async () => {
      if (await host.installUpdate()) await host.restartToUpdate();
    });
  const restart = () => void run('update', async () => void (await host.restartToUpdate()));
  const install = state.install;
  // A version irori found by itself is shown; its other results only answer the person's check.
  const shown = state.check?.status === 'available' ? state.check : checked;
  const working = install.phase === 'downloading' || install.phase === 'preparing';
  const failed = install.phase === 'failed';
  return (
    <div className="update-notice" aria-label={t('アプリの更新', 'App updates')}>
      <button
        type="button"
        disabled={!!busy || working}
        onClick={() =>
          void run('check', async () => {
            const value = await host.checkForUpdates();
            if (alive.current) setChecked(value);
          })
        }
      >
        {busy === 'check' ? t('確認中…', 'Checking…') : t('更新を確認', 'Check for updates')}
      </button>
      {working ? (
        <div className="update-notice-result" role="status">
          {install.phase === 'downloading' ? (
            <>
              <p>
                {t(`${install.version} をダウンロードしています`, `Downloading ${install.version}`)}
              </p>
              <progress
                aria-label={t('ダウンロードの進み具合', 'Download progress')}
                max={install.total}
                value={install.received}
              />
              <p className="update-notice-version">
                {Math.floor((install.received / install.total) * 100)}% ·{' '}
                {megabytes(install.received)} / {megabytes(install.total)} MB
              </p>
              <div className="update-notice-actions">
                <button type="button" onClick={() => void host.cancelUpdate().catch(() => {})}>
                  {t('キャンセル', 'Cancel')}
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                {t(
                  `${install.version} を確認して準備しています`,
                  `Verifying and preparing ${install.version}`,
                )}
              </p>
              <p className="update-notice-version">
                {t('終わると irori を再起動します。', 'irori will restart once this is done.')}
              </p>
            </>
          )}
        </div>
      ) : install.phase === 'ready' ? (
        <div className="update-notice-result" role="status">
          <p>
            {t(
              `${install.version} に更新する準備ができました。`,
              `Ready to update to ${install.version}.`,
            )}
          </p>
          <div className="update-notice-actions">
            <button
              type="button"
              className="update-notice-primary"
              disabled={!!busy}
              onClick={restart}
            >
              {t('再起動して更新', 'Restart and update')}
            </button>
          </div>
        </div>
      ) : (
        (shown || failed) && (
          <div
            className="update-notice-result"
            role={failed || shown?.status === 'error' ? 'alert' : 'status'}
          >
            {failed && (
              <p>
                {t('更新できませんでした。', 'Could not update.')}
                {install.detail}
              </p>
            )}
            {shown && <p>{shown.detail}</p>}
            {shown?.status === 'available' && (
              <>
                <p className="update-notice-version">
                  {t(
                    `使用中 ${shown.currentVersion} → 公開版 ${shown.release?.version}`,
                    `Current ${shown.currentVersion} → Published ${shown.release?.version}`,
                  )}
                </p>
                {shown.install?.available ? (
                  <>
                    <div className="update-notice-actions">
                      <button
                        type="button"
                        className="update-notice-primary"
                        disabled={!!busy}
                        onClick={update}
                      >
                        {failed
                          ? t('もう一度更新', 'Try updating again')
                          : t('更新して再起動', 'Update and restart')}
                      </button>
                      <button type="button" disabled={!!busy} onClick={() => open('release')}>
                        {t('変更点を見る', 'View changes')}
                      </button>
                      {failed && (
                        <button type="button" disabled={!!busy} onClick={() => open('download')}>
                          {t('インストーラーを取得', 'Get the installer')}
                        </button>
                      )}
                    </div>
                    <p className="update-notice-version">
                      {t(
                        'ダウンロードと確認が終わると、irori を再起動して新しい版を開きます。',
                        'Once downloading and verification finish, irori will restart into the new version.',
                      )}
                    </p>
                  </>
                ) : (
                  <>
                    {shown.install && (
                      <p className="update-notice-version">{shown.install.detail}</p>
                    )}
                    <div className="update-notice-actions">
                      <button type="button" disabled={!!busy} onClick={() => open('download')}>
                        {t('インストーラーを取得', 'Get the installer')}
                      </button>
                      <button type="button" disabled={!!busy} onClick={() => open('release')}>
                        {t('変更点を見る', 'View changes')}
                      </button>
                    </div>
                    <p className="update-notice-version">
                      {t(
                        'ブラウザで開きます。取得後、アプリを終了してインストールしてください。',
                        'Opens in your browser. After downloading, quit the app and install it.',
                      )}
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        )
      )}
      {error && (
        <p className="update-notice-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
