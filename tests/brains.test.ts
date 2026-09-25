import test from 'node:test';
import assert from 'node:assert/strict';
import { brainAppearance, brainColors } from '../src/domain/brains';

test('a brain looks the same wherever it is shown, and never white by default', () => {
  const space = { scopeId: '6f1c2d0e-8b1a-4c33-9d7e-2a4b5c6d7e8f', name: 'プロダクト' };
  assert.deepEqual(brainAppearance(space), brainAppearance({ ...space }));
  assert.deepEqual(brainAppearance(space).mark, { kind: 'text', text: 'プ' });
  const colours = new Set(
    Array.from(
      { length: 64 },
      (_, i) => brainAppearance({ scopeId: `${i}-scope-${i * 7}`, name: 'x' }).color,
    ),
  );
  assert.ok(!colours.has('shiro'));
  assert.ok(colours.size > 3);
  for (const colour of colours) assert.ok(brainColors.includes(colour));
});

test('a Latin name gives its capital, and an emoji stays whole', () => {
  assert.equal(brainAppearance({ scopeId: 'a', name: 'research' }).mark.text, 'R');
  assert.equal(brainAppearance({ scopeId: 'a', name: '  👩‍🔬 lab' }).mark.text, '👩‍🔬');
});
