import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPropertyPage } from '../src/domain/scopes';
import type { Space } from '../src/domain/types';
import {
  actorFromEmail,
  frontmatterHead,
  parseProperties,
  propertyDeclaration,
  requiredKeys,
  setProperty,
  splitPage,
  stampLastChange,
  withProperty,
} from '../src/domain/properties';

// The frontmatter example irori-templete's contract gives, comments and flow
// collections included.
const templateYaml = `type: artifact                       # required; one of the types above
title: Proposal for customer A, v2   # required
description: One sentence an agent reads to decide whether to open this page.  # required
generated: { by: human:taisei, at: 2026-09-17T10:00:00Z }   # required; who last changed the page
status: stable                       # draft | stable | deprecated
resource: contents/drive/output/proposal-v2.pptx
sources:                             # what this page was made from
  - { id: rfp, resource: contents/drive/source/customer-a-rfp.pdf, title: Customer A RFP, last_modified: 2026-09-01T00:00:00Z }
  - { id: pricing, resource: ../decisions/annual-fixed-pricing.md, title: Annual fixed pricing }
verified: [{ by: human:owner, at: 2026-09-18T09:00:00Z }]
stale_after: 2027-03-31T00:00:00Z
tags: [pricing]
x-team: keep me
relations:
  - { rel: uses, target: ../wiki/retry-budget.md }`;
const page = `---\n${templateYaml}\n---\n\n# Proposal\n\nBody text.\n`;

const declaration = propertyDeclaration.parse({
  schemaVersion: 1,
  properties: {
    type: { kind: 'type' },
    title: { kind: 'text' },
    description: { kind: 'text' },
    generated: { kind: 'actor-time', auto: 'last-change' },
    status: { kind: 'select', options: ['draft', 'stable', 'deprecated'], default: 'stable' },
    tags: { kind: 'multi-select' },
  },
  required: ['type', 'title', 'description', 'generated'],
  types: { artifact: { heading: '# Artifacts', required: ['resource', 'sources'] } },
  relations: { uses: { from: 'any', to: 'page' } },
  avoid: [],
  futureKey: true,
});

/** Lines that differ between two texts, as [before, after] pairs. */
function changedLines(before: string, after: string) {
  const a = before.split('\n'),
    b = after.split('\n');
  return a.flatMap((line, index) => (line === b[index] ? [] : [[line, b[index]]]));
}

test('A page splits at its frontmatter and joins back to the same bytes', () => {
  for (const text of [
    page,
    page.replace(/\n/g, '\r\n'),
    `\uFEFF${page}`,
    '---\n---\nbody\n',
    '---\ntitle: x\n---',
    '# No frontmatter\n',
    '---\nnot closed\n',
  ]) {
    const split = splitPage(text);
    assert.equal(split.head + split.body, text);
  }
  assert.equal(splitPage(page).yaml, templateYaml);
  assert.equal(splitPage('---\n---\nbody\n').yaml, '');
  assert.equal(splitPage('# No frontmatter\n').yaml, undefined);
  assert.equal(splitPage('---\r\na: 1\r\n---\r\nbody').newline, '\r\n');
});

test('Setting one value rewrites only that value', () => {
  const cases: [string[], unknown, string, string][] = [
    [
      ['status'],
      'draft',
      'status: stable                       # draft | stable | deprecated',
      'status: draft                       # draft | stable | deprecated',
    ],
    [
      ['generated', 'by'],
      'human:ozaki',
      'generated: { by: human:taisei, at: 2026-09-17T10:00:00Z }   # required; who last changed the page',
      'generated: { by: human:ozaki, at: 2026-09-17T10:00:00Z }   # required; who last changed the page',
    ],
    [['tags'], ['pricing', 'q3'], 'tags: [pricing]', 'tags: [pricing, q3]'],
    [
      ['title'],
      'Proposal: v3',
      'title: Proposal for customer A, v2   # required',
      'title: "Proposal: v3"   # required',
    ],
  ];
  for (const [path, value, before, after] of cases) {
    const next = setProperty(templateYaml, path, value as never);
    assert.deepEqual(changedLines(templateYaml, next), [[before, after]], path.join('.'));
    assert.deepEqual(
      (parseProperties(next).values as Record<string, unknown>)[path[0]!] !== undefined,
      true,
    );
  }
});

test('Values inside a flow collection are quoted when they carry flow indicators', () => {
  const next = setProperty(templateYaml, ['generated', 'by'], 'human:a, b');
  assert.deepEqual(
    (parseProperties(next).values.generated as Record<string, unknown>).by,
    'human:a, b',
  );
});

test('A new key is appended and a removed key takes its whole entry with it', () => {
  const added = setProperty(templateYaml, ['sensitivity'], 'internal');
  assert.equal(added, `${templateYaml}\nsensitivity: internal\n`);
  const removed = setProperty(templateYaml, ['sources'], undefined);
  assert.ok(!removed.includes('customer-a-rfp'));
  assert.ok(removed.includes('resource: contents/drive/output/proposal-v2.pptx\nverified:'));
  assert.deepEqual(
    parseProperties(removed).keys,
    parseProperties(templateYaml).keys.filter((key) => key !== 'sources'),
  );
  assert.equal(setProperty('', ['title'], 'New'), 'title: New\n');
});

test('A block list keeps its block style', () => {
  const yaml = 'tags:\n  - a\n  - b\nnext: 1\n';
  const next = setProperty(yaml, ['tags'], ['a', 'c', 'd']);
  assert.equal(next, 'tags:\n  - a\n  - c\n  - d\nnext: 1\n');
  const emptied = setProperty(yaml, ['tags'], []);
  assert.deepEqual(parseProperties(emptied).values, { tags: [], next: 1 });
});

test('Frontmatter that does not parse is reported, and not edited', () => {
  assert.match(parseProperties('a: 1\na: 2').error ?? '', /unique|duplicate/i);
  assert.ok(parseProperties('a: [1').error);
  assert.ok(parseProperties('- a\n- b').error);
  assert.throws(() => setProperty('a: [1', ['a'], 2));
  assert.ok(parseProperties('a: &x 1\nb: *x').error);
  const broken = '---\na: [1\n---\nbody\n';
  assert.equal(stampLastChange(broken, declaration, 'human:x', new Date()), broken);
});

test('Line endings and BOM survive an edit', () => {
  const text = `\uFEFF${page.replace(/\n/g, '\r\n')}`;
  const next = withProperty(text, ['status'], 'draft');
  assert.ok(next.startsWith('\uFEFF---\r\n'));
  assert.ok(!/[^\r]\n/.test(next));
  assert.equal(splitPage(next).body, splitPage(text).body);
});

test('The last change names the person and the moment', () => {
  const at = new Date(2026, 8, 29, 10, 0, 0);
  const next = stampLastChange(page, declaration, 'human:ozaki', at);
  const generated = parseProperties(splitPage(next).yaml).values.generated as Record<
    string,
    string
  >;
  assert.equal(generated.by, 'human:ozaki');
  assert.match(generated.at, /^2026-09-29T10:00:00[+-]\d\d:\d\d$/);
  assert.equal(changedLines(page, next).length, 1);
  assert.equal(splitPage(next).body, splitPage(page).body);
  // Missing, it is added as one flow mapping.
  const bare = '---\ntitle: x\n---\nbody';
  assert.match(
    stampLastChange(bare, declaration, 'human:ozaki', at),
    /^---\ntitle: x\ngenerated: \{ by: human:ozaki, at: 2026-09-29T10:00:00[+-]\d\d:\d\d \}\n---\nbody$/,
  );
  // Nothing without a declaration, an actor or frontmatter.
  assert.equal(stampLastChange(page, null, 'human:ozaki', at), page);
  assert.equal(stampLastChange(page, declaration, undefined, at), page);
  assert.equal(stampLastChange('# body only\n', declaration, 'human:ozaki', at), '# body only\n');
});

test('Required keys combine every page with the type, and pages exclude indexes', () => {
  assert.deepEqual(requiredKeys(declaration, 'artifact'), [
    'type',
    'title',
    'description',
    'generated',
    'resource',
    'sources',
  ]);
  assert.deepEqual(requiredKeys(declaration, 'unknown'), declaration.required);
  assert.deepEqual(requiredKeys(null, 'artifact'), []);
  const space = { contents: ['contents'] } as unknown as Space;
  assert.ok(isPropertyPage(space, 'Knowledge_Base/wiki/a.md'));
  assert.ok(isPropertyPage(space, 'notes/free-folder/a.md'));
  assert.ok(!isPropertyPage(space, 'Knowledge_Base/wiki/index.md'));
  assert.ok(!isPropertyPage(space, 'Knowledge_Base/data.csv'));
  assert.ok(!isPropertyPage(space, 'AGENTS.md'));
  // The repository's front page is Schema, not a page (ADR 028); a nested one is a page.
  for (const readme of ['README.md', 'readme.md', 'Readme.MD'])
    assert.ok(!isPropertyPage(space, readme), readme);
  assert.ok(isPropertyPage(space, 'Knowledge_Base/README.md'));
  assert.ok(isPropertyPage(space, 'notes/readme.md'));
  assert.ok(!isPropertyPage(space, '.agents/skills/a/SKILL.md'));
  assert.ok(!isPropertyPage(space, 'contents/drive/memo.md'));
  assert.equal(actorFromEmail('taisei.ozaki.lab@example.com'), 'human:taisei.ozaki.lab');
  assert.equal(actorFromEmail(''), undefined);
});

test("irori-templete's declaration parses when the template is checked out beside irori", (t) => {
  // From irori/ in KB_design, or from a worktree under KB_design/.local/worktrees/.
  const text = ['../../irori-templete', '../../../../irori-templete']
    .map((dir) => {
      try {
        return readFileSync(new URL(`${dir}/.property/property.json`, import.meta.url), 'utf8');
      } catch {
        return undefined;
      }
    })
    .find((found) => found !== undefined);
  if (!text) {
    t.skip('irori-templete is not checked out beside this repository');
    return;
  }
  const parsed = propertyDeclaration.parse(JSON.parse(text));
  assert.equal(parsed.properties.generated?.auto, 'last-change');
  assert.ok(parsed.types.artifact);
});

test('The head keeps the YAML as typed, and a structured edit leaves no blank line', () => {
  for (const yaml of ['a: 1', 'a: 1\n', '', 'a: 1\n\n']) {
    const text = frontmatterHead(yaml) + 'body';
    assert.equal(splitPage(text).yaml, yaml, JSON.stringify(yaml));
  }
  assert.equal(withProperty('---\na: 1\n---\nbody', ['b'], 2), '---\na: 1\nb: 2\n---\nbody');
  assert.equal(withProperty('body', ['title'], 'x'), '---\ntitle: x\n---\nbody');
});
