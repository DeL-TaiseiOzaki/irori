import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import writeFileAtomic from 'write-file-atomic';

/** A command irori puts on an agent run's PATH (`hibachi`, `irori`). */
export interface BridgeCommand {
  /** The command's name, and its folder under `<irori data>/agents/`. */
  name: string;
  /** What the command does, for the launchers' comment line. */
  purpose: string;
  /** The client's CommonJS source, run on irori's own runtime as Node. */
  client: string;
  /** The environment variable that carries the URL with its token. */
  variable: string;
  /** The longest request body read, in characters. */
  limit: number;
}

/** A POSIX shell word for any path: single quotes, with each quote closed and escaped. */
const shellWord = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
/** A cmd.exe word: double quotes, with % doubled so a path is never expanded. */
const cmdWord = (value: string) => `"${value.replaceAll('%', '%%')}"`;

export function commandLaunchers(purpose: string, runtime: string, script: string) {
  return {
    posix: `#!/bin/sh\n# irori: ${purpose}\nELECTRON_RUN_AS_NODE=1 exec ${shellWord(runtime)} ${shellWord(script)} "$@"\n`,
    windows: `@echo off\r\nrem irori: ${purpose}\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n${cmdWord(runtime)} ${cmdWord(script)} %*\r\n`,
  };
}

/** The environment with `directory` first on its search path, whatever the key's case. */
export function withPath(env: NodeJS.ProcessEnv, directory: string) {
  const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
  return { ...env, [key]: [directory, env[key]].filter(Boolean).join(path.delimiter) };
}

/**
 * Serves one run's command. The launchers and the client live in irori's data
 * directory, never in a KB or the irori agent's folder; the URL with its random
 * token is only in the returned environment. `answer` gets the parsed request
 * body and returns the report; a request whose client goes away aborts its
 * signal.
 */
export async function commandBridge(
  dataDir: string,
  command: BridgeCommand,
  answer: (request: unknown, signal: AbortSignal) => Promise<string>,
  env: NodeJS.ProcessEnv,
  runtime = process.execPath,
) {
  const directory = path.join(dataDir, 'agents', command.name);
  const bin = path.join(directory, 'bin');
  await mkdir(bin, { recursive: true, mode: 0o700 });
  const script = path.join(directory, 'client.cjs');
  // Replaced whole: another run's CLI may be starting from them at this moment.
  await writeFileAtomic(script, command.client, { mode: 0o600 });
  const launchers = commandLaunchers(command.purpose, runtime, script);
  const posix = path.join(bin, command.name);
  await writeFileAtomic(posix, launchers.posix, { mode: 0o700 });
  await chmod(posix, 0o700);
  await writeFileAtomic(path.join(bin, `${command.name}.cmd`), launchers.windows, { mode: 0o700 });
  const token = randomBytes(24).toString('hex');
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body = (body + chunk).slice(0, command.limit);
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
      // The answer may take as long as the work does.
      response.writeHead(200, { 'content-type': 'application/json' });
      response.flushHeaders();
      let reply: { ok: true; report: string } | { ok: false; error: string };
      try {
        reply = { ok: true, report: await answer(JSON.parse(body), gone.signal) };
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
    env: withPath({ ...env, [command.variable]: url }, bin),
    url,
    bin,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
