import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkDrift, checkPullRequest, latestPreview, shipped } from '../scripts/release-policy';

test('Only paths that cannot reach the package are exempt from a release', () => {
  for (const file of [
    'src/host/updates.ts',
    'index.html',
    'vite.config.ts',
    'tsconfig.json',
    'forge.config.cjs',
    'package.json',
    'package-lock.json',
    'assets/irori-icon.ico',
    'LICENSE',
    'docs/THIRD_PARTY_NOTICES.md',
    'scripts/build-host.mjs',
    'scripts/prepare-rclone.mjs',
    'scripts/rclone.json',
    '.github/workflows/app.yml',
    // A path nobody has classified yet ships until someone decides otherwise.
    'electron-builder.yml',
  ])
    assert.equal(shipped(file), true, file);
  for (const file of [
    'docs/STATUS.md',
    'docs/releases/0.1.6-preview.1.md',
    'tests/updates.test.ts',
    'website/releases.json',
    'scripts/ui-smoke.ts',
    'scripts/package-smoke.ts',
    'scripts/real-agents.ts',
    'scripts/release-policy.ts',
    'scripts/start.mjs',
    '.github/workflows/release.yml',
    'README.md',
    'README.en.md',
    'AGENTS.md',
  ])
    assert.equal(shipped(file), false, file);
});

test('The latest preview is ordered by version, not by name', () => {
  assert.equal(
    latestPreview([
      'v0.1.5-preview.3',
      'v0.1.10-preview.1',
      'v0.1.9-preview.2',
      'v0.1.10-preview.0',
      'v1.0.0',
      'nightly',
    ])?.tag,
    'v0.1.10-preview.1',
  );
  assert.equal(latestPreview(['nightly']), undefined);
});

async function repository(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(tmpdir(), 'irori release policy '));
  t.after(() => rm(root, { recursive: true, force: true }));
  let clock = Date.parse('2026-09-17T00:00:00Z');
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: new Date(clock).toISOString(),
          GIT_COMMITTER_DATE: new Date(clock).toISOString(),
        },
      },
    );
  const write = async (file: string, text: string) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  };
  const version = async (value: string, lockValue = value) => {
    await write('package.json', JSON.stringify({ name: 'irori', version: value }, null, 2));
    await write(
      'package-lock.json',
      JSON.stringify({
        name: 'irori',
        version: lockValue,
        packages: { '': { version: lockValue } },
      }),
    );
  };
  const commit = (message: string, at?: number) => {
    if (at !== undefined) clock = at;
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD').trim();
  };
  git('init', '-q', '-b', 'main');
  await version('0.1.0');
  await write('src/a.ts', 'export const a = 1;\n');
  await write('docs/STATUS.md', 'status\n');
  commit('Initial');
  git('tag', 'v0.1.0-preview.1');
  return { root, git, write, version, commit, at: (minutes: number) => clock + minutes * 60000 };
}

test('A pull request that ships must carry a newer version and its notes', async (t) => {
  const r = await repository(t);
  const branch = async (name: string, change: () => Promise<void>) => {
    r.git('checkout', '-q', '-b', name, 'main');
    await change();
    r.commit(name);
    return checkPullRequest(r.root, 'main', name);
  };

  const docs = await branch('docs-only', () => r.write('docs/STATUS.md', 'more status\n'));
  assert.equal(docs.ok, true);
  assert.match(docs.lines.join('\n'), /No change reaches/);

  const unversioned = await branch('code-only', () => r.write('src/a.ts', 'export const a = 2;\n'));
  assert.equal(unversioned.ok, false);
  assert.match(unversioned.lines.join('\n'), /v0\.1\.0-preview\.1` is already published/);
  assert.match(unversioned.lines.join('\n'), /0\.1\.0-preview\.1\.md` is missing/);

  const notice = await branch('notice', () =>
    r.write('docs/THIRD_PARTY_NOTICES.md', 'renamed upstream\n'),
  );
  assert.equal(notice.ok, false, 'the shipped notice needs a release like code does');

  const lock = await branch('lock-mismatch', async () => {
    await r.write('src/a.ts', 'export const a = 3;\n');
    await r.version('0.1.1', '0.1.0');
    await r.write('docs/releases/0.1.1-preview.1.md', '# irori 0.1.1\n');
  });
  assert.equal(lock.ok, false);
  assert.match(lock.lines.join('\n'), /package-lock\.json` does not carry the same version/);

  const untitled = await branch('untitled-notes', async () => {
    await r.write('src/a.ts', 'export const a = 4;\n');
    await r.version('0.1.1');
    await r.write('docs/releases/0.1.1-preview.1.md', 'Notes without a heading\n');
  });
  assert.equal(untitled.ok, false);
  assert.match(untitled.lines.join('\n'), /must start with a `# ` title/);

  const ready = await branch('ready', async () => {
    await r.write('src/a.ts', 'export const a = 5;\n');
    await r.version('0.1.1');
    await r.write('docs/releases/0.1.1-preview.1.md', '# irori 0.1.1 — fixture\n');
  });
  assert.equal(ready.ok, true, ready.lines.join('\n'));
  assert.match(ready.lines.join('\n'), /published as `v0\.1\.1-preview\.1`/);
});

test('Drift counts from the first shipped change main holds beyond the latest release', async (t) => {
  const r = await repository(t);
  await r.write('docs/STATUS.md', 'docs after the release\n');
  const docsAt = r.at(10);
  r.commit('Docs only', docsAt);
  const quiet = checkDrift(r.root, 'main', r.at(500), 60);
  assert.equal(quiet.ok, true);
  assert.equal(quiet.outputs.state, 'in-sync');
  assert.equal(quiet.outputs.tag, 'v0.1.0-preview.1');

  await r.write('src/a.ts', 'export const a = 6;\n');
  const shippedAt = r.at(20);
  r.commit('Code', shippedAt);
  const pending = checkDrift(r.root, 'main', shippedAt + 30 * 60000, 60);
  assert.equal(pending.ok, true);
  assert.equal(pending.outputs.state, 'pending');
  const overdue = checkDrift(r.root, 'main', shippedAt + 90 * 60000, 60);
  assert.equal(overdue.ok, false);
  assert.equal(overdue.outputs.state, 'overdue');
  assert.match(overdue.lines.join('\n'), /first merged 90 minutes ago/);

  // Reverting the change leaves nothing unpublished, however long ago it merged.
  await r.write('src/a.ts', 'export const a = 1;\n');
  r.commit('Revert code', r.at(5));
  assert.equal(checkDrift(r.root, 'main', shippedAt + 600 * 60000, 60).outputs.state, 'in-sync');
});
