import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { launch, killTree, agentEnv } from '../agents/process';
import { readJson } from '../host/http';
import { t } from '../domain/i18n';
import { UploadFailures, type UploadFailure } from './upload-errors';

export interface RcloneAPI {
  call(method: string, params?: Record<string, unknown>): Promise<any>;
  close(): Promise<void>;
  /** The last uploads rclone reported as failed, oldest first, when the service can tell. */
  uploadFailures?(): UploadFailure[];
}

// Only host services have this API. No method names, credentials or RPC endpoint reach IPC.
export class Rclone implements RcloneAPI {
  private child?: ChildProcess;
  private starting?: Promise<void>;
  private endpoint = '';
  private secret = randomBytes(32).toString('hex');
  private stopped = false;
  private failures = new UploadFailures();
  constructor(
    private dataDir: string,
    private executable = process.env.IRORI_RCLONE_PATH || 'rclone',
  ) {}
  private async start() {
    if (this.stopped)
      throw Error(t('クラウドサービスは終了しました。', 'The cloud service has stopped.'));
    if (this.starting) return this.starting;
    this.starting = this.launch();
    try {
      await this.starting;
    } catch (error) {
      this.starting = undefined;
      throw error;
    }
  }
  private async launch() {
    const dir = path.join(this.dataDir, 'rclone');
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const config = path.join(dir, 'rclone.conf');
    const handle = await fs.open(config, 'a', 0o600);
    await handle.close();
    if (process.platform !== 'win32') await fs.chmod(config, 0o600);
    const env = agentEnv();
    for (const key of Object.keys(env)) if (key.startsWith('RCLONE_')) delete env[key];
    env.RCLONE_RC_USER = 'irori';
    env.RCLONE_RC_PASS = this.secret;
    const child = launch(
      this.executable,
      [
        'rcd',
        '--config',
        config,
        '--rc-addr',
        '127.0.0.1:0',
        '--cache-dir',
        path.join(dir, 'cache'),
        '--log-level',
        'NOTICE',
        '--contimeout',
        '10s',
        '--timeout',
        '30s',
        '--retries',
        '1',
        '--low-level-retries',
        '1',
      ],
      this.dataDir,
      env,
    );
    this.child = child;
    // A new process has a new upload queue; the failures of the old one no longer apply.
    const failures = (this.failures = new UploadFailures());
    child.stdin?.end();
    child.stdout?.resume();
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              Error(t('rcloneの起動がタイムアウトしました。', 'rclone timed out while starting.')),
            ),
          10000,
        );
        let buffer = '';
        const fail = () => {
          clearTimeout(timer);
          reject(
            Error(
              t(
                'rcloneを起動できません。インストールと実行権限を確認してください。',
                'Could not start rclone. Check that it is installed and executable.',
              ),
            ),
          );
        };
        child.once('error', fail);
        child.once('close', fail);
        child.stderr?.on('data', (bytes: Buffer) => {
          // Read only the startup address and upload failures from the log; raw
          // provider lines are never propagated.
          failures.feed(bytes);
          if (this.endpoint) return;
          buffer = (buffer + bytes.toString()).slice(-4096);
          const match = buffer.match(/Serving remote control on (http:\/\/127\.0\.0\.1:\d+)\//);
          if (match) {
            this.endpoint = match[1];
            clearTimeout(timer);
            resolve();
          }
        });
      });
      const identity = await this.request('core/pid', {});
      if (identity.pid !== child.pid)
        throw Error(
          t('クラウドサービスの識別に失敗しました。', 'Could not identify the cloud service.'),
        );
      child.once('close', () => {
        this.endpoint = '';
        this.starting = undefined;
      });
    } catch (error) {
      await killTree(child);
      this.endpoint = '';
      throw error;
    }
  }
  async call(method: string, params: Record<string, unknown> = {}) {
    await this.start();
    return this.request(method, params);
  }
  uploadFailures() {
    return this.failures.list();
  }
  private async request(method: string, params: Record<string, unknown>) {
    try {
      const response = await fetch(`${this.endpoint}/${method}`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic ' + Buffer.from(`irori:${this.secret}`).toString('base64'),
        },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw Error(`rclone request failed (${response.status})`);
      return await readJson(response);
    } catch {
      // RC error bodies can contain credentials, input parameters and machine paths.
      throw Error(
        t(
          'クラウド操作に失敗しました。接続・ログイン状態を確認して再試行してください。',
          'The cloud operation failed. Check the connection and sign-in, then try again.',
        ),
      );
    }
  }
  async close() {
    this.stopped = true;
    await this.starting?.catch(() => {});
    if (this.child) await killTree(this.child);
    this.endpoint = '';
  }
}
