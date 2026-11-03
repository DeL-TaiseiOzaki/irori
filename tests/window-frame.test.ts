import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { themes } from '../src/domain/types';
import { titleBarHeight, windowChrome } from '../src/domain/window-frame';

const tokens = await readFile(new URL('../src/app/tokens.css', import.meta.url), 'utf8');
const shell = await readFile(new URL('../src/app/shell.css', import.meta.url), 'utf8');

/** The value of a custom property in the first rule whose selector list contains `selector`. */
function token(selector: string, name: string) {
  const start = tokens.indexOf(selector);
  assert.ok(start >= 0, `${selector} is in tokens.css`);
  const block = tokens.slice(start, tokens.indexOf('}', start));
  const value = new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1].trim();
  assert.ok(value, `${selector} sets ${name}`);
  return value;
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
