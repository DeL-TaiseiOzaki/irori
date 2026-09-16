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
    // @electron/osx-sign reads per-file settings only from an optionsForFile callback,
    // so its defaults always apply here: hardened runtime, with Electron's own
    // entitlements for the app and each helper. The package smoke asserts that state
    // rather than assuming it.
    osxSign: {
      identity: '-',
      identityValidation: false,
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
