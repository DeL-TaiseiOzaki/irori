import { clientBase, commandBridge, type BridgeCommand } from './command-bridge';
import { iroriArgumentLimit } from '../domain/irori-command';

/** Runs one hand-off to a vault agent and resolves with its report. */
export type HandOff = (vault: string, task: string, signal: AbortSignal) => Promise<string>;

/** The longest task a hand-off takes; the vault agent's prompt adds a line to it. */
export const handOffTaskLimit = 30000;

/** Answers one `irori` command: its arguments and the folder it ran in. */
export type IroriAnswer = (
  request: { argv: string[]; cwd: string },
  signal: AbortSignal,
) => Promise<string>;

// The irori agent and the vault agents do what the person does in irori
// through an `irori` command on their run's PATH, on every CLI (ADR 025, 031). The client passes its arguments and working folder to
// irori over a loopback URL that only this run's environment carries, and
// prints irori's answer.
// \`irori call <vault>\` may take its task on standard input.
const client = `${clientBase('irori')}
const address = process.env.IRORI_COMMAND;
const argv = process.argv.slice(2);
const read = () =>
  new Promise((resolve, reject) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (text += chunk));
    process.stdin.on('end', () => resolve(text));
    process.stdin.on('error', reject);
  });
(async () => {
  if (!address) return fail('only an agent run that irori started can use this command.');
  if (argv[0] === 'call' && argv.length === 2 && !process.stdin.isTTY) argv.push(await read());
  post(address, JSON.stringify({ argv, cwd: process.cwd() }), 'the command did not complete.');
})().catch((error) => fail(String(error && error.message ? error.message : error)));
`;

export const iroriCommand: BridgeCommand = {
  name: 'irori',
  purpose: 'does in irori what the person does there, for the agent, and prints what was done.',
  client,
  variable: 'IRORI_COMMAND',
  // Room for every argument and the folder, each escaped in JSON at worst,
  // and for a task handed over with \`irori call\`.
  limit: (iroriArgumentLimit.count + 1) * iroriArgumentLimit.length * 6 + handOffTaskLimit * 6 + 64,
};

/** Serves one agent run's `irori` command (see `commandBridge`). */
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
