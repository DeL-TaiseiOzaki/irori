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
for (const agent of process.argv[2]
  ? [process.argv[2] as AgentId]
  : (['codex', 'claude'] as AgentId[])) {
  const note = await files.createNote(space.scopeId, agent);
  const original = await readFile(path.join(root, note.path), 'utf8');
  let finish!: (e: AgentEvent) => void;
  let phase = 'deny';
  let permissionCount = 0;
  let questions = 0;
  let text = '';
  let toolEvents = 0;
  let activity!: () => void;
  let active = new Promise<void>((resolve) => {
    activity = resolve;
  });
  let done = new Promise<AgentEvent>((resolve) => {
    finish = resolve;
  });
  const service = new AgentService(files, (e) => {
    if (['text', 'tool', 'permission', 'question'].includes(e.type)) activity();
    if (e.type === 'text') text += e.text;
    if (e.type === 'tool') toolEvents++;
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
      agent === 'codex'
        ? 'Request explicit user approval for a native shell command that would append DENIAL_SHOULD_PREVENT_THIS to the selected note, using sandbox_permissions=require_escalated. Do not execute the command without that approval. The trial will deny the request. On denial, stop immediately and report it; do not retry or use another tool.'
        : 'Read this note and append DENIAL_SHOULD_PREVENT_THIS. If any tool is denied, stop immediately and report the denial. Do not retry or use an alternative tool.',
  });
  const denied = await done;
  clearTimeout(timer);
  results.push({
    agent,
    phase,
    requests: permissionCount,
    toolEvents,
    streamed: text.length > 0,
    outcome: denied.outcome,
    unchanged: (await readFile(path.join(root, note.path), 'utf8')) === original,
  });
  phase = 'question';
  text = '';
  toolEvents = 0;
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
  results.push({
    agent,
    phase,
    requests: questions,
    outcome: questioned.outcome,
    acknowledgedAnswer: /green/i.test(text),
    structuredQuestionUnavailable:
      /not available|unavailable|plan mode|available.*plan|使え|利用でき/i.test(text),
  });
  phase = 'cancel';
  let sawActivity = false;
  active = new Promise<void>((resolve) => {
    activity = () => {
      sawActivity = true;
      resolve();
    };
  });
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
  let activityTimer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    active,
    done,
    new Promise<void>((resolve) => {
      activityTimer = setTimeout(resolve, 15000);
    }),
  ]);
  clearTimeout(activityTimer);
  const start = Date.now();
  await service.cancel();
  const cancelled = await done;
  results.push({
    agent,
    phase,
    outcome: cancelled.outcome,
    sawActivity,
    elapsedMs: Date.now() - start,
    busy: service.anyBusy,
  });
}
await mkdir('test-results', { recursive: true });
await writeFile(
  'test-results/lifecycle-agents.json',
  JSON.stringify({ fixture: base, results }, null, 2),
);
console.log(JSON.stringify(results, null, 2));

// A provider can complete without asking either gate; that is missing acceptance,
// not a passing lifecycle test. Cancellation alone does not establish inference.
if (
  results.some((value: any) => {
    if (value.phase === 'deny')
      return (
        value.outcome !== 'completed' || value.requests < 1 || !value.unchanged || !value.streamed
      );
    if (value.phase === 'question')
      return value.outcome !== 'completed' || value.requests < 1 || !value.acknowledgedAnswer;
    return (
      value.outcome !== 'cancelled' || !value.sawActivity || value.busy || value.elapsedMs > 15000
    );
  })
)
  process.exitCode = 1;
