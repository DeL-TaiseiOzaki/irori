import { z } from 'zod';
import { agentIds } from './types';
import type { HostRequests } from './host-bridge';
import { providerId } from './connections';

const id = z.uuid(),
  path = z.string().max(4096),
  text = z.string().max(2 * 1024 * 1024);
const name = z.string().min(1).max(120),
  version = z.string().regex(/^[a-f0-9]{64}$/);
const document = z.object({ scopeId: id, path, text, hash: version });
const cols = z.number().int().min(2).max(500),
  rows = z.number().int().min(1).max(300);

// This registry is also the preload allowlist. Every HostAPI request must have a validator.
export const hostArguments = {
  terminalShells: z.tuple([]),
  openTerminal: z.tuple([id, path, cols, rows]),
  writeTerminal: z.tuple([id, z.string().max(65536)]),
  resizeTerminal: z.tuple([id, cols, rows]),
  acknowledgeTerminal: z.tuple([
    id,
    z
      .number()
      .int()
      .min(0)
      .max(2 * 1024 * 1024),
  ]),
  closeTerminal: z.tuple([id]),
  gitStatus: z.tuple([id]),
  gitDiff: z.tuple([id, path, z.boolean()]),
  gitHistory: z.tuple([id, z.number().int().min(0).max(10000)]),
  gitCommitDiff: z.tuple([id, z.string().regex(/^[a-f0-9]{40,64}$/)]),
  gitStage: z.tuple([id, path, z.boolean(), version]),
  gitCommit: z.tuple([id, z.string().min(1).max(10000), version]),
  gitSync: z.tuple([id, z.enum(['fetch', 'pull', 'merge', 'push']), version]),
  gitConflict: z.tuple([id, path]),
  gitResolve: z.tuple([id, path, text.nullable(), version]),
  gitClone: z.tuple([z.object({ url: z.string().max(2048), parent: path, name })]),
  gitOpenRepository: z.tuple([id]),
  repositories: z.tuple([path]),
  workspaces: z.tuple([]),
  saveWorkspace: z.tuple([name.trim().min(1), z.array(id).max(100), id.optional()]),
  removeWorkspace: z.tuple([id]),
  cloudSetup: z.tuple([]),
  openCloudSetupHelp: z.tuple([]),
  workspaceCloud: z.tuple([id]),
  cloudEntries: z.tuple([id, path]),
  cloudRead: z.tuple([id, path]),
  openCloudFile: z.tuple([id, path]),
  cloudAccounts: z.tuple([]),
  addCloudAccount: z.tuple([name.trim().min(1)]),
  cancelCloudAccount: z.tuple([id]),
  removeCloudAccount: z.tuple([id]),
  cloudDrives: z.tuple([id]),
  cloudFolders: z.tuple([id, providerId, providerId.optional()]),
  cloudConnections: z.tuple([id]),
  addCloudAttachment: z.tuple([
    z.object({
      scopeId: id,
      accountId: id,
      name: z.string().max(200),
      contentsRoot: path,
      folder: z.object({
        id: providerId,
        name: z.string().max(1024),
        parentId: providerId,
        driveId: providerId.optional(),
      }),
    }),
  ]),
  connectCloud: z.tuple([id, id]),
  disconnectCloud: z.tuple([id, id]),
  bindCloud: z.tuple([id, id, id]),
  renameCloud: z.tuple([id, id, z.string().max(200)]),
  removeCloud: z.tuple([id, id]),
  spaces: z.tuple([]),
  chooseFolder: z.tuple([]),
  register: z.tuple([path, name, z.enum(['personal', 'team', 'organization'])]),
  entries: z.tuple([id, path]),
  read: z.tuple([id, path]),
  ontology: z.tuple([id]),
  save: z.tuple([document]),
  draft: z.tuple([document]),
  createNote: z.tuple([id, z.string().max(120)]),
  openExternal: z.tuple([id, path]),
  agents: z.tuple([]),
  agentSession: z.tuple([id, z.enum(agentIds)]),
  resetAgentSession: z.tuple([id, z.enum(agentIds)]),
  start: z.tuple([
    z.object({
      scopeId: id,
      agent: z.enum(agentIds),
      prompt: z.string().min(1).max(32000),
      notePath: path.optional(),
      newSession: z.boolean().optional(),
    }),
  ]),
  cancel: z.tuple([]),
  respond: z.tuple([
    id,
    z.boolean(),
    z
      .record(z.string(), z.union([z.string().max(16000), z.array(z.string().max(16000)).max(100)]))
      .optional(),
  ]),
} satisfies { [K in keyof HostRequests]: z.ZodType<Parameters<HostRequests[K]>> };

export type HostHandlers = {
  [K in keyof HostRequests]: (
    ...args: Parameters<HostRequests[K]>
  ) => Awaited<ReturnType<HostRequests[K]>> | ReturnType<HostRequests[K]>;
};

export function dispatchHost(handlers: HostHandlers, method: unknown, args: unknown[]) {
  if (typeof method !== 'string' || !Object.hasOwn(hostArguments, method))
    throw Error('Unknown host operation');
  return dispatch(method as keyof HostRequests);
  function dispatch<K extends keyof HostRequests>(key: K) {
    const parsed = hostArguments[key].parse(args) as Parameters<HostRequests[K]>;
    return (handlers[key] as (...args: Parameters<HostRequests[K]>) => unknown)(...parsed);
  }
}
