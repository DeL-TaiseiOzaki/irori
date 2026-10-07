import { clientBase, commandBridge, type BridgeCommand } from './command-bridge';
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
const client = `${clientBase('irori')}
const address = process.env.IRORI_COMMAND;
if (!address) fail('only an irori agent run that irori started can use this command.');
else
  post(
    address,
    JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }),
    'the command did not complete.',
  );
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
