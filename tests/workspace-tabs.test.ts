import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closeTab,
  insertTab,
  onlyIn,
  openTab,
  replaceTab,
  WindowTabs,
} from '../src/domain/workspace-tabs';
import type { WorkspaceProfile } from '../src/domain/types';
import { hostArguments } from '../src/domain/host-requests';

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

test('A window has alone only what no other window has open', () => {
  const windows = new WindowTabs();
  windows.set(1, [tab('a', ['v1', 'v2']), tab('b', ['v3'])]);
  windows.set(2, [tab('b', ['v3']), tab('c', ['v2', 'v4'])]);
  assert.deepEqual(windows.elsewhere(1), [
    { id: 'b', scopeIds: ['v3'] },
    { id: 'c', scopeIds: ['v2', 'v4'] },
  ]);
  assert.deepEqual(windows.only(1), { workspaces: ['a'], scopeIds: ['v1'] });
  windows.forget(2);
  assert.deepEqual(windows.only(1), { workspaces: ['a', 'b'], scopeIds: ['v1', 'v2', 'v3'] });
  assert.deepEqual(windows.only(3), { workspaces: [], scopeIds: [] });
  windows.set(3, [tab('a', ['v5'])]);
  assert.deepEqual(
    windows.elsewhere(2),
    [{ id: 'a', scopeIds: ['v1', 'v2', 'v5'] }, tab('b', ['v3'])].map(({ id, scopeIds }) => ({
      id,
      scopeIds,
    })),
  );
});

test('A tab dragged out takes its place along, and nothing else, to its new window', () => {
  const workspace = '0b5e8f8e-5b0e-4c43-9a59-1c4d4b6e2f10';
  const vault = '7f1d2c3b-4a5e-4f60-8b7a-9c0d1e2f3a4b';
  const place = { level: 'brain', overviewView: 'columns', scopeId: vault, side: vault };
  const accepts = (...args: unknown[]) => hostArguments.moveTab.safeParse(args).success;
  assert.ok(accepts({ id: workspace }));
  assert.ok(accepts({ id: workspace, place }, { x: -1280, y: 40 }));
  assert.ok(!accepts({ id: workspace, place: { ...place, level: 'settings' } }));
  assert.ok(!accepts({ id: workspace, place: { ...place, scopeId: '../vault' } }));
  assert.ok(!accepts({ id: workspace, profile: { name: 'other' } }));
  assert.ok(!accepts({ id: workspace }, { x: 10.5, y: 0 }));
  assert.ok(hostArguments.movedTab.safeParse([]).success);
});

test('A tab dropped into the tabs stands where it was let go; an open one keeps its place', () => {
  const tabs = [tab('a'), tab('b'), tab('c')];
  assert.deepEqual(ids(insertTab(tabs, tab('d'), 1)), ['a', 'd', 'b', 'c']);
  assert.deepEqual(ids(insertTab(tabs, tab('d'), 0)), ['d', 'a', 'b', 'c']);
  assert.deepEqual(ids(insertTab(tabs, tab('d'), 9)), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids(insertTab([], tab('d'), 0)), ['d']);
  const renamed = { ...tab('b'), name: 'B2' };
  const kept = insertTab(tabs, renamed, 0);
  assert.deepEqual(ids(kept), ['a', 'b', 'c']);
  assert.equal(kept[1].name, 'B2');
});

test('A window whose one tab joins another window is left with none', () => {
  const windows = new WindowTabs();
  windows.set(1, [tab('a')]);
  windows.set(2, [tab('a'), tab('b')]);
  windows.set(3, []);
  assert.ok(windows.onlyTab(1, 'a'));
  assert.ok(!windows.onlyTab(1, 'b'));
  assert.ok(!windows.onlyTab(2, 'a'));
  assert.ok(!windows.onlyTab(3, 'a'));
  assert.ok(!windows.onlyTab(4, 'a'));
});

test('Where a dragged tab is goes to the host as a name and a screen point, or nothing', () => {
  const accepts = (...args: unknown[]) => hostArguments.dragTab.safeParse(args).success;
  assert.ok(accepts());
  assert.ok(accepts({ name: '作業', at: { x: -1280, y: 18 } }));
  assert.ok(!accepts(undefined));
  assert.ok(!accepts({ name: '作業', at: { x: 1.5, y: 18 } }));
  assert.ok(!accepts({ name: 'x'.repeat(121), at: { x: 0, y: 0 } }));
  assert.ok(!accepts({ name: '作業', at: { x: 0, y: 0 }, id: 'other' }));
});
