import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { SettingsService } from '../src/host/settings';
import { hostArguments } from '../src/domain/host-requests';

async function service() {
  const dir = await mkdtemp(path.join(tmpdir(), 'irori settings '));
  return { dir, settings: new SettingsService(dir) };
}

test('a device without a record starts on the system theme and no layouts', async () => {
  const { settings } = await service();
  assert.deepEqual(await settings.read(), { theme: 'system', layouts: {} });
});

test('a choice is written down and read back after a restart', async () => {
  const { dir, settings } = await service();
  await settings.save({ theme: 'dark' });
  assert.equal((await new SettingsService(dir).read()).theme, 'dark');
  // The renderer is loaded from a file URL, so this file is the only durable copy.
  assert.match(await readFile(path.join(dir, 'device-settings.json'), 'utf8'), /"theme": "dark"/);
});

test('layout records merge instead of replacing each other', async () => {
  const { settings } = await service();
  await settings.save({ layouts: { workspace: '{"explorer":30}' } });
  await settings.save({ layouts: { document: '{"terminal":25}' } });
  await settings.save({ theme: 'light' });
  const stored = await settings.read();
  assert.deepEqual(stored.layouts, {
    workspace: '{"explorer":30}',
    document: '{"terminal":25}',
  });
  assert.equal(stored.theme, 'light');
});

test('a damaged or hostile record becomes the defaults rather than an error', async () => {
  const { dir, settings } = await service();
  await writeFile(path.join(dir, 'device-settings.json'), '{"theme":"neon","layouts":42}');
  assert.deepEqual(await settings.read(), { theme: 'system', layouts: {} });
  await settings.save({ theme: 'dark' });
  assert.equal((await settings.read()).theme, 'dark');
});

test('the request validator bounds what a renderer may store', () => {
  const save = hostArguments.saveDeviceSettings;
  assert.equal(save.safeParse([{ theme: 'dark' }]).success, true);
  assert.equal(save.safeParse([{ layouts: { workspace: '{"explorer":30}' } }]).success, true);
  assert.equal(save.safeParse([{ theme: 'neon' }]).success, false);
  assert.equal(save.safeParse([{ layouts: { workspace: 'x'.repeat(5000) } }]).success, false);
  assert.equal(save.safeParse([{ layouts: { ['k'.repeat(65)]: '{}' } }]).success, false);
});
