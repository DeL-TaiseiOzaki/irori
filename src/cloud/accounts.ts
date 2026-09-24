import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CloudAccount, CloudFolder } from '../domain/types';
import { providerId } from '../domain/connections';
import { readLocalJson, writeLocalJson } from '../host/local-json';
import type { RcloneAPI } from './rclone';
import type { GoogleOAuth } from './oauth';
import { t } from '../domain/i18n';
const accountSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  provider: z.literal('google-drive'),
  state: z.enum(['authorizing', 'ready', 'incomplete']),
  detail: z.string().optional(),
  // Accounts signed in before 0.1.35 asked for read access only and lack this.
  writable: z.boolean().optional(),
});
const entriesSchema = z.array(z.object({ ID: providerId, Name: z.string(), IsDir: z.boolean() }));
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
type AuthTask = {
  id: string;
  cancelled: boolean;
  done?: Promise<void>;
  jobId?: number;
  /** Signing an existing account in again: cancelling keeps the account and its bindings. */
  again?: boolean;
};
export class CloudAccounts {
  private accounts: CloudAccount[] = [];
  private active?: AuthTask;
  private initialized?: Promise<void>;
  constructor(
    private dataDir: string,
    readonly rpc: RcloneAPI,
    private openBrowser: (url: string) => Promise<void>,
    private oauth: GoogleOAuth = {
      clientId: process.env.IRORI_GOOGLE_CLIENT_ID,
      clientSecret: process.env.IRORI_GOOGLE_CLIENT_SECRET,
    },
  ) {}
  get configured() {
    return !!this.oauth.clientId && !!this.oauth.clientSecret;
  }
  remote(id: string) {
    this.get(id);
    return 'irori_' + id.replaceAll('-', '');
  }
  private get(id: string) {
    const account = this.accounts.find((item) => item.id === id);
    if (!account)
      throw Error(
        t('登録されていないクラウドアカウントです。', 'This cloud account is not registered.'),
      );
    return account;
  }
  async init() {
    if (!this.initialized)
      this.initialized = (async () => {
        this.accounts = z
          .array(accountSchema)
          .parse(await readLocalJson(path.join(this.dataDir, 'cloud-accounts.json'), []));
        for (const account of this.accounts)
          if (account.state === 'authorizing') {
            account.state = 'incomplete';
            account.detail = t(
              '前回の認証が完了していません。再ログインするか、取り消して追加し直してください。',
              'The previous sign-in did not finish. Sign in again, or cancel it and add the account again.',
            );
          }
      })();
    return this.initialized;
  }
  private persist() {
    return writeLocalJson(path.join(this.dataDir, 'cloud-accounts.json'), this.accounts);
  }
  async list() {
    await this.init();
    return this.accounts.map((item) => ({ ...item }));
  }
  async add(name: string): Promise<CloudAccount> {
    await this.init();
    if (this.active)
      throw Error(
        t(
          '進行中のアカウント認証を完了または取り消してください。',
          'Finish or cancel the account sign-in in progress.',
        ),
      );
    if (!this.configured)
      throw Error(
        t(
          'このビルドにはGoogleログイン設定がありません。配布用OAuth設定が必要です。',
          'This build has no Google sign-in configuration. A distribution OAuth configuration is required.',
        ),
      );
    const account = accountSchema.parse({
      id: randomUUID(),
      name,
      provider: 'google-drive',
      state: 'authorizing',
    });
    const task: AuthTask = { id: account.id, cancelled: false };
    this.active = task;
    this.accounts.push(account);
    try {
      await this.persist();
    } catch (error) {
      this.accounts = this.accounts.filter((a) => a.id !== account.id);
      this.active = undefined;
      throw error;
    }
    task.done = this.authorize(account, task);
    return { ...account };
  }
  private async authorize(account: CloudAccount, task: AuthTask) {
    try {
      const parameters = {
        client_id: this.oauth.clientId!,
        client_secret: this.oauth.clientSecret ?? '',
        // Folders are edited in place, so the account may change files; Google asks
        // the person to allow that when they sign in.
        scope: 'drive',
        config_auth_no_browser: 'true',
      };
      let method = 'config/create';
      let opt: Record<string, unknown> = { nonInteractive: true, noOutput: true };
      let opened = false;
      const deadline = Date.now() + 180000;
      for (let step = 0; step < 8; step++) {
        if (task.cancelled) return;
        const job = await this.rpc.call(method, {
          name: this.remote(account.id),
          ...(method === 'config/create' ? { type: 'drive' } : {}),
          parameters,
          opt,
          _async: true,
        });
        task.jobId = z.number().int().parse(job.jobid);
        if (task.cancelled) {
          await this.rpc.call('job/stop', { jobid: task.jobId }).catch(() => {});
          return;
        }
        let output: any;
        while (!task.cancelled && Date.now() < deadline) {
          const status = await this.rpc.call('job/status', { jobid: task.jobId });
          if (status.finished) {
            if (!status.success)
              throw Error(
                t(
                  'Google認証を完了できませんでした。ログインを取り消して再試行してください。',
                  'Google sign-in could not finish. Cancel the sign-in and try again.',
                ),
              );
            output = status.output;
            break;
          }
          if (!opened) {
            const browser = await this.rpc.call('config/oauthstatus');
            if (browser.status === 'running' && typeof browser.authUrl === 'string') {
              const url = new URL(browser.authUrl);
              if (
                url.protocol !== 'http:' ||
                url.hostname !== '127.0.0.1' ||
                url.port !== '53682' ||
                url.pathname !== '/auth'
              )
                throw Error(
                  t(
                    'Google認証の接続先を確認できません。',
                    'Could not verify the Google sign-in endpoint.',
                  ),
                );
              if (task.cancelled) return;
              await this.openBrowser(url.href);
              opened = true;
            }
          }
          await delay(300);
        }
        if (task.cancelled) return;
        if (!output)
          throw Error(
            t(
              'Google認証がタイムアウトしました。取り消して追加し直してください。',
              'Google sign-in timed out. Cancel it and add the account again.',
            ),
          );
        if (output.Error)
          throw Error(
            t(
              'Google認証を完了できませんでした。取り消して再試行してください。',
              'Google sign-in could not finish. Cancel it and try again.',
            ),
          );
        if (!output.State) {
          account.state = 'ready';
          account.detail = undefined;
          account.writable = true;
          return;
        }
        const answer =
          output.Option?.Name === 'config_is_local'
            ? 'true'
            : output.Option?.Name === 'config_change_team_drive'
              ? 'false'
              : undefined;
        if (answer === undefined)
          throw Error(
            t(
              'このrcloneバージョンの認証手順に未対応です。',
              "This rclone version's sign-in steps are not supported.",
            ),
          );
        method = 'config/update';
        opt = {
          nonInteractive: true,
          noOutput: true,
          continue: true,
          state: output.State,
          result: answer,
        };
      }
      throw Error(t('認証手順の上限に達しました。', 'The sign-in reached its step limit.'));
    } catch (error) {
      account.state = 'incomplete';
      account.detail = (error as Error).message;
      if (task.jobId !== undefined)
        await this.rpc.call('job/stop', { jobid: task.jobId }).catch(() => {});
      await this.rpc.call('config/oauthstop').catch(() => {});
    } finally {
      if (!task.cancelled)
        await this.persist().catch(() => {
          account.state = 'incomplete';
          account.detail = t(
            '認証状態を端末に保存できませんでした。',
            'Could not save the sign-in state on this device.',
          );
        });
      if (this.active === task) this.active = undefined;
    }
  }
  /**
   * Signs an existing account in again with permission to change files. The remote
   * keeps its name, so the connections bound to the account keep working afterwards.
   */
  async reauthorize(id: string) {
    await this.init();
    if (this.active)
      throw Error(
        t(
          '進行中のアカウント認証を完了または取り消してください。',
          'Finish or cancel the account sign-in in progress.',
        ),
      );
    if (!this.configured)
      throw Error(
        t(
          'このビルドにはGoogleログイン設定がありません。配布用OAuth設定が必要です。',
          'This build has no Google sign-in configuration. A distribution OAuth configuration is required.',
        ),
      );
    const account = this.get(id);
    const previous = { ...account };
    account.state = 'authorizing';
    account.detail = undefined;
    const task: AuthTask = { id, cancelled: false, again: true };
    this.active = task;
    try {
      await this.persist();
    } catch (error) {
      Object.assign(account, previous);
      this.active = undefined;
      throw error;
    }
    task.done = this.authorize(account, task);
  }
  /** Signed in and allowed to change files. */
  async writable(id: string) {
    await this.init();
    const account = this.get(id);
    return account.state === 'ready' && account.writable === true;
  }
  async cancel(id: string) {
    await this.init();
    const account = this.get(id);
    if (account.state === 'ready')
      throw Error(
        t(
          '認証済みアカウントはこの操作では削除できません。',
          'A signed-in account cannot be removed this way.',
        ),
      );
    if (this.active && this.active.id !== id)
      throw Error(
        t('進行中の認証を先に完了してください。', 'Finish the sign-in in progress first.'),
      );
    const task = this.active;
    if (task) {
      task.cancelled = true;
      if (task.jobId !== undefined)
        await this.rpc.call('job/stop', { jobid: task.jobId }).catch(() => {});
      await this.rpc.call('config/oauthstop').catch(() => {});
      await task.done;
    }
    if (task?.again) {
      // The account stays with its bindings; only the new sign-in is abandoned.
      account.state = 'incomplete';
      account.detail = t(
        '再ログインを取り消しました。もう一度「再ログイン」を押すと続けられます。',
        'Signing in again was cancelled. Press “Sign in again” to continue.',
      );
      if (this.active === task) this.active = undefined;
      await this.persist();
      return;
    }
    await this.rpc.call('config/delete', { name: this.remote(id) });
    this.accounts = this.accounts.filter((item) => item.id !== id);
    await this.persist();
  }
  async filesystem(accountId: string, folderId = 'root', driveId?: string) {
    await this.init();
    if (this.get(accountId).state !== 'ready')
      throw Error(
        t('アカウントのログインを完了してください。', 'Finish signing in to the account.'),
      );
    providerId.parse(folderId);
    if (driveId) providerId.parse(driveId);
    return {
      _name: this.remote(accountId),
      root_folder_id: folderId === 'root' ? (driveId ?? '') : folderId,
      team_drive: driveId ?? '',
    };
  }
  async remove(id: string) {
    await this.init();
    if (this.active)
      throw Error(
        t(
          '進行中のアカウント認証を完了または取り消してください。',
          'Finish or cancel the account sign-in in progress.',
        ),
      );
    if (this.get(id).state !== 'ready')
      throw Error(t('未完了の認証は取り消してください。', 'Cancel the unfinished sign-in.'));
    await this.rpc.call('config/delete', { name: this.remote(id) });
    this.accounts = this.accounts.filter((item) => item.id !== id);
    await this.persist();
  }
  async drives(id: string): Promise<CloudFolder[]> {
    const fs = await this.filesystem(id);
    const value = await this.rpc.call('backend/command', {
      fs,
      command: 'drives',
      arg: [],
      opt: {},
    });
    const drives = z
      .array(z.object({ id: providerId, name: z.string() }))
      .max(4000)
      .parse(value.result);
    return [
      { id: 'root', name: t('マイドライブ', 'My Drive') },
      ...drives.map((item) => ({ ...item, driveId: item.id })),
    ];
  }
  async folders(id: string, parentId: string, driveId?: string): Promise<CloudFolder[]> {
    const fs = await this.filesystem(id, parentId, driveId);
    const value = await this.rpc.call('operations/list', {
      fs,
      remote: '',
      opt: { dirsOnly: true, recurse: false },
    });
    return entriesSchema
      .max(4000)
      .parse(value.list)
      .filter((item) => item.IsDir)
      .map((item) => ({ id: item.ID, name: item.Name, parentId, ...(driveId ? { driveId } : {}) }));
  }
  async verify(id: string, folder: CloudFolder) {
    if (!folder.parentId)
      throw Error(
        t(
          'フォルダ一覧からマウントするフォルダを選択してください。',
          'Choose the folder to mount from the folder list.',
        ),
      );
    const items = await this.folders(id, folder.parentId, folder.driveId);
    if (!items.some((item) => item.id === folder.id))
      throw Error(
        t(
          '選択したフォルダの識別情報を確認できません。移動・削除・アクセス権を確認してください。',
          'Could not verify the selected folder. Check whether it was moved or deleted, and its access rights.',
        ),
      );
  }
  async close() {
    if (this.active) {
      const task = this.active;
      task.cancelled = true;
      if (task.jobId !== undefined)
        await this.rpc.call('job/stop', { jobid: task.jobId }).catch(() => {});
      await this.rpc.call('config/oauthstop').catch(() => {});
      await task.done;
    }
  }
}
