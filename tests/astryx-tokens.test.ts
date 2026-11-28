import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  astryxTokensFile,
  coreTokens,
  readSource,
  renderAstryxTokens,
  sides,
  themeTokens,
} from '../scripts/astryx-tokens';

test('astryx-tokens.css is what the installed Astryx gives', async () => {
  const source = await readSource();
  const installed = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(source.coreVersion, installed.dependencies['@astryxdesign/core']);
  assert.equal(source.themeVersion, installed.dependencies['@astryxdesign/theme-neutral']);
  assert.equal(
    await readFile(astryxTokensFile, 'utf8'),
    await renderAstryxTokens(source),
    'run `tsx scripts/astryx-tokens.ts` after changing Astryx',
  );
});

test('a theme overrides the tokens core declares, and core keeps its private ones', () => {
  const core = coreTokens(
    ':root, .x1{--color-accent:light-dark(#00f, #0af);--_private:1px;}\n:root, .x2{--x-local:0;--radius-element:8px;}',
  );
  assert.deepEqual(
    [...core],
    [
      ['--color-accent', 'light-dark(#00f, #0af)'],
      ['--radius-element', '8px'],
    ],
  );
  const theme = themeTokens(
    `@layer astryx-theme {
  @scope ([data-astryx-theme="neutral"]) to ([data-astryx-theme]) {
    :scope {
      --color-accent: light-dark(#1b1b1b, #f1f1f1);
      --font-family-body: Figtree, "Segoe UI", sans-serif;
    }
    .astryx-heading { --color-accent: red; }
  }
}`,
    'neutral',
  );
  assert.deepEqual(
    [...theme],
    [
      ['--color-accent', 'light-dark(#1b1b1b, #f1f1f1)'],
      ['--font-family-body', 'Figtree, "Segoe UI", sans-serif'],
    ],
  );
});

test('a two-sided colour splits at its top-level comma only', () => {
  assert.deepEqual(sides('light-dark(#000000, #ffffff)'), ['#000000', '#ffffff']);
  assert.deepEqual(sides('light-dark(oklch(0 0 0 / 5%), rgba(0, 0, 0, 0.25))'), [
    'oklch(0 0 0 / 5%)',
    'rgba(0, 0, 0, 0.25)',
  ]);
  assert.equal(sides('#ffce2f'), undefined);
  assert.equal(sides('0 2px 4px light-dark(#000, #fff)'), undefined);
});

test('every Astryx token the roles name is one astryx-tokens.css sets', async () => {
  const generated = await readFile(astryxTokensFile, 'utf8');
  const roles = await readFile(new URL('../src/app/tokens.css', import.meta.url), 'utf8');
  const set = new Set(
    [
      ...generated.matchAll(/^\s+(--[a-z0-9-]+):/gm),
      ...roles.matchAll(/^\s+(--[a-z0-9-]+):/gm),
    ].map((match) => match[1]),
  );
  const named = [...roles.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((match) => match[1]);
  assert.deepEqual(
    named.filter((name) => !set.has(name)),
    [],
  );
});
