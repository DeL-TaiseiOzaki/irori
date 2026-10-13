import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeTab, onlyIn, openTab, replaceTab } from '../src/domain/workspace-tabs';
import type { WorkspaceProfile } from '../src/domain/types';

const tab = (id: string, scopeIds: string[] = [id]): WorkspaceProfile => ({
  id,
  name: id.toUpperCase(),
  scopeIds,
});
const ids = (tabs: WorkspaceProfile[]) => tabs.map((item) => item.id);

test('A workspace opens after the tab on show, or at the end', () => {
  const tabs = [tab('a'), tab('b')];
  assert.deepEqual(ids(openTab(tabs, tab('c'), 'a')), ['a', 'c', 'b']);
  assert.deepEqual(ids(openTab(tabs, tab('c'))), ['a', 'b', 'c']);
  assert.deepEqual(ids(openTab([], tab('a'), 'gone')), ['a']);
});

test('An open workspace keeps its place and takes its newer profile', () => {
  const tabs = [tab('a'), tab('b')];
  const renamed = { ...tab('b'), name: 'Renamed' };
  const opened = openTab(tabs, renamed, 'a');
  assert.deepEqual(ids(opened), ['a', 'b']);
  assert.equal(opened[1].name, 'Renamed');
  assert.deepEqual(replaceTab(tabs, tab('c')), tabs);
});

test('Closing the tab on show brings the next one, else the one before', () => {
  const tabs = [tab('a'), tab('b'), tab('c')];
  assert.equal(closeTab(tabs, 'b', 'b').next?.id, 'c');
  assert.equal(closeTab(tabs, 'c', 'c').next?.id, 'b');
  assert.deepEqual(closeTab([tab('a')], 'a', 'a'), { tabs: [], next: undefined });
  // Another tab closing leaves the one on show.
  const other = closeTab(tabs, 'a', 'c');
  assert.deepEqual(ids(other.tabs), ['b', 'c']);
  assert.equal(other.next?.id, 'c');
  assert.equal(closeTab(tabs, 'gone', 'b').tabs, tabs);
});

test('Only the vaults no other tab has are the closing tab’s own', () => {
  const tabs = [tab('a', ['p', 'r']), tab('b', ['r']), tab('c', ['q'])];
  assert.deepEqual(onlyIn(tabs, 'a'), ['p']);
  assert.deepEqual(onlyIn(tabs, 'b'), []);
  assert.deepEqual(onlyIn(tabs, 'c'), ['q']);
  assert.deepEqual(onlyIn(tabs, 'gone'), []);
});
