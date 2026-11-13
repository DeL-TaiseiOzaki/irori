import { build } from 'esbuild';
import { tsImport } from 'tsx/esm/api';
const { hostArguments } = await tsImport('../src/domain/host-requests.ts', import.meta.url);
await build({
  entryPoints: ['src/host/main.ts'],
  outfile: 'dist-host/main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  sourcemap: true,
});
await build({
  entryPoints: ['src/host/preload.ts'],
  outfile: 'dist-host/preload.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  define: { HOST_METHODS: JSON.stringify(Object.keys(hostArguments)) },
});
// The vault host that runs on an SSH host (ADR 061) is one file, since nothing is
// installed beside it there: every package it uses is inside it. The Agent SDK is
// an ES module that asks where it is, and in one CommonJS file `import.meta` is
// empty, so its `createRequire(import.meta.url)` is given this file's address.
await build({
  entryPoints: ['src/remote/vault-host.ts'],
  outfile: 'dist-host/vault-host.cjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['node-pty', 'electron'],
  define: { 'import.meta.url': '__vaultHostUrl' },
  banner: { js: "const __vaultHostUrl = require('node:url').pathToFileURL(__filename).href;" },
});
