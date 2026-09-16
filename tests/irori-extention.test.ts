// Scenario adaptation from irori-extention scopes.test.ts at 2a2e7e0.
// Copyright (c) 2026 Taisei Ozaki. MIT; see docs/THIRD_PARTY_NOTICES.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { owner, classify } from '../src/domain/scopes';
import type { Space } from '../src/domain/types';
const root = path.resolve('fixture-vault');
const scope = (relative: string, id: string): Space => ({
  schemaVersion: 1,
  scopeId: id,
  name: id,
  category: relative ? 'team' : 'personal',
  root: path.join(root, relative),
  contents: ['contents'],
});
const spaces = [
  scope('', 'personal-id'),
  scope('team-kb/engineering', 'engineering-id'),
  scope('partner-kb', 'partner-id'),
];
test('irori-extention regression scenarios keep foreign schema together, and contents outside extension classification', () => {
  for (const p of [
    'team-kb/engineering/CLAUDE.md',
    'team-kb/engineering/AGENTS.md',
    'team-kb/engineering/.claude/rules/house.md',
  ]) {
    const s = owner(spaces, path.join(root, p))!;
    assert.equal(s.scopeId, 'engineering-id');
    assert.equal(classify(s, path.relative(s.root, path.join(root, p))), 'schema');
  }
  assert.equal(
    owner(spaces, path.join(root, 'partner-kb-archive/note.md'))?.scopeId,
    'personal-id',
  );
  // A KB is often also an Obsidian vault, a Git checkout and a claudian vault. Their
  // directories arrive without irori writing anything, and none of them is knowledge.
  for (const p of [
    '.obsidian/workspace.json',
    '.claudian/sessions/a.jsonl',
    '.github/workflows/ci.yml',
    '.gitignore',
    '.mcp.json',
    '.irori/ontology.json',
    'schema/house.md',
  ])
    assert.equal(classify(spaces[0], p), 'schema', p);
  for (const p of ['Knowledge_Base/library/a.md', 'note.md', 'notes/.hidden/a.md'])
    assert.equal(classify(spaces[0], p), 'Knowledge_Base', p);
  for (const p of [
    'contents/gdrive/CLAUDE.md',
    'contents/gdrive/note.md',
    'contents/gdrive/Ontology.csv',
    'contents/gdrive/file.bin',
  ])
    assert.equal(classify(spaces[1], p), 'contents');
});
