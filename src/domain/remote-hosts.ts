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

/**
 * What `ssh` asks the person while it signs in to a host (ADR 061, amended): a
 * password, a key's passphrase, a verification code, or whether to trust the
 * host's key. `text` is the question in ssh's own words, which for a code or a
 * password come from the host.
 */
export interface RemoteHostQuestion {
  id: string;
  text: string;
  /** `secret`: words to type, unseen unless shown. `confirm`: yes or no. `notice`: nothing to answer. */
  kind: 'secret' | 'confirm' | 'notice';
  /** Asked before in this login in the same words: `ssh` did not take the last answer. */
  again?: boolean;
}
/** The longest answer taken to a question of `ssh`. */
export const remoteAnswerLimit = 4096;

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
  /** What `ssh` asks the person now, in the window that is to show it. */
  asking?: RemoteHostQuestion;
  about?: RemoteHostAbout;
  /** How many of its vaults are on this device's list. */
  vaults: number;
}

/**
 * A host the person's own ssh configuration names (`~/.ssh/config` and what it
 * includes): `alias` is what `ssh` is given. The rest is what the entry says of
 * it, for showing which machine it is; `ssh` works it out again when it connects.
 */
export interface SshConfigHost {
  alias: string;
  hostName?: string;
  user?: string;
  port?: number;
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
