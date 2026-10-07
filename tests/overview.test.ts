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
    { scopeId: ids.a, category: 'personal' },
    { scopeId: ids.b, category: 'team' },
    { scopeId: ids.c, category: '研究室' },
    { scopeId: ids.d },
  ];
  const layout = mapLayout(spaces);
  assert.deepEqual(layout, mapLayout(spaces.map((space) => ({ ...space }))));
  for (const node of layout.nodes) {
    assert.ok(node.x > 0 && node.x < board.width);
    assert.ok(node.y > 0 && node.y < board.height);
  }
  // Categories do not move a hibachi: one row in the workspace's order, without areas.
  assert.deepEqual(
    layout.nodes.map((node) => node.scopeId),
    [ids.a, ids.b, ids.c, ids.d],
  );
  assert.ok(layout.nodes.every((node) => node.y === layout.nodes[0].y));
  assert.ok(layout.nodes.every((node, i) => i === 0 || node.x > layout.nodes[i - 1].x));
  assert.equal('groups' in layout, false);
  assert.deepEqual(mapLayout([]), { nodes: [], hearth: undefined });
});

test('with your AI, the hearth is on the left and the brains keep to its right', () => {
  const layout = mapLayout([{ scopeId: ids.a }, { scopeId: ids.b }, { scopeId: ids.c }], {
    hearth: true,
  });
  assert.ok(layout.hearth && layout.hearth.x < 200);
  for (const node of layout.nodes)
    assert.ok(node.x > layout.hearth.x + 150 && node.x < board.width);
});

test('many hibachis wrap into rows of four in order', () => {
  const spaces = Array.from({ length: 6 }, (_, i) => ({
    scopeId: `00000000-0000-4000-8000-00000000010${i}`,
  }));
  for (const hearth of [false, true]) {
    const layout = mapLayout(spaces, { hearth });
    const ys = [...new Set(layout.nodes.map((node) => node.y))];
    assert.equal(ys.length, 2);
    assert.deepEqual(
      layout.nodes.filter((node) => node.y === ys[0]).map((node) => node.scopeId),
      spaces.slice(0, 4).map((space) => space.scopeId),
    );
    for (const node of layout.nodes) assert.ok(node.y > 0 && node.y < board.height);
  }
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
