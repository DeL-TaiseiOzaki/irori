import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { hibachiBridge, hibachiLaunchers } from '../src/agents/hibachi-bridge';
import { hibachiOf, type Delegation } from '../src/agents/delegation';
import { brainsCommandPreamble } from '../src/domain/you';
import { FileService } from '../src/host/files';
import { YourAiService } from '../src/host/you';
import { AgentService } from '../src/agents/service';
import type { AgentEvent, Space } from '../src/domain/types';

const posixOnly = {
  skip: process.platform === 'win32' && 'POSIX launcher and executable fixtures',
  timeout: 30000,
};

async function temp(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori hibachi command '));
  t.after(() => rm(base, { recursive: true, force: true }));
  return base;
}

/** Runs the `hibachi` command as a CLI's shell would: by name, from the run's PATH. */
function hibachi(env: NodeJS.ProcessEnv, args: string[], input?: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = execFile('hibachi', args, { env }, (error, stdout, stderr) =>
      resolve({ code: error ? Number(error.code) : 0, stdout, stderr }),
    );
    child.stdin?.end(input);
  });
}

test('a hibachi is named by its sub-agent name or its own name, and only if handed', () => {
  const delegation: Delegation = {
    you: '/me/you',
    brains: [
      { scopeId: 'a', name: 'Product Lab', agent: 'hibachi-product-lab', root: '/kb/a' },
      { scopeId: 'b', name: 'Notes', agent: 'hibachi-notes', root: '/kb/b' },
      { scopeId: 'c', name: 'notes', agent: 'hibachi-notes-cccccccc', root: '/kb/c' },
    ],
  };
  assert.equal(hibachiOf(delegation, 'hibachi-product-lab').scopeId, 'a');
  assert.equal(hibachiOf(delegation, 'product  lab').scopeId, 'a');
  assert.equal(hibachiOf(delegation, 'hibachi-notes-cccccccc').scopeId, 'c');
  assert.throws(() => hibachiOf(delegation, 'Notes'), /More than one hibachi.*sub-agent name/);
  assert.throws(
    () => hibachiOf(delegation, 'Research'),
    /No hibachi named "Research".*hibachi-notes/,
  );
});

test('the command preamble names each hibachi agent and the command, not their Schema', () => {
  const text = brainsCommandPreamble(
    [{ name: 'Product', category: 'チーム', agent: 'hibachi-product', root: '/kb/p' }],
    'Hermes Agent',
  );
  assert.match(text, /- Product \(チーム\): folder "\/kb\/p", hibachi agent "hibachi-product"\n/);
  assert.match(text, /You run on Hermes Agent/);
  assert.match(text, /hibachi <hibachi agent or hibachi name> "<task>"/);
  assert.match(text, /Do not change a hibachi's files yourself/);
  assert.doesNotMatch(text, /AGENTS\.md/);
});

test('the launchers run irori’s runtime as Node, quoting any path', () => {
  const { posix, windows } = hibachiLaunchers(
    "/Apps/it's irori/irori",
    'C:\\data\\100%\\client.cjs',
  );
  assert.match(posix, /^#!\/bin\/sh\n/);
  assert.match(posix, /ELECTRON_RUN_AS_NODE=1 exec '\/Apps\/it'\\''s irori\/irori' /);
  assert.match(posix, / "\$@"\n$/);
  assert.match(windows, /set ELECTRON_RUN_AS_NODE=1\r\n/);
  assert.match(windows, /"C:\\data\\100%%\\client\.cjs" %\*\r\n$/);
});

test(
  'the hibachi command reaches only its own run’s bridge and prints the report',
  posixOnly,
  async (t) => {
    const base = await temp(t);
    const asked: [string, string][] = [];
    const bridge = await hibachiBridge(
      path.join(base, 'data'),
      async (name, task) => {
        asked.push([name, task]);
        if (name === 'broken') throw Error('No hibachi named "broken" was handed to this request.');
        return `Report from ${name}: done.`;
      },
      { PATH: process.env.PATH },
    );
    t.after(bridge.close);
    // The launcher lives in irori's data directory, private to the person.
    assert.equal(bridge.bin, path.join(base, 'data', 'agents', 'hibachi', 'bin'));
    assert.equal((await stat(path.join(bridge.bin, 'hibachi'))).mode & 0o777, 0o700);
    assert.ok(bridge.env.PATH!.startsWith(bridge.bin + path.delimiter));

    const done = await hibachi(bridge.env, ['hibachi-product', 'Write', 'a note.']);
    assert.deepEqual(done, { code: 0, stdout: 'Report from hibachi-product: done.\n', stderr: '' });
    // The task may come on standard input.
    const piped = await hibachi(bridge.env, ['Product'], 'Line one.\nLine two.\n');
    assert.equal(piped.code, 0);
    assert.deepEqual(asked.at(-1), ['Product', 'Line one.\nLine two.\n']);
    // A refused hand-off exits non-zero with the reason.
    const refused = await hibachi(bridge.env, ['broken', 'x']);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /^hibachi: No hibachi named "broken"/);
    assert.equal(refused.stdout, '');
    // Without the run's URL, or with another token, nothing is handed over.
    const outside = await hibachi({ PATH: bridge.env.PATH }, ['hibachi-product', 'x']);
    assert.equal(outside.code, 1);
    assert.match(outside.stderr, /only an irori agent run/);
    const forged = await hibachi(
      { ...bridge.env, IRORI_HIBACHI: bridge.url.replace(/\/[^/]+$/, '/forged') },
      ['hibachi-product', 'x'],
    );
    assert.equal(forged.code, 1);
    assert.match(forged.stderr, /Not found/);
    const response = await fetch(bridge.url.replace(/\/[^/]+$/, '/nope'), {
      method: 'POST',
      body: JSON.stringify({ hibachi: 'hibachi-product', task: 'x' }),
    });
    assert.equal(response.status, 404);
    const usage = await hibachi(bridge.env, []);
    assert.equal(usage.code, 2);
    assert.match(usage.stderr, /Usage: hibachi/);
    assert.equal(asked.length, 3);
  },
);

async function handOffs(t: TestContext) {
  const base = await temp(t);
  const home = path.join(base, 'home');
  await mkdir(home);
  const you = new YourAiService(path.join(base, 'device'), home);
  const bin = path.join(base, 'bin');
  await mkdir(bin);
  await writeFile(
    path.join(bin, 'pi'),
    `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/harnesses.mjs')).href)}).then(m=>m.run('pi'));\n`,
    { mode: 0o700 },
  );
  const previous = process.env.PATH;
  process.env.PATH = bin + path.delimiter + previous;
  t.after(() => {
    process.env.PATH = previous;
  });
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const brains: Space[] = [];
  for (const name of ['Product', 'Research']) {
    const root = path.join(base, name);
    await mkdir(root);
    brains.push(await files.register(root, name, 'team'));
  }
  const { id, root } = await you.create();
  const events: AgentEvent[] = [];
  const waiting = new Map<string, () => void>();
  const service = new AgentService(
    files,
    (event) => {
      events.push(event);
      if (event.type === 'done') waiting.get(event.runId)?.();
    },
    undefined,
    undefined,
    you,
  );
  t.after(() => service.cancel());
  const run = async (prompt: string, handed = [brains[0]]) => {
    const runId = await service.startAccepted({
      scopeId: id,
      agent: 'pi',
      prompt,
      brains: handed.map((brain) => brain.scopeId),
    });
    const done = new Promise<void>((resolve) => waiting.set(runId, resolve));
    return { runId, done };
  };
  const log = async (folder: string) =>
    (await readFile(path.join(folder, 'fixture-requests.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  return { base, files, brains, id, root, service, events, run, log };
}

test(
  'the irori agent on Pi hands a hibachi to its agent with the hibachi command (protocol fixture)',
  posixOnly,
  async (t) => {
    const { base, brains, id, root, service, events, run, log } = await handOffs(t);
    const [product] = brains;
    const { runId, done } = await run('Hand over.\nrun: hibachi hibachi-product "Tidy the notes."');
    await done;
    const mine = events.filter((event) => event.runId === runId);
    assert.equal(mine.at(-1)?.outcome, 'completed', JSON.stringify(mine));
    // The hibachi agent ran in its own hibachi, on the same CLI, recorded in its scope.
    const handedPrompt = (await log(product.root)).find((call) => call.type === 'prompt').message;
    assert.match(handedPrompt, /^irori: the irori agent handed you this task\./);
    assert.ok(handedPrompt.endsWith('\n\nTidy the notes.'));
    const conversation = await service.conversation(product.scopeId, 'pi');
    assert.ok(
      conversation.events.some((event) => event.role === 'user' && event.text === handedPrompt),
    );
    assert.ok(
      conversation.events.some((event) => event.type === 'done' && event.outcome === 'completed'),
    );
    const hibachiRun = events.find(
      (event) => event.scopeId === product.scopeId && event.type === 'done',
    );
    assert.equal(hibachiRun?.outcome, 'completed');
    // The command printed that run's words, and the irori agent answered with them.
    const command = (await log(root)).find((call) => call.type === 'command');
    assert.equal(command.code, 0);
    assert.equal(command.stdout, '日本語\u2028の応答\n');
    // The irori agent's log follows the hand-off as a task of the hibachi.
    const started = mine.find((event) => event.delegate?.state === 'started');
    assert.equal(started?.delegate?.scopeId, product.scopeId);
    assert.equal(started?.text, 'Tidy the notes.');
    const reported = mine.find((event) => event.delegate?.state === 'reported');
    assert.equal(reported?.delegate?.task, started?.delegate?.task);
    assert.equal(reported?.text, '日本語\u2028の応答');
    assert.ok(mine.some((event) => event.type === 'tool' && event.delegate?.state === 'working'));
    assert.equal(service.busy(product.scopeId), false);
    // Nothing was written in the irori agent's folder or the KB for the command.
    await assert.rejects(stat(path.join(root, 'hibachi')));
    assert.ok(
      (await stat(path.join(base, 'device', 'agents', 'hibachi', 'bin', 'hibachi'))).isFile(),
    );
    assert.equal((await service.conversation(id, 'pi')).activeRunId, undefined);
  },
);

test(
  'a hibachi not handed to the request is refused, and stopping the irori agent stops its hand-off (protocol fixture)',
  posixOnly,
  async (t) => {
    const { brains, id, root, service, events, run, log } = await handOffs(t);
    const [product, research] = brains;
    const refused = await run('run: hibachi Research "Look around."');
    await refused.done;
    const command = (await log(root)).find((call) => call.type === 'command');
    assert.equal(command.code, 1);
    assert.match(command.stderr, /No hibachi named "Research" was handed to this request/);
    assert.equal(
      events.some((event) => event.scopeId === research.scopeId),
      false,
      'no run started in Research',
    );
    assert.equal(
      events.filter((event) => event.runId === refused.runId).at(-1)?.outcome,
      'completed',
    );

    // A hand-off that is still working stops with the irori agent's run.
    const held = await run('run: hibachi Product "hold on"', [product, research]);
    await new Promise<void>((resolve) => {
      const check = () =>
        events.some((event) => event.scopeId === product.scopeId && event.type === 'tool')
          ? resolve()
          : setTimeout(check, 20);
      check();
    });
    assert.equal(service.busy(product.scopeId), true);
    await service.cancel(id);
    await held.done;
    const productDone = events.filter(
      (event) => event.scopeId === product.scopeId && event.type === 'done',
    );
    assert.equal(productDone.at(-1)?.outcome, 'cancelled');
    assert.equal(events.filter((event) => event.runId === held.runId).at(-1)?.outcome, 'cancelled');
    assert.equal(service.busy(product.scopeId), false);
  },
);
