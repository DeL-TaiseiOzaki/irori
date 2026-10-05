import { commandBridge, type BridgeCommand } from './command-bridge';
import { iroriArgumentLimit } from '../domain/irori-command';

/** Answers one `irori` command: its arguments and the folder it ran in. */
export type IroriAnswer = (
  request: { argv: string[]; cwd: string },
  signal: AbortSignal,
) => Promise<string>;

// The irori agent sets up hibachis through an `irori` command on its run's
// PATH, on every CLI. The client passes its arguments and working folder to
// irori over a loopback URL that only this run's environment carries, and
// prints irori's answer.
const client = `'use strict';
const http = require('node:http');
const fail = (message, code = 1) => {
  process.stderr.write('irori: ' + message + '\\n');
  process.exitCode = code;
};
const address = process.env.IRORI_COMMAND;
if (!address) fail('only an irori agent run that irori started can use this command.');
else {
  const body = JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() });
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
        if (!reply || !reply.ok) return fail((reply && reply.error) || 'the command did not complete.');
        process.stdout.write(reply.report.endsWith('\\n') ? reply.report : reply.report + '\\n');
      });
      response.on('error', (error) => fail('the connection to irori ended (' + error.message + ').'));
    },
  );
  request.on('error', (error) => fail('irori is not reachable (' + error.message + ').'));
  request.end(body);
}
`;

export const iroriCommand: BridgeCommand = {
  name: 'irori',
  purpose: 'sets up hibachis for the irori agent and prints what was done.',
  client,
  variable: 'IRORI_COMMAND',
  // Room for every argument and the folder, each escaped in JSON at worst.
  limit: (iroriArgumentLimit.count + 1) * iroriArgumentLimit.length * 6 + 64,
};

/** Serves one irori agent run's `irori` command (see `commandBridge`). */
export function iroriBridge(
  dataDir: string,
  answer: IroriAnswer,
  env: NodeJS.ProcessEnv,
  runtime = process.execPath,
) {
  return commandBridge(
    dataDir,
    iroriCommand,
    (request, signal) => {
      const { argv, cwd } = (request ?? {}) as { argv?: unknown; cwd?: unknown };
      if (!Array.isArray(argv) || typeof cwd !== 'string' || !cwd)
        throw Error('The command could not be read.');
      return answer({ argv: argv as string[], cwd }, signal);
    },
    env,
    runtime,
  );
}
