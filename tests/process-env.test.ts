import test from 'node:test';
import assert from 'node:assert/strict';
import { agentEnv } from '../src/agents/process';

test('Windows child processes retain native Path spelling and provider configuration', () => {
  const source = {
    Path: 'C:\\Program Files\\Git\\cmd;C:\\Users\\User\\bin',
    NATIVE_PROVIDER_SETTING: 'synthetic-preserved',
    IRORI_BUILD_GOOGLE_CLIENT_ID: 'synthetic-distributor-config',
    IRORI_GOOGLE_CLIENT_SECRET: 'synthetic-development-config',
  };
  const result = agentEnv(source, 'win32');
  assert.equal(result.Path, source.Path);
  assert.equal(result.PATH, undefined, 'do not introduce a shadowing uppercase key');
  assert.equal(result.NATIVE_PROVIDER_SETTING, source.NATIVE_PROVIDER_SETTING);
  assert.equal(result.IRORI_BUILD_GOOGLE_CLIENT_ID, undefined);
  assert.equal(result.IRORI_GOOGLE_CLIENT_SECRET, undefined);
  assert.equal(source.IRORI_GOOGLE_CLIENT_SECRET, 'synthetic-development-config');
  assert.equal(agentEnv({ PATH: 'C:\\Native' }, 'win32').PATH, 'C:\\Native');
  assert(agentEnv({ PATH: '/custom/bin' }, 'linux').PATH?.startsWith('/custom/bin:'));
});

test('a bare command is found on the search path alone, never in the working folder', async (t) => {
  const { mkdtemp, mkdir, writeFile, chmod, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { onSearchPath } = await import('../src/agents/process');
  const base = await mkdtemp(path.join(tmpdir(), 'irori-path-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const bin = path.join(base, 'bin');
  const vault = path.join(base, 'vault');
  await mkdir(bin);
  await mkdir(vault);
  await writeFile(path.join(bin, 'tool'), '#!/bin/sh\n');
  await chmod(path.join(bin, 'tool'), 0o755);
  await writeFile(path.join(vault, 'other'), '#!/bin/sh\n');
  await chmod(path.join(vault, 'other'), 0o755);
  const env = { PATH: `:.:${bin}` };
  assert.equal(onSearchPath('tool', env, 'linux'), path.join(bin, 'tool'));
  // Empty and relative entries, which mean the working folder, are not searched or kept.
  assert.equal(onSearchPath('other', env, 'linux'), undefined);
  assert.ok(
    !agentEnv(env, 'linux')
      .PATH?.split(':')
      .some((dir) => !path.isAbsolute(dir)),
  );
  assert.equal(agentEnv({ Path: 'C:\\Git\\cmd;.;;C:\\bin' }, 'win32').Path, 'C:\\Git\\cmd;C:\\bin');
});
