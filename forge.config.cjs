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
