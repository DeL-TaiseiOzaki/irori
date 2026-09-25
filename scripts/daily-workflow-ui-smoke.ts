import { _electron as electron, expect, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';
import type { AgentId, Space } from '../src/domain/types';
import { dateTokens } from '../src/domain/notes';

// Exercise the actual desktop bridge and disk persistence in disposable KBs.
// Only provider discovery is stubbed; model starts and update requests are rejected.
const base = await mkdtemp(path.join(tmpdir(), 'irori daily UI 日本語 '));
const files = new FileService(path.join(base, 'device'));
await files.init();
const spaces: Space[] = [];
for (const [name, category] of [
  ['日常の個人KB', 'personal'],
  ['日常のチームKB', 'team'],
] as const) {
  const root = path.join(base, name);
  await mkdir(root);
  spaces.push(await files.register(root, name, category));
  await writeFile(path.join(root, '作業.md'), `# ${name}\n\nDaily fixture note.\n`);
}
const root = spaces[0].root;
// The personal KB declares where today's note goes and the template it starts from.
await mkdir(path.join(root, '.irori/templates'), { recursive: true });
await writeFile(path.join(root, '.irori/templates/daily.md'), '# Daily {{date}}\n\n## Log\n');
await writeFile(
  path.join(root, '.irori/notes.json'),
  JSON.stringify({
    schemaVersion: 1,
    newNoteDirectory: 'Knowledge_Base/journal',
    daily: {
      path: 'Knowledge_Base/journal/{{yyyy}}/{{date}}.md',
      template: '.irori/templates/daily.md',
    },
  }),
);
const customDirectory = '日常/下書き';
const destination = '整理先';
await mkdir(path.join(root, customDirectory), { recursive: true });
await mkdir(path.join(root, destination));
const brokenMarkdown =
  '# Missing image fixture\n\n![Missing](missing-image.png)\n\n![Unreadable](invalid-image.png)\n';
await writeFile(path.join(root, '画像エラー.md'), brokenMarkdown);
await writeFile(path.join(root, 'invalid-image.png'), 'This is not an image.\n');
await new WorkspaceService(files).save(
  '日常操作の検証',
  spaces.map((space) => space.scopeId),
);
const env = { ...process.env, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const errors: string[] = [];
let app: Awaited<ReturnType<typeof electron.launch>> | undefined;

async function launch() {
  app = await electron.launch({
    args: [
      ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      '.',
    ],
    env,
  });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await expect(
    page.getByRole('heading', { name: 'ワークスペースを選択', exact: true }),
  ).toBeVisible();
  await app.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;
    const original = (
      ipcMain as unknown as { _invokeHandlers: Map<string, Handler> }
    )._invokeHandlers.get('irori')!;
    const fixture = { modelCalls: 0, updateCalls: 0 };
    (globalThis as unknown as { dailyUiFixture: typeof fixture }).dailyUiFixture = fixture;
    ipcMain.removeHandler('irori');
    ipcMain.handle('irori', (event, method, ...args) => {
      if (['start', 'startQueuedMessage', 'queueAgentMessage'].includes(method)) {
        fixture.modelCalls++;
        return { ok: false, error: 'Model execution is disabled in this UI fixture.' };
      }
      if (['checkForUpdates', 'openUpdatePage'].includes(method)) {
        fixture.updateCalls++;
        return { ok: false, error: 'Update networking is disabled in this UI fixture.' };
      }
      if (method === 'agents')
        return {
          ok: true,
          value: ['codex', 'claude', 'opencode', 'pi'].map((id) => ({
            id,
            version: 'UI fixture',
            available: true,
            tested: true,
            detail: 'No model is executed by this fixture.',
          })),
        };
      return original(event, method, ...args);
    });
  });
  await page.reload();
  await expect(page.getByRole('button', { name: '更新を確認', exact: true })).toBeVisible();
  await page.locator('.workspace-card').filter({ hasText: '日常操作の検証' }).click();
  await page
    .getByRole('region', { name: 'Knowledge', exact: true })
    .getByRole('button', { name: '作業', exact: true })
    .click();
  await expect(page.locator('.ProseMirror')).toContainText('Daily fixture note');
  await page.getByRole('button', { name: 'AIに相談', exact: true }).click();
  await expect(page.getByLabel('エージェントへの指示', { exact: true })).toBeEnabled();
  return page;
}
async function close() {
  const calls = await app!.evaluate(
    () =>
      (globalThis as unknown as { dailyUiFixture: { modelCalls: number; updateCalls: number } })
        .dailyUiFixture,
  );
  expect(calls).toEqual({ modelCalls: 0, updateCalls: 0 });
  await app!.close();
  app = undefined;
}
/** A brain's tile on the rail. */
function brainButton(page: Page, space: Space) {
  const name = space.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page
    .getByRole('navigation', { name: 'Brain' })
    .getByRole('button', { name: new RegExp(`^${name}・AI`) });
}
/** Opens the note's menu and takes one of its actions. */
async function noteMenu(page: Page, name: string) {
  await page.getByRole('button', { name: /^その他（/ }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
async function chooseScope(page: Page, space: Space) {
  await brainButton(page, space).click();
  await expect(page.locator('.composer-context')).toContainText(space.name);
}
async function chooseAgent(page: Page, agent: AgentId) {
  await page.getByLabel('エージェント', { exact: true }).selectOption(agent);
  await expect(page.getByLabel('エージェント', { exact: true })).toHaveValue(agent);
}
async function exists(filename: string) {
  return access(filename).then(
    () => true,
    () => false,
  );
}
async function imageIsVisible(page: Page) {
  await expect
    .poll(() =>
      page
        .locator('.ProseMirror img')
        .evaluateAll((images) =>
          images.some((image) => (image as HTMLImageElement).naturalWidth === 1),
        ),
    )
    .toBe(true);
}
try {
  let page = await launch();
  let composer = page.getByLabel('エージェントへの指示', { exact: true });
  const personalCodex = '個人 Codex の未送信下書き';
  const personalClaude = '個人 Claude の未送信下書き';
  const teamCodex = 'チーム Codex の未送信下書き';
  const teamClaude = 'チーム Claude の未送信下書き';
  await expect(composer).toHaveValue('');
  await composer.fill(personalCodex);
  await expect(page.locator('.composer')).toContainText('未送信の下書きをこの端末に保存済み');
  const send = page.getByRole('button', { name: '送信', exact: true });
  await expect(send).toBeEnabled();
  const draftDirectory = path.join(files.dataDir, 'drafts');
  let draftFile: string | undefined;
  for (const name of await readdir(draftDirectory)) {
    const candidate = path.join(draftDirectory, name);
    if (
      name.endsWith('.json') &&
      JSON.parse(await readFile(candidate, 'utf8')).text === personalCodex
    )
      draftFile = candidate;
  }
  expect(draftFile).toBeDefined();
  const recordPath = draftFile!;
  const backup = `${recordPath}.fixture-backup`;
  await rename(recordPath, backup);
  await mkdir(recordPath);
  const failedText = `${personalCodex}\n保存失敗中も保持する追記`;
  try {
    await composer.fill(failedText);
    await expect(page.locator('.composer [role="alert"]')).toContainText(
      '下書きを保存できませんでした',
    );
    await expect(composer).toHaveValue(failedText);
    await expect(send).toBeDisabled();
    await page.getByLabel('エージェント', { exact: true }).selectOption('claude');
    await expect(page.getByLabel('エージェント', { exact: true })).toHaveValue('codex');
    await brainButton(page, spaces[1]).click();
    await expect(page.locator('.composer-context')).toContainText(spaces[0].name);
    await expect(composer).toHaveValue(failedText);
  } finally {
    // Restore the exact disposable record before exercising the user's retry action.
    await rm(recordPath, { recursive: true });
    await rename(backup, recordPath);
    await page.getByRole('button', { name: '下書き保存を再試行', exact: true }).click();
    await expect(page.locator('.composer [role="alert"]')).toHaveCount(0);
  }
  await expect
    .poll(async () => JSON.parse(await readFile(recordPath, 'utf8')).text)
    .toBe(failedText);
  await expect(send).toBeEnabled();
  await composer.fill(personalCodex);
  await chooseAgent(page, 'claude');
  await expect(composer).toHaveValue('');
  await composer.fill(personalClaude);
  await chooseScope(page, spaces[1]);
  await expect(composer).toHaveValue('');
  await composer.fill(teamClaude);
  await chooseAgent(page, 'codex');
  await expect(composer).toHaveValue('');
  await composer.fill(teamCodex);
  await chooseScope(page, spaces[0]);
  // Each brain keeps the AI chosen for it.
  await expect(composer).toHaveValue(personalClaude);
  await chooseAgent(page, 'codex');
  await expect(composer).toHaveValue(personalCodex);
  const finalPersonalCodex = `${personalCodex}\n終了直前の追記`;
  await composer.fill(finalPersonalCodex);
  await close();

  page = await launch();
  composer = page.getByLabel('エージェントへの指示', { exact: true });
  await expect(composer).toHaveValue(finalPersonalCodex);
  await chooseAgent(page, 'claude');
  await expect(composer).toHaveValue(personalClaude);
  await chooseScope(page, spaces[1]);
  await expect(composer).toHaveValue(teamClaude);
  await chooseAgent(page, 'codex');
  await expect(composer).toHaveValue(teamCodex);
  await chooseScope(page, spaces[0]);
  await expect(composer).toHaveValue(personalClaude);
  await chooseAgent(page, 'codex');
  await expect(composer).toHaveValue(finalPersonalCodex);
  await composer.fill('');
  await close();

  page = await launch();
  composer = page.getByLabel('エージェントへの指示', { exact: true });
  await expect(composer).toHaveValue('');
  await chooseAgent(page, 'claude');
  await expect(composer).toHaveValue(personalClaude);
  await chooseAgent(page, 'codex');
  await expect(composer).toHaveValue('');
  await page
    .locator('.agent-panel')
    .getByRole('button', { name: 'AIパネルを閉じる', exact: true })
    .click();

  await page.getByRole('button', { name: / にノートを作成$/ }).click();
  const create = page.getByRole('dialog', { name: 'ノートを作成', exact: true });
  await create.getByLabel('ノート名', { exact: true }).fill('整理前');
  await create.getByLabel('保存先フォルダー', { exact: true }).fill(customDirectory);
  await create.getByRole('button', { name: '作成', exact: true }).click();
  await expect(create).toHaveCount(0);
  const originalPath = path.join(root, customDirectory, '整理前.md');
  await expect.poll(() => exists(originalPath)).toBe(true);
  const editor = page.locator('.ProseMirror');
  await expect(editor).toContainText('整理前');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('整理しても保持する本文');
  await page.keyboard.press('Enter');
  const png = await app!.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
    const bytes = nativeImage
      .createFromBitmap(Buffer.from([0x22, 0x66, 0xcc, 0xff]), { width: 1, height: 1 })
      .toPNG();
    await clipboard.write([
      new ClipboardItem({ 'image/png': new Blob([new Uint8Array(bytes)], { type: 'image/png' }) }),
    ]);
    // The OS may re-encode the image when accepting it into the clipboard.
    const item = (await clipboard.read())[0];
    const stored = (await item.getType('image/png')) as Blob;
    return Buffer.from(await stored.arrayBuffer()).toString('base64');
  });
  await page.keyboard.press('ControlOrMeta+v');
  await imageIsVisible(page);
  await expect.poll(() => readFile(originalPath, 'utf8')).toContain('_assets/image-');
  const savedMarkdown = await readFile(originalPath, 'utf8');
  const imageRelative = savedMarkdown.match(/_assets\/image-[a-f0-9]{64}\.png/)![0];
  expect(savedMarkdown).toContain('整理しても保持する本文');
  expect(await readFile(path.join(root, customDirectory, imageRelative))).toEqual(
    Buffer.from(png, 'base64'),
  );

  await noteMenu(page, '名前・場所');
  let move = page.getByRole('dialog', { name: 'ノートの名前と場所', exact: true });
  await move.getByLabel('ノート名', { exact: true }).fill('名前変更');
  await move.getByRole('button', { name: '変更する', exact: true }).click();
  await expect(move).toHaveCount(0);
  const renamedPath = path.join(root, customDirectory, '名前変更.md');
  expect(await exists(originalPath)).toBe(false);
  expect(await readFile(renamedPath, 'utf8')).toBe(savedMarkdown);
  await expect(page.locator('.crumbs')).toHaveAttribute('title', /名前変更\.md$/);
  await imageIsVisible(page);
  await expect(page.locator('.stage .error[role="alert"]')).toHaveCount(0);

  await noteMenu(page, '名前・場所');
  move = page.getByRole('dialog', { name: 'ノートの名前と場所', exact: true });
  await move.getByLabel('移動先フォルダ', { exact: true }).fill(destination);
  await move.getByRole('button', { name: '変更する', exact: true }).click();
  await expect(move).toHaveCount(0);
  const movedPath = path.join(root, destination, '名前変更.md');
  expect(await exists(renamedPath)).toBe(false);
  expect(await readFile(movedPath, 'utf8')).toBe(savedMarkdown);
  expect(await readFile(path.join(root, destination, imageRelative))).toEqual(
    Buffer.from(png, 'base64'),
  );
  expect(await exists(path.join(root, customDirectory, imageRelative))).toBe(true);
  await imageIsVisible(page);
  await expect(page.locator('.stage .error[role="alert"]')).toHaveCount(0);

  await noteMenu(page, '削除');
  const trash = page.getByRole('dialog', { name: 'ノートを削除', exact: true });
  await trash.getByRole('button', { name: '削除済みに移す', exact: true }).click();
  await expect(trash).toHaveCount(0);
  expect(await exists(movedPath)).toBe(false);
  expect(await exists(path.join(root, destination, imageRelative))).toBe(true);
  await expect(page.locator('.stage .error[role="alert"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Brain のメニュー', exact: true }).click();
  await page.getByRole('menuitem', { name: '削除したノートを復元', exact: true }).click();
  const restore = page.getByRole('dialog', { name: '削除済みノート', exact: true });
  await restore
    .getByRole('button', { name: `${destination}/名前変更.md を復元`, exact: true })
    .click();
  await expect(restore).toHaveCount(0);
  expect(await readFile(movedPath, 'utf8')).toBe(savedMarkdown);
  await imageIsVisible(page);
  await expect(page.locator('.stage .error[role="alert"]')).toHaveCount(0);
  expect(
    await page.evaluate((scopeId) => window.irori.trashedNotes(scopeId), spaces[0].scopeId),
  ).toEqual([]);
  await page.getByRole('button', { name: 'AIに相談', exact: true }).click();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/irori-daily-workflow.png' });

  await page.getByRole('button', { name: '画像エラー', exact: true }).click();
  await expect(page.locator('.image-errors')).toContainText('表示できない画像があります。');
  await expect(page.locator('.image-errors')).toContainText('missing-image.png');
  await expect(page.locator('.image-errors')).toContainText('invalid-image.png');
  await page.keyboard.press('ControlOrMeta+s');
  expect(await readFile(path.join(root, '画像エラー.md'), 'utf8')).toBe(brokenMarkdown);
  await page.screenshot({ path: 'test-results/irori-missing-images.png' });
  await page
    .getByRole('region', { name: 'Knowledge', exact: true })
    .getByRole('button', { name: '作業', exact: true })
    .click();
  await expect(page.locator('.image-errors')).toHaveCount(0);

  // Today's note: created from the declared template on first use, reopened as is afterwards.
  const today = dateTokens(new Date());
  const dailyPath = path.join(root, 'Knowledge_Base/journal', today.yyyy, `${today.date}.md`);
  expect(await exists(dailyPath)).toBe(false);
  await page.getByRole('button', { name: '今日のノート', exact: true }).click();
  await expect.poll(() => exists(dailyPath)).toBe(true);
  await expect(page.locator('.crumbs')).toHaveAttribute('title', new RegExp(`${today.date}\\.md$`));
  await expect(page.locator('.ProseMirror')).toContainText(`Daily ${today.date}`);
  expect(await readFile(dailyPath, 'utf8')).toBe(`# Daily ${today.date}\n\n## Log\n`);
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('今日の記録');
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => readFile(dailyPath, 'utf8')).toContain('今日の記録');
  await page.getByRole('button', { name: '今日のノート', exact: true }).click();
  await expect(page.locator('.crumbs')).toHaveAttribute('title', new RegExp(`${today.date}\\.md$`));
  await expect(page.locator('.ProseMirror')).toContainText('今日の記録');
  expect(await readFile(dailyPath, 'utf8')).toContain('# Daily ');
  await expect(page.locator('.stage .error[role="alert"]')).toHaveCount(0);
  // The team KB declares nothing, so it offers no daily note.
  await chooseScope(page, spaces[1]);
  await expect(page.getByRole('button', { name: '今日のノート', exact: true })).toHaveCount(0);
  await chooseScope(page, spaces[0]);
  expect(errors).toEqual([]);
  await close();
  console.log(
    "Daily workflow UI smoke passed: composer restart/isolation/empty deletion/write failure and retry, custom note folder, rename, managed-image move, trash/restore, missing-image warning, preserved Markdown, and today's note from the declared template.",
  );
} finally {
  await app?.close();
  await rm(base, { recursive: true, force: true });
}
