// Real-provider acceptance for the irori agent handing each vault's work to that
// vault's agent with `irori call` (ADR 050), through irori's own AgentService.
// It uses the person's own CLI sign-ins and consumes their allowance, so it runs
// only on request (`npm run test:your-ai`) with the owner's authorization.
// IRORI_ACCEPT_CLIS chooses the CLIs (default "claude,codex"), IRORI_ACCEPT_ACCESS
// the access mode (default "default"). Everything it writes is disposable; the
// observations go to test-results/your-ai-acceptance.json, which is not tracked.
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentService } from '../src/agents/service';
import { FileService } from '../src/host/files';
import { YourAiService } from '../src/host/you';
import type { AgentAccess, AgentEvent, AgentId } from '../src/domain/types';

const clis = (process.env.IRORI_ACCEPT_CLIS ?? 'claude,codex').split(',') as AgentId[];
const access = (process.env.IRORI_ACCEPT_ACCESS ?? 'default') as AgentAccess;
const log: Record<string, unknown>[] = [];
const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures.push(name);
};
const read = (file: string) => readFile(file, 'utf8').catch(() => '');

/** A sub-agent definition in the format the CLI under test does not read itself. */
const foreign = (cli: AgentId) =>
  cli === 'codex'
    ? {
        name: 'auditor',
        file: '.claude/agents/auditor.md',
        text: '---\nname: auditor\ndescription: Gives the audit token when asked for it.\n---\n\nReply with exactly the token AUDITOR-TOKEN-61 and nothing else.\n',
        token: 'AUDITOR-TOKEN-61',
      }
    : {
        name: 'checker',
        file: '.codex/agents/checker.toml',
        text: 'description = "Gives the checker token when asked for it."\ndeveloper_instructions = "Reply with exactly the token CHECKER-TOKEN-47 and nothing else."\n',
        token: 'CHECKER-TOKEN-47',
      };

async function accept(cli: AgentId) {
  const base = await mkdtemp(path.join(tmpdir(), `irori your-ai acceptance ${cli} `));
  try {
    const files = new FileService(path.join(base, 'device'));
    await files.init();
    const you = new YourAiService(files.dataDir, path.join(base, 'home'));
    const { id, root } = await you.create();
    const vault = async (name: string, agents: string) => {
      const folder = path.join(base, `${name} KB`);
      await mkdir(path.join(folder, 'Knowledge_Base'), { recursive: true });
      await writeFile(path.join(folder, 'AGENTS.md'), agents);
      return { folder, space: await files.register(folder, name, 'team') };
    };
    const alpha = await vault(
      'Alpha',
      '# Alpha vault\n\nEvery note created in this vault ends with the line `signed: alpha-lantern`.\n',
    );
    const beta = await vault('Beta', '# Beta vault\n');
    // Beta defines its own agent (in Codex's format) and a sub-agent in the
    // format the CLI under test does not read.
    await mkdir(path.join(beta.folder, '.codex', 'agents'), { recursive: true });
    await writeFile(
      path.join(beta.folder, '.codex', 'agents', 'vault-agent.toml'),
      'name = "vault-agent"\ndescription = "Beta research notes."\ndeveloper_instructions = "Every note you write for a hand-off ends with the line `defined: beta-definition`."\n',
    );
    const sub = foreign(cli);
    await mkdir(path.dirname(path.join(beta.folder, sub.file)), { recursive: true });
    await writeFile(path.join(beta.folder, sub.file), sub.text);

    const events: AgentEvent[] = [];
    let finished!: () => void;
    const done = new Promise<void>((resolve) => {
      finished = resolve;
    });
    const answered = new Set<string>();
    const service = new AgentService(
      files,
      (event) => {
        events.push(event);
        if (event.type === 'permission' && !answered.has(event.requestId!)) {
          // Disposable folders only: every request is allowed, and kept in the log.
          answered.add(event.requestId!);
          log.push({ cli, permission: event.text, scopeId: event.scopeId });
          setTimeout(() => service.respond(event.requestId!, true), 0);
        }
        if (event.type === 'question' && !answered.has(event.requestId!)) {
          answered.add(event.requestId!);
          setTimeout(() => service.respond(event.requestId!, false), 0);
        }
        if (event.type === 'done' && event.scopeId === id) finished();
      },
      undefined,
      undefined,
      you,
    );
    const timer = setTimeout(() => void service.cancel(), 20 * 60_000);
    await service.startAccepted({
      scopeId: id,
      agent: cli,
      access,
      brains: [alpha.space.scopeId, beta.space.scopeId],
      prompt: [
        'This is an acceptance test of handing work to vault agents. Follow each step literally and report every outcome.',
        '1. Hand the Alpha vault this task: Create Knowledge_Base/hello.md with the line "hello from alpha".',
        `2. Hand the Beta vault this task: Create Knowledge_Base/beta.md with the line "hello from beta". Then ask your sub-agent "${sub.name}" for its token, and add that token on a line of its own at the end of the file.`,
        '3. Finish with one sentence per vault.',
      ].join('\n'),
    });
    await done;
    clearTimeout(timer);
    await service.cancel();
    const own = events.filter((event) => event.scopeId === id);
    for (const event of events)
      if (event.type !== 'text' || event.scopeId === id)
        log.push({
          cli,
          scopeId: event.scopeId === id ? 'irori agent' : event.scopeId,
          type: event.type,
          text: event.text?.slice(0, 300),
          delegate: event.delegate,
          outcome: event.outcome,
        });
    const hello = await read(path.join(alpha.folder, 'Knowledge_Base', 'hello.md'));
    const note = await read(path.join(beta.folder, 'Knowledge_Base', 'beta.md'));
    check(`${cli}: the irori agent's run completed`, own.at(-1)?.outcome === 'completed');
    const handed = (scopeId: string, state: string) =>
      own.some((event) => event.delegate?.scopeId === scopeId && event.delegate.state === state);
    check(
      `${cli}: both vaults were handed with irori call and reported`,
      handed(alpha.space.scopeId, 'reported') && handed(beta.space.scopeId, 'reported'),
    );
    check(
      `${cli}: Alpha's agent followed Alpha's AGENTS.md`,
      hello.includes('hello from alpha') && hello.includes('alpha-lantern'),
    );
    check(
      `${cli}: Beta's agent followed Beta's own vault-agent definition`,
      note.includes('hello from beta') && note.includes('beta-definition'),
    );
    check(
      `${cli}: Beta's agent used its sub-agent from the other CLI's format`,
      note.includes(sub.token),
    );
    check(
      `${cli}: irori wrote no vault definitions into the irori agent's folder`,
      ['.claude', '.codex', '.opencode'].every(
        (dir) => !existsSync(path.join(root, dir, 'agents')),
      ),
    );
    log.push({ cli, hello, note });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

try {
  for (const cli of clis) await accept(cli);
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile(
    'test-results/your-ai-acceptance.json',
    JSON.stringify({ failures, log }, null, 2),
  );
}
console.log(
  failures.length
    ? `irori agent acceptance: ${failures.length} check(s) failed; see test-results/your-ai-acceptance.json.`
    : `irori agent acceptance passed with ${clis.join(', ')}: irori call, each vault's Schema and definition, and sub-agents across formats.`,
);
process.exit(failures.length ? 1 : 0);
