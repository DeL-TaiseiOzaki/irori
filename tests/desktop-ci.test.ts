import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { uiSmokeGroups } from '../scripts/run-ui-smokes';

const project = process.cwd();

function fixture(t: TestContext) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'irori CI fixture '));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const write = (file: string, content: string) => writeFileSync(path.join(cwd, file), content);
  const commit = (name: string) => {
    git('add', '-A');
    git('commit', '-qm', name);
    return git('rev-parse', 'HEAD');
  };

  git('init', '-qb', 'main');
  git('config', 'user.email', 'desktop-ci@example.test');
  git('config', 'user.name', 'Desktop CI fixture');
  mkdirSync(path.join(cwd, 'docs'));
  mkdirSync(path.join(cwd, 'docs', 'releases'));
  mkdirSync(path.join(cwd, 'scripts'));
  write('docs/STATUS.md', '# Status\n');
  write('docs/HANDOFF.md', '# Handoff\n');
  write('docs/THIRD_PARTY_NOTICES.md', '# Notices\n');
  copyFileSync(
    path.join(project, 'scripts/release-policy.ts'),
    path.join(cwd, 'scripts/release-policy.ts'),
  );
  const published = commit('Published preview');
  git('tag', 'v0.1.0-preview.1');
  const output = path.join(cwd, '.git', 'ci-output');
  const summary = path.join(cwd, '.git', 'ci-summary');

  const plan = (event: string, eventEnv: NodeJS.ProcessEnv) => {
    writeFileSync(output, '');
    execFileSync('bash', [path.join(project, '.github/ci/plan.sh')], {
      cwd,
      env: {
        ...process.env,
        PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}`,
        GITHUB_EVENT_NAME: event,
        GITHUB_REF: 'refs/heads/main',
        GITHUB_SHA: git('rev-parse', 'HEAD'),
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
        ...eventEnv,
      },
    });
    return readFileSync(output, 'utf8').trim();
  };

  return { cwd, git, write, commit, published, plan };
}

test('every Electron UI smoke is in exactly one CI group', () => {
  const scripts = readdirSync(path.join(project, 'scripts'));
  const expected = scripts
    .filter((name) => name === 'ui-smoke.ts' || name.endsWith('-ui-smoke.ts'))
    .map((name) => `scripts/${name}`)
    .sort();
  assert.equal(uiSmokeGroups.length, 3);
  assert.deepEqual(uiSmokeGroups.flat().sort(), expected);
});

const bashFixtures = { skip: process.platform === 'win32' && 'CI plan runs on Linux' };

test(
  'the lightweight PR route uses the tested merge and only regular record edits',
  bashFixtures,
  (t) => {
    const { git, write, commit, published, plan } = fixture(t);
    const mergeRequest = () => {
      const head = git('rev-parse', 'HEAD');
      git('switch', '-q', 'main');
      git('merge', '-q', '--no-ff', 'topic');
      return { PR_BASE_REF: 'main', PR_BASE_SHA: published, PR_HEAD_SHA: head };
    };

    git('switch', '-qc', 'topic');
    write('docs/STATUS.md', '# Status\n\nRecord the published preview.\n');
    commit('Update status');
    const pr = mergeRequest();
    assert.equal(plan('pull_request', pr), 'mode=record-only');
    assert.equal(plan('pull_request', { ...pr, PR_HEAD_SHA: published }), 'mode=full');
    assert.equal(plan('pull_request', { ...pr, PR_BASE_REF: 'other' }), 'mode=full');

    git('reset', '-q', '--hard', published);
    git('switch', '-q', 'topic');
    write('docs/THIRD_PARTY_NOTICES.md', '# Notices\n\nNew distribution dependency.\n');
    commit('Update bundled notices');
    assert.equal(plan('pull_request', mergeRequest()), 'mode=full');
  },
);

test(
  'main keeps a full run when a preview is due or diff evidence is missing',
  bashFixtures,
  (t) => {
    const { git, write, commit, published, plan } = fixture(t);
    write('docs/HANDOFF.md', '# Handoff\n\nRecord the published preview.\n');
    const record = commit('Update handoff');
    assert.equal(plan('push', { PUSH_BEFORE: published }), 'mode=record-only');
    assert.equal(plan('push', { PUSH_BEFORE: '0'.repeat(40) }), 'mode=full');
    assert.equal(plan('workflow_dispatch', {}), 'mode=full');

    write('package.json', '{"version":"0.1.1"}\n');
    write('package-lock.json', '{"version":"0.1.1","packages":{"":{"version":"0.1.1"}}}\n');
    write('docs/releases/0.1.1-preview.1.md', '# A new preview\n');
    const shipping = commit('Change the package');
    write('docs/STATUS.md', '# Status\n\nUpdate the record.\n');
    const nextRecord = commit('Update status');
    assert.equal(plan('push', { PUSH_BEFORE: shipping }), 'mode=full');

    git('tag', 'v0.1.1-preview.1', shipping);
    assert.equal(plan('push', { PUSH_BEFORE: shipping }), 'mode=record-only');
    assert.equal(plan('push', { PUSH_BEFORE: record }), 'mode=full');
    assert.equal(plan('push', { PUSH_BEFORE: nextRecord }), 'mode=full');
  },
);
