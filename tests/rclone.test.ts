import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Rclone } from '../src/cloud/rclone';
import { CloudAccounts } from '../src/cloud/accounts';

test(
  'Real rclone authenticates RC, exposes native config questions and stops without a cloud account',
  {
    skip:
      !process.env.IRORI_TEST_RCLONE_PATH &&
      'Set IRORI_TEST_RCLONE_PATH to exercise the real binary',
    timeout: 20000,
  },
  async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), 'irori real rclone '));
    const rpc = new Rclone(base, process.env.IRORI_TEST_RCLONE_PATH);
    t.after(async () => {
      await rpc.close();
      await rm(base, { recursive: true, force: true });
    });
    const version = await rpc.call('core/version');
    assert.match(version.version, /^v1\./);
    const unauthenticated = await fetch(rpc['endpoint'] + '/config/listremotes', {
      method: 'POST',
    });
    assert.equal(unauthenticated.status, 401);
    const config = await rpc.call('config/create', {
      name: 'fixture',
      type: 'drive',
      parameters: {
        client_id: 'fixture.apps.googleusercontent.com',
        scope: 'drive.readonly',
        config_auth_no_browser: 'true',
      },
      opt: { nonInteractive: true, noOutput: true },
    });
    assert.equal(config.Option.Name, 'config_is_local');
    assert.match(config.State, /oauth/);
    await rpc.call('config/delete', { name: 'fixture' });
    assert.deepEqual((await rpc.call('config/listremotes')).remotes, []);
    await rpc.close();
    await assert.rejects(rpc.call('core/version'), /終了/);
  },
);

test(
  'Real rclone runs the account controller through browser handoff and cancellation without Google consent',
  {
    skip: !process.env.IRORI_TEST_RCLONE_PATH,
    timeout: 20000,
  },
  async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), 'irori native OAuth control '));
    const rpc = new Rclone(base, process.env.IRORI_TEST_RCLONE_PATH);
    let opened = false;
    const accounts = new CloudAccounts(
      base,
      rpc,
      async (address) => {
        const url = new URL(address);
        assert.equal(url.origin, 'http://127.0.0.1:53682');
        assert.equal(url.pathname, '/auth');
        assert(url.searchParams.has('state'));
        opened = true;
      },
      { clientId: 'fixture.apps.googleusercontent.com', clientSecret: 'synthetic-config' },
    );
    t.after(async () => {
      await accounts.close();
      await rpc.close();
      await rm(base, { recursive: true, force: true });
    });
    const account = await accounts.add('Native controller test');
    for (let i = 0; i < 100 && !opened; i++) {
      const state = (await accounts.list())[0];
      assert.equal(state.state, 'authorizing', state.detail);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert(opened, 'Real rclone did not provide the expected browser handoff');
    assert.equal((await rpc.call('config/oauthstatus')).status, 'running');
    await accounts.cancel(account.id);
    assert.deepEqual(await accounts.list(), []);
    assert.deepEqual((await rpc.call('config/listremotes')).remotes, []);
    assert.equal((await rpc.call('config/oauthstatus')).status, 'stopped');
  },
);
