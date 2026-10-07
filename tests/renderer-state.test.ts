import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameStructure } from '../src/domain/structural';
import { anyRevision, bumpRevision, noRevisions, scopeRevision } from '../src/domain/revisions';

test('values that read the same are the same structure', () => {
  assert.ok(sameStructure(1, 1));
  assert.ok(sameStructure('a', 'a'));
  assert.ok(sameStructure(null, null));
  assert.ok(sameStructure(undefined, undefined));
  assert.ok(sameStructure([], []));
  assert.ok(sameStructure({ a: [1, { b: 'c' }] }, { a: [1, { b: 'c' }] }));
  assert.ok(sameStructure(Object.create(null), {}));
});

test('values that differ anywhere are not', () => {
  assert.ok(!sameStructure(1, '1'));
  assert.ok(!sameStructure(null, undefined));
  assert.ok(!sameStructure(null, {}));
  assert.ok(!sameStructure([1], [1, 2]));
  assert.ok(!sameStructure([1], { 0: 1, length: 1 }));
  assert.ok(!sameStructure({ a: 1 }, { a: 1, b: undefined }));
  assert.ok(!sameStructure({ a: { b: 1 } }, { a: { b: 2 } }));
  assert.ok(!sameStructure(NaN, 0));
  assert.ok(sameStructure(NaN, NaN));
});

test('instances other than plain objects never read the same', () => {
  const at = new Date(0);
  assert.ok(!sameStructure(new Date(0), new Date(0)));
  assert.ok(sameStructure(at, at));
  assert.ok(!sameStructure(new Uint8Array([1]), new Uint8Array([1])));
  assert.ok(!sameStructure(new Map(), new Map()));
  assert.ok(!sameStructure({ a: 1 }, Object.assign(Object.create({ p: 1 }), { a: 1 })));
});

test("a change in one hibachi reaches that hibachi's views alone", () => {
  const once = bumpRevision(noRevisions, 'a');
  assert.equal(scopeRevision(once, 'a'), 1);
  assert.equal(scopeRevision(once, 'b'), 0);
  assert.equal(scopeRevision(once), 0);
  const twice = bumpRevision(bumpRevision(once, 'b'), 'a');
  assert.equal(scopeRevision(twice, 'a'), 2);
  assert.equal(scopeRevision(twice, 'b'), 1);
  // A change that may have reached every hibachi counts for each of them.
  const everywhere = bumpRevision(twice);
  assert.equal(scopeRevision(everywhere, 'a'), 3);
  assert.equal(scopeRevision(everywhere, 'c'), 1);
  assert.equal(scopeRevision(everywhere), 1);
  assert.equal(anyRevision(everywhere), 4);
  // The counts given are left as they were.
  assert.deepEqual(noRevisions, { all: 0, scopes: {} });
});
