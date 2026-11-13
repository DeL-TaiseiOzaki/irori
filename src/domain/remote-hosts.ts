import { z } from 'zod';

/**
 * What `ssh` is given to reach a host: a Host of the person's own ssh
 * configuration, or `user@host`. It is one argument to `ssh`, never a shell
 * word, and may not begin as an option would.
 */
export const sshDestination = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9_.@:%[\]-]*$/);

/** A folder of an SSH host, as that host names it. */
export const remotePath = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^\/[^\0\r\n]*$/);

/** What the person enters to add an SSH host, or to change one. */
export const remoteHostInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(60),
  destination: sshDestination,
  port: z.number().int().min(1).max(65535).optional(),
});
export type RemoteHostInput = z.infer<typeof remoteHostInput>;

export type RemoteHostState = 'offline' | 'connecting' | 'connected' | 'error';

/** What an SSH host says of itself once irori's vault host answers there. */
export interface RemoteHostAbout {
  user: string;
  hostname: string;
  platform: string;
  arch: string;
  home: string;
}

/** An SSH host a vault can live on (ADR 061), as this device knows it. */
export interface RemoteHost {
  id: string;
  name: string;
  destination: string;
  port?: number;
  state: RemoteHostState;
  /** What irori is doing to connect, or why it could not. */
  detail?: string;
  about?: RemoteHostAbout;
  /** How many of its vaults are on this device's list. */
  vaults: number;
}

/** The folders in one folder of an SSH host, for choosing a vault's. */
export interface RemoteFolders {
  path: string;
  /** The folder above, unless `path` is the top. */
  parent?: string;
  folders: { name: string; path: string; vault?: boolean }[];
  /** The folder holds more folders than are listed. */
  more?: boolean;
}

/** The longest name a file sent into a vault's work folder may have. */
export const sentFileName = z
  .string()
  .min(1)
  .max(200)
  // One name: no folder part, not a relative step, nothing a file system refuses.
  .refine((value) => !/[\\/\0]/.test(value) && value !== '.' && value !== '..');
