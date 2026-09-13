import type { HostAPI } from './types';
export type HostRequests = Omit<HostAPI, 'onEvent'>;

export function hostBridge(
  methods: (keyof HostRequests)[],
  invoke: (method: string, ...args: unknown[]) => Promise<unknown>,
): HostRequests {
  return Object.fromEntries(
    methods.map((method) => [method, (...args: unknown[]) => invoke(method, ...args)]),
  ) as HostRequests;
}
