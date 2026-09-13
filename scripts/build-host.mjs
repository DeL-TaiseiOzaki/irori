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
