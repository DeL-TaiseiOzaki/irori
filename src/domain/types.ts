export type AgentId = 'codex' | 'claude';
export type Category = 'personal' | 'team' | 'organization';
export type Layer = 'schema' | 'Knowledge_Base' | 'contents';
export interface ScopeDeclaration {
  schemaVersion: 1;
  scopeId: string;
  name: string;
  category: Category;
  contents: string[];
}
export interface Space extends ScopeDeclaration {
  root: string;
}
export interface Entry {
  path: string;
  name: string;
  directory: boolean;
  layer: Layer;
  note: boolean;
  blocked?: string;
}
export interface Document {
  scopeId: string;
  path: string;
  text: string;
  hash: string;
  draft?: { text: string; baseHash: string };
}
export interface Question {
  id: string;
  title: string;
  options?: string[];
}
export interface AgentEvent {
  runId: string;
  type: 'status' | 'text' | 'tool' | 'permission' | 'question' | 'error' | 'done';
  text: string;
  requestId?: string;
  questions?: Question[];
  details?: string;
  outcome?: 'completed' | 'failed' | 'cancelled';
}
export interface AgentInfo {
  id: AgentId;
  version: string;
  available: boolean;
  tested: boolean;
  detail: string;
}
export type HostEvent = { type: 'files'; scopeId: string } | { type: 'agent'; event: AgentEvent };
export interface StartRun {
  scopeId: string;
  agent: AgentId;
  prompt: string;
  notePath?: string;
  newSession?: boolean;
}
export interface HostAPI {
  spaces(): Promise<Space[]>;
  chooseFolder(): Promise<string | null>;
  register(root: string, name: string, category: Category): Promise<Space>;
  entries(scopeId: string, directory: string): Promise<Entry[]>;
  read(scopeId: string, path: string): Promise<Document>;
  save(doc: Document): Promise<Document>;
  draft(doc: Document): Promise<void>;
  createNote(scopeId: string, name: string): Promise<Document>;
  openExternal(scopeId: string, path: string): Promise<void>;
  agents(): Promise<AgentInfo[]>;
  start(input: StartRun): Promise<string>;
  cancel(): Promise<void>;
  respond(requestId: string, allow: boolean, answers?: Record<string, string>): Promise<void>;
  onEvent(callback: (event: HostEvent) => void): () => void;
}
declare global {
  interface Window {
    irori: HostAPI;
    iroriFlushDraft?: () => Promise<void>;
  }
}
