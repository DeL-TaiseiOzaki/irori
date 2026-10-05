import { z } from 'zod';
import { agentIds, markdownFonts, themes } from './types';
import type { HostRequests } from './host-bridge';
import { sourceDestination, sourceRef, sourceVersion } from './knowledge';
import { agentModel, startInput, yourAiChoice } from './conversation';
import { searchQuery } from './search';
import { draftKey, draftValue, draftRevision } from './drafts';
import { noteRef } from './note-operations';
import { externalUrl } from './links';
import { languages } from './i18n';
import { linkHref } from './note-links';
import { skillAudience, skillName } from './skills';
import { brainLook } from './brains';
import { layerFolderName } from './layers';
import { githubOwnerPattern, validRepositoryName } from './git';
import { routineRef, routineRuntimes } from './routines';
import { newComment } from './comments';

const id = z.uuid(),
  path = z.string().max(4096),
  text = z.string().max(2 * 1024 * 1024);
const name = z.string().min(1).max(120),
  version = z.string().regex(/^[a-f0-9]{64}$/);
const document = z.object({ scopeId: id, path, text, hash: version });
// A submodule's folder from the hibachi's root; the host checks it is one.
const repository = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !value.includes('\\') &&
      !value.includes('\0') &&
      value.split('/').every((part) => part && part !== '.' && part !== '..'),
  );
const target = z.union([id, z.object({ scopeId: id, repository }).strict()]);
const cols = z.number().int().min(2).max(500),
  rows = z.number().int().min(1).max(300);

// This registry is also the preload allowlist. Every HostAPI request must have a validator.
export const hostArguments = {
  recoverableCloudWrites: z.tuple([]),
  unsentDriveChanges: z.tuple([]),
  exportUnsentDriveChanges: z.tuple([]),
  draftRead: z.tuple([draftKey]),
  draftWrite: z.tuple([draftKey, draftValue, draftRevision]),
  checkForUpdates: z.tuple([]),
  openUpdatePage: z.tuple([z.enum(['release', 'download'])]),
  updateState: z.tuple([]),
  installUpdate: z.tuple([]),
  cancelUpdate: z.tuple([]),
  restartToUpdate: z.tuple([]),
  openUrl: z.tuple([externalUrl]),
  deviceSettings: z.tuple([]),
  saveDeviceSettings: z.tuple([
    z.object({
      theme: z.enum(themes).optional(),
      language: z.enum(languages).optional(),
      markdownFont: z.enum(markdownFonts).optional(),
      editorAssistance: z.boolean().optional(),
      hibachiAgent: z.boolean().optional(),
      // The pane library keys a layout by its prefix, the group id and every panel id.
      layouts: z.record(z.string().max(160), z.string().max(4096)).optional(),
      skillAudiences: z.record(z.string().max(64), skillAudience).optional(),
      yourAi: yourAiChoice.optional(),
      routineRuntimes: z.array(z.enum(routineRuntimes)).max(routineRuntimes.length).optional(),
    }),
  ]),
  moveNote: z.tuple([noteRef, path, z.boolean()]),
  trashNote: z.tuple([noteRef]),
  trashedNotes: z.tuple([id]),
  restoreNote: z.tuple([id, id]),
  search: z.tuple([id, searchQuery]),
  backlinks: z.tuple([id, path]),
  referringLinks: z.tuple([id, path]),
  resolveLink: z.tuple([id, path, linkHref]),
  knowledgeHistory: z.tuple([id]),
  restoreSource: z.tuple([sourceVersion]),
  sourceText: z.tuple([sourceVersion]),
  locateSource: z.tuple([sourceVersion]),
  rebindSource: z.tuple([sourceVersion, sourceDestination]),
  registerArtifact: z.tuple([sourceRef, id]),
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
  gitStatus: z.tuple([target]),
  gitDiff: z.tuple([target, path, z.boolean()]),
  gitHistory: z.tuple([target, z.number().int().min(0).max(10000)]),
  gitCommitDiff: z.tuple([target, z.string().regex(/^[a-f0-9]{40,64}$/)]),
  gitStage: z.tuple([target, path, z.boolean(), version]),
  gitStageMany: z.tuple([target, z.array(path).min(1).max(4000), z.boolean(), version]),
  gitCommit: z.tuple([target, z.string().min(1).max(10000), version]),
  gitSync: z.tuple([target, z.enum(['fetch', 'pull', 'merge', 'push']), version]),
  gitConflict: z.tuple([target, path]),
  gitResolve: z.tuple([target, path, text.nullable(), version]),
  gitSubmodules: z.tuple([id]),
  gitSubmoduleAdd: z.tuple([id, z.object({ url: z.string().max(2048), path: repository })]),
  gitSubmoduleInit: z.tuple([id, repository.optional()]),
  gitClone: z.tuple([z.object({ url: z.string().max(2048), parent: path, name })]),
  gitOpenRepository: z.tuple([target]),
  gitInit: z.tuple([id]),
  githubAccount: z.tuple([]),
  gitPublish: z.tuple([
    id,
    z.object({
      owner: z.string().regex(githubOwnerPattern),
      name: z.string().max(100).refine(validRepositoryName),
      visibility: z.enum(['private', 'public']),
      description: z.string().max(350).optional(),
    }),
    version,
  ]),
  repositories: z.tuple([path]),
  workspaces: z.tuple([]),
  saveWorkspace: z.tuple([name.trim().min(1), z.array(id).max(100), id.optional()]),
  removeWorkspace: z.tuple([id]),
  saveWorkspaceGroups: z.tuple([
    id,
    z
      .array(
        z.object({
          id,
          name: name.trim().min(1),
          scopeIds: z.array(id).max(100),
          open: z.boolean(),
        }),
      )
      .max(100),
  ]),
  cloudConnections: z.tuple([id]),
  connectCloud: z.tuple([id, id]),
  disconnectCloud: z.tuple([id, id]),
  addLocalFolder: z.tuple([
    z.object({
      scopeId: id,
      path: path.min(1),
      name: z.string().max(200),
      contentsRoot: path,
      access: z.enum(['read-only', 'read-write']).optional(),
    }),
  ]),
  bindLocalFolder: z.tuple([id, id, path.min(1)]),
  switchCloudToLocal: z.tuple([id, id, path.min(1)]),
  renameCloud: z.tuple([id, id, z.string().max(200)]),
  removeCloud: z.tuple([id, id]),
  setCloudAccess: z.tuple([id, id, z.enum(['read-only', 'read-write'])]),
  openCloudFolder: z.tuple([id, id]),
  createCloudNote: z.tuple([id, path, name.trim().min(1)]),
  moveCloudEntry: z.tuple([id, path, path]),
  deleteCloudEntry: z.tuple([id, path]),
  spaces: z.tuple([]),
  chooseFolder: z.tuple([]),
  register: z.tuple([path, name, z.enum(['personal', 'team', 'organization'])]),
  createSpace: z.tuple([
    z.object({
      parent: path,
      folder: name,
      name,
      category: z.enum(['personal', 'team', 'organization']),
    }),
  ]),
  updateSpace: z.tuple([
    id,
    z
      .object({
        name: name.optional(),
        category: z.enum(['personal', 'team', 'organization']).nullable().optional(),
        appearance: brainLook.nullable().optional(),
        labels: z
          .object({
            Knowledge_Base: z.string().max(40).nullable().optional(),
            contents: z.string().max(40).nullable().optional(),
          })
          .strict()
          .nullable()
          .optional(),
      })
      .strict(),
  ]),
  renameLayerFolder: z.tuple([id, z.enum(['Knowledge_Base', 'contents']), layerFolderName]),
  saveSpaceIcon: z.tuple([
    id,
    z.instanceof(Uint8Array).refine((value) => value.length <= 2 * 1024 * 1024),
  ]),
  entries: z.tuple([id, path]),
  read: z.tuple([id, path]),
  ontology: z.tuple([id]),
  graphIndexStatus: z.tuple([id]),
  updateGraphIndex: z.tuple([id]),
  skills: z.tuple([id]),
  skillReach: z.tuple([id]),
  schemaSettings: z.tuple([id]),
  readSchemaFile: z.tuple([id, path]),
  writeSchemaFile: z.tuple([id, path, text.nullable(), version.nullable()]),
  moveSkill: z.tuple([id, skillName, skillName.nullable()]),
  noteAuthorship: z.tuple([id, path, text]),
  noteComments: z.tuple([id, path]),
  addNoteComment: z.tuple([id, path, newComment]),
  removeNoteComment: z.tuple([id, path, z.string().min(1).max(64)]),
  saveImage: z.tuple([
    id,
    path,
    z.instanceof(Uint8Array).refine((value) => value.length <= 20 * 1024 * 1024),
  ]),
  readImage: z.tuple([id, path, path]),
  viewerBytes: z.tuple([id, path]),
  save: z.tuple([document]),
  draft: z.tuple([document]),
  createNote: z.tuple([id, z.string().max(120), path.optional()]),
  notesDeclaration: z.tuple([id]),
  pageProperties: z.tuple([id]),
  dailyNote: z.tuple([id]),
  openExternal: z.tuple([id, path]),
  agents: z.tuple([]),
  agentModels: z.tuple([z.enum(agentIds)]),
  agentConversations: z.tuple([id]),
  agentConversation: z.tuple([id, z.enum(agentIds), id.optional()]),
  createConversation: z.tuple([id, z.enum(agentIds)]),
  renameConversation: z.tuple([id, z.string().max(1000)]),
  pinConversation: z.tuple([id, z.boolean()]),
  archiveConversation: z.tuple([id, z.boolean()]),
  deleteConversation: z.tuple([id]),
  queueAgentMessage: z.tuple([startInput]),
  removeQueuedMessage: z.tuple([id, id]),
  startNextQueued: z.union([z.tuple([id]), z.tuple([id, id])]),
  start: z.tuple([startInput]),
  yourAi: z.tuple([]),
  createYourAi: z.tuple([]),
  addYourAiSkills: z.tuple([]),
  yourAiEntries: z.tuple([path]),
  yourAiRead: z.tuple([path]),
  yourAiBrains: z.tuple([z.array(id).max(50)]),
  routines: z.tuple([id]),
  reviewRoutine: z.tuple([routineRef]),
  runRoutine: z.tuple([
    routineRef,
    z
      .object({
        workspaceId: id,
        digest: version.optional(),
        agents: z.record(id, z.object({ agent: z.enum(agentIds), model: agentModel.optional() })),
      })
      .strict(),
  ]),
  stopRoutine: z.tuple([routineRef]),
  routineRuns: z.tuple([routineRef]),
  cancel: z.union([z.tuple([]), z.tuple([id]), z.tuple([id, id])]),
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
