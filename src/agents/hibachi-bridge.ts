import { commandBridge, commandLaunchers, type BridgeCommand } from './command-bridge';

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

const hibachiCommand: BridgeCommand = {
  name: 'hibachi',
  purpose: 'hands a task to a hibachi agent and prints its report.',
  client,
  variable: 'IRORI_HIBACHI',
  limit: handOffTaskLimit * 4,
};

export function hibachiLaunchers(runtime: string, script: string) {
  return commandLaunchers(hibachiCommand.purpose, runtime, script);
}

/**
 * Serves one irori agent run's `hibachi` command (see `commandBridge`). A
 * request whose client goes away cancels its hand-off.
 */
export function hibachiBridge(
  dataDir: string,
  handOff: HandOff,
  env: NodeJS.ProcessEnv,
  runtime = process.execPath,
) {
  return commandBridge(
    dataDir,
    hibachiCommand,
    async (request, signal) => {
      const { hibachi, task } = request as { hibachi?: unknown; task?: unknown };
      if (typeof hibachi !== 'string' || !hibachi.trim() || typeof task !== 'string')
        throw Error('Name a hibachi and a task.');
      if (!task.trim()) throw Error('The task is empty.');
      if (task.length > handOffTaskLimit)
        throw Error(`A task is at most ${handOffTaskLimit} characters.`);
      return handOff(hibachi.trim(), task, signal);
    },
    env,
    runtime,
  );
}
