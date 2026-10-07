import test from 'node:test';
import assert from 'node:assert/strict';
import {
  brainAppearance,
  brainColors,
  categoryChoices,
  categoryIcon,
  categoryName,
  categoryValue,
} from '../src/domain/brains';

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
  assert.deepEqual(brainAppearance({ scopeId: 'a', name: 'research' }).mark, {
    kind: 'text',
    text: 'R',
  });
  assert.deepEqual(brainAppearance({ scopeId: 'a', name: '  👩‍🔬 lab' }).mark, {
    kind: 'text',
    text: '👩‍🔬',
  });
});

test('a category is a preset or any name, and a preset reads the same in both languages', () => {
  for (const typed of ['チーム', 'team', 'Team', ' TEAM '])
    assert.equal(categoryValue(typed), 'team', typed);
  assert.equal(categoryValue('個人'), 'personal');
  assert.equal(categoryValue('Organization'), 'organization');
  assert.equal(categoryValue('  研究室   A '), '研究室 A');
  assert.equal(categoryValue('   '), undefined);
  assert.equal(categoryName('team'), 'チーム');
  assert.equal(categoryName('研究室'), '研究室');
  assert.equal(categoryIcon('team'), 'users');
  assert.equal(categoryIcon('研究室'), 'tag');
  // The presets first, then the workspace's own once each in name order.
  assert.deepEqual(
    categoryChoices([
      { category: '研究室' },
      { category: 'team' },
      { category: 'Club' },
      { category: '研究室' },
      {},
    ]),
    ['personal', 'team', 'organization', 'Club', '研究室'],
  );
});
