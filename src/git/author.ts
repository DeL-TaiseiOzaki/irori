import { t } from '../domain/i18n';
import { validGitEmail, validGitName, type GitIdentity } from '../domain/git';
import { GitProcess } from './process';

/**
 * This device's Git author: `user.name` and `user.email` in the person's own
 * Git configuration (`git config --global`), which every commit on the device
 * uses unless a repository sets its own (ADR 062).
 */
export class GitAuthorStore {
  constructor(
    /** A folder that is not a repository, so no repository's configuration is consulted. */
    private cwd: string,
    private process = new GitProcess(),
  ) {}
  private async get(key: string) {
    // Git exits with 1 when the key is unset.
    const value = await this.process.run(this.cwd, ['config', '--global', '--get', key], {
      codes: [0, 1],
    });
    return value.trim();
  }
  async read(): Promise<GitIdentity> {
    return { name: await this.get('user.name'), email: await this.get('user.email') };
  }
  /** Sets the parts given; each must be what Git can record. */
  async write(identity: Partial<GitIdentity>) {
    const name = identity.name?.trim(),
      email = identity.email?.trim();
    if (name !== undefined && !validGitName(name))
      throw Error(t('Git の作成者名が無効です。', 'The Git author name is invalid.'));
    if (email !== undefined && !validGitEmail(email))
      throw Error(t('メールアドレスが無効です。', 'The email address is invalid.'));
    if (name !== undefined)
      await this.process.run(this.cwd, ['config', '--global', 'user.name', name]);
    if (email !== undefined)
      await this.process.run(this.cwd, ['config', '--global', 'user.email', email]);
  }
  async close() {
    await this.process.close();
  }
}
