// Keep packaging with Forge; only compiled application files and runtime packages ship.
module.exports = {
  packagerConfig: {
    asar: { unpack: '{**/node_modules/node-pty/**/*,**/vendor/rclone/**/*}' },
    executableName: 'irori',
    icon: require('node:path').resolve('assets/irori-icon'),
    appBundleId: 'io.github.deltaiseiozaki.irori',
    // macOS refuses a downloaded bundle whose signature does not cover it, and Forge
    // leaves the copied Electron binaries carrying Electron's own identifier with no
    // bundle seal. Ad-hoc signing needs no Apple account and leaves the documented
    // "open anyway" route; Developer ID and notarization remain separate release work.
    osxSign: {
      identity: '-',
      identityValidation: false,
      // The hardened runtime enforces library validation, which requires every loaded
      // library to share the main executable's Team ID. An ad-hoc signature has no
      // Team ID, so macOS 26 refuses to map Electron Framework into the process and
      // the app aborts before it draws a window:
      //   "mapping process and mapped file (non-platform) have different Team IDs".
      // The runtime buys nothing without notarization, so turn it off. It must come
      // back with Developer ID signing, where one real Team ID covers every component.
      // @electron/osx-sign reads per-file settings only from this callback; a
      // top-level hardenedRuntime is discarded. Returning one key keeps its default
      // entitlements for the app and each helper.
      optionsForFile: () => ({ hardenedRuntime: false }),
      // Forge defaults this to true; a silently unsigned Mac package must fail instead.
      continueOnError: false,
    },
    prune: true,
    ignore: (filename) => {
      if (!filename) return false;
      const relative = filename.replaceAll('\\', '/').replace(/^\//, '');
      if (/^(dist|dist-host|assets|node_modules)(\/|$)/.test(relative))
        return relative.endsWith('.map');
      return !['package.json', 'LICENSE', 'docs', 'docs/THIRD_PARTY_NOTICES.md'].includes(relative);
    },
  },
  // node-pty 1.1 ships Node-API Windows prebuilds, including ConPTY helpers.
  // Reuse them instead of requiring a second, Electron-specific MSVC build.
  rebuildConfig: { ignoreModules: process.platform === 'win32' ? ['node-pty'] : [] },
  plugins: [{ name: '@electron-forge/plugin-auto-unpack-natives', config: {} }],
  hooks: {
    packageAfterCopy: async (_config, buildPath, _electronVersion, platform, arch) => {
      const { prepareRclone } = await import('./scripts/prepare-rclone.mjs');
      await prepareRclone(platform, arch, require('node:path').join(buildPath, 'vendor', 'rclone'));
    },
    // Two dependencies carry a complete executable for every platform they support, and
    // npm installs whichever ones match the build machine. Runs after pruning, so the
    // production dependency walk still sees the tree npm installed.
    packageAfterPrune: async (_config, buildPath, _electronVersion, platform, arch) => {
      const fs = require('node:fs/promises');
      const path = require('node:path');
      const modules = path.join(buildPath, 'node_modules');
      // The Agent SDK bundles Claude Code itself, around 220 MB per platform. irori
      // never reaches for it: src/agents/service.ts passes the reader's own installed
      // `claude` as pathToClaudeCodeExecutable, which is the only case where the SDK
      // does not resolve its bundled copy — and a packaged app could not spawn a file
      // inside app.asar anyway.
      const sdk = path.join(modules, '@anthropic-ai');
      for (const name of await fs.readdir(sdk))
        if (name.startsWith('claude-agent-sdk-'))
          await fs.rm(path.join(sdk, name), { recursive: true });
      // node-pty resolves build/Release first and then prebuilds/<platform>-<arch>, so
      // every other prebuild is unreachable; the Windows pair alone is 58 MB.
      const prebuilds = path.join(modules, 'node-pty', 'prebuilds');
      for (const name of await fs.readdir(prebuilds))
        if (name !== `${platform}-${arch}`)
          await fs.rm(path.join(prebuilds, name), { recursive: true });
      // Vite has bundled the renderer's packages into dist/, so at run time the application
      // loads from node_modules only what the host bundle requires — esbuild keeps every
      // package external (scripts/build-host.mjs) — and what those packages depend on. Keep
      // that closure, resolved as Node would, and remove everything else under node_modules,
      // npm's .bin links and hidden lockfile included; the bundled packages' licences ship
      // as dist/third-party-notices.txt.
      const { isBuiltin } = require('node:module');
      const kept = new Set();
      const keep = async (from, name) => {
        for (let base = from; base.startsWith(buildPath); base = path.dirname(base)) {
          const dir = path.join(base, 'node_modules', name);
          const manifest = await fs
            .readFile(path.join(dir, 'package.json'), 'utf8')
            .catch(() => null);
          if (!manifest) continue;
          if (!kept.has(dir)) {
            kept.add(dir);
            const { dependencies, optionalDependencies } = JSON.parse(manifest);
            for (const child of Object.keys({ ...dependencies, ...optionalDependencies }))
              await keep(dir, child);
          }
          return;
        }
      };
      for (const bundle of ['main.cjs', 'preload.cjs'])
        for (const [, specifier] of (
          await fs.readFile(path.join(buildPath, 'dist-host', bundle), 'utf8')
        ).matchAll(/\b(?:require|import)\("([^"./][^"]*)"\)/g))
          if (!isBuiltin(specifier) && specifier !== 'electron')
            await keep(buildPath, specifier.match(/^(@[^/]+\/)?[^/]+/)[0]);
      for (const entry of await fs.readdir(modules)) {
        const names = entry.startsWith('@')
          ? (await fs.readdir(path.join(modules, entry))).map((name) => `${entry}/${name}`)
          : [entry];
        const stale = names.filter((name) => !kept.has(path.join(modules, name)));
        // An emptied scope directory goes with its packages.
        for (const name of stale.length === names.length ? [entry] : stale)
          await fs.rm(path.join(modules, name), { recursive: true });
      }
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'irori',
        authors: 'DeL-TaiseiOzaki',
        setupIcon: require('node:path').resolve('assets/irori-icon.ico'),
      },
    },
    { name: '@electron-forge/maker-dmg', config: { format: 'ULFO' } },
    { name: '@electron-forge/maker-zip', platforms: ['linux', 'darwin'] },
  ],
};
