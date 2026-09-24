import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { SettingsService } from '../src/host/settings';
import { hostArguments } from '../src/domain/host-requests';
import { markdownFonts } from '../src/domain/types';

const defaults = {
  theme: 'system',
  language: 'ja',
  markdownFont: 'sans',
  editorAssistance: true,
  layouts: {},
  skillAudiences: {},
};

async function service() {
  const dir = await mkdtemp(path.join(tmpdir(), 'irori settings '));
  return { dir, settings: new SettingsService(dir) };
}

test('a device without a record starts with the default appearance and no layouts', async () => {
  const { settings } = await service();
  assert.deepEqual(await settings.read(), defaults);
});

test('a choice is written down and read back after a restart', async () => {
  const { dir, settings } = await service();
  await settings.save({ theme: 'dark' });
  await settings.save({ markdownFont: 'textbook' });
  assert.deepEqual(await new SettingsService(dir).read(), {
    ...defaults,
    theme: 'dark',
    markdownFont: 'textbook',
  });
  // The renderer is loaded from a file URL, so this file is the only durable copy.
  assert.match(await readFile(path.join(dir, 'device-settings.json'), 'utf8'), /"theme": "dark"/);
});

test('the interface language is Japanese until chosen, and a choice survives a restart', async () => {
  const { dir, settings } = await service();
  // A record written before the language setting existed still reads as Japanese.
  await writeFile(path.join(dir, 'device-settings.json'), '{"theme":"dark"}');
  assert.equal((await settings.read()).language, 'ja');
  await settings.save({ language: 'en' });
  await settings.save({ theme: 'light' });
  const restarted = await new SettingsService(dir).read();
  assert.equal(restarted.language, 'en');
  assert.equal(restarted.theme, 'light');
});

test('a layout keyed by several panel ids is kept', async () => {
  const { settings } = await service();
  const key = 'react-resizable-panels:irori-explorer-contents:my-contents:team-contents';
  await settings.save({ layouts: { [key]: '{"my-contents":40,"team-contents":60}' } });
  assert.equal((await settings.read()).layouts[key], '{"my-contents":40,"team-contents":60}');
});

test('layout records merge instead of replacing each other', async () => {
  const { settings } = await service();
  await settings.save({ layouts: { workspace: '{"explorer":30}' } });
  await settings.save({ layouts: { document: '{"terminal":25}' } });
  await settings.save({ markdownFont: 'mono' });
  await settings.save({ theme: 'light' });
  const stored = await settings.read();
  assert.deepEqual(stored.layouts, {
    workspace: '{"explorer":30}',
    document: '{"terminal":25}',
  });
  assert.equal(stored.theme, 'light');
  assert.equal(stored.markdownFont, 'mono');
});

test('editor assistance survives restart and unrelated preference writes, with compatible defaults', async () => {
  const { dir, settings } = await service();
  await writeFile(path.join(dir, 'device-settings.json'), JSON.stringify({ theme: 'dark' }));
  assert.equal((await settings.read()).editorAssistance, true);
  await settings.save({ editorAssistance: false });
  await settings.save({ markdownFont: 'mono', layouts: { workspace: 'kept' } });
  const restarted = await new SettingsService(dir).read();
  assert.equal(restarted.editorAssistance, false);
  assert.equal(restarted.theme, 'dark');
  assert.equal(restarted.layouts.workspace, 'kept');
  await settings.save({ editorAssistance: true });
  assert.equal((await new SettingsService(dir).read()).editorAssistance, true);
});

test("the reader's role and project are kept per KB on the device, not in the KB", async () => {
  const { dir, settings } = await service();
  await settings.save({ skillAudiences: { 'kb-1': { role: 'editor', project: 'thesis' } } });
  await settings.save({ skillAudiences: { 'kb-2': { role: '研究者' } } });
  await settings.save({ skillAudiences: { 'kb-1': { project: 'thesis' } } });
  assert.deepEqual((await new SettingsService(dir).read()).skillAudiences, {
    'kb-1': { project: 'thesis' },
    'kb-2': { role: '研究者' },
  });
});

test('a damaged or hostile record becomes the defaults rather than an error', async () => {
  const { dir, settings } = await service();
  await writeFile(path.join(dir, 'device-settings.json'), '{"theme":"neon","layouts":42}');
  assert.deepEqual(await settings.read(), defaults);
  await settings.save({ theme: 'dark' });
  assert.equal((await settings.read()).theme, 'dark');
});

test('the request validator bounds what a renderer may store', () => {
  const save = hostArguments.saveDeviceSettings;
  assert.equal(save.safeParse([{ theme: 'dark' }]).success, true);
  assert.equal(save.safeParse([{ editorAssistance: false }]).success, true);
  assert.equal(save.safeParse([{ editorAssistance: 'false' }]).success, false);
  for (const markdownFont of markdownFonts)
    assert.equal(save.safeParse([{ markdownFont }]).success, true);
  assert.equal(save.safeParse([{ layouts: { workspace: '{"explorer":30}' } }]).success, true);
  assert.equal(save.safeParse([{ theme: 'neon' }]).success, false);
  assert.equal(save.safeParse([{ language: 'en' }]).success, true);
  assert.equal(save.safeParse([{ language: 'fr' }]).success, false);
  assert.equal(save.safeParse([{ markdownFont: 'comic' }]).success, false);
  assert.equal(save.safeParse([{ layouts: { workspace: 'x'.repeat(5000) } }]).success, false);
  // The key the pane library writes for the three-pane workspace is 67 characters.
  const workspaceKey = 'react-resizable-panels:irori-workspace:explorer:workspace:assistant';
  assert.equal(save.safeParse([{ layouts: { [workspaceKey]: '{}' } }]).success, true);
  assert.equal(save.safeParse([{ layouts: { ['k'.repeat(161)]: '{}' } }]).success, false);
  assert.equal(save.safeParse([{ skillAudiences: { kb: { role: 'editor' } } }]).success, true);
  assert.equal(save.safeParse([{ skillAudiences: { kb: {} } }]).success, true);
  assert.equal(save.safeParse([{ skillAudiences: { kb: { role: 'a b' } } }]).success, false);
  assert.equal(save.safeParse([{ skillAudiences: { kb: { project: '../x' } } }]).success, false);
});
