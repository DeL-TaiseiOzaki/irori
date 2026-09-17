// Keeps main and the published preview in step (docs/DISTRIBUTION.md). It decides whether a
// change reaches the desktop package, requires such a pull request to carry a new version and
// its release notes, and reports how long main has held a shipped change without a release.
// Plain Node runs it with type stripping, so CI needs no dependency install.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Paths that never reach the package or the build that produces it. Anything else, including
// a path added after this list was written, counts as shipped: publishing a release that was
// not strictly needed costs less than leaving a changed application unpublished.
const notShipped = [
  /^docs\/(?!THIRD_PARTY_NOTICES\.md$)/,
  /^tests\//,
  /^website\//,
  /^\.github\/(?!workflows\/app\.yml$)/,
  /^scripts\/[^/]+-smoke\.ts$/,
  /^scripts\/(real-agents|lifecycle-agents|preview-vm|process-metrics|release-policy)\.ts$/,
  /^scripts\/(preview-vm\.html|record-evidence\.mjs|start\.mjs)$/,
  /^(README(\.[a-z]+)?\.md|AGENTS\.md|CLAUDE\.md|\.gitignore|\.prettierrc\.json)$/,
];

export function shipped(path: string): boolean {
  return !notShipped.some((pattern) => pattern.test(path));
}

export type Core = [number, number, number];
const corePattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const previewTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-preview\.(0|[1-9]\d*)$/;

export function parseCore(version: unknown): Core | undefined {
  const match = typeof version === 'string' ? corePattern.exec(version) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

export function compareCore(a: Core, b: Core): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export function latestPreview(
  tags: string[],
): { tag: string; core: Core; preview: number } | undefined {
  let latest: { tag: string; core: Core; preview: number } | undefined;
  for (const tag of tags) {
    const match = previewTagPattern.exec(tag.trim());
    if (!match) continue;
    const core: Core = [Number(match[1]), Number(match[2]), Number(match[3])];
    const preview = Number(match[4]);
    const order = latest ? compareCore(core, latest.core) || preview - latest.preview : 1;
    if (order > 0) latest = { tag: tag.trim(), core, preview };
  }
  return latest;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function fileAt(cwd: string, revision: string, path: string): string | undefined {
  try {
    return git(cwd, ['show', `${revision}:${path}`]);
  } catch {
    return undefined;
  }
}

function changedPaths(cwd: string, from: string, to: string): string[] {
  return git(cwd, ['diff', '--name-only', '--no-renames', from, to]).split('\n').filter(Boolean);
}

function listed(paths: string[]): string[] {
  const shown = paths.slice(0, 20).map((path) => `- \`${path}\``);
  return paths.length > 20 ? [...shown, `- and ${paths.length - 20} more`] : shown;
}

export interface Report {
  ok: boolean;
  lines: string[];
  outputs: Record<string, string>;
}

/** A pull request that changes what ships must be publishable as soon as it merges. */
export function checkPullRequest(cwd: string, base: string, head: string): Report {
  const mergeBase = git(cwd, ['merge-base', base, head]).trim();
  const reaching = changedPaths(cwd, mergeBase, head).filter(shipped);
  if (!reaching.length)
    return { ok: true, lines: ['No change reaches the desktop package.'], outputs: {} };

  const problems: string[] = [];
  const read = (path: string) => {
    try {
      return JSON.parse(fileAt(cwd, head, path) ?? 'null');
    } catch {
      return null;
    }
  };
  const version = read('package.json')?.version;
  const lock = read('package-lock.json');
  const core = parseCore(version);
  if (!core) problems.push(`\`package.json\` version \`${version}\` is not a plain x.y.z version.`);
  if (lock?.version !== version || lock?.packages?.['']?.version !== version)
    problems.push('`package-lock.json` does not carry the same version as `package.json`.');
  const latest = latestPreview(git(cwd, ['tag', '--list', 'v*']).split('\n'));
  if (core && latest && compareCore(core, latest.core) <= 0)
    problems.push(
      `\`package.json\` is \`${version}\`, but \`${latest.tag}\` is already published. ` +
        'Advance the version: the update check never offers a newer preview of the version a reader already runs.',
    );
  const notes = `docs/releases/${version}-preview.1.md`;
  const text = fileAt(cwd, head, notes);
  if (text === undefined)
    problems.push(`\`${notes}\` is missing. Write the notes this version will be published with.`);
  else if (!/^# \S/.test(text))
    problems.push(`\`${notes}\` must start with a \`# \` title; it becomes the release title.`);

  return {
    ok: problems.length === 0,
    lines: [
      'These changes reach the desktop package:',
      ...listed(reaching),
      '',
      problems.length
        ? 'This pull request cannot be published as it stands:'
        : `It will be published as \`v${version}-preview.1\`.`,
      ...problems.map((problem) => `- ${problem}`),
    ],
    outputs: {},
  };
}

/** How long main has held a shipped change that no published preview contains. */
export function checkDrift(cwd: string, ref: string, now: number, graceMinutes: number): Report {
  const latest = latestPreview(git(cwd, ['tag', '--list', 'v*']).split('\n'));
  if (!latest) return { ok: false, lines: ['No published preview tag exists.'], outputs: {} };
  const outputs = { tag: latest.tag, state: 'error' };
  const released = git(cwd, ['rev-list', '-n', '1', latest.tag]).trim();
  try {
    git(cwd, ['merge-base', '--is-ancestor', released, ref]);
  } catch {
    return { ok: false, lines: [`\`${latest.tag}\` is not on \`${ref}\`.`], outputs };
  }
  const commits = git(cwd, ['rev-list', '--first-parent', '--reverse', `${released}..${ref}`])
    .split('\n')
    .filter(Boolean);
  const reaching = changedPaths(cwd, released, ref).filter(shipped);
  const first = commits.find((commit) =>
    changedPaths(cwd, `${commit}^1`, commit).some((path) => shipped(path)),
  );
  if (!first || !reaching.length) {
    outputs.state = 'in-sync';
    return { ok: true, lines: [`\`${ref}\` is in step with \`${latest.tag}\`.`], outputs };
  }
  const since = Number(git(cwd, ['log', '-1', '--format=%ct', first]).trim()) * 1000;
  const minutes = Math.floor((now - since) / 60000);
  outputs.state = minutes > graceMinutes ? 'overdue' : 'pending';
  return {
    ok: outputs.state === 'pending',
    lines: [
      `\`${ref}\` holds changes that reach the desktop package and are not in \`${latest.tag}\`, ` +
        `first merged ${minutes} minutes ago in \`${first.slice(0, 7)}\`:`,
      ...listed(reaching),
      '',
      outputs.state === 'pending'
        ? `That is within the ${graceMinutes}-minute grace period for publishing.`
        : `That is past the ${graceMinutes}-minute grace period. Publish the version on \`${ref}\` (docs/DISTRIBUTION.md).`,
    ],
    outputs,
  };
}

function publish(report: Report) {
  const text = report.lines.join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
  if (process.env.GITHUB_OUTPUT)
    for (const [key, value] of Object.entries(report.outputs))
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const grace = Number(
    rest.find((arg) => arg.startsWith('--grace-minutes='))?.split('=')[1] ?? '60',
  );
  const positional = rest.filter((arg) => !arg.startsWith('--'));
  if (command === 'pr' && positional.length === 2)
    publish(checkPullRequest(process.cwd(), positional[0], positional[1]));
  else if (command === 'drift')
    publish(checkDrift(process.cwd(), positional[0] ?? 'origin/main', Date.now(), grace));
  else {
    console.error(
      'Usage: node scripts/release-policy.ts pr <base> <head> | drift [ref] [--grace-minutes=60]',
    );
    process.exitCode = 2;
  }
}
