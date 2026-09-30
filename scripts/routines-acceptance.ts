import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { YourAiService } from '../src/host/you';
import { WorkspaceService } from '../src/host/workspaces';
import { SettingsService } from '../src/host/settings';
import { GitService } from '../src/git/service';
import { AgentService } from '../src/agents/service';
import { conversationMetas } from '../tests/fixtures/conversations';
import { RoutineService } from '../src/host/routines';
import type { AgentEvent, AgentId } from '../src/domain/types';
import type { RoutineRef, RoutineRun } from '../src/domain/routines';

// Real Claude Code and Codex as routine agent steps (ADR 016 D7), in a
// disposable Git hibachi. It uses the person's CLI accounts and allowance:
// run it only when real agent runs are authorized. `npm run test:routines`
// runs both; name one CLI to run only that one. Permission requests are
// allowed here, as the person would in the routine's step.
const selected = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
const clis = (selected.length ? selected : ['claude', 'codex']) as AgentId[];
// Claude Code refuses bypassPermissions as root outside a recognised sandbox,
// and Codex's own sandbox cannot start where user namespaces are refused.
const access = (cli: AgentId) =>
  cli === 'claude' && process.getuid?.() === 0
    ? 'default'
    : cli === 'codex' && process.argv.includes('--codex-sandbox')
      ? 'default'
      : 'full-access';
const base = await mkdtemp(path.join(tmpdir(), 'irori routines real '));
const keep = process.argv.includes('--keep');
const files = new FileService(path.join(base, 'device'));
await files.init();
const root = path.join(base, 'Inbox hibachi');
await mkdir(path.join(root, 'Knowledge_Base'), { recursive: true });
await writeFile(
  path.join(root, 'AGENTS.md'),
  'This is a disposable test hibachi. Work only inside this folder. Do not use Git, the network or subagents.\n',
);
const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], {
    cwd: root,
    stdio: 'pipe',
  });
git('init', '-q', '-b', 'main');
git('add', '.');
git('commit', '-q', '-m', 'Start');
const space = await files.register(root, 'Inbox', 'personal');
const you = new YourAiService(files.dataDir, path.join(base, 'home'));
await you.load();
const workspaces = new WorkspaceService(files);
const workspace = await workspaces.save('Acceptance', [space.scopeId]);
const settings = new SettingsService(files.dataDir);
await settings.save({ routineRuntimes: ['javascript'] });
const requests: AgentEvent[] = [];
const agents = new AgentService(
  files,
  (event) => {
    if (event.type !== 'permission' && event.type !== 'question') return;
    requests.push(event);
    void agents.respond(
      event.requestId!,
      true,
      Object.fromEntries((event.questions ?? []).map((q) => [q.id, q.options?.[0] ?? 'yes'])),
    );
  },
  undefined,
  undefined,
  you,
);
const gitService = new GitService(files);
const routines = new RoutineService({
  dataDir: files.dataDir,
  files,
  you,
  agents,
  workspaces: () => workspaces.list(),
  settings: () => settings.read(),
  gitStatus: (id) => gitService.status(id),
  canStart: () => {},
  emit: () => {},
});
await routines.init();

async function routine(folder: string, contents: Record<string, string>): Promise<RoutineRef> {
  const dir = path.join(root, '.irori', 'routines', folder);
  for (const [rel, text] of Object.entries(contents)) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), text);
  }
  return { owner: space.scopeId, folder };
}
async function run(ref: RoutineRef): Promise<RoutineRun> {
  const review = await routines.review(ref);
  const id = await routines.run(ref, {
    workspaceId: workspace.id,
    digest: review.digest,
    agents: {},
  });
  const deadline = Date.now() + 15 * 60 * 1000;
  while (routines.busy) {
    if (Date.now() > deadline) {
      await routines.stop(ref);
      throw Error(`${ref.folder} did not finish in 15 minutes`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return (await routines.runs(ref)).find((item) => item.id === id)!;
}

const results: Record<string, unknown>[] = [];
try {
  for (const cli of clis) {
    const target = `Knowledge_Base/inbox-${cli}.md`;
    const triage = await routine(`triage-${cli}`, {
      'routine.yaml': `name: Triage (${cli})
steps:
  - run: fetch.js
  - agent: hibachi
    cli: ${cli}
    access: ${access(cli)}
    prompt: |
      Read the file items.txt in the folder named by IRORI_WORK. Create ${target} in this hibachi with one Markdown bullet per line of that file, in the same order, and nothing else in it. Change no other file.
`,
      'fetch.js': `require('node:fs').writeFileSync(require('node:path').join(process.env.IRORI_WORK, 'items.txt'), 'alpha mail\\nbeta mail\\ngamma mail\\n');\nconsole.log('fetched 3');\n`,
    });
    const started = Date.now();
    const done = await run(triage);
    const seconds = Math.round((Date.now() - started) / 1000);
    const written = await readFile(path.join(root, target), 'utf8').catch(() => '');
    const step = done.steps[1];
    const shown = (
      await agents.conversation(space.scopeId, cli, step.conversation?.conversationId)
    ).events.filter((event) => event.runId === step.conversation?.runId);
    const failing = await routine(`failing-${cli}`, {
      'routine.yaml': `name: Failing (${cli})
steps:
  - agent: hibachi
    cli: ${cli}
    access: ${access(cli)}
    prompt: |
      Summarize the file missing.txt in the folder named by IRORI_WORK. That file does not exist, so this task cannot be done: report it the way irori asked. Create no file.
`,
    });
    const failed = await run(failing);
    results.push({
      cli,
      access: access(cli),
      triage: done.state,
      seconds,
      stepStates: done.steps.map((item) => item.state),
      report: step.output.slice(0, 300),
      detail: step.detail,
      written,
      changes: done.changes,
      conversationLines: shown.length,
      failing: failed.state,
      failingDetail: failed.steps[0].detail,
      failingReport: failed.steps[0].output.slice(0, 200),
      requestsAnswered: requests.length,
    });
    assert.equal(done.state, 'succeeded', JSON.stringify(done));
    assert.equal(done.steps[0].output, 'fetched 3\n');
    assert.equal(step.conversation?.agent, cli);
    assert.match(written, /alpha mail[\s\S]*beta mail[\s\S]*gamma mail/);
    assert.deepEqual(done.changes, [{ scopeId: space.scopeId, name: 'Inbox', paths: [target] }]);
    assert.ok(shown.some((event) => event.text === `ルーティン: Triage (${cli})（ステップ 2）`));
    assert.ok(
      shown.some((event) => event.role === 'user' && event.text.startsWith('Read the file')),
    );
    assert.ok(!shown.some((event) => event.text.includes('IRORI_WORK=')));
    // The step is a conversation of its own whose native session is never saved.
    const meta = (await conversationMetas(files.dataDir)).find(
      (item) => item.id === step.conversation?.conversationId,
    );
    assert.deepEqual(meta?.native, {});
    assert.equal(failed.state, 'failed', JSON.stringify(failed));
    assert.match(failed.steps[0].output.trimStart(), /^\[FAILED\]/);
  }
  console.log(JSON.stringify(results, null, 2));
  console.log(`Routine agent steps passed on real ${clis.join(' and ')}.`);
} catch (error) {
  console.log(JSON.stringify(results, null, 2));
  throw error;
} finally {
  await routines.stopAll();
  await agents.cancel();
  if (keep) console.log(`Kept ${base}`);
  else await rm(base, { recursive: true, force: true });
}
