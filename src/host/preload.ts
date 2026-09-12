import { contextBridge, ipcRenderer } from 'electron';
import type { HostAPI, HostEvent } from '../domain/types';
const invoke = async (method: string, ...args: unknown[]) => {
  const result = await ipcRenderer.invoke('irori', method, ...args);
  if (!result.ok) throw Error(result.error);
  return result.value;
};
const api: HostAPI = {
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
