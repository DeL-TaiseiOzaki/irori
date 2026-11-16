import { t } from '../domain/i18n';
import type {
  GitAuthor,
  GitHubDeviceCode,
  GitHubSignIn,
  GitHubStatus,
  GitIdentity,
} from '../domain/git';
import type { GitAuthorStore } from '../git/author';
import type { GitHubCli } from '../git/github';

export interface GitHubSignInHost {
  github: Pick<GitHubCli, 'status' | 'profile' | 'signIn'>;
  author: Pick<GitAuthorStore, 'read' | 'write'>;
  /** Opens a page in the person's browser. */
  open: (url: string) => Promise<void>;
  /** Puts text on the system's clipboard. */
  copy: (text: string) => void;
}

interface Pending {
  code: Promise<GitHubDeviceCode>;
  done: Promise<string>;
  stop: AbortController;
  shown?: GitHubDeviceCode;
}

const stopped = () => Error(t('ログインを取りやめました。', 'Sign-in was cancelled.'));

/**
 * Signs the GitHub CLI in from irori's window, so a new device needs no
 * terminal, and gives the device's Git an author from that account where it
 * has none (ADR 062). gh keeps the token, as ADR 026 decided.
 */
export class GitHubSignInService {
  private pending?: Pending;
  constructor(private host: GitHubSignInHost) {}
  status(): Promise<GitHubStatus> {
    return this.host.github.status();
  }
  /** Starts signing in; resolves with the code to enter once gh shows it. */
  async start(): Promise<GitHubDeviceCode> {
    // One sign-in at a time: a new one replaces one still waiting.
    await this.cancel();
    const stop = new AbortController();
    let show!: (code: GitHubDeviceCode) => void;
    const code = new Promise<GitHubDeviceCode>((resolve) => (show = resolve));
    const pending: Pending = { code, stop, done: Promise.resolve('') };
    pending.done = this.host.github.signIn((value) => {
      pending.shown = value;
      show(value);
    }, stop.signal);
    // A sign-in nobody waits for still settles quietly.
    pending.done.catch(() => {});
    this.pending = pending;
    // gh failing before it shows a code (no network, a token in the environment)
    // is the answer to starting.
    return Promise.race([
      code,
      pending.done.then(
        () =>
          pending.shown ??
          Promise.reject(
            Error(
              t(
                'GitHub がログイン用のページを示しませんでした。',
                'GitHub did not give a page to sign in on.',
              ),
            ),
          ),
      ),
    ]);
  }
  /** Copies the code and opens GitHub's page to enter it on. */
  async open() {
    const shown = this.pending?.shown;
    if (!shown) throw Error(t('ログインを始めていません。', 'Sign-in has not started.'));
    if (shown.code) this.host.copy(shown.code);
    await this.host.open(shown.url);
  }
  /**
   * Waits for the sign-in started above, then fills in the parts of the Git
   * author this device does not have from the account.
   */
  async finish(): Promise<GitHubSignIn> {
    const pending = this.pending;
    if (!pending) throw Error(t('ログインを始めていません。', 'Sign-in has not started.'));
    let login: string;
    try {
      login = await pending.done;
    } finally {
      if (this.pending === pending) this.pending = undefined;
    }
    const current = await this.host.author.read();
    const missing = (['name', 'email'] as const).filter((key) => !current[key]);
    if (!missing.length) return { login, author: current, filled: [] };
    const profile = await this.host.github.profile();
    await this.host.author.write(Object.fromEntries(missing.map((key) => [key, profile[key]])));
    return { login, author: await this.host.author.read(), filled: [...missing] };
  }
  /** Stops a sign-in that is still waiting; nothing happens when none is. */
  async cancel() {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    pending.stop.abort(stopped());
    await pending.done.catch(() => {});
  }
  /** This device's Git author, with the account's offered while a part is unset. */
  async author(): Promise<GitAuthor> {
    const current = await this.host.author.read();
    if (current.name && current.email) return current;
    const github = await this.host.github.profile().then(
      ({ name, email }) => ({ name, email }),
      () => undefined,
    );
    return github ? { ...current, github } : current;
  }
  async saveAuthor(identity: GitIdentity): Promise<GitAuthor> {
    await this.host.author.write(identity);
    return this.author();
  }
}
