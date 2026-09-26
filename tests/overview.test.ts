import test from 'node:test';
import assert from 'node:assert/strict';
import { board, mapLayout, noteLabel, referenceLinks } from '../src/domain/overview';
import type { RunRecord } from '../src/domain/knowledge';

const ids = {
  a: '00000000-0000-4000-8000-00000000000a',
  b: '00000000-0000-4000-8000-00000000000b',
  c: '00000000-0000-4000-8000-00000000000c',
  d: '00000000-0000-4000-8000-00000000000d',
};

test('the map places each brain once, the same way every time, inside the board', () => {
  const spaces = [
    { scopeId: ids.a, category: 'personal' as const },
    { scopeId: ids.b, category: 'team' as const },
    { scopeId: ids.c, category: 'team' as const },
    { scopeId: ids.d },
  ];
  const layout = mapLayout(spaces);
  assert.deepEqual(layout, mapLayout(spaces.map((space) => ({ ...space }))));
  assert.deepEqual(layout.nodes.map((node) => node.scopeId).sort(), Object.values(ids).sort());
  for (const node of layout.nodes) {
    assert.ok(node.x > 0 && node.x < board.width);
    assert.ok(node.y > 0 && node.y < board.height);
  }
  // Team above personal above the brains without a category; the team keeps its order.
  const at = (id: string) => layout.nodes.find((node) => node.scopeId === id)!;
  assert.ok(at(ids.b).y < at(ids.a).y && at(ids.a).y < at(ids.d).y);
  assert.ok(at(ids.b).x < at(ids.c).x);
  assert.equal(at(ids.b).y, at(ids.c).y);
  // Categories are soft areas; a brain without one has none.
  assert.deepEqual(layout.groups.map((group) => group.category).sort(), ['personal', 'team']);
  const team = layout.groups.find((group) => group.category === 'team')!;
  for (const id of [ids.b, ids.c]) {
    assert.ok(at(id).x > team.x && at(id).x < team.x + team.width);
    assert.ok(at(id).y > team.y && at(id).y < team.y + team.height);
  }
});

test('brains with no category at all are one row without areas', () => {
  const layout = mapLayout([{ scopeId: ids.a }, { scopeId: ids.b }]);
  assert.equal(layout.groups.length, 0);
  assert.equal(layout.nodes[0].y, layout.nodes[1].y);
  assert.deepEqual(mapLayout([]), { nodes: [], groups: [], hearth: undefined });
});

test('with your AI, the hearth is on the left and the brains keep to its right', () => {
  const layout = mapLayout(
    [
      { scopeId: ids.a, category: 'team' },
      { scopeId: ids.b, category: 'team' },
      { scopeId: ids.c },
    ],
    { hearth: true },
  );
  assert.ok(layout.hearth && layout.hearth.x < 200);
  for (const node of layout.nodes)
    assert.ok(node.x > layout.hearth.x + 150 && node.x < board.width);
  for (const group of layout.groups) assert.ok(group.x > layout.hearth.x + 60);
});

function run(scopeId: string, createdAt: string, sources: [string, string][]): RunRecord {
  return {
    id: crypto.randomUUID(),
    scopeId,
    agent: 'codex',
    createdAt,
    sources: sources.map(([scope, path]) => ({
      scopeId: scope,
      path,
      id: crypto.randomUUID(),
      hash: 'a'.repeat(64),
      size: 1,
      capturedAt: createdAt,
    })),
  };
}

test('a line joins brains whose AI read another brain’s notes, named by the latest note', () => {
  const links = referenceLinks(
    {
      [ids.a]: [
        run(ids.a, '2026-09-20T00:00:00.000Z', [
          [ids.b, 'Knowledge_Base/old.md'],
          [ids.a, 'Knowledge_Base/own.md'],
        ]),
        run(ids.a, '2026-09-24T00:00:00.000Z', [[ids.b, 'Knowledge_Base/競合調査.md']]),
        run(ids.a, '2026-09-22T00:00:00.000Z', [[ids.b, 'Knowledge_Base/old.md']]),
      ],
      // A brain outside the workspace draws nothing.
      [ids.c]: [run(ids.c, '2026-09-24T00:00:00.000Z', [[ids.d, 'x.md']])],
    },
    [ids.a, ids.b, ids.c],
  );
  assert.deepEqual(links, [
    {
      from: ids.b,
      to: ids.a,
      path: 'Knowledge_Base/競合調査.md',
      notes: 2,
      at: '2026-09-24T00:00:00.000Z',
    },
  ]);
  assert.equal(noteLabel(links[0].path), '競合調査');
});
