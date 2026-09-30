import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import * as prompts from '../prompts';

// prompts/ is where the words irori gives an agent are found; its README is
// the index. A file or an export the index does not name is one nobody finds.
test('Every prompt file is exported from prompts/index.ts and indexed in its README', async () => {
  const index = await readFile('prompts/index.ts', 'utf8');
  const readme = await readFile('prompts/README.md', 'utf8');
  const files = (await readdir('prompts')).filter(
    (name) => name.endsWith('.ts') && name !== 'index.ts',
  );
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.ok(index.includes(`from './${file.slice(0, -3)}'`), `${file} is not exported`);
    assert.ok(readme.includes(`](${file})`), `${file} is not in prompts/README.md`);
  }
  for (const name of Object.keys(prompts))
    assert.ok(readme.includes(`\`${name}\``), `${name} is not in prompts/README.md`);
});
