import type { ChildProcess } from 'node:child_process';
import { agentEnv, killTree, launch } from '../agents/process';
import { t } from '../domain/i18n';
import {
  githubOwnerPattern,
  validRepositoryName,
  type GitHubAccount,
  type PublishRepository,
} from '../domain/git';
import { findGitHubCli, gitDetail } from './process';

const signedOut = /gh auth login|not logged in|authentication required|HTTP 401|bad credentials/i;

/**
 * The GitHub CLI, run for the few account and repository calls irori makes on
 * github.com. gh keeps the token; irori reads only the answers.
 */
export class GitHubCli {
  private children = new Set<ChildProcess>();
  constructor(private find: () => Promise<string | undefined> = () => findGitHubCli()) {}
  private async run(args: string[], timeout = 30000) {
    const gh = await this.find();
    if (!gh)
      throw Error(
        t(
          'GitHub CLI（gh）が見つかりません。gh をインストールし、`gh auth login` でログインしてから再試行してください。',
          'The GitHub CLI (gh) was not found. Install gh, sign in with `gh auth login`, then try again.',
        ),
      );
    const env = agentEnv();
    // Always github.com, never a prompt, a pager, colour or an update check.
    env.GH_HOST = 'github.com';
    env.GH_PROMPT_DISABLED = '1';
    env.GH_NO_UPDATE_NOTIFIER = '1';
    env.GH_PAGER = 'cat';
    env.NO_COLOR = '1';
    env.LC_ALL = 'C';
    const child = launch(gh, args, process.cwd(), env);
    this.children.add(child);
    return new Promise<string>((resolve, reject) => {
      let output = '',
        diagnostic = '',
        failure: Error | undefined;
      let stopping: Promise<void> | undefined;
      const timer = setTimeout(() => {
        failure ??= Error(
          t(
            'GitHub の応答が時間切れになりました。GitHub 上の状態を確認してから再試行してください。',
            'GitHub did not answer in time. Check what exists on GitHub, then try again.',
          ),
        );
        stopping ??= killTree(child);
      }, timeout);
      child.stdout?.on('data', (bytes: Buffer) => {
        output = (output + bytes.toString()).slice(-64000);
      });
      child.stderr?.on('data', (bytes: Buffer) => {
        diagnostic = (diagnostic + bytes.toString()).slice(-16000);
      });
      child.stdin?.on('error', () => {});
      child.stdin?.end();
      child.on('error', () => {
        failure ??= Error(
          t('GitHub CLI（gh）を起動できません。', 'Could not start the GitHub CLI (gh).'),
        );
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        void (async () => {
          await stopping?.catch(() => {});
          if (failure) throw failure;
          if (code !== 0) throw ghError(diagnostic || output);
          return output;
        })()
          .finally(() => this.children.delete(child))
          .then(resolve, reject);
      });
    });
  }
  /** The signed-in account and the organizations it belongs to. */
  async account(): Promise<GitHubAccount> {
    const login = (await this.run(['api', 'user', '--jq', '.login'])).trim();
    if (!githubOwnerPattern.test(login))
      throw Error(
        t('GitHub のアカウントを確認できません。', 'Could not determine the GitHub account.'),
      );
    // Listing organizations needs the read:org scope; without it only the account is offered.
    const organizations = await this.run(['api', 'user/orgs', '--paginate', '--jq', '.[].login'])
      .then((text) =>
        text
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => githubOwnerPattern.test(line) && line !== login),
      )
      .catch(() => [] as string[]);
    return { login, organizations: [...new Set(organizations)].sort() };
  }
  /** How gh clones for this person, so the new remote uses the same transport. */
  async protocol(): Promise<'https' | 'ssh'> {
    const value = await this.run(['config', 'get', 'git_protocol', '--host', 'github.com']).catch(
      () => '',
    );
    return value.trim() === 'ssh' ? 'ssh' : 'https';
  }
  /** Creates an empty repository on GitHub and returns its `owner/name`. */
  async create(input: PublishRepository): Promise<string> {
    if (!githubOwnerPattern.test(input.owner) || !validRepositoryName(input.name))
      throw Error(
        t(
          'GitHub のアカウント名とリポジトリ名を確認してください。リポジトリ名には英数字・「-」「_」「.」を使えます。',
          'Check the GitHub account and repository name. A repository name may use letters, digits, "-", "_" and ".".',
        ),
      );
    const repository = `${input.owner}/${input.name}`;
    await this.run(
      [
        'repo',
        'create',
        repository,
        input.visibility === 'public' ? '--public' : '--private',
        ...(input.description?.trim() ? ['--description', input.description.trim()] : []),
      ],
      90000,
    );
    return repository;
  }
  async close() {
    await Promise.all([...this.children].map(killTree));
  }
}

function ghError(diagnostic: string) {
  const hint = signedOut.test(diagnostic)
    ? t(
        'GitHub CLI（gh）にログインしていません。ターミナルで `gh auth login` を実行してから再試行してください。',
        'The GitHub CLI (gh) is not signed in. Run `gh auth login` in a terminal, then try again.',
      )
    : /name already exists/i.test(diagnostic)
      ? t(
          '同じ名前のリポジトリが GitHub にすでにあります。別の名前を選んでください。',
          'A repository with this name already exists on GitHub. Choose a different name.',
        )
      : /HTTP 403|HTTP 404|not have permission|must be an? (?:owner|admin)|resource not accessible/i.test(
            diagnostic,
          )
        ? t(
            'この GitHub アカウントには、選んだ場所にリポジトリを作成する権限がありません。`gh auth status` でアカウントと権限を確認してください。',
            'This GitHub account cannot create a repository there. Run `gh auth status` to check the account and its permissions.',
          )
        : t(
            'GitHub での操作が完了しませんでした。ネットワークと GitHub の状態を確認してから再試行してください。',
            'The GitHub operation did not complete. Check the network and GitHub, then try again.',
          );
  const detail = gitDetail(diagnostic);
  return Error(detail ? `${hint}\n\n${detail}` : hint);
}
