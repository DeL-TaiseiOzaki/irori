import { agentEnv, onSearchPath } from '../agents/process';

/**
 * Where `name` resolves on the PATH of `env`, the one irori gives child processes
 * by default — never in the current folder, which Windows would search first.
 */
export async function findExecutable(name: string, env: NodeJS.ProcessEnv = agentEnv()) {
  return onSearchPath(name, env) ?? null;
}
