import { useRef, useState, useEffect } from 'react';
import type { HostAPI } from '../domain/types';
import type { UpdateCheck, UpdateState, UpdateTarget } from '../domain/updates';
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

export function UpdateNotice({ host }: { host: UpdateHost }) {
  // What the host knows, including a check irori made by itself, and the person's own check.
  const [state, setState] = useState<UpdateState>({ install: { phase: 'idle' } });
  const [checked, setChecked] = useState<UpdateCheck>();
  const [busy, setBusy] = useState<'' | 'check' | 'open' | 'update'>('');
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let heard = false;
    const stop = host.onEvent((event) => {
      if (event.type !== 'update') return;
      heard = true;
      setState(event.state);
    });
    void host.updateState().then(
      (value) => {
        if (alive.current && !heard) setState(value);
      },
      () => {},
    );
    return () => {
      alive.current = false;
      stop();
    };
  }, [host]);
  async function run(kind: 'check' | 'open' | 'update', action: () => Promise<void>) {
    if (busy) return;
    setBusy(kind);
    setError('');
    try {
      await action();
    } catch (e) {
      if (alive.current)
        setError(
          kind === 'update' ? message(e) : '更新情報を開けませんでした。もう一度お試しください。',
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
    <div className="update-notice" aria-label="アプリの更新">
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
        {busy === 'check' ? '確認中…' : '更新を確認'}
      </button>
      {working ? (
        <div className="update-notice-result" role="status">
          {install.phase === 'downloading' ? (
            <>
              <p>{install.version} をダウンロードしています</p>
              <progress
                aria-label="ダウンロードの進み具合"
                max={install.total}
                value={install.received}
              />
              <p className="update-notice-version">
                {Math.floor((install.received / install.total) * 100)}% ·{' '}
                {megabytes(install.received)} / {megabytes(install.total)} MB
              </p>
              <div className="update-notice-actions">
                <button type="button" onClick={() => void host.cancelUpdate().catch(() => {})}>
                  キャンセル
                </button>
              </div>
            </>
          ) : (
            <>
              <p>{install.version} を確認して準備しています</p>
              <p className="update-notice-version">終わると irori を再起動します。</p>
            </>
          )}
        </div>
      ) : install.phase === 'ready' ? (
        <div className="update-notice-result" role="status">
          <p>{install.version} に更新する準備ができました。</p>
          <div className="update-notice-actions">
            <button
              type="button"
              className="update-notice-primary"
              disabled={!!busy}
              onClick={restart}
            >
              再起動して更新
            </button>
          </div>
        </div>
      ) : (
        (shown || failed) && (
          <div
            className="update-notice-result"
            role={failed || shown?.status === 'error' ? 'alert' : 'status'}
          >
            {failed && <p>更新できませんでした。{install.detail}</p>}
            {shown && <p>{shown.detail}</p>}
            {shown?.status === 'available' && (
              <>
                <p className="update-notice-version">
                  使用中 {shown.currentVersion} → 公開版 {shown.release?.version}
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
                        {failed ? 'もう一度更新' : '更新して再起動'}
                      </button>
                      <button type="button" disabled={!!busy} onClick={() => open('release')}>
                        変更点を見る
                      </button>
                      {failed && (
                        <button type="button" disabled={!!busy} onClick={() => open('download')}>
                          インストーラーを取得
                        </button>
                      )}
                    </div>
                    <p className="update-notice-version">
                      ダウンロードと確認が終わると、irori を再起動して新しい版を開きます。
                    </p>
                  </>
                ) : (
                  <>
                    {shown.install && (
                      <p className="update-notice-version">{shown.install.detail}</p>
                    )}
                    <div className="update-notice-actions">
                      <button type="button" disabled={!!busy} onClick={() => open('download')}>
                        インストーラーを取得
                      </button>
                      <button type="button" disabled={!!busy} onClick={() => open('release')}>
                        変更点を見る
                      </button>
                    </div>
                    <p className="update-notice-version">
                      ブラウザで開きます。取得後、アプリを終了してインストールしてください。
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
