import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { FileService } from '../src/host/files';
import { AgentService } from '../src/agents/service';
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
  results.push({
    agent,
    outcome: finish.outcome,
    modified: actual.includes(marker),
    streamed: events.some((e) => e.type === 'text'),
    toolEvents: events.filter((e) => e.type === 'tool').length,
    permissions: events.filter((e) => e.type === 'permission').length,
    elapsedMs: Date.now() - start,
    errors: events.filter((e) => e.type === 'error').map((e) => e.text),
  });
  // Exercise actual cancellation with another process, without a simulated response.
  assert(actual.includes('日本語'));
}
console.log(JSON.stringify({ fixture: base, results }, null, 2));
await mkdir('test-results', { recursive: true });
await writeFile(
  'test-results/real-agents.json',
  JSON.stringify({ fixture: base, results }, null, 2),
);
if (results.some((r: any) => !r.modified || r.outcome !== 'completed')) process.exitCode = 1;
