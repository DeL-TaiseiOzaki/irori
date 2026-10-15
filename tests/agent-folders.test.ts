import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { YourAiService } from '../src/host/you';
import { AgentPaths } from '../src/host/agent-paths';
import type { WorkspaceProfile } from '../src/domain/types';

const work = '11111111-2222-4333-8444-555555555555';
const home = '22222222-2222-4333-8444-555555555555';

async function device(t: any) {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'irori folders 作業 ')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const vault = async (name: string) => {
    const root = path.join(base, 'vaults', name);
    await mkdir(root, { recursive: true });
    return files.register(root, name, 'personal');
  };
  const lab = await vault('Lab');
  const team = await vault('Team');
  const you = new YourAiService(files.dataDir, base);
  await you.load();
  return { base, files, lab, team, you };
}

test("each workspace may choose the irori agent's folder; the default stays ~/irori/you", async (t) => {
  const { base, files, lab, you } = await device(t);
  const fallback = path.join(base, 'irori', 'you');
  const { id } = await you.load();
  assert.deepEqual(you.folderOf(work), { path: fallback, chosen: false });
  const chosen = path.join(base, 'Work agent');
  await mkdir(chosen);
  const roots = files.list().map((space) => space.root);
  assert.deepEqual(await you.choose(work, chosen, roots), { path: chosen, chosen: true });
  // Another workspace keeps the default; a run of this one works in its folder.
  assert.equal(you.rootOf(id, work), chosen);
  assert.equal(you.rootOf(id, home), fallback);
  // The screens follow the workspace on show.
  assert.equal(you.rootOf(id), fallback);
  you.show(work);
  assert.equal(you.rootOf(id), chosen);
  assert.equal((await you.status()).root, chosen);
  assert.equal((await you.status()).chosen, true);
  // Each folder is set up by itself; the shared Schema stays in the default one.
  await you.create();
  assert.equal((await you.status(work)).state, 'ready');
  assert.equal((await you.status(home)).state, 'missing');
  await assert.rejects(you.sharedFolder(), /既定のフォルダ/);
  // Kept in irori's data, and read again by a new service.
  const again = new YourAiService(files.dataDir, base);
  await again.load();
  assert.equal(again.folderOf(work).path, chosen);
  // A chosen folder not there gives way to the default meanwhile.
  await rm(chosen, { recursive: true });
  assert.deepEqual(you.folderOf(work), { path: fallback, chosen: true, missing: chosen });
  // The default chosen again forgets the choice.
  assert.deepEqual(await you.choose(work, null, roots), { path: fallback, chosen: false });
  // Overlaps are refused: a vault, irori's data, inside the default or holding it.
  const refused = /重なる/;
  await assert.rejects(you.choose(work, lab.root, roots), refused);
  await assert.rejects(you.choose(work, path.join(base, 'vaults'), roots), refused);
  await assert.rejects(you.choose(work, files.dataDir, roots), refused);
  await mkdir(path.join(fallback, 'inner'), { recursive: true });
  await assert.rejects(you.choose(work, path.join(fallback, 'inner'), roots), refused);
  await assert.rejects(you.choose(work, path.join(base, 'irori'), roots), refused);
  await assert.rejects(you.choose(work, path.join(base, 'missing'), roots), /見つかりません/);
  // The default itself is the default.
  assert.deepEqual(await you.choose(work, fallback, roots), { path: fallback, chosen: false });
});

test("a path in a reply is found where its writer works, then in the workspace's other folders", async (t) => {
  const { base, files, lab, team, you } = await device(t);
  const { id } = await you.load();
  const youRoot = path.join(base, 'irori', 'you');
  const profile: WorkspaceProfile = {
    id: work,
    name: 'Work',
    scopeIds: [lab.scopeId, team.scopeId],
  };
  const write = async (root: string, rel: string) => {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), '# x\n');
  };
  await write(youRoot, 'plans/today.md');
  await write(lab.root, 'plans/today.md');
  await write(team.root, 'wiki/only-team.md');
  await write(lab.root, 'wiki/topic.md');
  await write(team.root, 'journal/topic.md');
  await write(lab.root, 'knowledge/wiki/deep.md');
  // A connected folder: a link in contents to a folder elsewhere.
  const drive = path.join(base, 'Drive', 'Shared');
  await write(drive, 'q3/plan.pdf');
  await mkdir(path.join(lab.root, 'contents'), { recursive: true });
  await symlink(drive, path.join(lab.root, 'contents', 'Drive'));
  const paths = new AgentPaths({
    files: {
      list: () => files.list(),
      // The vault's own guards, but for contents, which the cloud service resolves.
      resolve: async (scopeId, rel) =>
        rel.startsWith('contents/')
          ? path.join(files.get(scopeId).root, rel)
          : files.resolve(scopeId, rel),
      cloud: {
        linkedFolders: (scopeId) =>
          scopeId === lab.scopeId ? [{ path: 'contents/Drive', target: drive }] : [],
      },
    },
    you,
    workspaces: async () => [profile],
  });
  const locate = (p: string, from?: string) => paths.locate({ path: p, from, workspaceId: work });
  // The irori agent's own plan, not the vault's file of the same path.
  assert.deepEqual(await locate('plans/today.md', id), [{ scopeId: id, path: 'plans/today.md' }]);
  // A vault agent's path relayed by the irori agent: in the vault that has it.
  assert.deepEqual(await locate('wiki/only-team.md', id), [
    { scopeId: team.scopeId, path: 'wiki/only-team.md' },
  ]);
  // The writer's own vault first.
  assert.deepEqual(await locate('plans/today.md', lab.scopeId), [
    { scopeId: lab.scopeId, path: 'plans/today.md' },
  ]);
  // A name alone, or the tail of a path, by name; several places are each offered.
  assert.deepEqual(await locate('deep.md', lab.scopeId), [
    { scopeId: lab.scopeId, path: 'knowledge/wiki/deep.md' },
  ]);
  assert.deepEqual(await locate('wiki/deep.md', team.scopeId), [
    { scopeId: lab.scopeId, path: 'knowledge/wiki/deep.md' },
  ]);
  assert.deepEqual(
    new Set((await locate('topic.md', team.scopeId)).map((found) => found.scopeId)),
    new Set([team.scopeId, lab.scopeId]),
  );
  assert.equal((await locate('topic.md', team.scopeId))[0].scopeId, team.scopeId);
  // A connected folder's real place opens through its vault.
  assert.deepEqual(await locate(path.join(drive, 'q3', 'plan.pdf')), [
    { scopeId: lab.scopeId, path: 'contents/Drive/q3/plan.pdf' },
  ]);
  // Nothing there, or outside every folder.
  assert.deepEqual(await locate('missing.md', lab.scopeId), []);
  assert.deepEqual(await locate(path.join(base, 'elsewhere.md')), []);
  // The roots a reply's paths may land in: the vaults, the connected folder and the irori agent's.
  assert.deepEqual(
    (await paths.roots(work)).map((root) => [root.scopeId, root.prefix ?? '']),
    [
      [lab.scopeId, ''],
      [lab.scopeId, 'contents/Drive'],
      [team.scopeId, ''],
      [id, ''],
    ],
  );
});
