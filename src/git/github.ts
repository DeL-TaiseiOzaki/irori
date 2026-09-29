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
          'GitHub CLI（gh）が見つかりません（インストール後 `gh auth login`）。',
          'The GitHub CLI (gh) was not found (install it, then `gh auth login`).',
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
          t('GitHub の応答が時間切れになりました。', 'GitHub did not answer in time.'),
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
          'GitHub のアカウント名またはリポジトリ名が無効です。',
          'The GitHub account name or repository name is invalid.',
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
        'GitHub CLI（gh）にログインしていません（`gh auth login`）。',
        'The GitHub CLI (gh) is not signed in (`gh auth login`).',
      )
    : /name already exists/i.test(diagnostic)
      ? t(
          '同じ名前のリポジトリが GitHub にすでにあります。',
          'A repository with this name already exists on GitHub.',
        )
      : /HTTP 403|HTTP 404|not have permission|must be an? (?:owner|admin)|resource not accessible/i.test(
            diagnostic,
          )
        ? t(
            'この GitHub アカウントには、選んだ場所にリポジトリを作成する権限がありません。',
            'This GitHub account cannot create a repository there.',
          )
        : t('GitHub での操作が完了しませんでした。', 'The GitHub operation did not complete.');
  const detail = gitDetail(diagnostic);
  return Error(detail ? `${hint}\n\n${detail}` : hint);
}
