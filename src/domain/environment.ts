import type { DeviceSettings } from './types';

/**
 * A device's environment kept on the person's GitHub account (ADR 026): the
 * vaults that live on GitHub, the workspaces that combine them, the display
 * and agent preferences, the irori agent's folder when it is a repository,
 * and the irori agent's routines (ADR 043). It is files in a private
 * repository of that account, written and read with the GitHub CLI's sign-in;
 * notes and credentials never go there.
 */
export const environmentRepository = 'irori-settings';
export const environmentFile = 'environment.json';
/** The irori agent's routine folders, beside the environment. */
export const routinesFile = 'routines.json';

/** The preferences that follow the person from device to device. */
export const environmentPreferences = [
  'theme',
  'language',
  'markdownFont',
  'pageMargins',
  'editorAssistance',
  'vaultAgent',
  'yourAi',
  'routineRuntimes',
] as const satisfies readonly (keyof DeviceSettings)[];
export type EnvironmentPreferences = Partial<
  Pick<DeviceSettings, (typeof environmentPreferences)[number]>
>;

/** A routine of the saved environment, and whether this device has its folder. */
export interface EnvironmentRoutine {
  /** The folder's name in the irori agent's `routines/`. */
  folder: string;
  name: string;
  here: boolean;
}

/** A vault of the saved environment, and whether this device has it. */
export interface EnvironmentVault {
  scopeId: string;
  name: string;
  /** owner/name on GitHub. */
  repository: string;
  here: boolean;
}

export interface EnvironmentState {
  /** The GitHub account the GitHub CLI is signed in to. */
  account: string;
  /** What saving would write from this device. */
  local: {
    /** How many vaults would be saved. */
    vaults: number;
    /** The names of vaults left out because they are not on GitHub. */
    left: string[];
    /** The irori agent's repository, when its folder is one on GitHub. */
    agent?: string;
    /** How many of the irori agent's routines would be saved. */
    routines: number;
    /** The names of routines left out because they do not fit. */
    routinesLeft: string[];
  };
  /** The environment saved on the account, absent before the first save. */
  saved?: {
    savedAt: string;
    vaults: EnvironmentVault[];
    workspaces: string[];
    agent?: { repository: string; here: boolean };
    routines: EnvironmentRoutine[];
  };
  /** Where restored vaults are cloned unless another folder is chosen. */
  parent: string;
}

export interface RestoreEnvironment {
  /** The saved vaults to clone here; ones this device has are skipped. */
  scopeIds: string[];
  /** Clone the irori agent's folder when it is absent or empty here. */
  agent: boolean;
  /** The folders of the saved routines to add here; ones this device has are skipped. */
  routines?: string[];
  /** The parent folder for the clones; the default when absent. */
  parent?: string;
}

export interface EnvironmentRestore {
  /** The names of the vaults cloned and registered. */
  restored: string[];
  failed: { name: string; message: string }[];
  /** How many workspaces were added or brought up to date. */
  workspaces: number;
  /** The names of the routines added to the irori agent's folder. */
  routines: string[];
  agent: 'restored' | 'unchanged' | 'failed';
}
