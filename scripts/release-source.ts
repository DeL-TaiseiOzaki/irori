// Names the commit a preview is published from and the Verify and package run whose artifacts
// it carries (docs/DISTRIBUTION.md). A pull request's run builds GitHub's test merge of the
// branch into main. When the merge commit main received has the same tree, that run already
// verified and packaged main's exact source, so a release need not wait for main to rebuild it.
// Any other case, such as main moving between the run and the merge, is refused and main's own
// run publishes instead.
// Plain Node runs it with type stripping, so CI needs no dependency install.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Api = (path: string) => any;
export type Git = (...args: string[]) => string;

export interface Source {
  /** The commit on main the release is tagged at. */
  commit: string;
  /** The commit the run built: `commit` itself, or the pull request's test merge. */
  built: string;
  tree: string;
  pullRequest?: number;
}

// app.yml names each package artifact after the platform, the architecture and github.sha.
const artifactPattern = /^unsigned-irori-[a-z0-9]+-[a-z0-9]+-([0-9a-f]{40})$/;

export function builtCommit(names: string[]): string {
  const commits = new Set(names.flatMap((name) => artifactPattern.exec(name)?.slice(1) ?? []));
  if (commits.size !== 1)
    throw new Error(`Expected the package artifacts of one commit, found ${commits.size}`);
  return [...commits][0];
}

export function resolveRun(repo: string, runId: string, api: Api, git: Git): Source {
  const run = api(`repos/${repo}/actions/runs/${runId}`);
  if (run.status !== 'completed') throw new Error(`Run ${runId} is not completed`);
  if (run.conclusion !== 'success') throw new Error(`Run ${runId} did not succeed`);
  if (run.path !== '.github/workflows/app.yml')
    throw new Error(`Run ${runId} is not a verify and package run`);
  if (run.head_repository?.full_name !== repo)
    throw new Error(`Run ${runId} built a branch outside ${repo}`);
  const artifacts = api(`repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`).artifacts;
  const built = builtCommit(
    artifacts.filter((item: any) => !item.expired).map((item: any) => item.name),
  );

  let commit: string;
  let pullRequest: number | undefined;
  if (run.event === 'pull_request') {
    // Only the head the run built counts: an earlier run of the same pull request tested
    // other source, even if the pull request merged later.
    const merged = api(`repos/${repo}/commits/${run.head_sha}/pulls`).filter(
      (pull: any) => pull.merged_at && pull.base.ref === 'main' && pull.head.sha === run.head_sha,
    );
    if (merged.length !== 1)
      throw new Error(`Run ${runId} built ${run.head_sha}, which no pull request merged into main`);
    commit = merged[0].merge_commit_sha;
    pullRequest = merged[0].number;
  } else {
    if (built !== run.head_sha)
      throw new Error(`Run ${runId} packaged ${built}, not its own commit ${run.head_sha}`);
    commit = run.head_sha;
  }

  // The published bytes must come from a commit that is actually on main.
  try {
    git('merge-base', '--is-ancestor', commit, 'origin/main');
  } catch {
    throw new Error(`${commit} is not on main`);
  }
  const tree = git('rev-parse', `${commit}^{tree}`);
  const builtTree = built === commit ? tree : api(`repos/${repo}/git/commits/${built}`).tree.sha;
  if (builtTree !== tree)
    throw new Error(
      `Run ${runId} packaged tree ${builtTree}, but ${commit} on main has tree ${tree}. ` +
        "main changed after the run; publish from main's own run.",
    );
  return { commit, built, tree, pullRequest };
}

/** The latest successful run of the pull request merged as `commit`, if any. */
export function findPullRequestRun(repo: string, commit: string, api: Api): string | undefined {
  const pulls = api(`repos/${repo}/commits/${commit}/pulls`).filter(
    (pull: any) => pull.merge_commit_sha === commit && pull.base.ref === 'main',
  );
  if (pulls.length !== 1) return undefined;
  const runs = api(
    `repos/${repo}/actions/workflows/app.yml/runs?event=pull_request&status=success` +
      `&head_sha=${pulls[0].head.sha}&per_page=1`,
  ).workflow_runs;
  return runs[0] ? String(runs[0].id) : undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, argument] = process.argv.slice(2);
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  const api: Api = (path) =>
    JSON.parse(
      execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    );
  const git: Git = (...args) =>
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const output = (values: Record<string, string>) => {
    if (process.env.GITHUB_OUTPUT)
      for (const [key, value] of Object.entries(values))
        appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  };
  try {
    if (!repo || !argument) throw new Error('Set GITHUB_REPOSITORY and name a run or commit');
    if (command === 'resolve') {
      const source = resolveRun(repo, argument, api, git);
      console.log(
        `Run ${argument} packaged ${source.built}` +
          (source.pullRequest ? ` for pull request #${source.pullRequest}` : '') +
          `; main's ${source.commit} has the same tree ${source.tree}.`,
      );
      output({
        commit: source.commit,
        built: source.built,
        tree: source.tree,
        pull_request: source.pullRequest ? String(source.pullRequest) : '',
      });
    } else if (command === 'find') {
      // The run id alone on stdout, empty when there is none, so a shell can capture it.
      console.log(findPullRequestRun(repo, argument, api) ?? '');
    } else {
      console.error('Usage: node scripts/release-source.ts resolve <run-id> | find <commit>');
      process.exitCode = 2;
    }
  } catch (error) {
    // stderr, so the reason still shows when a shell captures stdout (`run=$(... find ...)`).
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
