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

// What `ssh` runs on Windows to ask the person something while it signs in
// (src/host/ssh-askpass.ts): a program of its own and not a script, because Windows
// would hand a script to cmd.exe together with the host's words. It is built with the
// C# compiler that is part of every Windows (.NET Framework 4), so no other toolchain
// is needed; native/askpass/Askpass.cs keeps to what that compiler knows.
if (process.platform === 'win32') {
  const { execFileSync } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const path = await import('node:path');
  const windows = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows';
  const compiler = ['Framework64', 'Framework']
    .map((folder) => path.join(windows, 'Microsoft.NET', folder, 'v4.0.30319', 'csc.exe'))
    .find((file) => existsSync(file));
  if (!compiler)
    throw Error('The C# compiler of .NET Framework 4 (csc.exe) was not found under ' + windows);
  execFileSync(
    compiler,
    [
      '/nologo',
      '/target:winexe',
      '/optimize+',
      '/out:' + path.join('dist-host', 'irori-askpass.exe'),
      path.join('native', 'askpass', 'Askpass.cs'),
    ],
    { stdio: 'inherit' },
  );
}
