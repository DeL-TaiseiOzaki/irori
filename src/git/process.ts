import type { ChildProcess } from 'node:child_process';
import { agentEnv, launch, killTree } from '../agents/process';

export class GitError extends Error {
  constructor(
    readonly code: number | null,
    diagnostic: string,
  ) {
    const hint = /non-fast-forward|fetch first|rejected/i.test(diagnostic)
      ? 'リモートに受け付けられませんでした。取得して履歴を確認してください。保護ブランチでは pull request が必要な場合があります。'
      : /authentication|permission denied|could not read Username|publickey|terminal prompts disabled/i.test(
            diagnostic,
          )
        ? 'Git の認証・アクセス権を確認してから再試行してください。既存の認証ヘルパー・SSH 設定を使用します。'
        : /unable to auto-detect email|author identity unknown/i.test(diagnostic)
          ? 'Git に commit の作成者名とメールアドレスを設定してください。'
          : /index.lock|another git process/i.test(diagnostic)
            ? '別の Git 操作が実行中です。完了後に再試行してください。'
            : /could not resolve|unable to access|connection|repository not found/i.test(diagnostic)
              ? '接続先・ネットワーク・アクセス権を確認してから再試行してください。'
              : 'Git 操作が完了しませんでした。変更一覧を更新し、Git の設定・フック・署名設定を確認してください。';
    // Git diagnostics may contain credential-bearing URLs, helper output and machine paths.
    super(hint);
  }
}

export class GitProcess {
  private children = new Set<ChildProcess>();
  async run(
    cwd: string,
    args: string[],
    options: { input?: string; network?: boolean; codes?: number[]; inspection?: boolean } = {},
  ) {
    const env = agentEnv();
    for (const key of Object.keys(env))
      if (
        key.startsWith('GIT_') &&
        (options.inspection ||
          ![
            'GIT_SSH',
            'GIT_SSH_COMMAND',
            'GIT_ASKPASS',
            'GIT_CONFIG_GLOBAL',
            'GIT_CONFIG_SYSTEM',
            'GIT_CONFIG_NOSYSTEM',
          ].includes(key))
      )
        delete env[key];
    env.GIT_TERMINAL_PROMPT = '0';
    env.GIT_OPTIONAL_LOCKS = '0';
    env.GIT_MERGE_AUTOEDIT = 'no';
    env.GIT_PAGER = 'cat';
    env.LC_ALL = 'C';
    const child = launch(
      'git',
      ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'color.ui=false', ...args],
      cwd,
      env,
    );
    this.children.add(child);
    const limit = (options.inspection ? 1 : 4) * 1024 * 1024;
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0,
        diagnostic = '',
        failure: Error | undefined;
      let stopping: Promise<void> | undefined;
      const stop = (error: Error) => {
        failure ??= error;
        stopping ??= killTree(child);
        void stopping.catch(() => {});
      };
      const timer = setTimeout(
        () => stop(Error('Git 操作が時間切れになりました。状態を更新して結果を確認してください。')),
        options.inspection ? 8000 : options.network ? 90000 : 30000,
      );
      child.stdout?.on('data', (bytes: Buffer) => {
        size += bytes.length;
        if (size > limit) stop(Error('Git の表示上限を超えました。対象を絞ってください。'));
        else chunks.push(bytes);
      });
      child.stderr?.on('data', (bytes: Buffer) => {
        diagnostic = (diagnostic + bytes.toString()).slice(-16000);
      });
      child.stdin?.on('error', () => {});
      child.on('error', () => {
        failure ??= Error('Git を起動できません。インストールと実行権限を確認してください。');
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        void (async () => {
          await stopping;
          if (failure) throw failure;
          if (!(options.codes ?? [0]).includes(code ?? -1)) throw new GitError(code, diagnostic);
          return Buffer.concat(chunks).toString('utf8');
        })()
          .finally(() => this.children.delete(child))
          .then(resolve, reject);
      });
      child.stdin?.end(options.input);
    });
  }
  async close() {
    await Promise.all([...this.children].map(killTree));
  }
}
