import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  joinGroup,
  leaveGroup,
  normalizeGroups,
  railItems,
  renameGroup,
  startGroup,
  toggleGroup,
  ungroup,
} from '../src/domain/hibachi-groups';
import { dispatchHost, hostArguments, type HostHandlers } from '../src/domain/host-requests';
import { WorkspaceService } from '../src/host/workspaces';
import { fixture } from './fixtures/cloud';

const [a, b, c, d] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const g1 = randomUUID(),
  g2 = randomUUID();

test('A group stands where its first hibachi is, holding its members in workspace order', () => {
  const groups = [{ id: g1, name: 'Lab', scopeIds: [d, b], open: false }];
  assert.deepEqual(railItems([a, b, c, d], groups), [
    { kind: 'hibachi', scopeId: a },
    { kind: 'group', group: { id: g1, name: 'Lab', scopeIds: [b, d], open: false } },
    { kind: 'hibachi', scopeId: c },
  ]);
  assert.deepEqual(railItems([a, b]), [
    { kind: 'hibachi', scopeId: a },
    { kind: 'hibachi', scopeId: b },
  ]);
});

test('Each hibachi is in one group at most, and a group without hibachis goes', () => {
  assert.deepEqual(
    normalizeGroups(
      [
        { id: g1, name: ' Lab ', scopeIds: [a, b, randomUUID()], open: true },
        { id: g2, name: 'Other', scopeIds: [b], open: true },
        { id: g1, name: 'Copy', scopeIds: [c], open: true },
      ],
      [a, b, c],
    ),
    [{ id: g1, name: 'Lab', scopeIds: [a, b], open: true }],
  );
});

test('Grouping edits move hibachis between groups, rename, toggle and dissolve', () => {
  let groups = startGroup([], a, ' Lab ', g1);
  assert.deepEqual(groups, [{ id: g1, name: 'Lab', scopeIds: [a], open: true }]);
  groups = joinGroup(groups, b, g1);
  groups = startGroup(groups, b, 'Team', g2);
  assert.deepEqual(
    groups.map((group) => group.scopeIds),
    [[a], [b]],
  );
  groups = joinGroup(groups, a, g2);
  assert.deepEqual(groups, [{ id: g2, name: 'Team', scopeIds: [b, a], open: true }]);
  groups = toggleGroup(renameGroup(groups, g2, 'Projects'), g2);
  assert.deepEqual(groups, [{ id: g2, name: 'Projects', scopeIds: [b, a], open: false }]);
  assert.deepEqual(leaveGroup(groups, b)[0].scopeIds, [a]);
  assert.deepEqual(leaveGroup(leaveGroup(groups, b), a), []);
  assert.deepEqual(ungroup(groups, g2), []);
});

test('Workspace groups persist, follow the hibachis that stay, and reject invalid input', async (t) => {
  const { files, space, base } = await fixture(t);
  const otherRoot = path.join(base, 'Team');
  await mkdir(otherRoot);
  const other = await files.register(otherRoot, 'Team', 'team');
  const service = new WorkspaceService(files);
  const profile = await service.save('Work', [space.scopeId, other.scopeId]);
  assert.equal(profile.groups, undefined);
  const saved = await service.saveGroups(profile.id, [
    { id: g1, name: 'Lab', scopeIds: [other.scopeId, space.scopeId, randomUUID()], open: false },
  ]);
  assert.deepEqual(saved.groups, [
    { id: g1, name: 'Lab', scopeIds: [space.scopeId, other.scopeId], open: false },
  ]);
  assert.deepEqual((await new WorkspaceService(files).list())[0], saved);
  // Renaming the workspace or removing one hibachi keeps the group for the rest.
  const renamed = await service.save('Renamed', [other.scopeId], profile.id);
  assert.deepEqual(renamed.groups, [
    { id: g1, name: 'Lab', scopeIds: [other.scopeId], open: false },
  ]);
  assert.equal((await service.saveGroups(profile.id, [])).groups, undefined);
  await assert.rejects(service.saveGroups(randomUUID(), []), /Unknown workspace/);

  const handlers = { saveWorkspaceGroups: () => undefined } as unknown as HostHandlers;
  assert.ok(hostArguments.saveWorkspaceGroups);
  for (const groups of [
    [{ id: 'x', name: 'Lab', scopeIds: [], open: true }],
    [{ id: g1, name: '  ', scopeIds: [], open: true }],
    [{ id: g1, name: 'Lab', scopeIds: [], open: 'yes' }],
  ])
    assert.throws(() => dispatchHost(handlers, 'saveWorkspaceGroups', [profile.id, groups]));
});
