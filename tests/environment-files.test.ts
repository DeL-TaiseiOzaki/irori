import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { packAgentFiles, storedAgentFiles } from '../src/host/environment-agent';

test('credential files stay on this device when the irori agent’s folder is saved', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'irori agent files '));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'AGENTS.md'), '# irori agent\n');
  await writeFile(path.join(root, '.env'), 'TOKEN=secret\n');
  await writeFile(path.join(root, '.env.local'), 'TOKEN=secret\n');
  await writeFile(path.join(root, '.env.example'), 'TOKEN=\n');
  await mkdir(path.join(root, 'keys'));
  await writeFile(path.join(root, 'keys', 'deploy.pem'), 'key\n');
  const { files, left } = await packAgentFiles(root);
  assert.deepEqual(
    files.map((file) => file.path),
    ['.env.example', 'AGENTS.md'],
  );
  assert.deepEqual(left, ['.env', '.env.local', 'keys/deploy.pem']);
});

test('a saved environment never restores into a Git folder', () => {
  const saved = (rel: string) =>
    storedAgentFiles.safeParse({
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      files: [{ path: rel, text: 'x' }],
    }).success;
  assert.equal(saved('notes/plan.md'), true);
  assert.equal(saved('.git/hooks/pre-commit'), false);
  assert.equal(saved('vault/.GIT/config'), false);
});
