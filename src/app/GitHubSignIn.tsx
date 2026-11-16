import { useEffect, useRef, useState } from 'react';
import type { GitHubDeviceCode, GitHubSignIn as SignedIn } from '../domain/git';
import { t } from '../domain/i18n';
import { ErrorMessage, errorText } from './ErrorMessage';
import { Icon } from './Icon';
import './account.css';

const host = window.irori;

/** Where the GitHub CLI is offered when it is not installed. */
const cliPage = 'https://cli.github.com/';

/**
 * Why a GitHub call failed, when it was because the GitHub CLI is signed out
 * or missing: asked once each time `error` changes, so the window can offer
 * to sign in instead of showing the error. `checking` while it asks.
 */
export function useGitHubUnavailable(error: string | undefined) {
  const [state, setState] = useState<'checking' | 'signed-out' | 'missing'>();
  useEffect(() => {
    setState(error ? 'checking' : undefined);
    if (!error) return;
    let live = true;
    void host.githubStatus().then(
      (status) => {
        if (live) setState(status.state === 'signed-in' ? undefined : status.state);
      },
      () => live && setState(undefined),
    );
    return () => {
      live = false;
    };
  }, [error]);
  return state;
}

/**
 * Signs the GitHub CLI in without a terminal (ADR 062): irori runs
 * `gh auth login --web`, shows the one-time code, and opens GitHub's page to
 * enter it on. Once the person approves there, `onSignedIn` receives the
 * account and the Git author irori filled in from it.
 */
export function GitHubSignIn({
  state,
  onSignedIn,
  onCheck,
}: {
  state: 'signed-out' | 'missing';
  onSignedIn: (result: SignedIn) => void;
  /** Asks again, after the GitHub CLI was installed. */
  onCheck: () => void;
}) {
  const [code, setCode] = useState<GitHubDeviceCode>();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  // Each start or cancel is a new attempt; an older one's answer is ignored.
  const attempt = useRef(0);
  useEffect(
    () => () => {
      attempt.current++;
      void host.cancelGitHubSignIn().catch(() => {});
    },
    [],
  );
  async function start() {
    const mine = ++attempt.current;
    setError('');
    setStarting(true);
    try {
      const shown = await host.startGitHubSignIn();
      if (mine !== attempt.current) return;
      setCode(shown);
      setStarting(false);
      const result = await host.finishGitHubSignIn();
      if (mine === attempt.current) onSignedIn(result);
    } catch (reason) {
      if (mine !== attempt.current) return;
      setCode(undefined);
      setStarting(false);
      setError(errorText(reason));
    }
  }
  function cancel() {
    attempt.current++;
    setCode(undefined);
    setStarting(false);
    void host.cancelGitHubSignIn().catch(() => {});
  }
  if (state === 'missing')
    return (
      <div className="github-sign-in">
        <p>
          {t(
            'GitHub CLI（gh）が見つかりません。irori は gh を通して GitHub に接続します。インストールしてから「再確認」を押してください。',
            'The GitHub CLI (gh) was not found. irori connects to GitHub through gh. Install it, then choose Check again.',
          )}
        </p>
        <div className="account-actions">
          <button type="button" onClick={() => void host.openUrl(cliPage).catch(() => {})}>
            <Icon name="link" size={14} />
            {t('GitHub CLI を入手', 'Get the GitHub CLI')}
          </button>
          <button type="button" onClick={onCheck}>
            <Icon name="refresh" size={14} />
            {t('再確認', 'Check again')}
          </button>
        </div>
      </div>
    );
  return (
    <div className="github-sign-in">
      {code ? (
        <>
          <p>
            {code.code
              ? t(
                  'GitHub のページで次のコードを入力し、承認してください。承認すると、ここに戻らなくても接続が完了します。',
                  'Enter this code on the GitHub page and approve. The connection completes once you do.',
                )
              : t(
                  'GitHub のページで承認してください。承認すると接続が完了します。',
                  'Approve on the GitHub page. The connection completes once you do.',
                )}
          </p>
          {code.code && (
            <p className="github-code" aria-label={t('ワンタイムコード', 'One-time code')}>
              {code.code}
            </p>
          )}
          <div className="account-actions">
            <button
              type="button"
              onClick={() => void host.openGitHubSignIn().catch((e) => setError(errorText(e)))}
            >
              <Icon name={code.code ? 'copy' : 'link'} size={14} />
              {code.code
                ? t('コードをコピーして GitHub を開く', 'Copy the code and open GitHub')
                : t('GitHub を開く', 'Open GitHub')}
            </button>
            <button type="button" onClick={cancel}>
              {t('キャンセル', 'Cancel')}
            </button>
          </div>
          <p role="status" className="account-hint">
            <Icon name="loader" size={13} />
            {t('GitHub での承認を待っています…', 'Waiting for approval on GitHub…')}
          </p>
        </>
      ) : (
        <>
          <p>
            {t(
              'GitHub にログインしていません。ブラウザで GitHub にログインして承認すると、irori から接続できます。',
              'Not signed in to GitHub. Sign in and approve in your browser to connect irori.',
            )}
          </p>
          <div className="account-actions">
            <button type="button" disabled={starting} onClick={() => void start()}>
              <Icon name="user" size={14} />
              {t('GitHub にログイン', 'Sign in to GitHub')}
            </button>
          </div>
          {starting && <p role="status">{t('準備しています…', 'Preparing…')}</p>}
        </>
      )}
      {error && <ErrorMessage text={error} />}
    </div>
  );
}

/** What signing in did, for a status line. */
export function signedInText({ login, author, filled }: SignedIn) {
  const who = t(`GitHub に ${login} としてログインしました。`, `Signed in to GitHub as ${login}.`);
  if (!filled.length) return who;
  return `${who}${t(
    `Git の作成者を「${author.name} <${author.email}>」にしました。`,
    ` Git now records commits as ${author.name} <${author.email}>.`,
  )}`;
}
