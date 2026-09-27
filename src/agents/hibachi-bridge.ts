import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';

/** Runs one hand-off to a hibachi agent and resolves with its report. */
export type HandOff = (hibachi: string, task: string, signal: AbortSignal) => Promise<string>;

/** The longest task a hand-off takes; the hibachi agent's prompt adds a line to it. */
export const handOffTaskLimit = 30000;

// Pi and Hermes Agent load no sub-agents from files, so the irori agent hands
// work to a hibachi agent through a `hibachi` command on its run's PATH. The
// command is irori's own runtime run as Node (Electron with
// ELECTRON_RUN_AS_NODE, so no Node install is assumed) with this client, which
// asks irori over a loopback URL that only this run's environment carries. It
// waits without a deadline: a hibachi agent's run ends when it finishes.
const client = `'use strict';
const http = require('node:http');
const usage = 'Usage: hibachi <hibachi or sub-agent name> "<task>"  (or the task on standard input)';
const fail = (message, code = 1) => {
  process.stderr.write('hibachi: ' + message + '\\n');
  process.exitCode = code;
};
const [name, ...words] = process.argv.slice(2);
const address = process.env.IRORI_HIBACHI;
const read = () =>
  new Promise((resolve, reject) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (text += chunk));
    process.stdin.on('end', () => resolve(text));
    process.stdin.on('error', reject);
  });
(async () => {
  if (!name || name === '-h' || name === '--help') {
    process.stderr.write(usage + '\\n');
    process.exitCode = name ? 0 : 2;
    return;
  }
  if (!address)
    return fail('only an irori agent run that irori started can hand work to a hibachi.');
  const task = words.length ? words.join(' ') : process.stdin.isTTY ? '' : await read();
  if (!task.trim()) return fail(usage, 2);
  const body = JSON.stringify({ hibachi: name, task });
  const request = http.request(
    address,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    },
    (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (text += chunk));
      response.on('end', () => {
        let reply;
        try {
          reply = JSON.parse(text);
        } catch {
          return fail('irori answered ' + response.statusCode + '.');
        }
        if (!reply || !reply.ok) return fail((reply && reply.error) || 'the hand-off did not complete.');
        process.stdout.write(reply.report.endsWith('\\n') ? reply.report : reply.report + '\\n');
      });
      response.on('error', (error) => fail('the connection to irori ended (' + error.message + ').'));
    },
  );
  request.on('error', (error) => fail('irori is not reachable (' + error.message + ').'));
  request.end(body);
})().catch((error) => fail(String(error && error.message ? error.message : error)));
`;

/** A POSIX shell word for any path: single quotes, with each quote closed and escaped. */
const shellWord = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
/** A cmd.exe word: double quotes, with % doubled so a path is never expanded. */
const cmdWord = (value: string) => `"${value.replaceAll('%', '%%')}"`;

export function hibachiLaunchers(runtime: string, script: string) {
  return {
    posix: `#!/bin/sh\n# irori: hands a task to a hibachi agent and prints its report.\nELECTRON_RUN_AS_NODE=1 exec ${shellWord(runtime)} ${shellWord(script)} "$@"\n`,
    windows: `@echo off\r\nrem irori: hands a task to a hibachi agent and prints its report.\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n${cmdWord(runtime)} ${cmdWord(script)} %*\r\n`,
  };
}

/** The environment with `directory` first on its search path, whatever the key's case. */
function withPath(env: NodeJS.ProcessEnv, directory: string) {
  const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
  return { ...env, [key]: [directory, env[key]].filter(Boolean).join(path.delimiter) };
}

/**
 * Serves one irori agent run's `hibachi` command. The launchers and the client
 * live in irori's data directory, never in a KB or the irori agent's folder;
 * the URL with its random token is only in the returned environment. A request
 * whose client goes away cancels its hand-off.
 */
export async function hibachiBridge(
  dataDir: string,
  handOff: HandOff,
  env: NodeJS.ProcessEnv,
  runtime = process.execPath,
) {
  const directory = path.join(dataDir, 'agents', 'hibachi');
  const bin = path.join(directory, 'bin');
  await mkdir(bin, { recursive: true, mode: 0o700 });
  const script = path.join(directory, 'client.cjs');
  await writeFile(script, client, { mode: 0o600 });
  const launchers = hibachiLaunchers(runtime, script);
  const posix = path.join(bin, 'hibachi');
  await writeFile(posix, launchers.posix, { mode: 0o700 });
  await chmod(posix, 0o700);
  await writeFile(path.join(bin, 'hibachi.cmd'), launchers.windows, { mode: 0o700 });
  const token = randomBytes(24).toString('hex');
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body = (body + chunk).slice(0, handOffTaskLimit * 4);
    });
    request.on('end', async () => {
      if (request.method !== 'POST' || request.url !== `/${token}`) {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: false, error: 'Not found' }));
        return;
      }
      const gone = new AbortController();
      response.on('close', () => {
        if (!response.writableFinished) gone.abort();
      });
      // The answer may take as long as the hibachi agent works.
      response.writeHead(200, { 'content-type': 'application/json' });
      response.flushHeaders();
      let reply: { ok: true; report: string } | { ok: false; error: string };
      try {
        const { hibachi, task } = JSON.parse(body) as { hibachi?: unknown; task?: unknown };
        if (typeof hibachi !== 'string' || !hibachi.trim() || typeof task !== 'string')
          throw Error('Name a hibachi and a task.');
        if (!task.trim()) throw Error('The task is empty.');
        if (task.length > handOffTaskLimit)
          throw Error(`A task is at most ${handOffTaskLimit} characters.`);
        reply = { ok: true, report: await handOff(hibachi.trim(), task, gone.signal) };
      } catch (error) {
        reply = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      if (!response.destroyed) response.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/${token}`;
  return {
    env: withPath({ ...env, IRORI_HIBACHI: url }, bin),
    url,
    bin,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
