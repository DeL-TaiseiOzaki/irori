import { _electron as electron, expect } from '@playwright/test';
import { extractFile, listPackage } from '@electron/asar';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, glob, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ontologyFixture } from '../tests/fixtures/ontology';

const project = process.cwd();
const built = path.join(project, 'out', `irori-${process.platform}-${process.arch}`);
const temporary = await mkdtemp(path.join(tmpdir(), 'irori packaged 日本語 '));
const relocated = path.join(temporary, 'application');
let application;
try {
  // Copy the complete Forge output; launch with a different cwd and no Node module search path.
  // macOS frameworks use relative links; rewriting them breaks Chromium's bundle lookup.
  await cp(built, relocated, { recursive: true, verbatimSymlinks: true });
  const mac = process.platform === 'darwin';
  const resources = path.join(
    relocated,
    ...(mac ? ['irori.app', 'Contents', 'Resources'] : ['resources']),
  );
  const archive = path.join(resources, 'app.asar');
  const entries = listPackage(archive, { isPack: false }).map((entry) =>
    entry.replaceAll('\\', '/').replace(/^\//, ''),
  );
  const packaged = JSON.parse(extractFile(archive, 'package.json').toString());
  for (const entry of [
    'dist/index.html',
    'dist-host/main.cjs',
    'dist-host/preload.cjs',
    'assets/irori-icon.png',
    'assets/irori-icon.ico',
    'assets/irori-icon.icns',
    'LICENSE',
    'docs/THIRD_PARTY_NOTICES.md',
    'vendor/rclone/distribution.json',
  ])
    assert(entries.includes(entry), `Missing packaged file: ${entry}`);
  const roots = new Set([
    'dist',
    'dist-host',
    'assets',
    'node_modules',
    'package.json',
    'docs',
    'LICENSE',
    'vendor',
  ]);
  assert(
    entries.every((entry) => roots.has(entry.split('/')[0])),
    'Unexpected application data in package',
  );
  for (const name of Object.keys(packaged.dependencies))
    assert(
      entries.includes(`node_modules/${name}/package.json`),
      `Missing runtime dependency: ${name}`,
    );
  for (const name of [
    'electron',
    'node',
    'typescript',
    'tsx',
    '@electron-forge/cli',
    '@playwright/test',
  ])
    assert(
      !entries.includes(`node_modules/${name}/package.json`),
      `Development dependency shipped: ${name}`,
    );

  const inventory = entries
    .filter((entry) => entry.startsWith('node_modules/') && entry.endsWith('/package.json'))
    .flatMap((entry) => {
      const data = JSON.parse(extractFile(archive, path.normalize(entry)).toString());
      return data.name && data.version
        ? [{ name: data.name, version: data.version, license: data.license ?? null }]
        : [];
    });
  const env = { ...process.env, IRORI_DATA_DIR: path.join(temporary, 'device') } as Record<
    string,
    string
  >;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  delete env.IRORI_GOOGLE_CLIENT_ID;
  delete env.IRORI_GOOGLE_CLIENT_SECRET;
  // A packaged build must not use a development machine's OAuth environment.
  env.IRORI_GOOGLE_CLIENT_ID = 'synthetic-development-client';
  env.IRORI_GOOGLE_CLIENT_SECRET = 'synthetic-development-secret';
  const launchPackaged = () =>
    electron.launch({
      executablePath: path.join(
        relocated,
        ...(mac
          ? ['irori.app', 'Contents', 'MacOS', 'irori']
          : [process.platform === 'win32' ? 'irori.exe' : 'irori']),
      ),
      // Root containers have no user sandbox and often only 64 MiB of /dev/shm.
      args:
        process.platform === 'linux' && process.getuid?.() === 0
          ? ['--no-sandbox', '--disable-dev-shm-usage']
          : [],
      cwd: temporary,
      env,
      timeout: 60_000,
    });
  application = await launchPackaged();
  const page = await application.firstWindow();
  application.on('console', (message) => {
    if (message.text().startsWith('PACKAGE_RENDERER_EXIT ')) console.error(message.text());
  });
  await application.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.on('render-process-gone', (_event, detail) =>
        console.error(
          'PACKAGE_RENDERER_EXIT ' +
            JSON.stringify({ reason: detail.reason, exitCode: detail.exitCode }),
        ),
      );
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByRole('heading', { name: 'ワークスペースを選択' })).toBeVisible();
  // URL spelling and in-document navigation must retain the same canonical trust boundary.
  await page.evaluate(() => {
    window.location.hash = 'packaged-smoke';
  });
  const cloudSetup = await page.evaluate(() => window.irori.cloudSetup());
  assert.equal(cloudSetup.oauthConfigured, process.env.IRORI_EXPECT_PACKAGED_OAUTH === '1');
  assert.equal(cloudSetup.available, true, cloudSetup.detail);
  assert.equal(cloudSetup.version, 'v1.75.1');
  let oauthHandoff: {
    googleAuthorization: boolean;
    readonlyScope: boolean;
    clientConfigured: boolean;
  } | null = null;
  if (cloudSetup.oauthConfigured) {
    // Exercise the compiled client through real rclone, stopping before Google consent.
    // Keep OAuth URLs/client values out of logs and evidence; inspect only the local redirect.
    await application.evaluate(({ shell }) => {
      const state = { restore: shell.openExternal, result: null as unknown };
      Reflect.set(globalThis, 'iroriPackageOAuth', state);
      shell.openExternal = async (address) => {
        const result = {
          googleAuthorization: false,
          readonlyScope: false,
          clientConfigured: false,
        };
        try {
          const local = new URL(address);
          if (local.origin !== 'http://127.0.0.1:53682' || local.pathname !== '/auth')
            throw Error('Unexpected local OAuth endpoint');
          const response = await fetch(local, {
            redirect: 'manual',
            signal: AbortSignal.timeout(10000),
          });
          const authorization = new URL(response.headers.get('location') ?? '');
          result.googleAuthorization =
            response.status === 307 &&
            authorization.origin === 'https://accounts.google.com' &&
            ['/o/oauth2/auth', '/o/oauth2/v2/auth'].includes(authorization.pathname);
          result.readonlyScope =
            authorization.searchParams.get('scope') ===
            'https://www.googleapis.com/auth/drive.readonly';
          const client = authorization.searchParams.get('client_id') ?? '';
          result.clientConfigured =
            client.endsWith('.apps.googleusercontent.com') &&
            client !== 'synthetic-development-client';
        } catch {
          // Fixed boolean diagnostics prevent a failed URL assertion from revealing values.
        }
        state.result = result;
      };
    });
    let accountId: string | undefined;
    try {
      accountId = (await page.evaluate(() => window.irori.addCloudAccount('Packaged OAuth trial')))
        .id;
      await expect
        .poll(
          () =>
            application!.evaluate(
              () => Reflect.get(globalThis, 'iroriPackageOAuth').result !== null,
            ),
          { timeout: 20000 },
        )
        .toBe(true);
      oauthHandoff = await application.evaluate(
        () => Reflect.get(globalThis, 'iroriPackageOAuth').result,
      );
      assert.deepEqual(oauthHandoff, {
        googleAuthorization: true,
        readonlyScope: true,
        clientConfigured: true,
      });
    } finally {
      if (accountId) await page.evaluate((id) => window.irori.cancelCloudAccount(id), accountId);
      await application.evaluate(({ shell }) => {
        shell.openExternal = Reflect.get(globalThis, 'iroriPackageOAuth').restore;
        Reflect.deleteProperty(globalThis, 'iroriPackageOAuth');
      });
    }
    assert.deepEqual(await page.evaluate(() => window.irori.cloudAccounts()), []);
  }
  const root = path.join(temporary, '検証 KB');
  await mkdir(root);
  await writeFile(path.join(root, 'note.md'), '# Packaged note\n');
  await page.evaluate(async (root) => {
    const space = await window.irori.register(root, '配布検証', 'personal');
    const note = await window.irori.read(space.scopeId, 'note.md');
    await window.irori.save({ ...note, text: '# Packaged edit 日本語\n' });
  }, root);
  assert.equal(await readFile(path.join(root, 'note.md'), 'utf8'), '# Packaged edit 日本語\n');
  await mkdir(path.join(root, 'ontology'));
  await writeFile(
    path.join(root, '.irori/ontology.json'),
    JSON.stringify(ontologyFixture.declaration),
  );
  await writeFile(
    path.join(root, ontologyFixture.declaration.entities.path),
    ontologyFixture.entities,
  );
  await writeFile(
    path.join(root, ontologyFixture.declaration.relations.path),
    ontologyFixture.relations,
  );
  await page.reload();
  await page.getByRole('checkbox', { name: /配布検証/ }).check();
  await page.getByRole('button', { name: '選択したスペースを開く', exact: true }).click();
  await page.getByRole('button', { name: 'note', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toContainText('Packaged edit 日本語');
  const clipboardPng = await application.evaluate(
    async ({ clipboard, ClipboardItem, nativeImage }) => {
      const png = nativeImage
        .createFromBitmap(Buffer.from([0x22, 0x66, 0xcc, 0xff]), {
          width: 1,
          height: 1,
        })
        .toPNG();
      await clipboard.write([
        new ClipboardItem({
          'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }),
        }),
      ]);
      const item = (await clipboard.read())[0];
      const image = (await item.getType('image/png')) as Blob;
      return Buffer.from(await image.arrayBuffer()).toString('base64');
    },
  );
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.locator('.ProseMirror').evaluate((element) => {
    element.addEventListener(
      'paste',
      (event) => {
        element.setAttribute('data-native-paste', String(event.isTrusted));
      },
      { once: true },
    );
  });
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('.ProseMirror')).toHaveAttribute('data-native-paste', 'true');
  await expect
    .poll(async () =>
      (await readFile(path.join(root, 'note.md'), 'utf8')).includes('_assets/image-'),
    )
    .toBe(true);
  const imageMarkdown = await readFile(path.join(root, 'note.md'), 'utf8');
  expect(imageMarkdown).not.toMatch(/blob:|data:image/);
  const reference = imageMarkdown.match(/_assets\/image-[a-f0-9]+\.png/)![0];
  assert.equal(await readFile(path.join(root, reference), 'base64'), clipboardPng);
  await expect
    .poll(() =>
      page
        .locator('.ProseMirror img')
        .evaluateAll((images) =>
          images.some((image) => (image as HTMLImageElement).naturalWidth === 1),
        ),
    )
    .toBe(true);
  await page.locator('.ProseMirror').evaluate((element) => {
    element.dataset.lifecycle = 'packaged';
  });
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Continuous packaged edit');
  await page.keyboard.press('ControlOrMeta+s');
  await expect
    .poll(async () =>
      (await readFile(path.join(root, 'note.md'), 'utf8')).includes('Continuous packaged edit'),
    )
    .toBe(true);
  await expect(page.locator('.ProseMirror')).toHaveAttribute('data-lifecycle', 'packaged');
  await expect(page.locator('.ProseMirror')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.ProseMirror')).not.toContainText('Continuous packaged edit');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('.ProseMirror')).toContainText('Continuous packaged edit');
  await page.keyboard.insertText(' after saving');
  await expect
    .poll(async () =>
      (await readFile(path.join(root, 'note.md'), 'utf8')).includes(
        'Continuous packaged edit after saving',
      ),
    )
    .toBe(true);
  await expect(page.locator('.ProseMirror')).toHaveAttribute('data-lifecycle', 'packaged');
  await page.getByRole('button', { name: '再読み込み', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toContainText('Continuous packaged edit after saving');
  await expect
    .poll(() =>
      page
        .locator('.ProseMirror img')
        .evaluateAll((images) =>
          images.some((image) => (image as HTMLImageElement).naturalWidth === 1),
        ),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'オントロジー', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'オントロジー', exact: true }).locator('.react-flow__node'),
  ).toHaveCount(4);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'ターミナル', exact: true }).click();
  const terminal = page.getByRole('region', { name: '配布検証 のターミナル' });
  await expect(terminal.locator('.terminal-state')).toHaveText('実行中', { timeout: 15000 });
  await terminal.locator('.xterm-helper-textarea').focus();
  await page.keyboard.insertText(
    process.platform === 'win32'
      ? "Set-Content -LiteralPath 'terminal 日本語.txt' -Value '配布端末から保存' -Encoding utf8"
      : "printf '配布端末から保存\\n' > 'terminal 日本語.txt'",
  );
  await page.keyboard.press('Enter');
  await expect
    .poll(() => readFile(path.join(root, 'terminal 日本語.txt'), 'utf8').catch(() => ''), {
      timeout: 15000,
    })
    .toContain('配布端末から保存');
  await terminal.getByRole('button', { name: 'ターミナルを終了して閉じる' }).click();
  const runtime = await application.evaluate(async ({ app }) => {
    const path = process.getBuiltinModule('node:path');
    const { createRequire } = process.getBuiltinModule('node:module');
    const { pathToFileURL } = process.getBuiltinModule('node:url');
    // Playwright evaluates in a VM without an import callback; use Node's standard loader.
    const vm = process.getBuiltinModule('node:vm');
    const importModule = vm.compileFunction('return import(specifier)', ['specifier'], {
      importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
    });
    const fromApp = createRequire(path.join(app.getAppPath(), 'package.json'));
    const sdk = await importModule(
      pathToFileURL(path.join(app.getAppPath(), 'node_modules/@opencode-ai/sdk/dist/v2/client.js'))
        .href,
    );
    const claude = await importModule(
      pathToFileURL(fromApp.resolve('@anthropic-ai/claude-agent-sdk')).href,
    );
    return {
      packaged: app.isPackaged,
      ownsDeviceData: app.hasSingleInstanceLock(),
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      opencode: typeof sdk.createOpencodeClient,
      claude: typeof claude.query,
    };
  });
  assert.equal(runtime.packaged, true);
  assert.equal(runtime.ownsDeviceData, true);
  assert.equal(runtime.version, packaged.version);
  assert.equal(runtime.opencode, 'function');
  assert.equal(runtime.claude, 'function');
  const conversationScope = await page.evaluate(async () => {
    const space = (await window.irori.spaces())[0];
    await window.irori.queueAgentMessage({
      scopeId: space.scopeId,
      agent: 'codex',
      prompt: 'Packaged pending instruction 日本語',
      notePath: 'note.md',
      sources: [{ scopeId: space.scopeId, path: 'note.md' }],
    });
    return space.scopeId;
  });
  await application.close();
  application = await launchPackaged();
  const restored = await application.firstWindow();
  restored.on('pageerror', (error) => errors.push(error.message));
  await restored.locator('.workspace-card').first().click();
  await restored.getByRole('button', { name: 'AIに相談', exact: true }).click();
  await expect(restored.getByLabel('送信待ち', { exact: true })).toContainText(
    'Packaged pending instruction 日本語',
  );
  await expect(restored.getByRole('button', { name: '停止', exact: true })).toHaveCount(0);
  const savedConversation = await restored.evaluate(
    (id) => window.irori.agentConversation(id, 'codex'),
    conversationScope,
  );
  assert.equal(savedConversation.queued[0].notePath, 'note.md');
  assert.equal(savedConversation.queued[0].sources?.[0].scopeId, conversationScope);
  assert.equal(savedConversation.events.length, 0); // No native prompt has been submitted.
  await restored
    .getByLabel('送信待ち', { exact: true })
    .getByRole('button', { name: /を削除$/ })
    .click();
  await expect(restored.getByLabel('送信待ち', { exact: true })).toHaveCount(0);
  await application.close();
  application = undefined;
  assert.deepEqual(errors, []);

  const artifacts = [];
  for await (const filename of glob('out/make/**/*', { cwd: project })) {
    const info = await stat(filename);
    if (!info.isFile()) continue;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filename)) hash.update(chunk);
    artifacts.push({
      file: filename.replaceAll('\\', '/'),
      size: info.size,
      sha256: hash.digest('hex'),
    });
  }
  await mkdir('test-results', { recursive: true });
  await writeFile(
    'test-results/package-smoke.json',
    JSON.stringify(
      {
        evidence:
          'Unsigned relocated Forge package; SDK imports, save/undo/redo and editing after autosave, native OS clipboard image paste/bytes/reopen, CSV graph, Japanese note/terminal file save, queued instruction restored without execution after restart, single-instance ownership and bundled rclone; configured OAuth checks local browser handoff/cancellation only, without Google consent or model inference; not installed-device acceptance',
        rootContainerFallback: process.platform === 'linux' && process.getuid?.() === 0,
        platform: process.platform,
        arch: process.arch,
        runtime,
        cloudSetup,
        oauthHandoff,
        inventory,
        artifacts,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Packaged app passed: ${process.platform}/${process.arch}, isolated launch, both SDK imports, Japanese note save, CSV graph and normal shutdown.`,
  );
} catch (error) {
  // Preserve the actual failure if Windows briefly retains an executable handle during cleanup.
  console.error('Packaged app verification failed:', error);
  throw error;
} finally {
  await application?.close();
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
