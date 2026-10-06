import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { ArrowFillButton } from './obsidian/ArrowFillButton';
import { ErrorMessage, errorText } from './ErrorMessage';
import { Icon } from './Icon';
import { reloadDeviceSettings } from './device-settings';
import { displayLocale, t } from '../domain/i18n';
import type { EnvironmentRestore, EnvironmentState } from '../domain/environment';
import './account.css';

const host = window.irori;

const when = (iso: string) =>
  new Date(iso).toLocaleString(displayLocale(), { dateStyle: 'medium', timeStyle: 'short' });

/** The environment on the GitHub account, read once and again on request. */
function useEnvironment() {
  const [state, setState] = useState<EnvironmentState>();
  const [error, setError] = useState('');
  const load = () => {
    setError('');
    void host.environment().then(setState, (e) => setError(errorText(e)));
  };
  useEffect(load, []);
  return { state, setState, error, load };
}

/**
 * The settings' account section (ADR 026): the GitHub account the GitHub CLI
 * is signed in to, and the environment saved there.
 */
export function AccountSection({ onRestore }: { onRestore: () => void }) {
  const { state, setState, error, load } = useEnvironment();
  const [busy, setBusy] = useState(false),
    [issue, setIssue] = useState(''),
    [saved, setSaved] = useState(false);
  async function save() {
    setBusy(true);
    setIssue('');
    setSaved(false);
    try {
      setState(await host.saveEnvironment());
      setSaved(true);
    } catch (e) {
      setIssue(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const dropped = state?.saved?.hibachis.filter((item) => !item.here).length ?? 0;
  return (
    <section className="settings-account" aria-label={t('アカウント', 'Account')}>
      <h3>{t('アカウント', 'Account')}</h3>
      {state ? (
        <>
          <p className="account-name">
            <Icon name="user" size={15} />
            <span>GitHub: {state.account}</span>
          </p>
          <p className="account-saved">
            {state.saved
              ? t(`環境を保存：${when(state.saved.savedAt)}`, `Saved ${when(state.saved.savedAt)}`)
              : t('環境は保存されていません', 'No environment saved')}
          </p>
          {dropped > 0 && (
            <p className="account-hint">
              {t(
                `この端末にない hibachi ${dropped} 件は、保存すると外れます。`,
                `Saving drops ${dropped} hibachi${dropped === 1 ? '' : 's'} not on this device.`,
              )}
            </p>
          )}
          <div className="account-actions">
            <button type="button" disabled={busy} onClick={() => void save()}>
              <Icon name="cloudUp" size={14} />
              {t('環境を保存', 'Save environment')}
            </button>
            {state.saved && (
              <button type="button" disabled={busy} onClick={onRestore}>
                <Icon name="download" size={14} />
                {t('復元', 'Restore')}
              </button>
            )}
          </div>
          {busy && <p role="status">{t('保存しています…', 'Saving…')}</p>}
          {saved && <p role="status">{t('保存しました。', 'Saved.')}</p>}
          {issue && <ErrorMessage text={issue} />}
        </>
      ) : error ? (
        <>
          <ErrorMessage text={error} />
          <button type="button" onClick={load}>
            <Icon name="refresh" size={14} />
            {t('再確認', 'Check again')}
          </button>
        </>
      ) : (
        <p role="status">{t('確認しています…', 'Checking…')}</p>
      )}
    </section>
  );
}

/**
 * Restores the environment saved on the GitHub account to this device: the
 * chosen hibachis are cloned, the workspaces and preferences taken in.
 */
export function RestoreEnvironment({
  onClose,
  onRestored,
}: {
  onClose: () => void;
  /** This device's hibachis, workspaces and preferences changed. */
  onRestored: () => void | Promise<void>;
}) {
  const { state, error, load } = useEnvironment();
  const [selected, setSelected] = useState<string[]>(),
    [agent, setAgent] = useState(true),
    [parent, setParent] = useState<string>(),
    [busy, setBusy] = useState(false),
    [issue, setIssue] = useState(''),
    [result, setResult] = useState<EnvironmentRestore>();
  const saved = state?.saved;
  // Every hibachi not yet here is chosen until the person says otherwise.
  const chosen =
    selected ?? saved?.hibachis.filter((item) => !item.here).map((item) => item.scopeId) ?? [];
  const agentMissing = !!saved?.agent && !saved.agent.here;
  async function chooseParent() {
    const folder = await host.chooseFolder();
    if (folder) setParent(folder);
  }
  async function restore() {
    setBusy(true);
    setIssue('');
    try {
      const restored = await host.restoreEnvironment({
        scopeIds: chosen,
        agent: agentMissing && agent,
        ...(parent && { parent }),
      });
      await reloadDeviceSettings();
      setResult(restored);
      await onRestored();
    } catch (e) {
      setIssue(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const label = t('環境を復元', 'Restore environment');
  return (
    <Dialog label={label} busy={busy} onClose={onClose}>
      <form
        className="modal restore-environment"
        aria-label={label}
        onSubmit={(e) => {
          e.preventDefault();
          if (result) onClose();
          else void restore();
        }}
      >
        <h2>{label}</h2>
        {result ? (
          <div className="restore-result">
            <p role="status">
              {t(
                `hibachi ${result.restored.length} 件とワークスペース ${result.workspaces} 件を取り込みました。`,
                `Took in ${result.restored.length} hibachi${result.restored.length === 1 ? '' : 's'} and ${result.workspaces} workspace${result.workspaces === 1 ? '' : 's'}.`,
              )}
            </p>
            {result.failed.map((item) => (
              <ErrorMessage key={item.name} text={`${item.name}: ${item.message}`} />
            ))}
          </div>
        ) : state && !saved ? (
          <p>
            {t(
              'この GitHub アカウントには保存された環境がありません。',
              'This GitHub account has no saved environment.',
            )}
          </p>
        ) : state && saved ? (
          <>
            <p className="restore-source">
              GitHub: {state.account} · {when(saved.savedAt)}
            </p>
            <fieldset className="restore-list">
              <legend>hibachi</legend>
              {saved.hibachis.map((item) => (
                <label key={item.scopeId} data-here={item.here || undefined}>
                  <input
                    type="checkbox"
                    disabled={busy || item.here}
                    checked={item.here || chosen.includes(item.scopeId)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...chosen, item.scopeId]
                          : chosen.filter((id) => id !== item.scopeId),
                      )
                    }
                  />
                  <span>{item.name}</span>
                  <small>
                    {item.here ? t('この端末にあります', 'On this device') : item.repository}
                  </small>
                </label>
              ))}
              {saved.agent && (
                <label data-here={saved.agent.here || undefined}>
                  <input
                    type="checkbox"
                    disabled={busy || saved.agent.here}
                    checked={saved.agent.here || agent}
                    onChange={(e) => setAgent(e.target.checked)}
                  />
                  <span>irori agent</span>
                  <small>
                    {saved.agent.here
                      ? t('この端末にあります', 'On this device')
                      : saved.agent.repository}
                  </small>
                </label>
              )}
            </fieldset>
            {saved.workspaces.length > 0 && (
              <p className="restore-workspaces">
                {t('ワークスペース', 'Workspaces')}: {saved.workspaces.join(t('・', ', '))}
              </p>
            )}
            <div className="restore-parent">
              <span>{t('取得先', 'Clone into')}</span>
              <code title={parent ?? state.parent}>{parent ?? state.parent}</code>
              <button type="button" disabled={busy} onClick={() => void chooseParent()}>
                {t('変更', 'Change')}
              </button>
            </div>
          </>
        ) : error ? (
          <>
            <ErrorMessage text={error} />
            <button type="button" onClick={load}>
              {t('再確認', 'Check again')}
            </button>
          </>
        ) : (
          <p role="status">{t('確認しています…', 'Checking…')}</p>
        )}
        {issue && <ErrorMessage text={issue} />}
        {busy && !result && <p role="status">{t('復元しています…', 'Restoring…')}</p>}
        <div className="actions">
          {result ? (
            <ArrowFillButton type="submit">{t('閉じる', 'Close')}</ArrowFillButton>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={onClose}>
                {t('キャンセル', 'Cancel')}
              </button>
              <ArrowFillButton type="submit" disabled={busy || !saved}>
                {t('復元', 'Restore')}
              </ArrowFillButton>
            </>
          )}
        </div>
      </form>
    </Dialog>
  );
}
