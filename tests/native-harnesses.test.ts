import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OpenCodeServer, data } from '../src/agents/opencode';
import { PiRpc, runPi } from '../src/agents/pi';
import { launch, killTree, agentEnv } from '../src/agents/process';
import type { ChildProcess } from 'node:child_process';

// Opt-in native control probes. No prompt, auth flow, API key or model inference.
test(
  'Real OpenCode serves authenticated native sessions without model inference',
  { skip: !process.env.IRORI_TEST_OPENCODE_PATH, timeout: 60000 },
  async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), 'irori native opencode '));
    const keys = ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME'] as const;
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    for (const key of keys) process.env[key] = path.join(base, key);
    const cwd = path.join(base, 'KB 日本語');
    await mkdir(cwd);
    const abort = new AbortController();
    const server = new OpenCodeServer(cwd, abort.signal, process.env.IRORI_TEST_OPENCODE_PATH);
    t.after(async () => {
      server.stop();
      await killTree(server.child);
      for (const key of keys)
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      await rm(base, { recursive: true, force: true });
    });

    assert.equal((await server.start()).healthy, true);
    const response = await server.request('/global/health');
    assert.equal((await fetch(response.url)).status, 401);
    const session = await data(server.client.session.create());
    assert.equal(
      await import('node:fs/promises').then((fs) => fs.realpath(session.directory)),
      cwd,
    );
    assert.equal((await data(server.client.session.get({ sessionID: session.id }))).id, session.id);
    let connected = false;
    const [events] = await server.events((event) => {
      if (event.type === 'server.connected') connected = true;
    });
    const ending = events.catch(() => {});
    for (let n = 0; n < 100 && !connected; n++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(connected);
    await data(server.client.session.delete({ sessionID: session.id }));
    server.stop();
    await ending;
    await assert.rejects(data(server.client.global.health()));
  },
);

test(
  'Real Pi answers RPC state and command discovery without model inference',
  { skip: !process.env.IRORI_TEST_PI_PATH, timeout: 60000 },
  async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), 'irori native pi '));
    const env = { ...agentEnv(), PI_CODING_AGENT_DIR: path.join(base, 'pi-state') };
    const abort = new AbortController();
    const child = launch(process.env.IRORI_TEST_PI_PATH!, ['--mode', 'rpc'], base, env);
    const rpc = new PiRpc(
      child,
      () => {},
      () => {},
      abort.signal,
    );
    t.after(async () => {
      rpc.fail(Error('Test finished'));
      await killTree(child);
      await rm(base, { recursive: true, force: true });
    });
    const state = await rpc.request('get_state');
    assert.equal(state.isStreaming, false);
    assert.ok(path.isAbsolute(state.sessionFile));
    assert.ok(Array.isArray((await rpc.request('get_commands')).commands));
    await rpc.request('abort');
    abort.abort();
    await assert.rejects(rpc.request('get_state'), /stopped/);
  },
);

test(
  'Real Pi extension dialog, lazy persistence and seeded session restart pass without model inference',
  { skip: !process.env.IRORI_TEST_PI_PATH, timeout: 60000 },
  async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), 'irori native pi extension '));
    const previousPath = process.env.PATH;
    const previousPi = process.env.PI_CODING_AGENT_DIR;
    process.env.PATH =
      path.dirname(process.env.IRORI_TEST_PI_PATH!) + path.delimiter + previousPath;
    process.env.PI_CODING_AGENT_DIR = path.join(base, 'pi-state');
    const extensions = path.join(process.env.PI_CODING_AGENT_DIR, 'extensions');
    await mkdir(extensions, { recursive: true });
    await writeFile(
      path.join(extensions, 'irori-test.ts'),
      `export default function(pi: any) {
    pi.registerCommand('irori-native-probe', { description: 'Disposable no-model probe', handler: async (_args: string, ctx: any) => {
      const answer = await ctx.ui.confirm('Native Pi fixture confirmation', 'No model is called');
      pi.sendMessage({ customType: 'irori-test', content: answer ? 'confirmed' : 'denied', display: true }, { triggerTurn: false });
    } });
  }`,
    );
    t.after(async () => {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousPi === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousPi;
      await rm(base, { recursive: true, force: true });
    });
    let handle: string | undefined;
    let dialogs = 0;
    for (let run = 0; run < 3; run++) {
      let child: ChildProcess | undefined;
      const originalHandle = handle;
      try {
        await runPi({
          cwd: base,
          prompt: '/irori-native-probe',
          session: handle,
          signal: new AbortController().signal,
          child: (value) => {
            child = value;
          },
          event: () => {},
          ask: async (title) => {
            assert.equal(title, 'Native Pi fixture confirmation');
            dialogs++;
            return { allow: false };
          },
          saveSession: async (value) => {
            handle = value;
          },
        });
        if (originalHandle) assert.equal(handle, originalHandle);
        if (run === 0) {
          assert.equal(
            handle,
            undefined,
            'A command-only run must not persist a nonexistent native file',
          );
          handle = path.join(base, 'seeded-session.jsonl');
          await writeFile(
            handle,
            JSON.stringify({
              type: 'session',
              version: 3,
              id: '8e839a5f-d6ea-48ce-8a11-26a1cb5c247c',
              timestamp: new Date().toISOString(),
              cwd: base,
            }) + '\n',
          );
        } else assert.ok((await readFile(handle!, 'utf8')).includes('denied'));
      } finally {
        if (child) await killTree(child);
      }
    }
    assert.equal(dialogs, 3);
  },
);
