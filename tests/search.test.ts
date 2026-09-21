import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, rename } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { SearchService, searchLimits } from '../src/host/search';
import { dispatchHost, type HostHandlers } from '../src/domain/host-requests';

async function fixture(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori search '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'Knowledge');
  await mkdir(root);
  const space = await files.register(root, '検索のKB', 'personal');
  const write = async (relative: string, text: string | Buffer) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  };
  return { base, files, space, write };
}

test('Search finds literal body text and original line previews without changing files', async (t) => {
  const { files, space, write } = await fixture(t);
  const body = '\ufeff# 日本語\r\nBody NEEDLE [a+b].*\r\nneedle again\r\n';
  await write('Knowledge_Base/topic.md', body);
  await write('needle.md', '# Filename is not a body match\n');
  await write('table.csv', 'id,label\n1,needle\n');
  const search = new SearchService(files);
  const result = await search.search(space.scopeId, '  needle  ');
  assert.equal(result.query, 'needle');
  assert.equal(result.incomplete, false);
  assert.equal(result.scannedFiles, 3);
  assert.deepEqual(
    result.hits.map(({ path, line }) => ({ path, line })),
    [
      { path: 'table.csv', line: 2 },
      { path: 'Knowledge_Base/topic.md', line: 2 },
      { path: 'Knowledge_Base/topic.md', line: 3 },
    ],
  );
  assert.equal(result.hits[1].preview, 'Body NEEDLE [a+b].*');
  assert.deepEqual((await search.search(space.scopeId, '[a+b].*')).hits, [result.hits[1]]);
  assert.equal((await search.search(space.scopeId, '日本語')).hits[0].line, 1);
  assert.equal(await readFile(path.join(space.root, 'Knowledge_Base/topic.md'), 'utf8'), body);
});

test('Search stays in one knowledge layer, excluding nested KBs, rules, cloud and aliases', async (t) => {
  const { base, files, space, write } = await fixture(t);
  await write('visible.md', 'Needle from this KB');
  for (const relative of [
    'schema/rules.md',
    'AGENTS.md',
    'contents/local.md',
    '.hidden.md',
    '.local/cache.md',
    'node_modules/dependency.md',
    'nested/note.md',
  ])
    await write(relative, 'Needle outside search scope');
  const nested = await files.register(path.join(space.root, 'nested'), 'Nested', 'team');
  assert.deepEqual(
    (await new SearchService(files).search(nested.scopeId, 'needle')).hits.map((hit) => hit.path),
    ['note.md'],
  );
  const cloudCalls: string[] = [];
  files.cloud = {
    rootEntries: async () => undefined,
    resolve: async (_id, relative) => {
      cloudCalls.push(relative);
      throw Error('Search must not resolve Drive content');
    },
  };
  if (process.platform !== 'win32') {
    const outside = path.join(base, 'outside.md');
    await writeFile(outside, 'Needle from outside');
    await symlink(outside, path.join(space.root, 'alias.md'));
    await symlink(path.join(space.root, 'schema'), path.join(space.root, 'alias-directory'));
    await symlink(space.root, path.join(space.root, 'cycle'));
  }
  const result = await new SearchService(files).search(space.scopeId, 'needle');
  assert.deepEqual(
    result.hits.map((hit) => hit.path),
    ['visible.md'],
  );
  assert.equal(result.incomplete, false);
  assert.deepEqual(cloudCalls, []);
});

test('Invalid and oversized text is reported as skipped while readable results survive', async (t) => {
  const { files, space, write } = await fixture(t);
  await write('bad.md', Buffer.from([0xff, 0xfe]));
  await write('binary.txt', Buffer.from('needle\0binary'));
  await write('large.md', 'needle'.repeat(10));
  await write('valid.md', 'needle');
  await write('image.png', 'needle');
  const search = new SearchService(files, { ...searchLimits, fileBytes: 20 });
  const result = await search.search(space.scopeId, 'needle');
  assert.deepEqual(
    result.hits.map((hit) => hit.path),
    ['valid.md'],
  );
  assert.equal(result.scannedFiles, 1);
  assert.equal(result.skippedFiles, 3);
  assert.equal(result.incomplete, true);
});

test('Search reports partial results when result, file, entry, byte or time budgets stop it', async (t) => {
  const { files, space, write } = await fixture(t);
  await write('a.md', 'needle\nneedle\n');
  await write('b.md', 'needle\n');
  for (const [name, value] of Object.entries({
    hits: 1,
    files: 1,
    entries: 1,
    bytes: 14,
    milliseconds: 0,
  })) {
    // Each budget starts from a cold index: bytes counts what a request reads into it.
    await rm(path.join(files.dataDir, 'search-index'), { recursive: true, force: true });
    const result = await new SearchService(files, { ...searchLimits, [name]: value }).search(
      space.scopeId,
      'needle',
    );
    assert.equal(result.incomplete, true, name);
    assert.ok(result.hits.length < 3, name);
    if (name === 'hits') assert.equal(result.hits.length, 1);
    if (name === 'files') assert.equal(result.scannedFiles, 1);
  }
});

test('Unavailable descendants mark a search incomplete while root failures remain errors', async (t) => {
  const { files, space, write } = await fixture(t);
  await write('a.md', 'needle');
  await write('unavailable/b.md', 'needle');
  const entries = files.entries.bind(files);
  files.entries = async (id, directory) => {
    if (directory === 'unavailable') throw Error('Directory unavailable');
    return entries(id, directory);
  };
  const result = await new SearchService(files).search(space.scopeId, 'needle');
  assert.equal(result.incomplete, true);
  assert.deepEqual(
    result.hits.map((hit) => hit.path),
    ['a.md'],
  );
  await rm(space.root, { recursive: true });
  await assert.rejects(new SearchService(files).search(space.scopeId, 'needle'));
});

test('A later search supersedes an earlier request and external changes are searched afresh', async (t) => {
  const { files, space, write } = await fixture(t);
  await write('note.md', 'old phrase');
  const entries = files.entries.bind(files);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pause = true;
  files.entries = async (id, directory) => {
    if (pause) {
      pause = false;
      await gate;
    }
    return entries(id, directory);
  };
  const service = new SearchService(files);
  const old = service.search(space.scopeId, 'old');
  const rejected = assert.rejects(old, /新しい検索/);
  await write('note.md', 'new phrase');
  assert.equal((await service.search(space.scopeId, 'new')).hits.length, 1);
  release();
  await rejected;
  await rename(path.join(space.root, 'note.md'), path.join(space.root, 'moved.md'));
  assert.deepEqual(
    (await service.search(space.scopeId, 'new')).hits.map((hit) => hit.path),
    ['moved.md'],
  );
  assert.deepEqual((await service.search(space.scopeId, 'old')).hits, []);
});

test('Long matching lines keep the literal match in the preview, and IPC rejects invalid queries', async (t) => {
  const { files, space, write } = await fixture(t);
  await write('long.md', '前'.repeat(500) + 'Needle' + '後'.repeat(500));
  const result = await new SearchService(files).search(space.scopeId, 'needle');
  assert.ok(result.hits[0].preview.includes('Needle'));
  assert.ok(result.hits[0].preview.length < 200);
  const calls: unknown[] = [];
  const handlers = { search: (...args: unknown[]) => calls.push(args) } as unknown as HostHandlers;
  for (const query of ['', '  ', 'x'.repeat(201), 'line\nbreak', 'zero\0byte', {}, 7])
    assert.throws(() => dispatchHost(handlers, 'search', [space.scopeId, query]));
  assert.throws(() => dispatchHost(handlers, 'search', ['../other-kb', 'needle']));
  assert.deepEqual(calls, []);
  dispatchHost(handlers, 'search', [space.scopeId, ' needle ']);
  assert.deepEqual(calls, [[space.scopeId, 'needle']]);
  await assert.rejects(new SearchService(files).search('unknown-scope', 'needle'), /Unknown space/);
});
