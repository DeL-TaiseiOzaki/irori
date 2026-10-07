import which from 'which';
import { agentEnv } from '../agents/process';

/** Where `name` resolves on the PATH of `env`, the one irori gives child processes by default. */
export function findExecutable(name: string, env: NodeJS.ProcessEnv = agentEnv()) {
  // Windows spells the key `Path`; a copied environment keeps whichever spelling it had.
  const searchPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1];
  return which(name, { nothrow: true, path: searchPath });
}
