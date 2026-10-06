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
  private async run(
    args: string[],
    {
      timeout = 30000,
      input,
      forbidden,
    }: { timeout?: number; input?: string; forbidden?: string } = {},
  ) {
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
      child.stdin?.end(input);
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
          if (code !== 0) throw ghError(diagnostic || output, forbidden);
          return output;
        })()
          .finally(() => this.children.delete(child))
          .then(resolve, reject);
      });
    });
  }
  /** The signed-in account's name. */
  async login(): Promise<string> {
    const login = (await this.run(['api', 'user', '--jq', '.login'])).trim();
    if (!githubOwnerPattern.test(login))
      throw Error(
        t('GitHub のアカウントを確認できません。', 'Could not determine the GitHub account.'),
      );
    return login;
  }
  /** The signed-in account and the organizations it belongs to. */
  async account(): Promise<GitHubAccount> {
    const login = await this.login();
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
      { timeout: 90000, forbidden: cannotCreate() },
    );
    return repository;
  }
  /** Whether `owner/name` exists for the account and is private; undefined when it does not. */
  async repository(repository: string): Promise<{ private: boolean } | undefined> {
    const answer = await this.found(['api', `repos/${repository}`, '--jq', '.private']);
    return answer === undefined ? undefined : { private: answer.trim() === 'true' };
  }
  /** Creates a private repository of the signed-in account, with a first commit to write to. */
  async createPrivate(name: string, description: string) {
    if (!validRepositoryName(name))
      throw Error(t('リポジトリ名が無効です。', 'The repository name is invalid.'));
    await this.run(
      [
        'api',
        '-X',
        'POST',
        'user/repos',
        '-f',
        `name=${name}`,
        '-F',
        'private=true',
        '-F',
        'auto_init=true',
        '-f',
        `description=${description}`,
      ],
      { timeout: 90000, forbidden: cannotCreate() },
    );
  }
  /** A file of a repository's default branch with its blob sha; undefined when absent. */
  async readFile(repository: string, file: string) {
    const answer = await this.found([
      'api',
      `repos/${repository}/contents/${file}`,
      '--jq',
      '{sha: .sha, encoding: .encoding, content: .content}',
    ]);
    if (answer === undefined) return undefined;
    const { sha, encoding, content } = JSON.parse(answer) as {
      sha: string;
      encoding: string;
      content: string;
    };
    // GitHub gives no content for a file over 1 MB; irori never writes one that large.
    if (encoding !== 'base64' || typeof content !== 'string')
      throw Error(t(`${file} を読み込めません。`, `Could not read ${file}.`));
    return { sha, text: Buffer.from(content.replace(/\s/g, ''), 'base64').toString('utf8') };
  }
  /**
   * Writes a file to a repository's default branch as one commit. With `sha`,
   * GitHub refuses when the file changed since it was read.
   */
  async writeFile(repository: string, file: string, text: string, message: string, sha?: string) {
    const body = { message, content: Buffer.from(text, 'utf8').toString('base64'), sha };
    try {
      await this.run(['api', '-X', 'PUT', `repos/${repository}/contents/${file}`, '--input', '-'], {
        input: JSON.stringify(body),
        timeout: 60000,
      });
    } catch (error) {
      if (error instanceof GitHubError && /HTTP 409|does not match|is at/i.test(error.diagnostic))
        throw Error(
          t(
            '保存の途中で、別の端末が先に保存しました。読み込み直してからもう一度保存してください。',
            'Another device saved first. Load it again, then save.',
          ),
        );
      throw error;
    }
  }
  /** A `gh api` answer, or undefined when GitHub answers 404. */
  private async found(args: string[]) {
    try {
      return await this.run(args);
    } catch (error) {
      if (error instanceof GitHubError && /HTTP 404/.test(error.diagnostic)) return undefined;
      throw error;
    }
  }
  async close() {
    await Promise.all([...this.children].map(killTree));
  }
}

/** A failed gh call, keeping what gh said for callers that tell answers apart. */
class GitHubError extends Error {
  constructor(
    message: string,
    readonly diagnostic: string,
  ) {
    super(message);
  }
}

const cannotCreate = () =>
  t(
    'この GitHub アカウントには、選んだ場所にリポジトリを作成する権限がありません。',
    'This GitHub account cannot create a repository there.',
  );

function ghError(diagnostic: string, forbidden?: string) {
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
        ? (forbidden ??
          t(
            'この GitHub アカウントでは、この操作が許可されていません。',
            'This GitHub account is not allowed to do this.',
          ))
        : t('GitHub での操作が完了しませんでした。', 'The GitHub operation did not complete.');
  const detail = gitDetail(diagnostic);
  return new GitHubError(detail ? `${hint}\n\n${detail}` : hint, diagnostic);
}
