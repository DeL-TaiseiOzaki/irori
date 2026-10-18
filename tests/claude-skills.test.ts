import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { YourAiService } from '../src/host/you';
import { AgentService } from '../src/agents/service';
import { linkClaudeSkills, pruneClaudeSkills } from '../src/agents/claude-skills';
import type { AgentEvent } from '../src/domain/types';

const skill = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\nDo it.\n`;
async function writeSkill(root: string, dir: string, name: string) {
  await mkdir(path.join(root, dir, name), { recursive: true });
  await writeFile(path.join(root, dir, name, 'SKILL.md'), skill(name, `The ${name} skill.`));
}

test('skill links: the first of a name wins, skipped names stay out, nothing left means no folder', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori claude skills '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const data = path.join(base, 'data');
  const one = path.join(base, 'one');
  const two = path.join(base, 'two');
  const root = await linkClaudeSkills(
    data,
    'run-1',
    [
      { name: 'alpha', folder: one },
      { name: 'alpha', folder: two },
      { name: 'beta', folder: two },
      { name: 'own', folder: two },
    ],
    new Set(['own']),
  );
  assert.equal(root, path.join(data, 'claude-skills', 'run-1'));
  const links = path.join(root!, '.claude', 'skills');
  assert.deepEqual((await readdir(links)).sort(), ['alpha', 'beta']);
  assert.equal(await readlink(path.join(links, 'alpha')), one);
  assert.equal(await readlink(path.join(links, 'beta')), two);
  assert.equal(
    await linkClaudeSkills(data, 'run-2', [{ name: 'own', folder: one }], new Set(['own'])),
    undefined,
  );
  // Folders left by runs that are no longer going are removed; a going run's stays.
  await linkClaudeSkills(data, 'run-3', [{ name: 'alpha', folder: one }], new Set());
  await pruneClaudeSkills(data, (id) => id === 'run-3');
  assert.deepEqual(await readdir(path.join(data, 'claude-skills')), ['run-3']);
});

test(
  'Claude Code is given the vault’s and the shared Schema’s .agents/skills as links, which go with the run (CLI stand-in)',
  { skip: process.platform === 'win32' ? 'POSIX executable fixture' : false, timeout: 20000 },
  async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), 'irori claude skills run '));
    const previous = process.env.PATH;
    const bin = path.join(base, 'bin');
    const kb = path.join(base, 'KB');
    const home = path.join(base, 'home');
    await mkdir(bin);
    await mkdir(kb);
    await mkdir(home);
    // The stand-in records, while it runs, what each added directory's
    // .claude/skills holds, as Claude Code would read it there. No model runs.
    await writeFile(
      path.join(bin, 'claude'),
      `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const adds = args.filter((_, i) => args[i - 1] === '--add-dir');
const seen = {};
for (const add of adds) {
  const dir = path.join(add, '.claude', 'skills');
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) seen[name] = fs.readlinkSync(path.join(dir, name));
}
fs.appendFileSync('claude-skills.jsonl', JSON.stringify({ seen, adds }) + '\\n');
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const message = JSON.parse(line);
  if (message.type === 'control_request')
    send({type:'control_response',response:{subtype:'success',request_id:message.request_id,response:{}}});
  if (message.type === 'user') {
    send({type:'system',subtype:'init',session_id:'fixture-session'});
    send({type:'result',subtype:'success',result:'done',is_error:false,session_id:'fixture-session',duration_ms:1,duration_api_ms:0,num_turns:1,total_cost_usd:0,usage:{},modelUsage:{},permission_denials:[]});
    setTimeout(() => process.exit(0), 50);
  }
});
`,
      { mode: 0o700 },
    );
    process.env.PATH = bin + path.delimiter + previous;
    t.after(async () => {
      process.env.PATH = previous;
      await rm(base, { recursive: true, force: true });
    });
    const files = new FileService(path.join(base, 'device'));
    await files.init();
    const you = new YourAiService(files.dataDir, home);
    const { id: youId, root: youRoot } = await you.create();
    const shared = path.join(youRoot, '.irori', 'shared');
    await writeFile(path.join(kb, 'AGENTS.md'), '# KB\n');
    // The vault's own skills, one also in its .claude/skills, and the shared
    // Schema's, one of them by a name the vault has too.
    await writeSkill(kb, '.agents/skills', 'distill');
    await writeSkill(kb, '.agents/skills', 'both');
    await writeSkill(kb, '.claude/skills', 'both');
    await writeSkill(kb, '.agents/skills', 'weekly');
    await writeSkill(shared, '.agents/skills', 'weekly');
    await writeSkill(shared, '.agents/skills', 'tidy');
    const space = await files.register(kb, 'Fixture', 'personal');
    const run = async (scopeId: string) => {
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
      service.start({ scopeId, agent: 'claude', prompt: 'hello' });
      await done;
      assert.equal(events.at(-1)?.outcome, 'completed', JSON.stringify(events));
    };
    await run(space.scopeId);
    const [record] = (await readFile(path.join(kb, 'claude-skills.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    // The vault's own come first and win a shared name; the one in its
    // .claude/skills is left to Claude Code.
    const real = await realpath(kb);
    assert.deepEqual(record.seen, {
      distill: path.join(real, '.agents', 'skills', 'distill'),
      weekly: path.join(real, '.agents', 'skills', 'weekly'),
      tidy: path.join(shared, '.agents', 'skills', 'tidy'),
    });
    assert.ok(
      (record.adds as string[]).some(
        (add) => path.dirname(add) === path.join(files.dataDir, 'claude-skills'),
      ),
    );
    // Nothing was written into the vault's Schema, and the links went with the run.
    assert.deepEqual(await readdir(path.join(kb, '.claude', 'skills')), ['both']);
    assert.deepEqual(await readdir(path.join(files.dataDir, 'claude-skills')).catch(() => []), []);
    // The irori agent's own skills, the standard ones irori wrote among them, go the same way.
    await run(youId);
    const mine = JSON.parse(
      (await readFile(path.join(youRoot, 'claude-skills.jsonl'), 'utf8')).trim(),
    );
    assert.equal(mine.seen['irori-setup'], path.join(youRoot, '.agents', 'skills', 'irori-setup'));
    assert.equal(mine.seen.tidy, path.join(shared, '.agents', 'skills', 'tidy'));
  },
);
