// Keep packaging with Forge; only compiled application files and runtime packages ship.
module.exports = {
  packagerConfig: {
    asar: true,
    executableName: 'irori',
    appBundleId: 'io.github.deltaiseiozaki.irori',
    prune: true,
    ignore: (filename) => {
      if (!filename) return false;
      const relative = filename.replaceAll('\\', '/').replace(/^\//, '');
      if (/^(dist|dist-host|assets|node_modules)(\/|$)/.test(relative))
        return relative.endsWith('.map');
      return !['package.json', 'LICENSE', 'docs', 'docs/THIRD_PARTY_NOTICES.md'].includes(relative);
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: { name: 'irori', authors: 'DeL-TaiseiOzaki' },
    },
    { name: '@electron-forge/maker-dmg', config: { format: 'ULFO' } },
    { name: '@electron-forge/maker-zip', platforms: ['linux', 'darwin'] },
  ],
};
