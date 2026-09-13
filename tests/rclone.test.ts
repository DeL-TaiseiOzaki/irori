import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Rclone } from '../src/cloud/rclone';

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
