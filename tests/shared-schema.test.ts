import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileService } from '../src/host/files';
import { YourAiService } from '../src/host/you';
import { SearchService } from '../src/host/search';
import { SchemaSettingsService } from '../src/host/schema-settings';
import { AgentService } from '../src/agents/service';
import { sharedSchemaId } from '../src/domain/you';
import { sharedSchema, sharedSchemaPointer } from '../prompts';
import type { AgentEvent, StartRun } from '../src/domain/types';

const fixtureOptions = {
  skip: process.platform === 'win32' && 'POSIX executable fixture',
  timeout: 25000,
};

const skill = (name: string, description: string, body: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

async function setup(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori shared schema '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = path.join(base, 'home');
  await mkdir(home);
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const you = new YourAiService(path.join(base, 'device'), home);
  const settings = new SchemaSettingsService(files, new SearchService(files), async (scopeId) =>
    scopeId === sharedSchemaId ? you.sharedFolder() : you.schemaFolder(),
  );
  return { base, home, files, you, settings };
}

test('the shared Schema is written through the settings into the irori agent’s folder, and nowhere else', async (t) => {
  const { base, you, settings } = await setup(t);
  // It lives in the irori agent's folder, so that folder comes first.
  await assert.rejects(settings.list(sharedSchemaId), /Set up the irori agent|irori agent を用意/);
  assert.equal(await you.shared(), undefined);
  const { root } = await you.create();
  // Ready but empty: nothing for agents yet.
  assert.deepEqual((await settings.list(sharedSchemaId)).instructions, []);
  assert.equal(await you.shared(), undefined);
  await settings.write(
    sharedSchemaId,
    'AGENTS.md',
    '# Shared\n\nWrite dates as YYYY-MM-DD.\n',
    null,
  );
  await settings.write(
    sharedSchemaId,
    '.agents/skills/weekly/SKILL.md',
    skill('weekly', 'Writes the weekly review.', 'Collect the week.'),
    null,
  );
  // As files in its hidden folder, as `.obsidian` holds a vault's settings.
  const shared = path.join(root, '.irori', 'shared');
  assert.match(await readFile(path.join(shared, 'AGENTS.md'), 'utf8'), /YYYY-MM-DD/);
  assert.deepEqual(await readdir(path.join(shared, '.agents', 'skills')), ['weekly']);
  // The irori agent's own instructions are untouched, and its own listing stays its own.
  assert.doesNotMatch(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), /YYYY-MM-DD/);
  assert.deepEqual((await settings.list(sharedSchemaId)).instructions, ['AGENTS.md']);
  // Instructions and skills only: Claude Code's rules and hooks are not shared.
  await assert.rejects(
    settings.write(sharedSchemaId, '.claude/rules/tone.md', 'Be brief.\n', null),
    /cannot be changed|変更できません/,
  );
  await assert.rejects(
    settings.write(sharedSchemaId, '.claude/settings.json', '{}\n', null),
    /cannot be changed|変更できません/,
  );
  // What agents are told: the instructions and each skill with its file.
  const told = await you.shared();
  assert.equal(told?.root, path.join(await realpath(root), '.irori', 'shared'));
  assert.equal(told?.instructions, '# Shared\n\nWrite dates as YYYY-MM-DD.');
  assert.deepEqual(told?.skills, [
    {
      name: 'weekly',
      description: 'Writes the weekly review.',
      path: path.join(told!.root, '.agents', 'skills', 'weekly', 'SKILL.md'),
    },
  ]);
  // Long instructions are pointed at rather than sent with each request.
  const agents = await settings.read(sharedSchemaId, 'AGENTS.md');
  await settings.write(sharedSchemaId, 'AGENTS.md', 'x'.repeat(40 * 1024), agents.hash);
  const long = await you.shared();
  assert.equal(long?.instructions, undefined);
  assert.equal(long?.long, true);
  assert.match(sharedSchema(long!, false), /Read the shared instructions at .+AGENTS\.md first/);
  // No alias leads out of the shared folder.
  const outside = path.join(base, 'outside');
  await mkdir(outside);
  await rm(path.join(shared, '.agents'), { recursive: true });
  await symlink(outside, path.join(shared, '.agents'));
  await assert.rejects(
    settings.write(
      sharedSchemaId,
      '.agents/skills/x/SKILL.md',
      skill('x', 'Escapes.', 'No.'),
      null,
    ),
    /cannot be changed|変更できません|alias/,
  );
  assert.deepEqual(await readdir(outside), []);
});

test('the shared Schema says which Schema wins, and tells the irori agent to pass it on', () => {
  const shared = {
    root: '/me/.irori/shared',
    file: '/me/.irori/shared/AGENTS.md',
    instructions: 'Write dates as YYYY-MM-DD.',
    skills: [{ name: 'weekly', description: 'Weekly review.', path: '/me/s/weekly/SKILL.md' }],
  };
  const text = sharedSchema(shared, false);
  assert.match(text, /every agent in irori follows/);
  assert.match(text, /that folder's Schema wins/);
  assert.match(text, /<shared-instructions>\nWrite dates as YYYY-MM-DD\.\n<\/shared-instructions>/);
  assert.match(text, /- weekly: Weekly review\. \(\/me\/s\/weekly\/SKILL\.md\)/);
  assert.doesNotMatch(text, /sub-agent/);
  assert.match(sharedSchema(shared, true), /hand work to a hibachi's sub-agent, tell it to follow/);
  assert.match(
    sharedSchemaPointer(shared),
    /still applies, unchanged\. Its folder is \/me\/\.irori\/shared\./,
  );
});

test(
  'every request carries the shared Schema: whole for a new session or a change, one line otherwise (protocol fixture)',
  fixtureOptions,
  async (t) => {
    const { base, files, you, settings } = await setup(t);
    const bin = path.join(base, 'bin');
    await mkdir(bin);
    const old = process.env.PATH;
    process.env.PATH = bin + path.delimiter + old;
    t.after(() => {
      process.env.PATH = old;
    });
    await writeFile(
      path.join(bin, 'hermes'),
      `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/harnesses.mjs')).href)}).then(m=>m.run('hermes'));\n`,
      { mode: 0o700 },
    );
    const kb = path.join(base, 'KB');
    await mkdir(kb);
    await writeFile(path.join(kb, 'note.md'), '# Fixture\n');
    const space = await files.register(kb, 'Fixture', 'personal');
    const prompts = async () =>
      (await readFile(path.join(kb, 'fixture-requests.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .filter((call) => call.kind === 'hermes' && call.prompt !== undefined)
        .map((call) => call.prompt as string);
    const execute = async (prompt: string, extra: Partial<StartRun> = {}) => {
      const events: AgentEvent[] = [];
      let end!: () => void;
      const done = new Promise<void>((resolve) => {
        end = resolve;
      });
      const service = new AgentService(
        files,
        (event) => {
          events.push(event);
          if (event.type === 'done') end();
        },
        undefined,
        undefined,
        you,
      );
      t.after(() => service.cancel());
      service.start({ scopeId: space.scopeId, agent: 'hermes', prompt, ...extra });
      await done;
      return events;
    };
    // Without the irori agent there is no shared Schema: the request is the person's words.
    assert.equal((await execute('first words')).at(-1)?.outcome, 'completed');
    assert.equal((await prompts()).at(-1), 'first words');
    await you.create();
    await settings.write(sharedSchemaId, 'AGENTS.md', 'Write dates as YYYY-MM-DD.\n', null);
    await settings.write(
      sharedSchemaId,
      '.agents/skills/weekly/SKILL.md',
      skill('weekly', 'Writes the weekly review.', 'Collect the week.'),
      null,
    );
    // The session started before the shared Schema existed: it hears it whole.
    await execute('second words');
    const second = (await prompts()).at(-1)!;
    assert.match(second, /^irori: the shared Schema/);
    assert.match(second, /Write dates as YYYY-MM-DD\./);
    assert.match(second, /- weekly: Writes the weekly review\./);
    assert.ok(second.endsWith('\n\nsecond words'));
    // The same session, the same shared Schema: one line.
    await execute('third words');
    const third = (await prompts()).at(-1)!;
    assert.equal(third, `${sharedSchemaPointer((await you.shared())!)}\n\nthird words`);
    // A change is heard whole again.
    const agents = await settings.read(sharedSchemaId, 'AGENTS.md');
    await settings.write(sharedSchemaId, 'AGENTS.md', 'Write times in UTC.\n', agents.hash);
    await execute('fourth words');
    assert.match((await prompts()).at(-1)!, /<shared-instructions>\nWrite times in UTC\.\n/);
    // A skill the hibachi lacks is found in the shared Schema, and says so.
    const events = await execute('fifth words', { skill: 'weekly' });
    assert.equal(events.at(-1)?.outcome, 'completed', JSON.stringify(events));
    const fifth = (await prompts()).at(-1)!;
    assert.match(fifth, /chose the "weekly" skill from the shared Schema/);
    assert.match(fifth, /--- begin skill ---\nCollect the week\.\n--- end skill ---/);
    // The hibachi's own skill of the same name wins.
    await mkdir(path.join(kb, '.agents', 'skills', 'weekly'), { recursive: true });
    await writeFile(
      path.join(kb, '.agents', 'skills', 'weekly', 'SKILL.md'),
      skill('weekly', 'The hibachi’s own.', 'Use the hibachi’s template.'),
    );
    await execute('sixth words', { skill: 'weekly' });
    assert.match((await prompts()).at(-1)!, /from this KB's schema layer[\s\S]*hibachi’s template/);
    // A skill neither has is refused before any CLI starts.
    const missing = await execute('seventh words', { skill: 'absent' });
    assert.equal(missing.at(-1)?.outcome, 'failed');
    assert.equal((await prompts()).length, 6);
  },
);
