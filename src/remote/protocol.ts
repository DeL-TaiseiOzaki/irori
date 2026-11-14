import { z } from 'zod';
import { hostArguments } from '../domain/host-requests';
import { agentAccessModes, agentIds, type AgentEvent } from '../domain/types';
import { categoryText } from '../domain/brains';
import { languages } from '../domain/i18n';
import { remotePath, sentFileName, type RemoteHostAbout } from '../domain/remote-hosts';
import type { VaultRead } from '../host/vault-reads';
import type { HandOffResult } from '../agents/remote-vaults';

/**
 * The operations of the HostAPI that a vault host answers for the vaults on its
 * SSH host, under the names and with the arguments the window uses (ADR 061).
 */
export const forwardedReads = [
  'entries',
  'read',
  'readImage',
  'viewerBytes',
  'trashedNotes',
  'search',
  'backlinks',
  'referringLinks',
  'resolveLink',
  'knowledgeHistory',
  'gitStatus',
  'gitDiff',
  'gitHistory',
  'gitCommitDiff',
  'gitConflict',
  'gitSubmodules',
  'ontology',
  'ontologyPages',
  'skillReach',
  'workFolder',
  'notesDeclaration',
  'pageProperties',
  'noteAuthorship',
  'noteComments',
  'skills',
  'schemaSettings',
  'readSchemaFile',
] as const satisfies readonly (VaultRead | 'skills' | 'schemaSettings' | 'readSchemaFile')[];
export type ForwardedRead = (typeof forwardedReads)[number];
export const isForwardedRead = (method: string): method is ForwardedRead =>
  (forwardedReads as readonly string[]).includes(method);

const id = z.uuid();
const name = z.string().trim().min(1).max(120);
/** The largest file sent into a work folder: what `irori send` takes. */
export const sentFileLimit = 20 * 1024 * 1024;

/** A task handed to a vault's agent on its host. */
export const handedTask = z.object({
  scopeId: id,
  agent: z.enum(agentIds),
  model: z.string().min(1).max(200).optional(),
  effort: z.string().min(1).max(40).optional(),
  access: z.enum(agentAccessModes),
  task: z.string().min(1).max(32000),
});

/** What a vault host answers beside the HostAPI's reads. */
export const hostOperations = {
  spaces: z.tuple([]),
  folders: z.tuple([remotePath.optional()]),
  registerVault: z.tuple([remotePath, name, categoryText]),
  unregisterVault: z.tuple([id]),
  brief: z.tuple([id, z.enum(agentIds)]),
  sendFile: z.tuple([
    id,
    sentFileName,
    z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength <= sentFileLimit),
  ]),
  handOff: z.tuple([handedTask, id.optional()]),
  handOffState: z.tuple([id]),
  awaitHandOff: z.tuple([id]),
  cancelHandOff: z.tuple([id]),
  forgetHandOff: z.tuple([id]),
  respond: hostArguments.respond,
  status: z.tuple([]),
} as const;
export type HostOperation = keyof typeof hostOperations;

/** Where a hand-off stands on its host. */
export type HandOffState =
  | { state: 'unknown' }
  | { state: 'running'; pending: AgentEvent[] }
  | ({ state: 'done' } & HandOffResult);

/** What this device says when it attaches, and what the vault host answers. */
export const attachRequest = z.object({
  /** The version of the vault host this device carries. */
  version: z.string().min(1).max(80),
  language: z.enum(languages),
  /** The last event this device got, to be sent what came after it. */
  resume: z.number().int().min(0).optional(),
});
export type AttachRequest = z.infer<typeof attachRequest>;
export interface AttachReply {
  version: string;
  about: RemoteHostAbout;
  /** The number of the newest event. */
  seq: number;
  /** Whether every event after `resume` is being sent; otherwise some were dropped. */
  resumed: boolean;
  /** Whether an agent run is in progress on the host. */
  running: boolean;
}

/** The line a vault host prints before the frames begin, after whatever a login shell printed. */
export const attachedLine = 'IRORI-HOST 1';
/** The line the starter prints instead when the vault host is not installed yet. */
export const needsLine = 'IRORI-NEEDS';
