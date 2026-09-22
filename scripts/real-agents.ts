import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { FileService } from '../src/host/files';
import { AgentService } from '../src/agents/service';
import { classify } from '../src/domain/scopes';
import { AuthorshipStore } from '../src/knowledge/authorship';
import { SessionStore } from '../src/agents/sessions';
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
const continuity = process.argv.includes('--continuity');
const selectedAgent = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
for (const agent of selectedAgent
  ? [selectedAgent as AgentId]
  : (['codex', 'claude'] as AgentId[])) {
  const note = await files.createNote(space.scopeId, `${agent} 日本語 note`);
  const marker = `IRORI_${agent.toUpperCase()}_VERIFIED`;
  const authorship = new AuthorshipStore(files.dataDir);
  const originalLine = 'A fixture sentence for the first version.';
  const revisedLine = 'A fixture sentence for the revised version.';
  let authorshipLookups = 0;
  const view = authorship.view.bind(authorship);
  authorship.view = async (ref, text) => {
    authorshipLookups++;
    return view(ref, text);
  };
  const continuationToken = randomBytes(12).toString('hex');
  if (continuity) {
    const before = await readFile(path.join(root, note.path), 'utf8');
    const text = `${before}\n${originalLine}\n`;
    await writeFile(path.join(root, note.path), text);
    await authorship.observe({ scopeId: space.scopeId, path: note.path }, text, before);
  }
  const events: AgentEvent[] = [];
  let end!: (event: AgentEvent) => void;
  const done = new Promise<AgentEvent>((resolve) => {
    end = resolve;
  });
  const service = new AgentService(
    files,
    (event) => {
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
    },
    undefined,
    authorship,
  );
  const start = Date.now();
  const timer = setTimeout(() => void service.cancel(), 150000);
  service.start({
    scopeId: space.scopeId,
    agent,
    notePath: note.path,
    prompt: `Read the selected note. Append exactly one new paragraph: ${marker}. Use your native tools to read and edit the file; shell file reads and apply_patch are allowed and preserve the Japanese title. Do not change other files. ${continuity ? `Also use your native Edit tool to replace the exact sentence ${JSON.stringify(originalLine)} with ${JSON.stringify(revisedLine)}. After editing, mention any extra tool-provided context about that edit. Remember this continuation token in the conversation only, never write it to a file: ${continuationToken}.` : ''} Then briefly report completion.`,
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
    ...(continuity
      ? {
          personLineEdited: actual.includes(revisedLine) && !actual.includes(originalLine),
          personLineHookLookups: authorshipLookups,
          personLineNoticeAcknowledged: /person wrote|person.*revised|human|authorship/i.test(
            events
              .filter((event) => event.type === 'text')
              .map((event) => event.text)
              .join(''),
          ),
        }
      : {}),
  });
  await service.flush();
  if (continuity && finish.outcome === 'completed') {
    // Recreate both host services from disk; every adapter also starts a fresh
    // native process. No token or first-turn text enters the second request.
    const reloadedFiles = new FileService(files.dataDir);
    await reloadedFiles.init();
    const binding = { scopeId: space.scopeId, agent, root: reloadedFiles.get(space.scopeId).root };
    const before = await new SessionStore(files.dataDir).read(binding);
    const resumedEvents: AgentEvent[] = [];
    let complete!: (event: AgentEvent) => void;
    const resumedDone = new Promise<AgentEvent>((resolve) => {
      complete = resolve;
    });
    const reloaded = new AgentService(reloadedFiles, (event) => {
      resumedEvents.push(event);
      if (event.type === 'permission' || event.type === 'question')
        reloaded.respond(event.requestId!, false);
      if (event.type === 'done') complete(event);
    });
    const resumeStart = Date.now();
    const resumeTimer = setTimeout(() => void reloaded.cancel(), 90000);
    reloaded.start({
      scopeId: space.scopeId,
      agent,
      prompt:
        'Reply with only the continuation token I told you to remember earlier in this conversation. Do not use tools, read files, or edit anything.',
    });
    const resumed = await resumedDone;
    clearTimeout(resumeTimer);
    await reloaded.flush();
    const after = await new SessionStore(files.dataDir).read(binding);
    const text = resumedEvents
      .filter((event) => event.type === 'text')
      .map((event) => event.text)
      .join('');
    const schemaAfterResume = await schemaLayer();
    results.push({
      agent,
      phase: 'restart-resume',
      outcome: resumed.outcome,
      recalled: text.includes(continuationToken),
      sameHandle: !!before && before.handle === after?.handle,
      toolEvents: resumedEvents.filter(
        (event) => event.type === 'tool' && event.text !== 'reasoning',
      ).length,
      schemaUnchanged:
        schemaAfterResume.size === schemaBefore.size &&
        [...schemaAfterResume].every((entry) => schemaBefore.has(entry)),
      elapsedMs: Date.now() - resumeStart,
      errors: resumedEvents.filter((event) => event.type === 'error').map((event) => event.text),
    });
  }
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
  results.some((r: any) =>
    r.phase === 'restart-resume'
      ? r.outcome !== 'completed' ||
        !r.recalled ||
        !r.sameHandle ||
        !r.schemaUnchanged ||
        r.toolEvents > 0
      : !r.modified ||
        !r.streamed ||
        r.toolEvents < 1 ||
        r.outcome !== 'completed' ||
        r.schemaChanges.length > 0 ||
        (continuity &&
          (!r.personLineEdited || (r.agent === 'claude' && r.personLineHookLookups < 1))),
  )
)
  process.exitCode = 1;
