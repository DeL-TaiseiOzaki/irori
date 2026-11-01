import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countLabel, shortWhen } from '../src/app/display';

test('a badge count stops at 99+', () => {
  assert.equal(countLabel(0), '0');
  assert.equal(countLabel(7), '7');
  assert.equal(countLabel(99), '99');
  assert.equal(countLabel(100), '99+');
  assert.equal(countLabel(12345), '99+');
  assert.equal(countLabel(1500, 999), '999+');
});

test('a count that is not one shows as nothing', () => {
  assert.equal(countLabel(-1), '');
  assert.equal(countLabel(Number.NaN), '');
  assert.equal(countLabel(Number.POSITIVE_INFINITY), '');
  assert.equal(countLabel(2.7), '2');
});

test('a broken time shows as a dash', () => {
  assert.equal(shortWhen('not a date'), '—');
  assert.equal(shortWhen(''), '—');
  assert.notEqual(shortWhen('2026-11-01T09:30:00Z'), '—');
});
