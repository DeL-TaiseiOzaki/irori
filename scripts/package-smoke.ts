import { _electron as electron, expect } from '@playwright/test';
import { extractFile, listPackage } from '@electron/asar';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, glob, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const project = process.cwd();
const built = path.join(project, 'out', `irori-${process.platform}-${process.arch}`);
const temporary = await mkdtemp(path.join(tmpdir(), 'irori packaged 日本語 '));
const relocated = path.join(temporary, 'application');
let application;
try {
  // Copy the complete Forge output; launch with a different cwd and no Node module search path.
  await cp(built, relocated, { recursive: true });
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
    'docs/THIRD_PARTY_NOTICES.md',
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
      const data = JSON.parse(extractFile(archive, entry).toString());
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
  application = await electron.launch({
    executablePath: path.join(
      relocated,
      ...(mac
        ? ['irori.app', 'Contents', 'MacOS', 'irori']
        : [process.platform === 'win32' ? 'irori.exe' : 'irori']),
    ),
    args: process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [],
    cwd: temporary,
    env,
    timeout: 60_000,
  });
  const page = await application.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByRole('heading', { name: 'ワークスペースを選択' })).toBeVisible();
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
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      opencode: typeof sdk.createOpencodeClient,
      claude: typeof claude.query,
    };
  });
  assert.equal(runtime.packaged, true);
  assert.equal(runtime.version, packaged.version);
  assert.equal(runtime.opencode, 'function');
  assert.equal(runtime.claude, 'function');
  const root = path.join(temporary, '検証 KB');
  await mkdir(root);
  await writeFile(path.join(root, 'note.md'), '# Packaged note\n');
  await page.evaluate(async (root) => {
    const space = await window.irori.register(root, '配布検証', 'personal');
    const note = await window.irori.read(space.scopeId, 'note.md');
    await window.irori.save({ ...note, text: '# Packaged edit 日本語\n' });
  }, root);
  assert.equal(await readFile(path.join(root, 'note.md'), 'utf8'), '# Packaged edit 日本語\n');
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
          'Unsigned Forge package outside checkout; SDK loading without model inference; not installed-device acceptance',
        platform: process.platform,
        arch: process.arch,
        runtime,
        inventory,
        artifacts,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Packaged app passed: ${process.platform}/${process.arch}, isolated launch, both SDK imports, Japanese note save and normal shutdown.`,
  );
} finally {
  await application?.close();
  await rm(temporary, { recursive: true, force: true });
}
