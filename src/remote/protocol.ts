import { z } from 'zod';
import { hostArguments, type HostHandlers } from '../domain/host-requests';
import { attachmentByteLimit, attachmentRef } from '../domain/attachments';
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

/**
 * The operations of the HostAPI on a vault's own agent and its conversations,
 * which a vault host answers for the vaults on its SSH host: the agent runs and
 * its conversations are kept there (ADR 061, amended 0.2.79).
 */
export const forwardedAgent = [
  'agentCommands',
  'agentConversations',
  'agentConversation',
  'createConversation',
  'renameConversation',
  'pinConversation',
  'archiveConversation',
  'deleteConversation',
  'queueAgentMessage',
  'removeQueuedMessage',
  'startNextQueued',
  'sendQueuedNow',
  'rewindConversation',
  'forkConversation',
  'start',
  'cancel',
] as const satisfies readonly (keyof HostHandlers)[];
export type ForwardedAgent = (typeof forwardedAgent)[number];
export const isForwardedAgent = (method: string): method is ForwardedAgent =>
  (forwardedAgent as readonly string[]).includes(method);
/**
 * How many of an operation's arguments a vault host takes, for those whose last
 * names the irori agent's workspace, which a vault's conversations are not kept by.
 * The rest are sent as they are, less any left out at the end: a line of the
 * protocol is JSON, where an argument left out in the middle would arrive as null.
 */
export const hostArity: Partial<Record<ForwardedAgent, number>> = {
  agentConversations: 1,
  agentConversation: 3,
  createConversation: 2,
  startNextQueued: 2,
  sendQueuedNow: 3,
  rewindConversation: 3,
  forkConversation: 3,
};
/** Those of them that name a conversation first rather than a vault. */
export const byConversation = [
  'renameConversation',
  'pinConversation',
  'archiveConversation',
  'deleteConversation',
  'removeQueuedMessage',
] as const satisfies readonly ForwardedAgent[];
export const isByConversation = (method: string): method is (typeof byConversation)[number] =>
  (byConversation as readonly string[]).includes(method);

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
  /** A file the person attached on their device, kept under its id for an instruction there. */
  attach: z.tuple([
    attachmentRef,
    z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength <= attachmentByteLimit),
  ]),
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
/**
 * The line the starter prints instead when the vault host is not installed yet.
 * The same login then takes what is missing: one login is one sign-in, and a
 * person who types a verification code types it once.
 */
export const needsLine = 'IRORI-NEEDS';
/** What the starter prints once a part it was sent is in place, or could not be put there. */
export const doneLine = 'IRORI-DONE';
export const failedLine = 'IRORI-FAILED';
/** A vault host of another version is running an agent: it is not replaced now. */
export const busyLine = 'IRORI-BUSY';
/** A vault host of another version, with nothing running, is giving way to this one. */
export const replacingLine = 'IRORI-REPLACING';
