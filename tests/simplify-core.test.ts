import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { addOpenCodePlugin, mergeOpenCodeConfig } from '../src/agents/opencode-config';
import { runJsonLineProcess } from '../src/agents/json-lines';
import {
  defaultDeviceSettings,
  deviceSettingsPatchSchema,
  deviceSettingsSchema,
} from '../src/domain/settings';

test('OPENCODE_CONFIG_CONTENT helper handles empty, malformed, and existing configs safely', () => {
  const fromEmpty = addOpenCodePlugin({ OPENCODE_CONFIG_CONTENT: '' }, '/p/a.js');
  assert.deepEqual(JSON.parse(fromEmpty.OPENCODE_CONFIG_CONTENT!), { plugin: ['/p/a.js'] });

  const fromMalformed = addOpenCodePlugin({ OPENCODE_CONFIG_CONTENT: '{not json' }, '/p/a.js');
  assert.deepEqual(JSON.parse(fromMalformed.OPENCODE_CONFIG_CONTENT!), { plugin: ['/p/a.js'] });

  const fromArray = addOpenCodePlugin({ OPENCODE_CONFIG_CONTENT: '[]' }, '/p/a.js');
  assert.deepEqual(JSON.parse(fromArray.OPENCODE_CONFIG_CONTENT!), { plugin: ['/p/a.js'] });

  const merged = addOpenCodePlugin(
    mergeOpenCodeConfig(
      { OPENCODE_CONFIG_CONTENT: '{"theme":"dark","plugin":["/p/0.js"]}' },
      (c) => ({
        ...c,
        agent: { helper: { mode: 'subagent' } },
      }),
    ),
    '/p/1.js',
  );
  assert.deepEqual(JSON.parse(merged.OPENCODE_CONFIG_CONTENT!), {
    theme: 'dark',
    plugin: ['/p/0.js', '/p/1.js'],
    agent: { helper: { mode: 'subagent' } },
  });
});

test('DeviceSettings schema and patch schema share defaults and reject duplicate routineRuntimes', () => {
  const defaults = defaultDeviceSettings();
  assert.deepEqual(deviceSettingsSchema.parse({}), defaults);
  assert.equal(
    deviceSettingsPatchSchema.safeParse({ routineRuntimes: ['python', 'python'] }).success,
    false,
  );
  assert.equal(
    deviceSettingsSchema.safeParse({ routineRuntimes: ['python', 'python'] }).success,
    false,
  );
  assert.equal(
    deviceSettingsPatchSchema.safeParse({ routineRuntimes: ['javascript', 'python'] }).success,
    true,
  );
});

test('runJsonLineProcess streams JSON object records, skips noise, and flushes trailing output', async () => {
  const child = spawn(process.execPath, [
    '-e',
    `
      let input = '';
      process.stdin.on('data', (c) => (input += c));
      process.stdin.on('end', () => {
        process.stdout.write('not json\\n[1,2,3]\\n');
        const msg = Buffer.from(JSON.stringify({ kind: 'echo', text: input + '日本語' }) + '\\n');
        process.stdout.write(msg.subarray(0, 12));
        setTimeout(() => {
          process.stdout.write(msg.subarray(12));
          process.stdout.write(JSON.stringify({ kind: 'final', ok: true }));
        }, 10);
      });
    `,
  ]);
  const seen: Record<string, unknown>[] = [];
  const code = await runJsonLineProcess(child, 'hello ', (record) => seen.push(record));
  assert.equal(code, 0);
  assert.deepEqual(seen, [
    { kind: 'echo', text: 'hello 日本語' },
    { kind: 'final', ok: true },
  ]);
});
