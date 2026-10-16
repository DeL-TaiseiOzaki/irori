import { promises as fs } from 'node:fs';
import path from 'node:path';
import { GitProcess } from '../git/process';
import { githubRepository } from '../domain/git';
import type { RepositoryUpdate } from '../domain/types';
import { t } from '../domain/i18n';

/** A clone or an update may move a large repository: minutes, not Git's usual 90 seconds. */
const longTimeout = 30 * 60_000;

/**
 * The Git work of a GitHub repository in contents (ADR 046): cloning it on this
 * device, checking that a chosen folder is a clone of it, and bringing a clone up
 * to date. Everything else, commits and pushes among them, is the person's or an
 * agent's, in a terminal.
 */
export class RepositoryGit {
  constructor(
    private process = new GitProcess(),
    /** The transports Git may use for the repository. */
    private protocols = ['https', 'ssh'],
  ) {}
  private transports() {
    return [
      '-c',
      'protocol.allow=never',
      ...this.protocols.flatMap((name) => ['-c', `protocol.${name}.allow=always`]),
    ];
  }
  /**
   * Clones into `destination`, an empty folder. A partial clone: the files of
   * earlier versions are fetched only when something asks for them.
   */
  async clone(url: string, branch: string | undefined, destination: string) {
    await this.process.run(
      path.dirname(destination),
      [
        ...this.transports(),
        'clone',
        '--filter=blob:none',
        '--origin',
        'origin',
        '--no-recurse-submodules',
        ...(branch ? ['--branch', branch] : []),
        '--',
        url,
        destination,
      ],
      { network: true, timeout: longTimeout },
    );
  }
  /** Refuses a folder that is not the top of a clone whose origin is the repository `url` names. */
  async check(folder: string, url: string) {
    const wanted = githubRepository(url)!;
    const refused = () =>
      Error(
        t(
          `このフォルダは ${wanted} のクローンではありません。リポジトリの一番上のフォルダを選んでください。`,
          `This folder is not a clone of ${wanted}. Choose the top folder of its clone.`,
        ),
      );
    let top: string, origin: string;
    try {
      top = (await this.process.run(folder, ['rev-parse', '--show-toplevel'])).trim();
      // As written in its configuration, before any URL rewriting.
      origin = (await this.process.run(folder, ['config', '--get', 'remote.origin.url'])).trim();
    } catch {
      throw refused();
    }
    const [actualTop, actualFolder] = await Promise.all([
      fs.realpath(top).catch(() => top),
      fs.realpath(folder).catch(() => folder),
    ]);
    if (
      actualTop !== actualFolder ||
      githubRepository(origin)?.toLowerCase() !== wanted.toLowerCase()
    )
      throw refused();
  }
  /**
   * Fetches and moves the checked-out branch forward to its upstream. Nothing
   * moves when a tracked file has changes, the branch has its own commits, or
   * no branch is checked out; the error says which.
   */
  async update(folder: string): Promise<RepositoryUpdate> {
    const git = (args: string[], options?: Parameters<GitProcess['run']>[2]) =>
      this.process.run(folder, args, options).then((value) => value.trim());
    const branch = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { codes: [0, 1] });
    if (!branch)
      throw Error(
        t(
          'ブランチを checkout していないため、更新できません。',
          'No branch is checked out, so it cannot be updated.',
        ),
      );
    const upstream = await git(
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{upstream}`],
      { codes: [0, 128] },
    );
    if (!upstream)
      throw Error(
        t(
          `ブランチ ${branch} に追跡するリモートのブランチがありません。`,
          `The branch ${branch} tracks no remote branch.`,
        ),
      );
    if (await git(['status', '--porcelain', '--untracked-files=no', '--ignore-submodules']))
      throw Error(
        t(
          'コミットしていない変更があるため、更新しません。',
          'It has uncommitted changes, so it was not updated.',
        ),
      );
    await git([...this.transports(), 'fetch', '--quiet', '--no-recurse-submodules'], {
      network: true,
      timeout: longTimeout,
    });
    const target = `${branch}@{upstream}`;
    const commits = Number(await git(['rev-list', '--count', `HEAD..${target}`]));
    if (!commits) return { branch, commits: 0 };
    const ahead = Number(await git(['rev-list', '--count', `${target}..HEAD`]));
    if (ahead)
      throw Error(
        t(
          `ブランチ ${branch} にリモートにないコミットがあるため、更新しません。`,
          `The branch ${branch} has commits the remote does not, so it was not updated.`,
        ),
      );
    // Moving forward fetches the files of the new versions, so it may use the network.
    await git([...this.transports(), 'merge', '--ff-only', '--quiet', target], {
      network: true,
      timeout: longTimeout,
    });
    return { branch, commits };
  }
}
