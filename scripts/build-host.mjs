import { build } from 'esbuild';
import { tsImport } from 'tsx/esm/api';
const { hostArguments } = await tsImport('../src/domain/host-requests.ts', import.meta.url);
const { distributionOAuth } = await tsImport('../src/cloud/oauth.ts', import.meta.url);
const googleOAuth = distributionOAuth(process.env);
await build({
  entryPoints: ['src/host/main.ts'],
  outfile: 'dist-host/main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  sourcemap: true,
  define: { IRORI_DISTRIBUTION_GOOGLE_OAUTH: JSON.stringify(googleOAuth) },
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
