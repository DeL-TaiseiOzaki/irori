import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CloudAccount, CloudFolder } from '../domain/types';
import { providerId } from '../domain/connections';
import { readLocalJson, writeLocalJson } from '../host/local-json';
import type { RcloneAPI } from './rclone';
import type { GoogleOAuth } from './oauth';
const accountSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  provider: z.literal('google-drive'),
  state: z.enum(['authorizing', 'ready', 'incomplete']),
  detail: z.string().optional(),
});
const entriesSchema = z.array(z.object({ ID: providerId, Name: z.string(), IsDir: z.boolean() }));
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
type AuthTask = { id: string; cancelled: boolean; done?: Promise<void>; jobId?: number };
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
    if (!account) throw Error('登録されていないクラウドアカウントです。');
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
            account.detail = '前回の認証が完了していません。取り消して追加し直してください。';
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
    if (this.active) throw Error('進行中のアカウント認証を完了または取り消してください。');
    if (!this.configured)
      throw Error('このビルドにはGoogleログイン設定がありません。配布用OAuth設定が必要です。');
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
        scope: 'drive.readonly',
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
                'Google認証を完了できませんでした。ログインを取り消して再試行してください。',
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
                throw Error('Google認証の接続先を確認できません。');
              if (task.cancelled) return;
              await this.openBrowser(url.href);
              opened = true;
            }
          }
          await delay(300);
        }
        if (task.cancelled) return;
        if (!output)
          throw Error('Google認証がタイムアウトしました。取り消して追加し直してください。');
        if (output.Error)
          throw Error('Google認証を完了できませんでした。取り消して再試行してください。');
        if (!output.State) {
          account.state = 'ready';
          account.detail = undefined;
          return;
        }
        const answer =
          output.Option?.Name === 'config_is_local'
            ? 'true'
            : output.Option?.Name === 'config_change_team_drive'
              ? 'false'
              : undefined;
        if (answer === undefined) throw Error('このrcloneバージョンの認証手順に未対応です。');
        method = 'config/update';
        opt = {
          nonInteractive: true,
          noOutput: true,
          continue: true,
          state: output.State,
          result: answer,
        };
      }
      throw Error('認証手順の上限に達しました。');
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
          account.detail = '認証状態を端末に保存できませんでした。';
        });
      if (this.active === task) this.active = undefined;
    }
  }
  async cancel(id: string) {
    await this.init();
    const account = this.get(id);
    if (account.state === 'ready') throw Error('認証済みアカウントはこの操作では削除できません。');
    if (this.active && this.active.id !== id) throw Error('進行中の認証を先に完了してください。');
    const task = this.active;
    if (task) {
      task.cancelled = true;
      if (task.jobId !== undefined)
        await this.rpc.call('job/stop', { jobid: task.jobId }).catch(() => {});
      await this.rpc.call('config/oauthstop').catch(() => {});
      await task.done;
    }
    await this.rpc.call('config/delete', { name: this.remote(id) });
    this.accounts = this.accounts.filter((item) => item.id !== id);
    await this.persist();
  }
  async filesystem(accountId: string, folderId = 'root', driveId?: string) {
    await this.init();
    if (this.get(accountId).state !== 'ready')
      throw Error('アカウントのログインを完了してください。');
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
    if (this.active) throw Error('進行中のアカウント認証を完了または取り消してください。');
    if (this.get(id).state !== 'ready') throw Error('未完了の認証は取り消してください。');
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
      { id: 'root', name: 'マイドライブ' },
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
    if (!folder.parentId) throw Error('フォルダ一覧からマウントするフォルダを選択してください。');
    const items = await this.folders(id, folder.parentId, folder.driveId);
    if (!items.some((item) => item.id === folder.id))
      throw Error(
        '選択したフォルダの識別情報を確認できません。移動・削除・アクセス権を確認してください。',
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
