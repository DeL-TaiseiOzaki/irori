import { _electron as electron, expect, type Page, type Locator } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';

// Exercise the real desktop, editor views, settings and disposable KB. The IPC
// wrapper only observes writes and injects one explicitly bounded save failure.
const base = await mkdtemp(path.join(tmpdir(), 'irori editor assistance UI '));
const root = path.join(base, 'Knowledge');
await mkdir(root);
const files = new FileService(path.join(base, 'device'));
await files.init();
const space = await files.register(root, 'コード支援の検証', 'personal');
const script = 'function greeting(name) {\n  return `Hello, ${name}`;\n}\n';
const json = '{\n  "title": "Japanese 日本語",\n  "enabled": true\n}\n';
const markdown =
  '# Code in a note\n\nThe note remains editable.\n\n```javascript\nfunction example() {\n  return 42;\n}\n```\n';
await writeFile(path.join(root, 'example.js'), script);
await writeFile(path.join(root, 'config.json'), json);
await writeFile(path.join(root, 'note.md'), markdown);
await new WorkspaceService(files).save('コード支援の検証', [space.scopeId]);
const settingsFile = path.join(files.dataDir, 'device-settings.json');
const env = { ...process.env, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const errors: string[] = [];
let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
type Observation = { saves: number; drafts: number; forbidden: number; rejectSave: boolean };

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
  // Wrap the handler only after the first load, or the reload below aborts it.
  await expect(
    page.getByRole('heading', { name: 'ワークスペースを選択', exact: true }),
  ).toBeVisible();
  await app.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;
    const original = (
      ipcMain as unknown as { _invokeHandlers: Map<string, Handler> }
    )._invokeHandlers.get('irori')!;
    const observation: Observation = { saves: 0, drafts: 0, forbidden: 0, rejectSave: false };
    (globalThis as unknown as { assistanceUi: Observation }).assistanceUi = observation;
    ipcMain.removeHandler('irori');
    ipcMain.handle('irori', (event, method, ...args) => {
      if (
        [
          'start',
          'startQueuedMessage',
          'queueAgentMessage',
          'writeTerminal',
          'openTerminal',
        ].includes(method)
      ) {
        observation.forbidden++;
        return { ok: false, error: 'Agent and terminal execution is disabled in this fixture.' };
      }
      if (method === 'draft') observation.drafts++;
      if (method === 'save') {
        observation.saves++;
        if (observation.rejectSave)
          return { ok: false, error: 'Fixture note save held for dirty-editor acceptance.' };
      }
      return original(event, method, ...args);
    });
  });
  await page.reload();
  await page.locator('.workspace-card').filter({ hasText: 'コード支援の検証' }).click();
  return page;
}
async function observation() {
  return app!.evaluate(() => (globalThis as unknown as { assistanceUi: Observation }).assistanceUi);
}
async function rejectSave(value: boolean) {
  await app!.evaluate((_electron, reject) => {
    (globalThis as unknown as { assistanceUi: Observation }).assistanceUi.rejectSave = reject;
  }, value);
}
async function close() {
  expect((await observation()).forbidden).toBe(0);
  await app!.close();
  app = undefined;
}
// Code assistance is a checkbox in the note's menu, which stays open after it.
const toggle = (page: Page) => page.getByRole('menuitemcheckbox', { name: 'コード支援' });
async function inMenu(page: Page, act: () => Promise<void>) {
  await page.getByRole('button', { name: /^その他（/ }).click();
  await act();
  await page.keyboard.press('Escape');
  await expect(toggle(page)).toHaveCount(0);
}
async function assistance(page: Page, enabled: boolean) {
  await inMenu(page, () => expect(toggle(page)).toHaveAttribute('aria-checked', String(enabled)));
  await expect(page.locator('.document-editor')).toHaveAttribute(
    'data-editor-assistance',
    enabled ? 'on' : 'off',
  );
  const editor = page.locator('.document-editor .cm-editor').first();
  if (enabled) {
    await expect(editor.locator('.cm-lineNumbers')).toBeVisible();
    await expect(editor.locator('.cm-foldGutter')).toBeVisible();
  } else {
    await expect(editor.locator('.cm-lineNumbers')).toHaveCount(0);
    await expect(editor.locator('.cm-foldGutter')).toHaveCount(0);
  }
}
async function clickToggle(page: Page, enabled: boolean) {
  await inMenu(page, () => toggle(page).click());
  await assistance(page, enabled);
}
async function expectSelection(content: Locator, expected: string) {
  // CodeMirror restores the DOM selection from its state shortly after focus returns.
  await content.focus();
  await expect.poll(() => content.evaluate(() => window.getSelection()?.toString())).toBe(expected);
}
async function writesStayAt(before: Observation) {
  // The editor autosaves after one second. A display-only change must not
  // schedule an additional save or draft after that debounce has elapsed.
  await new Promise((resolve) => setTimeout(resolve, 1250));
  const after = await observation();
  expect({ saves: after.saves, drafts: after.drafts }).toEqual({
    saves: before.saves,
    drafts: before.drafts,
  });
}

try {
  let page = await launch();
  await page
    .locator('.brain-panel')
    .getByRole('button', { name: 'example.js', exact: true })
    .click();
  const source = page.locator('.document-editor.source .cm-editor');
  const content = source.locator('.cm-content');
  await expect(content).toContainText('function greeting');
  await assistance(page, true);
  await source.evaluate((element) => {
    element.dataset.fixtureIdentity = 'source-original';
  });
  await content.click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  const selected = 'fu';
  await expectSelection(content, selected);
  const cleanWrites = await observation();
  await clickToggle(page, false);
  await expectSelection(content, selected);
  await clickToggle(page, true);
  await expectSelection(content, selected);
  await expect(source).toHaveAttribute('data-fixture-identity', 'source-original');
  await writesStayAt(cleanWrites);
  expect(await readFile(path.join(root, 'example.js'), 'utf8')).toBe(script);

  // Keep an actual dirty editor while persistence is unavailable. Reconfiguring
  // its assistance must not replace its view, selection, text or undo history.
  await rejectSave(true);
  await content.focus();
  await page.keyboard.press('ControlOrMeta+End');
  const added = '// unsaved assistance fixture 日本語';
  await page.keyboard.insertText(`\n${added}`);
  await expect(page.locator('.error[role="alert"]')).toContainText('Fixture note save held');
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeVisible();
  await page.keyboard.press('Shift+Home');
  await expectSelection(content, added);
  const dirtyWrites = await observation();
  for (const enabled of [false, true, false, true]) {
    await clickToggle(page, enabled);
    await expect(content).toContainText(added);
    await expectSelection(content, added);
    await expect(source).toHaveAttribute('data-fixture-identity', 'source-original');
  }
  await writesStayAt(dirtyWrites);
  expect(await readFile(path.join(root, 'example.js'), 'utf8')).toBe(script);
  await content.press('ControlOrMeta+z');
  await expect(content).not.toContainText(added);
  await expect(content).toContainText('function greeting');
  await rejectSave(false);
  await content.press('ControlOrMeta+Shift+z');
  await expect(content).toContainText(added);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('保存済み', { exact: true })).toBeVisible();
  await expect.poll(() => readFile(path.join(root, 'example.js'), 'utf8')).toContain(added);
  await expect(source).toHaveAttribute('data-fixture-identity', 'source-original');
  await page.locator('.error').getByRole('button', { name: '閉じる', exact: true }).click();

  // The same display preference reaches another filename and newly created
  // fenced-code editors inside a Markdown document.
  await page
    .locator('.brain-panel')
    .getByRole('button', { name: 'config.json', exact: true })
    .click();
  await expect(page.locator('.document-editor.source .cm-content')).toContainText(
    'Japanese 日本語',
  );
  await assistance(page, true);
  await clickToggle(page, false);
  expect(await readFile(path.join(root, 'config.json'), 'utf8')).toBe(json);
  await page.locator('.brain-panel').getByRole('button', { name: 'note', exact: true }).click();
  const rich = page.locator('.ProseMirror');
  const code = page.locator('.document-editor.rich .milkdown-code-block .cm-editor');
  await expect(rich).toContainText('The note remains editable');
  await expect(code).toBeVisible();
  await assistance(page, false);
  await rich.evaluate((element) => {
    element.dataset.fixtureIdentity = 'rich-original';
  });
  await code.evaluate((element) => {
    element.dataset.fixtureIdentity = 'code-original';
  });
  const richWrites = await observation();
  await clickToggle(page, true);
  await clickToggle(page, false);
  await expect(rich).toHaveAttribute('data-fixture-identity', 'rich-original');
  await expect(code).toHaveAttribute('data-fixture-identity', 'code-original');
  await writesStayAt(richWrites);
  expect(await readFile(path.join(root, 'note.md'), 'utf8')).toBe(markdown);
  await expect
    .poll(async () => JSON.parse(await readFile(settingsFile, 'utf8')).editorAssistance)
    .toBe(false);
  await close();

  page = await launch();
  await page
    .locator('.brain-panel')
    .getByRole('button', { name: 'example.js', exact: true })
    .click();
  await expect(page.locator('.document-editor.source .cm-content')).toContainText(added);
  await assistance(page, false);
  await clickToggle(page, true);
  await expect
    .poll(async () => JSON.parse(await readFile(settingsFile, 'utf8')).editorAssistance)
    .toBe(true);

  // Fail the real SettingsService write by replacing only its disposable file
  // with a directory. A failed choice must not claim a new effective setting.
  const backup = `${settingsFile}.fixture-backup`;
  await rename(settingsFile, backup);
  await mkdir(settingsFile);
  try {
    await inMenu(page, () => toggle(page).click());
    await expect(page.locator('.error[role="alert"]')).toBeVisible();
    await inMenu(page, () => expect(toggle(page)).toBeEnabled());
    await assistance(page, true);
  } finally {
    await rm(settingsFile, { recursive: true, force: true });
    await rename(backup, settingsFile);
  }
  await page.locator('.error').getByRole('button', { name: '閉じる', exact: true }).click();
  await clickToggle(page, false);
  await expect
    .poll(async () => JSON.parse(await readFile(settingsFile, 'utf8')).editorAssistance)
    .toBe(false);
  await close();

  // An invalid typed preference follows the same default as an older device
  // record. This is a real host reload, not a renderer-local replacement value.
  const stored = JSON.parse(await readFile(settingsFile, 'utf8'));
  await writeFile(settingsFile, JSON.stringify({ ...stored, editorAssistance: 'invalid' }));
  page = await launch();
  await page
    .locator('.brain-panel')
    .getByRole('button', { name: 'config.json', exact: true })
    .click();
  await assistance(page, true);
  expect(await readFile(path.join(root, 'config.json'), 'utf8')).toBe(json);
  expect(await readFile(path.join(root, 'note.md'), 'utf8')).toBe(markdown);
  await close();
  if (errors.length) throw Error(`Renderer errors: ${errors.join('\n')}`);
  console.log(
    'Editor assistance UI passed: live source/fenced-code display, selection, dirty text, undo/save, no incidental note writes, restart persistence and settings failure recovery.',
  );
} finally {
  await app?.close();
  await rm(base, { recursive: true, force: true });
}
