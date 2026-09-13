import { contextBridge, ipcRenderer } from 'electron';
import type { HostAPI, HostEvent } from '../domain/types';
const invoke = async (method: string, ...args: unknown[]) => {
  const result = await ipcRenderer.invoke('irori', method, ...args);
  if (!result.ok) throw Error(result.error);
  return result.value;
};
const api: HostAPI = {
  repositories: (...args) => invoke('repositories', ...args),
  workspaces: () => invoke('workspaces'),
  saveWorkspace: (...args) => invoke('saveWorkspace', ...args),
  removeWorkspace: (...args) => invoke('removeWorkspace', ...args),
  cloudSetup: () => invoke('cloudSetup'),
  cloudAccounts: () => invoke('cloudAccounts'),
  addCloudAccount: (...args) => invoke('addCloudAccount', ...args),
  cancelCloudAccount: (...args) => invoke('cancelCloudAccount', ...args),
  removeCloudAccount: (...args) => invoke('removeCloudAccount', ...args),
  cloudDrives: (...args) => invoke('cloudDrives', ...args),
  cloudFolders: (...args) => invoke('cloudFolders', ...args),
  cloudConnections: (...args) => invoke('cloudConnections', ...args),
  addCloudAttachment: (...args) => invoke('addCloudAttachment', ...args),
  connectCloud: (...args) => invoke('connectCloud', ...args),
  disconnectCloud: (...args) => invoke('disconnectCloud', ...args),
  bindCloud: (...args) => invoke('bindCloud', ...args),
  renameCloud: (...args) => invoke('renameCloud', ...args),
  removeCloud: (...args) => invoke('removeCloud', ...args),
  spaces: () => invoke('spaces'),
  chooseFolder: () => invoke('chooseFolder'),
  register: (...args) => invoke('register', ...args),
  entries: (...args) => invoke('entries', ...args),
  read: (...args) => invoke('read', ...args),
  save: (...args) => invoke('save', ...args),
  draft: (...args) => invoke('draft', ...args),
  createNote: (...args) => invoke('createNote', ...args),
  openExternal: (...args) => invoke('openExternal', ...args),
  agents: () => invoke('agents'),
  agentSession: (...args) => invoke('agentSession', ...args),
  resetAgentSession: (...args) => invoke('resetAgentSession', ...args),
  start: (...args) => invoke('start', ...args),
  cancel: () => invoke('cancel'),
  respond: (...args) => invoke('respond', ...args),
  onEvent: (callback) => {
    const listener = (_: unknown, event: HostEvent) => callback(event);
    ipcRenderer.on('irori:event', listener);
    return () => ipcRenderer.removeListener('irori:event', listener);
  },
};
contextBridge.exposeInMainWorld('irori', api);
