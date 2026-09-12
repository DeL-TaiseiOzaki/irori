import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { AgentService } from '../src/agents/service';
import type { AgentEvent, AgentId } from '../src/domain/types';
const base = await mkdtemp(path.join(tmpdir(), 'irori lifecycle 日本語 '));
const files = new FileService(path.join(base, 'device'));
await files.init();
const root = path.join(base, 'KB');
await mkdir(root);
const space = await files.register(root, 'Lifecycle', 'personal');
await writeFile(
  path.join(root, 'AGENTS.md'),
  'Only access this disposable KB. Do not use network, subagents, or external files.\n',
);
await writeFile(
  path.join(root, 'CLAUDE.md'),
  'Only access this disposable KB. Do not use network, subagents, or external files.\n',
);
const results: unknown[] = [];
for (const agent of ['codex', 'claude'] as AgentId[]) {
  const note = await files.createNote(space.scopeId, agent);
  let finish!: (e: AgentEvent) => void;
  let phase = 'deny';
  let permissionCount = 0;
  let questions = 0;
  let done = new Promise<AgentEvent>((resolve) => {
    finish = resolve;
  });
  const service = new AgentService(files, (e) => {
    if (e.type === 'permission') {
      permissionCount++;
      service.respond(e.requestId!, false);
    }
    if (e.type === 'question') {
      questions++;
      service.respond(
        e.requestId!,
        true,
        Object.fromEntries((e.questions ?? []).map((q) => [q.id, 'Chosen answer: green'])),
      );
    }
    if (e.type === 'error') console.log(agent, phase, e.text.slice(0, 700));
    if (e.type === 'done') finish(e);
  });
  let timer = setTimeout(() => void service.cancel(), 120000);
  service.start({
    scopeId: space.scopeId,
    agent,
    notePath: note.path,
    newSession: true,
    prompt:
      'Read this note and append DENIAL_SHOULD_PREVENT_THIS. If any tool is denied, stop immediately and report the denial. Do not retry or use an alternative tool.',
  });
  const denied = await done;
  clearTimeout(timer);
  results.push({
    agent,
    phase,
    requests: permissionCount,
    outcome: denied.outcome,
    unchanged: !(await readFile(path.join(root, note.path), 'utf8')).includes(
      'DENIAL_SHOULD_PREVENT_THIS',
    ),
  });
  phase = 'question';
  done = new Promise((resolve) => {
    finish = resolve;
  });
  timer = setTimeout(() => void service.cancel(), 90000);
  service.start({
    scopeId: space.scopeId,
    agent,
    prompt: `Use ${agent === 'claude' ? 'AskUserQuestion' : 'request_user_input'} to ask me which color I want, red or green. Wait for the tool response, then acknowledge the selected color. Do not read or edit files.`,
  });
  const questioned = await done;
  clearTimeout(timer);
  results.push({ agent, phase, requests: questions, outcome: questioned.outcome });
  phase = 'cancel';
  done = new Promise((resolve) => {
    finish = resolve;
  });
  service.start({
    scopeId: space.scopeId,
    agent,
    prompt:
      'Read the selected note and think carefully about a twenty-step improvement plan. Do not modify any files.',
    notePath: note.path,
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const start = Date.now();
  await service.cancel();
  const cancelled = await done;
  results.push({
    agent,
    phase,
    outcome: cancelled.outcome,
    elapsedMs: Date.now() - start,
    busy: service.busy,
  });
}
await mkdir('test-results', { recursive: true });
await writeFile(
  'test-results/lifecycle-agents.json',
  JSON.stringify({ fixture: base, results }, null, 2),
);
console.log(JSON.stringify(results, null, 2));
