import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { themes } from '../src/domain/types';
import {
  droppedWindowBounds,
  stripUnder,
  titleBarHeight,
  windowChrome,
} from '../src/domain/window-frame';

const tokens = await readFile(new URL('../src/app/tokens.css', import.meta.url), 'utf8');
const astryx = await readFile(new URL('../src/app/astryx-tokens.css', import.meta.url), 'utf8');
const shell = await readFile(new URL('../src/app/shell.css', import.meta.url), 'utf8');

/**
 * The value of a custom property in the first rule whose selector list contains `selector`,
 * following a `var()` that names one of Astryx's tokens to the value it holds.
 */
function token(selector: string, name: string) {
  const start = tokens.indexOf(selector);
  assert.ok(start >= 0, `${selector} is in tokens.css`);
  const block = tokens.slice(start, tokens.indexOf('}', start));
  const value = new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1].trim();
  assert.ok(value, `${selector} sets ${name}`);
  const named = /^var\((--[a-z0-9-]+)\)$/.exec(value)?.[1];
  if (!named) return value;
  const held = new RegExp(`\\n\\s*${named}:\\s*([^;]+);`).exec(astryx)?.[1].trim();
  assert.ok(held, `astryx-tokens.css sets ${named}`);
  return held;
}

test('the window controls take the chrome colours of the theme on show', () => {
  const graphite = {
    background: token(":root[data-theme='hearth']", '--bg'),
    symbol: token(":root[data-theme='hearth']", '--tx-2'),
  };
  const paper = {
    background: token(":root[data-theme='light']", '--bg'),
    symbol: token(":root[data-theme='light']", '--tx-2'),
  };
  assert.deepEqual(windowChrome('hearth'), graphite);
  assert.deepEqual(windowChrome('light'), paper);
  // Dark keeps hearth's chrome and changes only the stage; a system choice is hearth or dark.
  assert.doesNotMatch(
    tokens.slice(tokens.indexOf(":root[data-theme='dark']")),
    /\n\s*--bg:/,
    'dark does not set its own chrome background',
  );
  assert.deepEqual(windowChrome('dark'), graphite);
  assert.deepEqual(windowChrome('system'), graphite);
  for (const theme of themes) assert.match(windowChrome(theme).background, /^#[0-9a-f]{6}$/);
});

test('the title bar is as tall as the window controls laid over it, with its hairline below', () => {
  const rule = /\.titlebar \{([^}]*)\}/.exec(shell)?.[1] ?? '';
  assert.match(rule, new RegExp(`height: ${titleBarHeight + 1}px;`));
  assert.match(rule, /border-bottom: 1px solid/);
});

test('a window a tab was dragged out to stands under the pointer, inside the screen', () => {
  // A screen whose menu bar takes its top 25 pixels.
  const area = { x: 0, y: 25, width: 2560, height: 1375 };
  const size = { width: 1440, height: 940 };
  // Its first tab, in the title bar, is where the tab was let go.
  const placed = droppedWindowBounds({ x: 400, y: 300 }, size, area);
  assert.deepEqual(placed, { x: 290, y: 300 - titleBarHeight / 2, ...size });
  // Near the screen's edges it moves back in, whole.
  assert.deepEqual(droppedWindowBounds({ x: 2550, y: 1390 }, size, area), {
    x: 1120,
    y: 460,
    ...size,
  });
  assert.deepEqual(droppedWindowBounds({ x: 5, y: 0 }, size, area), { x: 0, y: 25, ...size });
  // A screen left of the main one has negative coordinates; a window larger than it shrinks.
  const left = { x: -1280, y: 0, width: 1280, height: 800 };
  assert.deepEqual(droppedWindowBounds({ x: -600, y: 200 }, size, left), {
    x: -1280,
    y: 0,
    width: 1280,
    height: 800,
  });
});

test('a tab let go on the title bar of the window seen there joins it', () => {
  const first = { window: 'first', bounds: { x: 0, y: 0, width: 980, height: 680 } };
  const second = { window: 'second', bounds: { x: 300, y: 344, width: 980, height: 680 } };
  const onSecondBar = { x: 800, y: 344 + titleBarHeight / 2 };
  // The second window is in front where the two overlap: its title bar is seen there.
  assert.equal(stripUnder(onSecondBar, [second, first], 'first'), 'second');
  // Behind the first window, its title bar cannot be seen and is not joined.
  assert.equal(stripUnder(onSecondBar, [first, second], 'second'), undefined);
  assert.equal(stripUnder(onSecondBar, [first, second], 'first'), undefined);
  // A window's page below its title bar, its own title bar, or no window at all: none.
  assert.equal(stripUnder({ x: 800, y: 344 + 60 }, [second, first], 'first'), undefined);
  assert.equal(stripUnder({ x: 400, y: 10 }, [second, first], 'first'), undefined);
  assert.equal(stripUnder({ x: 1279, y: 10 }, [second, first], 'first'), undefined);
  assert.equal(stripUnder({ x: 400, y: 10 }, [second, first], 'second'), 'first');
  // The hairline under the title bar still counts; the right edge does not.
  assert.equal(stripUnder({ x: 10, y: titleBarHeight }, [first], 'second'), 'first');
  assert.equal(stripUnder({ x: 980, y: 10 }, [first], 'second'), undefined);
});
