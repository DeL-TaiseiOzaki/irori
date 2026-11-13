import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bundlePage,
  compareCodePoints,
  formerGraphIndex,
  frontmatterBlock,
  pageFacts,
} from '../src/domain/bundle';

test("A page's facts are read leniently from its frontmatter", () => {
  assert.deepEqual(
    pageFacts(`Knowledge_Base/wiki/${'ガ.md'.normalize('NFD')}`, {
      type: 'concept',
      title: '𝔅 astral',
      description: ' ',
      tags: [],
      generated: { by: 'human:x', at: '2026-11-13T00:00:00+09:00' },
      status: null,
      relations: [
        { rel: 'uses', target: 'a.md' },
        { rel: '', target: 'a.md' },
        { rel: 'uses' },
        { rel: ['not', 'a', 'string'], target: 5 },
        'not a relation',
      ],
    }),
    {
      path: 'Knowledge_Base/wiki/ガ.md',
      type: 'concept',
      title: '𝔅 astral',
      description: ' ',
      // A key counts when it holds a value: blank text, an empty list and null do not.
      keys: ['type', 'title', 'generated', 'relations'],
      relations: [
        { rel: 'uses', target: 'a.md' },
        { rel: '', target: 'a.md' },
        { rel: 'uses', target: '' },
        { rel: '', target: '' },
        { rel: '', target: '' },
      ],
    },
  );
  // A value of the wrong shape is as good as absent.
  assert.deepEqual(pageFacts('a.md', { title: ['not', 'a', 'string'], relations: 'none' }), {
    path: 'a.md',
    type: undefined,
    title: undefined,
    description: undefined,
    keys: ['title', 'relations'],
    relations: [],
  });
  for (const none of [undefined, null, 'text', ['list']])
    assert.deepEqual(pageFacts('a.md', none).keys, []);
});

test('The frontmatter block is the YAML between the leading delimiters', () => {
  assert.equal(frontmatterBlock('﻿---\r\ntitle: x\r\n--- \r\nBody'), 'title: x\r\n');
  assert.equal(frontmatterBlock('---\ntitle: x\n---'), 'title: x\n');
  assert.equal(frontmatterBlock('---\ntitle: x\n'), undefined, 'no closing line');
  assert.equal(frontmatterBlock('# Title\n---\nx\n---\n'), undefined, 'not leading');
  assert.equal(frontmatterBlock('---\n---\n'), '');
});

test('Pages are the Markdown files of the knowledge folder that are not folder indexes', () => {
  for (const file of [
    'Knowledge_Base/wiki/a.md',
    'Knowledge_Base/a.MD',
    'Knowledge_Base/ontology/x.md',
  ])
    assert(bundlePage(file), file);
  for (const file of [
    'Knowledge_Base/index.md',
    'Knowledge_Base/wiki/INDEX.md',
    'Knowledge_Base/wiki/a.csv',
    'notes/outside.md',
    'README.md',
  ])
    assert(!bundlePage(file), file);
  // A vault whose root is its knowledge folder: Schema files beside the pages are not pages.
  assert(bundlePage('wiki/a.md', ''));
  assert(bundlePage('ontology/x.md', ''));
  for (const file of ['AGENTS.md', 'README.md', 'index.md', '.agents/skills/lint/SKILL.md'])
    assert(!bundlePage(file, ''), file);
  assert.equal(formerGraphIndex('Knowledge_Base'), 'Knowledge_Base/ontology/entities.csv');
  assert.equal(formerGraphIndex(''), 'ontology/entities.csv');
});

test('Names sort by code point on every runtime', () => {
  assert.equal(compareCodePoints('', '\u{1F600}'), -1, 'code points, not UTF-16 units');
  assert.equal(compareCodePoints('ab', 'abc'), -1);
  assert.equal(compareCodePoints('b', 'ab'), 1);
  assert.equal(compareCodePoints('a', 'a'), 0);
});
