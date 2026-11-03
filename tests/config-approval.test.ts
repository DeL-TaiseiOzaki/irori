import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ConfigApprovals,
  ConfigRefused,
  findConfig,
  type FoundConfig,
} from '../src/agents/config-approval';

async function folders(t: test.TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori config '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const vault = path.join(base, 'vault');
  const drive = path.join(base, 'drive');
  await mkdir(path.join(vault, '.claude'), { recursive: true });
  await mkdir(path.join(drive, '.claude', 'skills', 'x'), { recursive: true });
  return { base, vault, drive };
}

test('what runs without asking is found per CLI, in the folder and beside it', async (t) => {
  const { vault, drive } = await folders(t);
  assert.equal(await findConfig({ root: vault }, 'claude'), undefined);
  await writeFile(path.join(vault, '.claude', 'settings.json'), '{"hooks":{}}');
  await writeFile(path.join(vault, '.mcp.json'), '{}');
  await writeFile(path.join(drive, '.claude', 'skills', 'x', 'SKILL.md'), '# x');
  const own = await findConfig({ root: vault }, 'claude');
  assert.deepEqual(own?.files, [
    path.join(vault, '.claude/settings.json'),
    path.join(vault, '.mcp.json'),
  ]);
  // Codex reads no project configuration of an untrusted folder; OpenCode reads its own.
  assert.equal(await findConfig({ root: vault }, 'codex'), undefined);
  assert.equal(await findConfig({ root: vault }, 'opencode'), undefined);
  // A folder given beside the working one brings its whole `.claude`.
  const beside = await findConfig({ root: drive, added: true }, 'claude');
  assert.deepEqual(beside?.files, [path.join(drive, '.claude/skills/x/SKILL.md')]);
});

test('the person is asked once, again after a change, and a refusal stops the run', async (t) => {
  const { base, vault } = await folders(t);
  await writeFile(path.join(vault, '.claude', 'settings.json'), '{"hooks":{}}');
  const asked: FoundConfig[][] = [];
  let answer = true;
  const approvals = new ConfigApprovals(
    path.join(base, 'data', 'approvals.json'),
    async (found) => {
      asked.push(found);
      return answer;
    },
  );
  assert.equal(await approvals.isAllowed('claude', [{ root: vault }]), false);
  await approvals.check('claude', [{ root: vault }]);
  await approvals.check('claude', [{ root: vault }]);
  assert.equal(asked.length, 1);
  assert.equal(await approvals.isAllowed('claude', [{ root: vault }]), true);
  await writeFile(path.join(vault, '.claude', 'settings.json'), '{"env":{"X":"1"}}');
  answer = false;
  await assert.rejects(approvals.check('claude', [{ root: vault }]), ConfigRefused);
  assert.equal(asked.length, 2);
  // Nothing was recorded for the refused version.
  await assert.rejects(approvals.check('claude', [{ root: vault }]), ConfigRefused);
  assert.equal(asked.length, 3);
});
