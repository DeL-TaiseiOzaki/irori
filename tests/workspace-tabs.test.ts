import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closeTabs,
  insertTab,
  onlyIn,
  reorderTab,
  openTab,
  profileOf,
  replaceTab,
  tabOf,
  WindowTabs,
  type WorkspaceTab,
} from '../src/domain/workspace-tabs';
import { hostArguments } from '../src/domain/host-requests';

// A tab of workspace `id`; a second tab of the same workspace has a key of its own.
const tab = (id: string, scopeIds: string[] = [id], key = id): WorkspaceTab => ({
  id,
  name: id.toUpperCase(),
  scopeIds,
  key,
});
const keys = (tabs: WorkspaceTab[]) => tabs.map((item) => item.key);

test('A tab opens after the tab on show, or at the end; one open comes on show where it is', () => {
  const tabs = [tab('a'), tab('b')];
  assert.deepEqual(keys(openTab(tabs, tab('c'), 'a')), ['a', 'c', 'b']);
  assert.deepEqual(keys(openTab(tabs, tab('c'))), ['a', 'b', 'c']);
  assert.deepEqual(keys(openTab([], tab('a'), 'gone')), ['a']);
  const renamed = { ...tab('b'), name: 'Renamed' };
  const opened = openTab(tabs, renamed, 'a');
  assert.deepEqual(keys(opened), ['a', 'b']);
  assert.equal(opened[1].name, 'Renamed');
});

test('A workspace open in two tabs takes its newer profile in both, each keeping its key', () => {
  const tabs = [tab('a'), tab('b'), tab('a', ['a'], 'a2')];
  const renamed = { id: 'a', name: 'Renamed', scopeIds: ['a', 'x'] };
  const replaced = replaceTab(tabs, renamed);
  assert.deepEqual(keys(replaced), ['a', 'b', 'a2']);
  assert.deepEqual(
    replaced.filter((item) => item.id === 'a').map((item) => [item.name, item.scopeIds]),
    [
      ['Renamed', ['a', 'x']],
      ['Renamed', ['a', 'x']],
    ],
  );
  assert.deepEqual(replaceTab(tabs, tab('c')), tabs);
  // A tab is a workspace and its key; the workspace alone is what the host is given.
  assert.deepEqual(profileOf(tabOf(renamed, 'k')), renamed);
});

test('Closing the tab on show brings the next one that stays, else the one before', () => {
  const tabs = [tab('a'), tab('b'), tab('c'), tab('d')];
  assert.equal(closeTabs(tabs, ['b'], 'b').next?.key, 'c');
  assert.equal(closeTabs(tabs, ['d'], 'd').next?.key, 'c');
  assert.deepEqual(closeTabs([tab('a')], ['a'], 'a'), { tabs: [], next: undefined });
  // Another tab closing leaves the one on show.
  const other = closeTabs(tabs, ['a'], 'c');
  assert.deepEqual(keys(other.tabs), ['b', 'c', 'd']);
  assert.equal(other.next?.key, 'c');
  // Several at once: the others, or those to the right of one.
  const others = closeTabs(tabs, ['a', 'c', 'd'], 'c');
  assert.deepEqual(keys(others.tabs), ['b']);
  assert.equal(others.next?.key, 'b');
  const right = closeTabs(tabs, ['c', 'd'], 'd');
  assert.deepEqual(keys(right.tabs), ['a', 'b']);
  assert.equal(right.next?.key, 'b');
  assert.deepEqual(keys(closeTabs(tabs, ['gone'], 'b').tabs), keys(tabs));
});

test('What only the closing tabs have: another tab of the same workspace keeps it', () => {
  const tabs = [tab('a', ['p', 'r']), tab('b', ['r']), tab('c', ['q'])];
  assert.deepEqual(onlyIn(tabs, ['a']), { scopeIds: ['p'], workspaces: ['a'] });
  assert.deepEqual(onlyIn(tabs, ['b']), { scopeIds: [], workspaces: ['b'] });
  assert.deepEqual(onlyIn(tabs, ['a', 'b']), { scopeIds: ['p', 'r'], workspaces: ['a', 'b'] });
  assert.deepEqual(onlyIn(tabs, ['gone']), { scopeIds: [], workspaces: [] });
  // Workspace a open twice: closing one tab of it stops nothing of it.
  const twice = [...tabs, tab('a', ['p', 'r'], 'a2')];
  assert.deepEqual(onlyIn(twice, ['a']), { scopeIds: [], workspaces: [] });
  assert.deepEqual(onlyIn(twice, ['a', 'a2']), { scopeIds: ['p'], workspaces: ['a'] });
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

test('A tab dropped into the tabs stands where it was let go, beside one of its workspace too', () => {
  const tabs = [tab('a'), tab('b'), tab('c')];
  assert.deepEqual(keys(insertTab(tabs, tab('d'), 1)), ['a', 'd', 'b', 'c']);
  assert.deepEqual(keys(insertTab(tabs, tab('d'), 0)), ['d', 'a', 'b', 'c']);
  assert.deepEqual(keys(insertTab(tabs, tab('d'), 9)), ['a', 'b', 'c', 'd']);
  assert.deepEqual(keys(insertTab([], tab('d'), 0)), ['d']);
  // The workspace is open here already: the dropped tab is a tab of its own (ADR 067).
  const again = insertTab(tabs, tab('b', ['b'], 'b2'), 0);
  assert.deepEqual(keys(again), ['b2', 'a', 'b', 'c']);
});

test('A window whose one tab joins another window is left with none', () => {
  const windows = new WindowTabs();
  windows.set(1, [tab('a')]);
  windows.set(2, [tab('a'), tab('b')]);
  windows.set(3, []);
  windows.set(5, [tab('a'), tab('a', ['a'], 'a2')]);
  assert.ok(windows.onlyTab(1, 'a'));
  // Two tabs of one workspace: one of them leaving leaves the other.
  assert.ok(!windows.onlyTab(5, 'a'));
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

test('A tab dragged along its strip stands before the other tab it was let go at', () => {
  const tabs = [tab('a'), tab('b'), tab('c'), tab('d')];
  assert.deepEqual(keys(reorderTab(tabs, 'c', 0)), ['c', 'a', 'b', 'd']);
  assert.deepEqual(keys(reorderTab(tabs, 'a', 2)), ['b', 'c', 'a', 'd']);
  assert.deepEqual(keys(reorderTab(tabs, 'a', 3)), ['b', 'c', 'd', 'a']);
  assert.deepEqual(keys(reorderTab(tabs, 'b', 1)), ['a', 'b', 'c', 'd']);
  assert.deepEqual(keys(reorderTab(tabs, 'b', 99)), ['a', 'c', 'd', 'b']);
  assert.deepEqual(keys(reorderTab(tabs, 'b', -1)), ['b', 'a', 'c', 'd']);
  assert.equal(reorderTab(tabs, 'gone', 0), tabs);
});
