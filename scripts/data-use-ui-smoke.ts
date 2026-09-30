import { _electron as electron, expect, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { FileService } from '../src/host/files';

// Exercise the real host/preload/renderer. Only native dialog responses and Pi's
// protocol are fixtures; no consent receipts are seeded and no provider runs.
if (process.platform === 'win32') {
  console.log('Data-use UI protocol executable fixtures are POSIX only.');
  process.exit(0);
}
type DialogFixture = {
  response: number;
  calls: { message: string; detail: string; defaultId: number; cancelId: number }[];
};
const base = await mkdtemp(path.join(tmpdir(), 'irori data-use UI '));
const files = new FileService(path.join(base, 'device'));
await files.init();
const root = path.join(base, 'KB');
await mkdir(root);
await writeFile(path.join(root, 'note.md'), '# Synthetic material\n');
const space = await files.register(root, 'データ確認', 'personal');
const bin = path.join(base, 'bin');
await mkdir(bin);
await writeFile(
  path.join(bin, 'pi'),
  `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/harnesses.mjs')).href)}).then(m=>m.run('pi'));\n`,
  { mode: 0o700 },
);
const env = {
  ...process.env,
  PATH: bin + path.delimiter + process.env.PATH,
  IRORI_DATA_DIR: files.dataDir,
} as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
let app: ElectronApplication | undefined;
async function launch() {
  app = await electron.launch({
    args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), '.'],
    env,
  });
  await app.evaluate(({ dialog }) => {
    const fixture: DialogFixture = ((
      globalThis as unknown as { dataUseFixture: DialogFixture }
    ).dataUseFixture = {
      response: 0,
      calls: [],
    });
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args.at(-1) as DialogFixture['calls'][number];
      fixture.calls.push({
        message: options.message,
        detail: options.detail,
        defaultId: options.defaultId,
        cancelId: options.cancelId,
      });
      return { response: fixture.response, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
  return app.firstWindow();
}
const receipt = () =>
  readFile(path.join(files.dataDir, 'data-consent.json'), 'utf8')
    .then((text) => JSON.parse(text).accepted as Record<string, string>)
    .catch(() => ({}));
const calls = () =>
  app!.evaluate(
    () => (globalThis as unknown as { dataUseFixture: DialogFixture }).dataUseFixture.calls,
  );
const respond = (response: number) =>
  app!.evaluate((_, value) => {
    (globalThis as unknown as { dataUseFixture: DialogFixture }).dataUseFixture.response = value;
  }, response);
try {
  let page = await launch();
  await expect(page.getByRole('heading', { name: 'ワークスペースを選択' })).toBeVisible();
  expect(await calls()).toEqual([]);
  const ids = { scopeId: space.scopeId, mountId: randomUUID() };
  const automatic = await page.evaluate(
    async (value) =>
      window.irori.connectCloud(value.scopeId, value.mountId, true).then(() => '', String),
    ids,
  );
  expect(automatic).toContain('データ利用');
  expect(await calls()).toEqual([]);
  const declinedGoogle = await page.evaluate(async () =>
    window.irori.addCloudAccount('Synthetic').then(() => '', String),
  );
  expect(declinedGoogle).toContain('同意');
  expect(await page.evaluate(() => window.irori.cloudAccounts())).toEqual([]);
  expect(await receipt()).toEqual({});
  const firstDialog = (await calls())[0];
  expect(firstDialog.message).toContain('Google Drive');
  expect(firstDialog.detail).toContain('Drive 全体');
  expect(firstDialog.defaultId).toBe(0);
  expect(firstDialog.cancelId).toBe(0);

  const input = {
    scopeId: space.scopeId,
    agent: 'pi' as const,
    prompt: 'hold synthetic request',
    notePath: 'note.md',
  };
  const rejectedAgent = await page.evaluate(
    async (value) => window.irori.start(value).then(() => '', String),
    input,
  );
  expect(rejectedAgent).toContain('同意');
  expect(await page.evaluate((id) => window.irori.agentConversations(id), space.scopeId)).toEqual(
    [],
  );
  expect(await receipt()).toEqual({});
  await respond(1);
  await page.evaluate((value) => window.irori.start(value), input);
  await expect
    .poll(async () =>
      (
        await page.evaluate((id) => window.irori.agentConversation(id, 'pi'), space.scopeId)
      ).events.some((event) => event.type === 'tool'),
    )
    .toBe(true);
  await page.evaluate((id) => window.irori.cancel(id), space.scopeId);
  await expect
    .poll(
      async () =>
        (await page.evaluate((id) => window.irori.agentConversation(id, 'pi'), space.scopeId))
          .activeRunId,
    )
    .toBeUndefined();
  expect(Object.keys(await receipt())).toEqual(['pi']);

  // The program gate is separate even after approving the CLI.
  await respond(0);
  const shells = await page.evaluate(() => window.irori.terminalShells());
  const terminalInput = { id: space.scopeId, shell: shells[0].id };
  expect(
    await page.evaluate(
      async (value) =>
        window.irori.openTerminal(value.id, value.shell, 80, 24).then(() => '', String),
      terminalInput,
    ),
  ).toContain('同意');
  expect(Object.keys(await receipt())).toEqual(['pi']);
  await respond(1);
  const terminal = await page.evaluate(
    (value) => window.irori.openTerminal(value.id, value.shell, 80, 24),
    terminalInput,
  );
  await page.evaluate((id) => window.irori.closeTerminal(id), terminal.id);
  expect(Object.keys(await receipt()).sort()).toEqual(['pi', 'programs']);
  await app!.close();
  app = undefined;
  page = await launch();
  const reopened = await page.evaluate(
    (value) => window.irori.openTerminal(value.id, value.shell, 80, 24),
    terminalInput,
  );
  await page.evaluate((id) => window.irori.closeTerminal(id), reopened.id);
  expect(await calls()).toEqual([]);

  // The rendered setting invokes the real host reset, with cancellation safe.
  await page.getByRole('checkbox', { name: /データ確認/ }).check();
  await page.getByRole('button', { name: '選択したスペースを開く' }).click();
  await page.getByRole('button', { name: /^設定（/ }).click();
  await page.getByRole('button', { name: 'データ利用を確認し直す', exact: true }).click();
  await expect.poll(async () => (await calls()).length).toBe(1);
  expect(Object.keys(await receipt()).sort()).toEqual(['pi', 'programs']);
  await respond(1);
  await page.getByRole('button', { name: 'データ利用を確認し直す', exact: true }).click();
  await expect.poll(receipt).toEqual({});
  await respond(0);
  expect(
    await page.evaluate(
      async (value) =>
        window.irori.openTerminal(value.id, value.shell, 80, 24).then(() => '', String),
      terminalInput,
    ),
  ).toContain('同意');
  expect(await readFile(path.join(root, 'note.md'), 'utf8')).toBe('# Synthetic material\n');
  console.log(
    'Data-use UI passed: no startup modal, silent automatic refusal, default-cancel disclosure, denied Google/AI/program operations, persisted independent receipts and rendered reset. No model or Google calls.',
  );
} finally {
  await app?.close();
  await rm(base, { recursive: true, force: true });
}
