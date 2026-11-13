import { _electron as electron, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { chooseJapanese } from '../tests/fixtures/japanese-interface';

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
      relations: { kind: 'relations' },
    },
    required: ['type', 'title', 'description', 'generated'],
    types: {
      artifact: { heading: '# Artifacts', required: ['resource', 'sources'] },
      concept: { heading: '# Concepts', required: ['sources'] },
      project: { heading: '# Projects', required: [] },
    },
    // The ontology (ADR 060): what a page may state, from which type, to which.
    relations: {
      about: { description: 'The project this page is about.', from: 'any', to: ['project'] },
      part_of: { description: 'A project inside another.', from: ['project'], to: ['project'] },
      same_as: { description: 'The same project elsewhere.', from: ['project'], to: 'url' },
    },
    avoid: [{ name: 'depends_on', use: 'about' }],
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
// Two pages inside the knowledge folder: a relation is picked among the pages of the bundle.
await mkdir(path.join(root, 'Knowledge_Base', 'wiki'), { recursive: true });
await writeFile(
  path.join(root, 'Knowledge_Base', 'wiki', 'alpha.md'),
  '---\ntype: project\ntitle: アルファ計画\ndescription: The first project.\n---\n\n# アルファ\n',
);
await writeFile(
  path.join(root, 'Knowledge_Base', 'wiki', 'claim.md'),
  '---\ntype: concept\ntitle: Claim\ndescription: One claim.\nsources:\n  - { id: s, resource: https://example.com/s }\n---\n\n# Claim\n',
);
await writeFile(path.join(root, 'broken.md'), '---\ntitle: [unclosed\n---\n# 壊れた frontmatter\n');

const files = new FileService(path.join(base, 'device'));
await files.init();
await files.register(root, 'プロパティのKB', 'personal');
await chooseJapanese(files.dataDir);
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

  // Smaller side margins widen the page; the properties stay aligned with the body.
  const pageEdges = () =>
    page.evaluate(() => {
      // Where each one's content starts: its box plus its own left padding.
      const [text, properties] = ['.ProseMirror', '.page-properties'].map((selector) => {
        const element = document.querySelector(selector)!;
        return (
          element.getBoundingClientRect().left + parseFloat(getComputedStyle(element).paddingLeft)
        );
      });
      return {
        stage: document.querySelector('.document-scroll')!.clientWidth,
        width: document.querySelector('.document-editor')!.getBoundingClientRect().width,
        text,
        properties,
      };
    });
  const chooseMargins = async (name: string) => {
    await page.getByRole('button', { name: /^設定（/ }).click();
    await page
      .getByRole('navigation', { name: '設定の項目' })
      .getByRole('button', { name: 'ノートの表示', exact: true })
      .click();
    await page.getByRole('group', { name: '左右の余白' }).getByRole('radio', { name }).check();
    await page.keyboard.press('Escape');
  };
  const standard = await pageEdges();
  expect(standard.width).toBeLessThanOrEqual(696);
  await chooseMargins('最小');
  await expect
    .poll(async () => (await page.evaluate(() => window.irori.deviceSettings())).pageMargins)
    .toBe('minimal');
  const minimal = await pageEdges();
  expect(minimal.width).toBeCloseTo(minimal.stage, 0);
  expect(minimal.text).toBeLessThan(standard.text);
  expect(minimal.properties - minimal.text).toBeCloseTo(standard.properties - standard.text, 0);
  await chooseMargins('標準');
  await expect.poll(async () => (await pageEdges()).width).toBeCloseTo(standard.width, 0);

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

  // A relation is picked, not typed (ADR 015 stage 2): the names a page of this type may
  // state, and the pages of the types that name points at.
  const claim = 'Knowledge_Base/wiki/claim.md';
  // The knowledge folder is open already; its `wiki` folder is not.
  await page.getByRole('button', { name: 'wiki', exact: true }).click();
  await page.getByRole('button', { name: 'claim', exact: true }).click();
  await expect(properties.getByLabel('タイトル')).toHaveValue('Claim');
  await properties.getByLabel('プロパティを追加').selectOption({ label: '関係' });
  await properties.getByRole('button', { name: '＋ 関係を追加' }).click();
  const relation = properties.locator('.properties-relation');
  // A concept may say what it is about; only a project may be part of one or the same as one.
  await expect(relation.getByLabel('関係', { exact: true }).locator('option')).toHaveText([
    'about',
  ]);
  const target = relation.getByLabel('関係の相手');
  await target.focus();
  // `about` points at projects: the one project is offered, the concept itself is not.
  await expect(relation.locator('datalist option')).toHaveCount(1);
  await expect(relation.locator('datalist option')).toHaveAttribute('value', 'alpha.md');
  await expect(relation.locator('datalist option')).toHaveAttribute(
    'label',
    'アルファ計画 · project',
  );
  await target.fill('alpha.md');
  await expect
    .poll(() => onDisk(claim), { timeout: 10000 })
    .toContain('relations: [{ rel: about, target: alpha.md }]\n');
  // A name the declaration lacks stays as written and is marked, never dropped.
  await properties.getByRole('button', { name: 'YAML で編集' }).click();
  await raw.fill((await raw.inputValue()).replace('rel: about', 'rel: depends_on'));
  await properties.getByRole('button', { name: 'プロパティで編集' }).click();
  await expect(relation.getByLabel('関係', { exact: true })).toHaveValue('depends_on');
  await expect(relation.getByLabel('関係', { exact: true }).locator('option').first()).toHaveText(
    'depends_on（宣言にない値）',
  );
  await relation.getByLabel('関係', { exact: true }).selectOption('about');
  await expect
    .poll(() => onDisk(claim), { timeout: 10000 })
    .toContain('relations: [{ rel: about, target: alpha.md }]\n');
  await page.getByRole('button', { name: 'proposal', exact: true }).click();
  await expect(properties.getByLabel('タイトル')).toHaveValue('Proposal for customer A, v2');

  // Folded, the title and description stay and the rows give way to their count.
  const fold = properties.locator('.properties-fold');
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(properties.locator('.properties-rows')).toHaveCount(0);
  await expect(properties.getByLabel('タイトル')).toHaveValue('Proposal for customer A, v2');
  await expect(properties.locator('.properties-count')).toHaveText(/^\d+$/);

  // A folder index keeps the plain editor.
  await page.getByRole('button', { name: 'index', exact: true }).click();
  await expect(editor).toContainText('Artifacts');
  await expect(page.getByRole('region', { name: 'プロパティ', exact: true })).toHaveCount(0);

  // A page without frontmatter offers to start one with the declared keys.
  await page.getByRole('button', { name: 'bare', exact: true }).click();
  await expect(editor).toContainText('素のページ');
  await properties.getByRole('button', { name: '＋ プロパティを追加' }).click();
  await expect(properties.getByLabel('タイトル')).toHaveValue('bare');
  // The fold holds on the next page too.
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(properties.locator('.properties-rows')).toHaveCount(0);
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
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  expect(await onDisk('broken.md')).toBe('---\ntitle: [unclosed\n---\n# 壊れた frontmatter\n');

  // A new page starts from a type (ADR 015 D6): its frontmatter is there before the first word.
  await page.getByRole('button', { name: / にノートを作成$/ }).click();
  const create = page.getByRole('dialog', { name: 'ノートを作成', exact: true });
  await create.getByLabel('ノート名').fill('案件 B');
  const folder = await create.getByLabel('保存先フォルダー').inputValue();
  await expect(create.getByLabel('種類', { exact: true }).locator('option')).toHaveText([
    'artifact',
    'concept',
    'project',
    '種類なし',
  ]);
  await create.getByLabel('種類', { exact: true }).selectOption('project');
  await create.getByRole('button', { name: '作成', exact: true }).click();
  await expect(properties.getByLabel('タイトル')).toHaveValue('案件 B');
  expect(await onDisk(`${folder}/案件 B.md`)).toMatch(
    /^---\ntype: project\ntitle: 案件 B\ndescription: ""\ngenerated: \{ by: human:properties\.person, at: [^}]+ \}\n---\n\n$/,
  );

  if (errors.length) throw Error(`Renderer errors: ${errors.join('\n')}`);
  console.log(
    'Properties UI smoke passed: declared properties shown above the body, a select and a tag written in place with the person named as the last change, the raw YAML view, folding kept across pages, a plain index, a relation picked from the declared names and pages, a page given frontmatter, a new page started from a type, and broken frontmatter left untouched.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
