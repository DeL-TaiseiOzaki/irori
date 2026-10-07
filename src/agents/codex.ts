import { launch } from './process';
import type { Message, Rpc } from './rpc';

/** Codex's app server, spoken to as JSON-RPC over its standard input and output. */
export function codexServer(cwd: string, env?: NodeJS.ProcessEnv) {
  return launch('codex', ['app-server', '--listen', 'stdio://'], cwd, env);
}

/** The app server's handshake: irori names itself and asks for the experimental API. */
export async function initializeCodex(rpc: Rpc) {
  await rpc.request('initialize', {
    clientInfo: { name: 'irori', title: 'irori', version: '0.1.0' },
    capabilities: { experimentalApi: true },
  });
  rpc.send({ method: 'initialized', params: {} });
}

/** Answers a server request irori does not handle with a refusal, never an approval. */
export function refuseCodex(rpc: Rpc, request: Message, message: string) {
  rpc.send({ id: request.id, error: { code: -32601, message } });
}
