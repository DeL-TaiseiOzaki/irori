import { contextBridge, ipcRenderer } from 'electron';
import { hostBridge, type HostRequests } from '../domain/host-bridge';
import type { HostAPI, HostEvent } from '../domain/types';
// Generated from the validators at build time; keep Zod out of the sandboxed preload.
declare const HOST_METHODS: (keyof HostRequests)[];
const invoke = async (method: string, ...args: unknown[]) => {
  const result = await ipcRenderer.invoke('irori', method, ...args);
  if (!result.ok) throw Error(result.error);
  return result.value;
};
const api: HostAPI = {
  ...hostBridge(HOST_METHODS, invoke),
  onEvent: (callback) => {
    const listener = (_: unknown, event: HostEvent) => callback(event);
    ipcRenderer.on('irori:event', listener);
    return () => ipcRenderer.removeListener('irori:event', listener);
  },
};
contextBridge.exposeInMainWorld('irori', api);
