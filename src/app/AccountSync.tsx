import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { ArrowFillButton } from './obsidian/ArrowFillButton';
import { ErrorMessage, errorText } from './ErrorMessage';
import { useAction } from './useAction';
import { Icon } from './Icon';
import { reloadDeviceSettings } from './device-settings';
import { displayLocale, t } from '../domain/i18n';
import { unavailableText } from '../domain/routines';
import {
  passphraseLength,
  type EnvironmentRestore,
  type EnvironmentState,
} from '../domain/environment';
import './account.css';

const host = window.irori;

const when = (iso: string) =>
  new Date(iso).toLocaleString(displayLocale(), { dateStyle: 'medium', timeStyle: 'short' });

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A few paths, and how many more there are. */
const someOf = (paths: string[]) =>
  paths.length > 3
    ? t(
        `${paths.slice(0, 3).join('・')} ほか ${paths.length - 3} 件`,
        `${paths.slice(0, 3).join(', ')} and ${paths.length - 3} more`,
      )
    : paths.join(t('・', ', '));

/** What a restore added, secrets named only when there were some. */
function tookIn({ restored, workspaces, routines, agentFiles, secrets }: EnvironmentRestore) {
  const ja = [`vault ${restored.length} 件`, `ワークスペース ${workspaces} 件`];
  const en = [count(restored.length, 'vault'), count(workspaces, 'workspace')];
  if (agentFiles.length) {
    ja.push(`irori agent のファイル ${agentFiles.length} 件`);
    en.push(count(agentFiles.length, 'irori agent file'));
  }
  ja.push(`ルーティン ${routines.length} 件`);
  en.push(count(routines.length, 'routine'));
  if (secrets.length) {
    ja.push(`シークレット ${secrets.length} 件`);
    en.push(count(secrets.length, 'secret'));
  }
  const last = en.pop();
  return t(`${ja.join('・')}を取り込みました。`, `Took in ${en.join(', ')} and ${last}.`);
}

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
  const { busy, error: issue, run } = useAction();
  const [saved, setSaved] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  async function save() {
    await run(async () => {
      setSaved(false);
      setState(await host.saveEnvironment(passphrase || undefined));
      setPassphrase('');
      setSaved(true);
    });
  }
  const keys = state?.local.secretsAvailable ? state.local.secrets : [];
  const shortPassphrase = !!passphrase && passphrase.length < passphraseLength.min;
  const droppedKeys = passphrase
    ? (state?.saved?.secrets?.filter((item) => !item.here).length ?? 0)
    : 0;
  const dropped = state?.saved?.vaults.filter((item) => !item.here).length ?? 0;
  const droppedRoutines = state?.saved?.routines.filter((item) => !item.here).length ?? 0;
  const left = state?.local.routinesLeft ?? [];
  const filesLeft = state?.local.agentFilesLeft ?? [];
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
          {droppedRoutines > 0 && (
            <p className="account-hint">
              {t(
                `この端末にないルーティン ${droppedRoutines} 件は、保存すると外れます。`,
                `Saving drops ${droppedRoutines} routine${droppedRoutines === 1 ? '' : 's'} not on this device.`,
              )}
            </p>
          )}
          {dropped > 0 && (
            <p className="account-hint">
              {t(
                `この端末にない vault ${dropped} 件は、保存すると外れます。`,
                `Saving drops ${dropped} vault${dropped === 1 ? '' : 's'} not on this device.`,
              )}
            </p>
          )}
          {left.length > 0 && (
            <p className="account-hint">
              {t(
                `大きすぎるルーティンは保存されません：${left.join('・')}`,
                `Too large to save: ${left.join(', ')}`,
              )}
            </p>
          )}
          {filesLeft.length > 0 && (
            <p className="account-hint">
              {t(
                `保存されない irori agent のファイル：${someOf(filesLeft)}`,
                `irori agent files not saved: ${someOf(filesLeft)}`,
              )}
            </p>
          )}
          {keys.length > 0 && (
            <label className="account-passphrase">
              <span>
                {t(
                  `シークレット ${keys.length} 件も保存する合言葉`,
                  `Passphrase to save ${keys.length} secret${keys.length === 1 ? '' : 's'} too`,
                )}
              </span>
              <input
                type="password"
                autoComplete="new-password"
                value={passphrase}
                disabled={busy}
                maxLength={passphraseLength.max}
                placeholder={t(
                  `${passphraseLength.min} 文字以上`,
                  `${passphraseLength.min}+ characters`,
                )}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </label>
          )}
          {droppedKeys > 0 && (
            <p className="account-hint">
              {t(
                `この端末にないシークレット ${droppedKeys} 件は、保存すると外れます。`,
                `Saving drops ${droppedKeys} secret${droppedKeys === 1 ? '' : 's'} not on this device.`,
              )}
            </p>
          )}
          <div className="account-actions">
            <button type="button" disabled={busy || shortPassphrase} onClick={() => void save()}>
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
 * chosen vaults are cloned, the workspaces and preferences taken in.
 */
export function RestoreEnvironment({
  onClose,
  onRestored,
}: {
  onClose: () => void;
  /** This device's vaults, workspaces and preferences changed. */
  onRestored: () => void | Promise<void>;
}) {
  const { state, error, load } = useEnvironment();
  const [selected, setSelected] = useState<string[]>(),
    [agent, setAgent] = useState(true),
    [routines, setRoutines] = useState<string[]>(),
    [files, setFiles] = useState(true),
    [keys, setKeys] = useState<string[]>(),
    [passphrase, setPassphrase] = useState(''),
    [parent, setParent] = useState<string>(),
    [result, setResult] = useState<EnvironmentRestore>();
  const { busy, error: issue, run } = useAction();
  const saved = state?.saved;
  // Every vault not yet here is chosen until the person says otherwise.
  const chosen =
    selected ?? saved?.vaults.filter((item) => !item.here).map((item) => item.scopeId) ?? [];
  const agentMissing = !!saved?.agent && !saved.agent.here;
  const filesMissing = !!saved?.agentFiles?.missing;
  const chosenRoutines =
    routines ?? saved?.routines.filter((item) => !item.here).map((item) => item.folder) ?? [];
  const keysAvailable = !!state?.local.secretsAvailable;
  const chosenKeys = keysAvailable
    ? (keys ?? saved?.secrets?.filter((item) => !item.here).map((item) => item.name) ?? [])
    : [];
  const needsPassphrase = chosenKeys.length > 0;
  async function chooseParent() {
    const folder = await host.chooseFolder();
    if (folder) setParent(folder);
  }
  async function restore() {
    await run(async () => {
      const restored = await host.restoreEnvironment({
        scopeIds: chosen,
        agent: agentMissing && agent,
        routines: chosenRoutines,
        agentFiles: filesMissing && files,
        ...(needsPassphrase && { secrets: chosenKeys, passphrase }),
        ...(parent && { parent }),
      });
      await reloadDeviceSettings();
      setResult(restored);
      await onRestored();
    });
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
            <p role="status">{tookIn(result)}</p>
            {result.agentFilesKept.length > 0 && (
              <p className="account-hint">
                {t(
                  `この端末のものを残したファイル：${someOf(result.agentFilesKept)}`,
                  `Kept this device's files: ${someOf(result.agentFilesKept)}`,
                )}
              </p>
            )}
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
              <legend>vault</legend>
              {saved.vaults.map((item) => (
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
              {saved.agentFiles && (
                <label data-here={!filesMissing || undefined}>
                  <input
                    type="checkbox"
                    disabled={busy || !filesMissing}
                    checked={!filesMissing || files}
                    onChange={(e) => setFiles(e.target.checked)}
                  />
                  <span>{t('irori agent のファイル', 'irori agent files')}</span>
                  <small>
                    {filesMissing
                      ? t(`${saved.agentFiles.missing} 件`, count(saved.agentFiles.missing, 'file'))
                      : t('この端末にあります', 'On this device')}
                  </small>
                </label>
              )}
            </fieldset>
            {saved.routines.length > 0 && (
              <fieldset className="restore-list">
                <legend>{t('ルーティン', 'Routines')}</legend>
                {saved.routines.map((item) => (
                  <label key={item.folder} data-here={item.here || undefined}>
                    <input
                      type="checkbox"
                      disabled={busy || item.here}
                      checked={item.here || chosenRoutines.includes(item.folder)}
                      onChange={(e) =>
                        setRoutines(
                          e.target.checked
                            ? [...chosenRoutines, item.folder]
                            : chosenRoutines.filter((folder) => folder !== item.folder),
                        )
                      }
                    />
                    <span>{item.name}</span>
                    <small>
                      {item.here ? t('この端末にあります', 'On this device') : 'irori agent'}
                    </small>
                  </label>
                ))}
              </fieldset>
            )}
            {!!saved.secrets?.length && (
              <fieldset className="restore-list">
                <legend>{t('シークレット', 'Secrets')}</legend>
                {saved.secrets.map((item) => (
                  <label key={item.name} data-here={item.here || undefined}>
                    <input
                      type="checkbox"
                      disabled={busy || item.here || !keysAvailable}
                      checked={item.here || chosenKeys.includes(item.name)}
                      onChange={(e) =>
                        setKeys(
                          e.target.checked
                            ? [...chosenKeys, item.name]
                            : chosenKeys.filter((name) => name !== item.name),
                        )
                      }
                    />
                    <span>{item.name}</span>
                    {item.here && <small>{t('この端末にあります', 'On this device')}</small>}
                  </label>
                ))}
                {keysAvailable ? (
                  needsPassphrase && (
                    <label className="restore-passphrase">
                      <span>{t('合言葉', 'Passphrase')}</span>
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={passphrase}
                        disabled={busy}
                        maxLength={passphraseLength.max}
                        onChange={(e) => setPassphrase(e.target.value)}
                      />
                    </label>
                  )
                ) : (
                  <small className="restore-unavailable">{unavailableText()}</small>
                )}
              </fieldset>
            )}
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
              <ArrowFillButton
                type="submit"
                disabled={
                  busy || !saved || (needsPassphrase && passphrase.length < passphraseLength.min)
                }
              >
                {t('復元', 'Restore')}
              </ArrowFillButton>
            </>
          )}
        </div>
      </form>
    </Dialog>
  );
}
