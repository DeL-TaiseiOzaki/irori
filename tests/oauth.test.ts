import test from 'node:test';
import assert from 'node:assert/strict';
import { distributionOAuth } from '../src/cloud/oauth';
import { CloudAccounts } from '../src/cloud/accounts';

test('distribution OAuth accepts complete desktop configuration and redacts invalid input', () => {
  assert.equal(distributionOAuth({}), null);
  assert.equal(
    distributionOAuth({ IRORI_BUILD_GOOGLE_CLIENT_ID: '', IRORI_BUILD_GOOGLE_CLIENT_SECRET: '' }),
    null,
  );
  // Ordinary development environment is never silently embedded into an installer.
  assert.equal(
    distributionOAuth({
      IRORI_GOOGLE_CLIENT_ID: 'developer',
      IRORI_GOOGLE_CLIENT_SECRET: 'private-fixture',
    }),
    null,
  );
  const config = {
    IRORI_BUILD_GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com',
    IRORI_BUILD_GOOGLE_CLIENT_SECRET: 'synthetic-client-configuration',
  };
  assert.deepEqual(distributionOAuth(config), {
    clientId: config.IRORI_BUILD_GOOGLE_CLIENT_ID,
    clientSecret: config.IRORI_BUILD_GOOGLE_CLIENT_SECRET,
  });
  for (const invalid of [
    { IRORI_BUILD_GOOGLE_CLIENT_SECRET: 'private-fixture' },
    { IRORI_BUILD_GOOGLE_CLIENT_ID: config.IRORI_BUILD_GOOGLE_CLIENT_ID },
    { ...config, IRORI_BUILD_GOOGLE_CLIENT_ID: 'invalid-private-fixture' },
    { ...config, IRORI_BUILD_GOOGLE_CLIENT_SECRET: '' },
  ])
    assert.throws(
      () => distributionOAuth(invalid),
      (error: Error) =>
        error.message.includes('Values are omitted') && !error.message.includes('private-fixture'),
    );
});

test('an unconfigured installed build cannot use development OAuth environment as a fallback', () => {
  const rpc = { call: async () => ({}), close: async () => {} };
  const accounts = new CloudAccounts('unused', rpc, async () => {}, {});
  assert.equal(accounts.configured, false);
  const configured = new CloudAccounts('unused', rpc, async () => {}, {
    clientId: 'fixture',
    clientSecret: 'fixture',
  });
  assert.equal(configured.configured, true);
});
