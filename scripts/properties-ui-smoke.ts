import { _electron as electron, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';

// A disposable knowledge base shaped like irori-templete's: a property
// declaration in the schema layer, pages with frontmatter, a folder index, a
// page without frontmatter and one whose frontmatter does not parse. No provider
// or model process is started.
const base = await mkdtemp(path.join(tmpdir(), 'irori properties UI '));
const root = path.join(base, 'Knowledge');
await mkdir(path.join(root, '.property'), { recursive: true });
execFileSync('git', ['init', '--quiet', root]);
execFileSync('git', ['-C', root, 'config', 'user.email', 'properties.person@example.com']);
await writeFile(
  path.join(root, '.property', 'property.json'),
  JSON.stringify({
    schemaVersion: 1,
    properties: {
      type: { kind: 'type' },
      title: { kind: 'text' },
      description: { kind: 'text' },
      generated: { kind: 'actor-time', auto: 'last-change' },
      status: { kind: 'select', options: ['draft', 'stable', 'deprecated'] },
      resource: { kind: 'link' },
      sources: { kind: 'sources' },
      stale_after: { kind: 'datetime' },
      tags: { kind: 'multi-select' },
      sensitivity: { kind: 'select', options: ['internal', 'confidential', 'restricted'] },
    },
    required: ['type', 'title', 'description', 'generated'],
    types: {
      artifact: { heading: '# Artifacts', required: ['resource', 'sources'] },
      concept: { heading: '# Concepts', required: ['sources'] },
    },
    relations: {},
    avoid: [],
  }),
);
const proposalHead = `---
type: artifact                       # required
title: Proposal for customer A, v2   # required
description: What we sent to customer A.
generated: { by: human:someone, at: 2026-09-17T10:00:00Z }   # who last changed it
status: stable                       # draft | stable | deprecated
sources:
  - { id: rfp, resource: contents/drive/source/rfp.pdf, title: Customer A RFP }
tags: [pricing]
x-team: keep me
---
`;
const proposalBody = '\n# 提案書\n\n本文はそのまま残ります。\n';
await writeFile(path.join(root, 'proposal.md'), proposalHead + proposalBody);
await writeFile(
  path.join(root, 'index.md'),
  '# Artifacts\n\n* [proposal](proposal.md) - What we sent\n',
);
await writeFile(path.join(root, 'bare.md'), '# 素のページ\n');
await writeFile(path.join(root, 'broken.md'), '---\ntitle: [unclosed\n---\n# 壊れた frontmatter\n');

const files = new FileService(path.join(base, 'device'));
await files.init();
await files.register(root, 'プロパティのKB', 'personal');
const env = { ...process.env, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), '.'],
  env,
});
const errors: string[] = [];
const onDisk = (name: string) => readFile(path.join(root, name), 'utf8');
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.getByRole('checkbox', { name: /プロパティのKB/ }).check();
  await page.getByLabel('ワークスペース名').fill('Properties workspace');
  await page.getByRole('button', { name: '選択したスペースを開く', exact: true }).click();

  // The page opens with its properties above the body, not a YAML block.
  await page.getByRole('button', { name: 'proposal', exact: true }).click();
  const properties = page.getByRole('region', { name: 'プロパティ', exact: true });
  const editor = page.locator('.ProseMirror');
  await expect(editor).toContainText('本文はそのまま残ります。');
  await expect(editor).not.toContainText('x-team');
  await expect(properties.getByLabel('タイトル')).toHaveValue('Proposal for customer A, v2');
  await expect(properties.getByLabel('説明')).toHaveValue('What we sent to customer A.');
  await expect(properties.getByLabel('種類', { exact: true })).toHaveValue('artifact');
  await expect(properties.getByLabel('状態', { exact: true })).toHaveValue('stable');
  await expect(properties.locator('.properties-chip')).toHaveText(['pricing×']);
  await expect(properties.getByText('x-team')).toBeVisible();
  // The type requires a file the page does not name yet.
  await expect(properties.locator('.properties-row[data-missing]')).toContainText('ファイル');
  // Opening a page and doing nothing leaves its bytes alone.
  expect(await onDisk('proposal.md')).toBe(proposalHead + proposalBody);

  // A select and a tag change one line each; the save names the person.
  await properties.getByLabel('状態', { exact: true }).selectOption('draft');
  const tagInput = properties.locator('.properties-chips input');
  await tagInput.fill('q3');
  await tagInput.press('Enter');
  await expect
    .poll(() => onDisk('proposal.md'), { timeout: 10000 })
    .toContain('tags: [pricing, q3]');
  const saved = await onDisk('proposal.md');
  expect(saved).toContain('status: draft                       # draft | stable | deprecated\n');
  expect(saved).toMatch(
    /generated: \{ by: human:properties\.person, at: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d \}   # who last changed it\n/,
  );
  expect(saved).toContain('type: artifact                       # required\n');
  expect(saved).toContain('x-team: keep me\n');
  expect(saved.endsWith(proposalBody)).toBe(true);
  await expect(properties.getByText('human:properties.person')).toBeVisible();

  // The raw view is the same YAML, and an edit there is kept as typed.
  await properties.getByRole('button', { name: 'YAML で編集' }).click();
  const raw = properties.getByLabel('frontmatter（YAML）');
  await expect(raw).toHaveValue(/status: draft/);
  await raw.press('ControlOrMeta+End');
  await raw.pressSequentially('\nsensitivity: internal');
  await expect
    .poll(() => onDisk('proposal.md'), { timeout: 10000 })
    .toContain('sensitivity: internal\n---\n');
  await properties.getByRole('button', { name: 'プロパティで編集' }).click();
  await expect(properties.getByLabel('公開範囲', { exact: true })).toHaveValue('internal');

  // A folder index keeps the plain editor.
  await page.getByRole('button', { name: 'index', exact: true }).click();
  await expect(editor).toContainText('Artifacts');
  await expect(page.getByRole('region', { name: 'プロパティ', exact: true })).toHaveCount(0);

  // A page without frontmatter offers to start one with the declared keys.
  await page.getByRole('button', { name: 'bare', exact: true }).click();
  await expect(editor).toContainText('素のページ');
  await properties.getByRole('button', { name: '＋ プロパティを追加' }).click();
  await expect(properties.getByLabel('タイトル')).toHaveValue('bare');
  await expect
    .poll(() => onDisk('bare.md'), { timeout: 10000 })
    .toMatch(
      /^---\ntype: ""\ntitle: bare\ndescription: ""\ngenerated: \{ by: human:properties\.person, at: [^}]+ \}\n---\n# 素のページ\n$/,
    );

  // Frontmatter that does not parse opens as YAML with the reason.
  await page.getByRole('button', { name: 'broken', exact: true }).click();
  await expect(editor).toContainText('壊れた frontmatter');
  await expect(properties.getByRole('alert')).toContainText('frontmatter を読めません');
  await expect(properties.getByLabel('frontmatter（YAML）')).toHaveValue('title: [unclosed');
  expect(await onDisk('broken.md')).toBe('---\ntitle: [unclosed\n---\n# 壊れた frontmatter\n');

  if (errors.length) throw Error(`Renderer errors: ${errors.join('\n')}`);
  console.log(
    'Properties UI smoke passed: declared properties shown above the body, a select and a tag written in place with the person named as the last change, the raw YAML view, a plain index, a page given frontmatter, and broken frontmatter left untouched.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
