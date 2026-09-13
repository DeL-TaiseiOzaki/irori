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
