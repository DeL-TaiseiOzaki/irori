import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';
import { removeSpace, type RemoveSpaceHost } from '../src/host/remove-space';
import { hostArguments } from '../src/domain/host-requests';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori remove hibachi '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const workspaces = new WorkspaceService(files);
  const roots = { product: path.join(base, 'Product'), research: path.join(base, 'Research') };
  await mkdir(roots.product);
  await mkdir(roots.research);
  const product = await files.register(roots.product, 'Product', 'team');
  const research = await files.register(roots.research, 'Research', 'personal');
  const lab = await workspaces.save('Lab', [product.scopeId, research.scopeId]);
  await workspaces.saveGroups(lab.id, [
    {
      id: crypto.randomUUID(),
      name: 'Both',
      scopeIds: [product.scopeId, research.scopeId],
      open: true,
    },
  ]);
  const solo = await workspaces.save('Solo', [research.scopeId]);
  const events: string[] = [];
  const host = (over: Partial<RemoveSpaceHost> = {}): RemoveSpaceHost => ({
    files,
    workspaces,
    keep: async () => [path.join(base, 'device')],
    release: async (space) => {
      events.push(`release ${space.name}`);
      return async () => {
        events.push(`take up ${space.name}`);
      };
    },
    trash: async (folder) => {
      events.push(`trash ${path.basename(folder)}`);
    },
    ...over,
  });
  return { base, files, workspaces, roots, product, research, lab, solo, events, host };
}

test('removing a hibachi takes it off the device and every workspace, and keeps its folder', async (t) => {
  const { base, files, workspaces, roots, product, research, lab, solo, events, host } =
    await fixture(t);
  await removeSpace(host(), research.scopeId, false);
  assert.deepEqual(events, ['release Research']);
  assert.deepEqual(
    files.list().map((space) => space.scopeId),
    [product.scopeId],
  );
  assert.throws(() => files.get(research.scopeId), /Unknown space/);
  const profiles = await workspaces.list();
  const labNow = profiles.find((item) => item.id === lab.id)!;
  assert.deepEqual(labNow.scopeIds, [product.scopeId]);
  // Its group keeps the hibachi that stays; a workspace left with none stays too.
  assert.deepEqual(
    labNow.groups?.map((group) => group.scopeIds),
    [[product.scopeId]],
  );
  assert.deepEqual(profiles.find((item) => item.id === solo.id)!.scopeIds, []);
  // The folder and its declaration stay, and a restart no longer lists it.
  await access(path.join(roots.research, '.irori', 'scope.json'));
  const stored = JSON.parse(await readFile(path.join(base, 'device', 'spaces.json'), 'utf8'));
  assert.deepEqual(
    stored.map((item: { scopeId: string }) => item.scopeId),
    [product.scopeId],
  );
  const again = new FileService(path.join(base, 'device'));
  await again.init();
  assert.deepEqual(
    again.list().map((space) => space.name),
    ['Product'],
  );
  // Registering the folder again brings the same hibachi back.
  const back = await files.register(roots.research, 'ignored', 'team');
  assert.equal(back.scopeId, research.scopeId);
  assert.equal(back.name, 'Research');
});

test('with trash, the folder goes to the trash after irori lets go of it', async (t) => {
  const { files, research, events, host } = await fixture(t);
  await removeSpace(host(), research.scopeId, true);
  assert.deepEqual(events, ['release Research', 'trash Research']);
  assert.equal(
    files.list().some((space) => space.scopeId === research.scopeId),
    false,
  );
});

test('a folder that cannot go to the trash leaves the hibachi registered and taken up again', async (t) => {
  const { files, workspaces, research, lab, events, host } = await fixture(t);
  await assert.rejects(
    removeSpace(
      host({
        trash: async () => {
          throw Error('no trash here');
        },
      }),
      research.scopeId,
      true,
    ),
    /no trash here/,
  );
  assert.deepEqual(events, ['release Research', 'take up Research']);
  assert.equal(files.get(research.scopeId).name, 'Research');
  assert.ok(
    (await workspaces.list())
      .find((item) => item.id === lab.id)!
      .scopeIds.includes(research.scopeId),
  );
});

test('a folder holding another hibachi or irori’s own folders does not go to the trash', async (t) => {
  const { base, files, product, roots, events, host } = await fixture(t);
  const inner = path.join(roots.product, 'Knowledge_Base', 'Inner');
  await mkdir(inner, { recursive: true });
  await files.register(inner, 'Inner', 'personal');
  await assert.rejects(removeSpace(host(), product.scopeId, true), /Inner/);
  // irori's data, or the irori agent's folder, inside a hibachi.
  await assert.rejects(
    removeSpace(
      host({ keep: async () => [path.join(base, 'Research', 'you')] }),
      files.list()[1].scopeId,
      true,
    ),
    /you/,
  );
  assert.deepEqual(events, []);
  assert.equal(files.list().length, 3);
  // Without the trash, the hibachi still leaves; its folder stays.
  await removeSpace(host(), product.scopeId, false);
  assert.deepEqual(
    files.list().map((space) => space.name),
    ['Research', 'Inner'],
  );
});

test('the request takes a hibachi id and whether to trash its folder', () => {
  const id = crypto.randomUUID();
  assert.equal(hostArguments.removeSpace.safeParse([id, true]).success, true);
  assert.equal(hostArguments.removeSpace.safeParse([id]).success, false);
  assert.equal(hostArguments.removeSpace.safeParse(['not an id', false]).success, false);
});
