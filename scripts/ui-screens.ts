import { _electron as electron, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';
import { YourAiService } from '../src/host/you';

// Screenshots of the v5 screens in each theme and language, to compare with the
// design canvas. Not part of `test:ui`: `tsx scripts/ui-screens.ts [theme-lang ...]`
// writes test-results/screens/<lang>-<screen>-<theme>.png. The notes are
// placeholders, not anyone's data.
const runs = (
  process.argv.slice(2).length ? process.argv.slice(2) : ['hearth-ja', 'dark-en', 'light-ja']
).map((value) => {
  const [theme, language] = value.split('-') as ['hearth' | 'light' | 'dark', 'ja' | 'en'];
  return { theme, language };
});
const out = path.resolve('test-results', 'screens');
await mkdir(out, { recursive: true });

async function fixture(base: string) {
  const home = path.join(base, 'home');
  await mkdir(home);
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const roots: Record<string, string> = {};
  for (const name of ['Product', 'Research', 'Handbook']) {
    const root = path.join(base, name);
    await mkdir(path.join(root, 'Knowledge_Base', 'notes'), { recursive: true });
    await writeFile(path.join(root, 'AGENTS.md'), `# ${name}\n\nThis brain's working agreement.\n`);
    await mkdir(path.join(root, '.agents', 'skills', 'weekly-review'), { recursive: true });
    await writeFile(
      path.join(root, '.agents', 'skills', 'weekly-review', 'SKILL.md'),
      '---\nname: weekly-review\ndescription: Summarise the week.\n---\nCollect the week’s notes.\n',
    );
    roots[name] = root;
  }
  const notes: Record<string, string> = {
    'Knowledge_Base/notes/decision-001.md':
      '# Decision 001\n\nWe keep one brain per team and link across brains.\n\n## Why\n\n- Each brain keeps its own Schema.\n- Links carry the context.\n',
    'Knowledge_Base/notes/interviews.md': '# Interviews\n\nThree conversations this week.\n',
    'Knowledge_Base/2026-09-25.md': '# 2026-09-25\n\n- Draft the decision note\n',
  };
  for (const [relative, text] of Object.entries(notes))
    await writeFile(path.join(roots.Product, relative), text);
  await writeFile(
    path.join(roots.Research, 'Knowledge_Base', 'notes', 'sources.md'),
    '# Sources\n',
  );
  await writeFile(path.join(roots.Handbook, 'Knowledge_Base', 'notes', 'policy.md'), '# Policy\n');
  const product = await files.register(roots.Product, 'Product', 'team');
  const research = await files.register(roots.Research, 'Research', 'team');
  const handbook = await files.register(roots.Handbook, 'Handbook', 'organization');
  await new WorkspaceService(files).save('Lab', [
    product.scopeId,
    research.scopeId,
    handbook.scopeId,
  ]);
  // A small ontology for the graph.
  await mkdir(path.join(roots.Product, 'Knowledge_Base', 'ontology'), { recursive: true });
  await writeFile(
    path.join(roots.Product, '.irori', 'ontology.json'),
    JSON.stringify({
      schemaVersion: 1,
      entities: {
        path: 'Knowledge_Base/ontology/entities.csv',
        note: 'note',
        parent: 'parent',
        group: 'group',
      },
      relations: { path: 'Knowledge_Base/ontology/relations.csv' },
    }),
  );
  await writeFile(
    path.join(roots.Product, 'Knowledge_Base', 'ontology', 'entities.csv'),
    'id,label,note,parent,group\nproduct,Product,,,core\ndecision,Decision,Knowledge_Base/notes/decision-001.md,product,core\ninterview,Interview,Knowledge_Base/notes/interviews.md,product,research\n',
  );
  await writeFile(
    path.join(roots.Product, 'Knowledge_Base', 'ontology', 'relations.csv'),
    'sourceId,relation,targetId\ninterview,informs,decision\n',
  );
  // Git history with one change, for Changes.
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: roots.Product,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'irori',
        GIT_AUTHOR_EMAIL: 'irori@example.invalid',
        GIT_COMMITTER_NAME: 'irori',
        GIT_COMMITTER_EMAIL: 'irori@example.invalid',
      },
    });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'Start the product brain');
  await writeFile(
    path.join(roots.Product, 'Knowledge_Base', 'notes', 'interviews.md'),
    '# Interviews\n\nThree conversations this week.\n\n- Onboarding took too long.\n',
  );
  // Your AI set up, as the Overview would.
  const you = new YourAiService(files.dataDir, home);
  await you.create();
  return { files, home };
}

async function shot(page: Page, name: string, run: { theme: string; language: string }) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, `${run.language}-${name}-${run.theme}.png`) });
  console.log(`${run.language}-${name}-${run.theme}`);
}

for (const run of runs) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori screens '));
  const { files, home } = await fixture(base);
  await writeFile(
    path.join(files.dataDir, 'device-settings.json'),
    JSON.stringify({ theme: run.theme, language: run.language }),
  );
  const env = { ...process.env, HOME: home, IRORI_DATA_DIR: files.dataDir } as Record<
    string,
    string
  >;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [
      ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      '.',
    ],
    env,
  });
  const L = (ja: string, en: string) => (run.language === 'ja' ? ja : en);
  const step = async (name: string, action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      console.log(`skipped ${name}: ${String(error).split('\n')[0]}`);
    }
  };
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
      const [window] = BrowserWindow.getAllWindows();
      window.setSize(1440, 900);
    });
    page.setDefaultTimeout(8000);
    await step('start', () => shot(page, 'Start', run));
    await page.locator('.workspace-card').filter({ hasText: 'Lab' }).click();
    await step('home', () => shot(page, 'Home', run));
    await step('note', async () => {
      await page.getByRole('button', { name: 'notes', exact: true }).click();
      await page.getByRole('button', { name: 'decision-001', exact: true }).click();
      await page.getByRole('button', { name: L('AIに相談', 'Ask AI'), exact: true }).click();
      await shot(page, 'Main', run);
    });
    await step('search', async () => {
      await page.keyboard.press('Control+k');
      await page.getByLabel(L('本文を検索', 'Search body text'), { exact: true }).fill('brain');
      await page.keyboard.press('Enter');
      await shot(page, 'Search', run);
      await page.getByRole('button', { name: L('閉じる', 'Close'), exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
    });
    await step('settings', async () => {
      await page
        .getByRole('button', { name: L('Brain のメニュー', 'Brain menu'), exact: true })
        .click();
      await page
        .getByRole('menuitem', { name: L('Brain の設定', 'Brain settings'), exact: true })
        .click();
      await shot(page, 'Settings', run);
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
    });
    await step('changes', async () => {
      await page
        .getByRole('group', { name: L('Brain の表示', 'Brain view') })
        .getByRole('button', { name: new RegExp(`^${L('変更', 'Changes')}`) })
        .click();
      await page
        .getByRole('button', { name: /interviews/ })
        .first()
        .click();
      await shot(page, 'Changes', run);
      await page
        .getByRole('group', { name: L('Brain の表示', 'Brain view') })
        .getByRole('button', { name: L('ファイル', 'Files'), exact: true })
        .click();
    });
    await step('graph', async () => {
      await page
        .getByRole('button', { name: L('グラフ（オントロジー）', 'Graph (ontology)'), exact: true })
        .click();
      await shot(page, 'Graph', run);
    });
    await step('records', async () => {
      await page.getByRole('button', { name: 'decision-001', exact: true }).click();
      await page.locator('.brain-names').click();
      await page
        .getByRole('button', { name: L('資料と成果物', 'Materials and outputs') })
        .first()
        .click();
      await shot(page, 'Records', run);
    });
    await step('connect', async () => {
      await page
        .getByRole('button', {
          name: L('Product のクラウド接続', 'Cloud connection for Product'),
          exact: true,
        })
        .click();
      await shot(page, 'Connect', run);
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
    });
    const rail = page.getByRole('navigation', { name: L('Brain', 'Brains') });
    await step('overview', async () => {
      await rail.getByRole('button', { name: L('全体', 'Overview'), exact: true }).click();
      await shot(page, 'Atlas', run);
    });
    await step('columns', async () => {
      await page.getByRole('button', { name: L('並列', 'Columns'), exact: true }).click();
      await shot(page, 'Columns', run);
      await page.getByRole('button', { name: L('地図', 'Map'), exact: true }).click();
    });
    await step('you', async () => {
      await page
        .getByRole('button', { name: L('あなたの AI の Schema を開く', "Open your AI's Schema") })
        .click();
      await shot(page, 'You', run);
    });
  } finally {
    await app.close();
    await rm(base, { recursive: true, force: true });
  }
}
