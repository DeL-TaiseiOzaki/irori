import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { FileService } from '../src/host/files';
import { AgentService } from '../src/agents/service';
import { classify } from '../src/domain/scopes';
import type { AgentEvent, AgentId } from '../src/domain/types';
const base = await mkdtemp(path.join(tmpdir(), 'irori real 日本語 '));
const files = new FileService(path.join(base, 'device'));
await files.init();
const root = path.join(base, 'KB fixture');
await mkdir(root);
const space = await files.register(root, '検証 KB', 'personal');
await writeFile(
  path.join(root, 'AGENTS.md'),
  'Only modify notes inside this disposable KB. Do not use subagents, network tools, Git, or any file outside this KB. Follow the user request exactly.\n',
);
await writeFile(
  path.join(root, 'CLAUDE.md'),
  'Only modify notes inside this disposable KB. Do not use subagents, network tools, Git, or any file outside this KB. Follow the user request exactly.\n',
);
// Every file in the KB's schema layer with its hash. A native CLI that creates `.claude/`,
// writes a settings file or rewrites the instructions during a turn shows up here;
// tests/harnesses.test.ts holds the same property for Pi and OpenCode without a model.
const schemaLayer = async () => {
  const out = new Set<string>();
  const walk = async (rel: string) => {
    for (const entry of await readdir(path.join(root, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${entry.name}` : entry.name;
      if (!rel && classify(space, p) !== 'schema') continue;
      if (entry.isDirectory()) await walk(p);
      else
        out.add(
          `${p} ${createHash('sha256')
            .update(await readFile(path.join(root, p)))
            .digest('hex')}`,
        );
    }
  };
  await walk('');
  return out;
};
const schemaBefore = await schemaLayer();
const results: unknown[] = [];
for (const agent of process.argv[2]
  ? [process.argv[2] as AgentId]
  : (['codex', 'claude'] as AgentId[])) {
  const note = await files.createNote(space.scopeId, `${agent} 日本語 note`);
  const marker = `IRORI_${agent.toUpperCase()}_VERIFIED`;
  const events: AgentEvent[] = [];
  let end!: (event: AgentEvent) => void;
  const done = new Promise<AgentEvent>((resolve) => {
    end = resolve;
  });
  const service = new AgentService(files, (event) => {
    events.push(event);
    if (event.type !== 'text') console.log(agent, event.type, event.text.slice(0, 500));
    if (event.type === 'permission') {
      // Only fixture-local note operations are authorized by this smoke test.
      const detail = event.details ?? '';
      const safe =
        (detail.includes(note.path) || detail.includes(path.join(root, note.path))) &&
        !/curl|wget|https?:|rm -|sudo/.test(detail);
      service.respond(event.requestId!, safe);
    }
    if (event.type === 'question') service.respond(event.requestId!, false);
    if (event.type === 'done') end(event);
  });
  const start = Date.now();
  const timer = setTimeout(() => void service.cancel(), 150000);
  service.start({
    scopeId: space.scopeId,
    agent,
    notePath: note.path,
    prompt: `Read the selected note. Append exactly one new paragraph: ${marker}. Use your native tools to read and edit the file; shell file reads and apply_patch are allowed and preserve the Japanese title. Do not change other files. Then briefly report completion.`,
    newSession: true,
  });
  const finish = await done;
  clearTimeout(timer);
  const actual = await readFile(path.join(root, note.path), 'utf8');
  const schemaAfter = await schemaLayer();
  results.push({
    agent,
    outcome: finish.outcome,
    modified: actual.includes(marker),
    schemaChanges: [
      ...[...schemaAfter].filter((e) => !schemaBefore.has(e)).map((e) => `+ ${e}`),
      ...[...schemaBefore].filter((e) => !schemaAfter.has(e)).map((e) => `- ${e}`),
    ],
    streamed: events.some((e) => e.type === 'text'),
    toolEvents: events.filter((e) => e.type === 'tool').length,
    permissions: events.filter((e) => e.type === 'permission').length,
    elapsedMs: Date.now() - start,
    errors: events.filter((e) => e.type === 'error').map((e) => e.text),
  });
  // Exercise actual cancellation with another process, without a simulated response.
  assert(actual.includes('日本語'));
}
const schemaFiles = [...schemaBefore].map((e) => e.split(' ')[0]).sort();
console.log(JSON.stringify({ fixture: base, schemaFiles, results }, null, 2));
await mkdir('test-results', { recursive: true });
await writeFile(
  'test-results/real-agents.json',
  JSON.stringify({ fixture: base, schemaFiles, results }, null, 2),
);
if (
  results.some((r: any) => !r.modified || r.outcome !== 'completed' || r.schemaChanges.length > 0)
)
  process.exitCode = 1;
