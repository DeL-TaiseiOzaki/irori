import type {
  AgentAccess,
  AgentAnswers,
  AgentEvent,
  AgentId,
  Document,
  Entry,
  Space,
} from '../domain/types';
import type { KnowledgeSearch } from '../domain/search';

/** A vault that lives on an SSH host, as this device knows it (ADR 061). */
export interface RemoteVault extends Space {
  host: { id: string; name: string };
}

/** What only the vault's host can say of it for the irori agent's request. */
export interface RemoteBrief {
  /** The description of the vault's own definition of its agent, when it has one. */
  description?: string;
}

/** A task handed to a vault's agent (ADR 050), wherever that vault is. */
export interface HandedTask {
  scopeId: string;
  agent: AgentId;
  model?: string;
  effort?: string;
  access: AgentAccess;
  task: string;
}

/** How a hand-off ended: the vault agent's words, and why it did not finish when it did not. */
export interface HandOffResult {
  outcome: NonNullable<AgentEvent['outcome']>;
  report: string;
  error?: string;
}

/** A hand-off in progress. */
export interface HandOff {
  /** Stops the vault agent's run; its result then says so. */
  cancel(): Promise<void>;
  result: Promise<HandOffResult>;
}

/**
 * The vaults on SSH hosts as an agent run reaches them (ADR 061). Only the
 * irori agent's runs do, and only the vaults handed to the request.
 */
export interface RemoteVaults {
  list(): RemoteVault[];
  brief(scopeId: string, agent: AgentId): Promise<RemoteBrief>;
  entries(scopeId: string, path: string): Promise<Entry[]>;
  read(scopeId: string, path: string): Promise<Document>;
  search(scopeId: string, query: string): Promise<KnowledgeSearch>;
  /** Puts a file in the vault's work folder, under its name or the first free one; its path inside the vault. */
  send(scopeId: string, name: string, bytes: Uint8Array): Promise<string>;
  /**
   * Starts the vault agent's run on its host. `from` is the irori agent's
   * conversation, so that its hand-offs continue in one conversation of the
   * vault. `follow` gets the run's events as they come.
   */
  handOff(
    task: HandedTask,
    from: string | undefined,
    follow: (event: AgentEvent) => void,
  ): Promise<HandOff>;
  /** Answers a permission request or question of a run on a host. */
  respond(requestId: string, allow: boolean, answers?: AgentAnswers): Promise<void>;
}
