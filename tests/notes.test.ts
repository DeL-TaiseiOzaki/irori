import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { dailyNotePath, dateTokens, expandTokens, notesDeclaration } from '../src/domain/notes';
import { noteDirectory, openDailyNote, readNotesDeclaration } from '../src/host/notes';

async function fixture(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori-notes-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'KB');
  await mkdir(root);
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const space = await files.register(root, 'Notes', 'personal');
  const declare = (declaration: unknown) =>
    writeFile(path.join(root, '.irori/notes.json'), JSON.stringify(declaration));
  return { base, root, files, id: space.scopeId, declare };
}

test('Date tokens use local time and leave unknown tokens as written', () => {
  const tokens = dateTokens(new Date(2026, 8, 7, 9, 5, 3));
  assert.equal(tokens.yyyy, '2026');
  assert.equal(tokens.MM, '09');
  assert.equal(tokens.dd, '07');
  assert.equal(tokens.date, '2026-09-07');
  assert.match(tokens.datetime, /^2026-09-07T09:05:03[+-]\d\d:\d\d$/);
  assert.equal(
    expandTokens('{{yyyy}}/{{date}} {{title}} {{unknown}}', tokens),
    '2026/2026-09-07 {{title}} {{unknown}}',
  );
});

test('Declaration accepts knowledge paths with date tokens and rejects the rest', () => {
  const declaration = notesDeclaration.parse({
    schemaVersion: 1,
    newNoteDirectory: 'Knowledge_Base/journal',
    daily: {
      path: 'Knowledge_Base/journal/{{yyyy}}/{{date}}.md',
      template: '.irori/templates/daily.md',
    },
  });
  assert.equal(
    dailyNotePath(declaration, new Date(2026, 0, 2)),
    'Knowledge_Base/journal/2026/2026-01-02.md',
  );
  for (const daily of [
    { path: 'Knowledge_Base/journal/today.md' },
    { path: 'Knowledge_Base/journal/{{date}}' },
    { path: '/tmp/{{date}}.md' },
    { path: 'Knowledge_Base/../{{date}}.md' },
    { path: 'Knowledge_Base/{{date}}.md', template: 'C:\\daily.md' },
  ])
    assert.throws(() => notesDeclaration.parse({ schemaVersion: 1, daily }));
  assert.throws(() => notesDeclaration.parse({ schemaVersion: 2 }));
  assert.throws(() => dailyNotePath({ schemaVersion: 1 }, new Date()), /宣言/);
});

test("Today's note is created once from the template at the declared path and reopened as is", async (t) => {
  const { files, id, root, declare } = await fixture(t);
  assert.equal(await readNotesDeclaration(files, id), null);
  assert.equal(await noteDirectory(files, id), 'Knowledge_Base/Notes');
  await mkdir(path.join(root, '.irori/templates'), { recursive: true });
  await writeFile(
    path.join(root, '.irori/templates/daily.md'),
    '---\ntype: daily\ntitle: {{date}}\ngenerated: { by: human:me, at: {{datetime}} }\n---\n\n# {{date}}\n\n## Log\n',
  );
  await writeFile(
    path.join(root, '.irori/notes.json'),
    '\ufeff' +
      JSON.stringify({
        schemaVersion: 1,
        newNoteDirectory: 'Knowledge_Base/journal',
        daily: {
          path: 'Knowledge_Base/journal/{{yyyy}}/{{date}}.md',
          template: '.irori/templates/daily.md',
        },
      }),
  );
  assert.equal(await noteDirectory(files, id), 'Knowledge_Base/journal');
  assert.equal(
    (await files.createNote(id, 'Loose', await noteDirectory(files, id))).path,
    'Knowledge_Base/journal/Loose.md',
  );
  const at = new Date(2026, 8, 17, 10, 0, 0);
  const created = await openDailyNote(files, id, at);
  assert.equal(created.path, 'Knowledge_Base/journal/2026/2026-09-17.md');
  assert.match(
    created.text,
    /^---\ntype: daily\ntitle: 2026-09-17\ngenerated: \{ by: human:me, at: 2026-09-17T10:00:00[+-]\d\d:\d\d \}\n---\n\n# 2026-09-17\n\n## Log\n$/,
  );
  // A template edited later never touches the note that already exists.
  await writeFile(path.join(root, '.irori/templates/daily.md'), '# changed\n');
  const reopened = await openDailyNote(files, id, at);
  assert.equal(reopened.text, created.text);
  assert.equal(reopened.hash, created.hash);
  // Without a template the note carries the date as its heading.
  await declare({ schemaVersion: 1, daily: { path: 'Knowledge_Base/{{date}}.md' } });
  assert.equal((await openDailyNote(files, id, at)).text, '# 2026-09-17\n\n');
});

test("Declared locations stay inside this KB's knowledge layer, and a template must be a real file of this KB", async (t) => {
  const { files, id, root, base, declare } = await fixture(t);
  for (const declaration of [
    { schemaVersion: 1, newNoteDirectory: 'contents/drive' },
    { schemaVersion: 1, newNoteDirectory: '.agents' },
    { schemaVersion: 1, daily: { path: 'schema/{{date}}.md' } },
    { schemaVersion: 1, daily: { path: 'contents/{{date}}.md' } },
  ]) {
    await declare(declaration);
    await assert.rejects(readNotesDeclaration(files, id), /ナレッジ層/);
  }
  await mkdir(path.join(root, 'contents'));
  await writeFile(path.join(root, 'contents/daily.md'), '# x\n');
  await declare({
    schemaVersion: 1,
    daily: { path: 'Knowledge_Base/{{date}}.md', template: 'contents/daily.md' },
  });
  await assert.rejects(openDailyNote(files, id), /contents/);
  const outside = path.join(base, 'outside.md');
  await writeFile(outside, '# outside\n');
  await symlink(outside, path.join(root, 'linked.md'));
  await declare({
    schemaVersion: 1,
    daily: { path: 'Knowledge_Base/{{date}}.md', template: 'linked.md' },
  });
  await assert.rejects(openDailyNote(files, id), /alias/);
  await declare({
    schemaVersion: 1,
    daily: { path: 'Knowledge_Base/{{date}}.md', template: 'missing.md' },
  });
  await assert.rejects(openDailyNote(files, id), { code: 'ENOENT' });
  await declare({ schemaVersion: 1 });
  await assert.rejects(openDailyNote(files, id), /宣言/);
});
