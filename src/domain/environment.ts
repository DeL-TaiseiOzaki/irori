import type { DeviceSettings } from './types';

/**
 * A device's environment kept on the person's GitHub account (ADR 026): the
 * hibachis that live on GitHub, the workspaces that combine them, the display
 * and agent preferences, and the irori agent's folder when it is a repository.
 * It is a file in a private repository of that account, written and read with
 * the GitHub CLI's sign-in; notes and credentials never go there.
 */
export const environmentRepository = 'irori-settings';
export const environmentFile = 'environment.json';

/** The preferences that follow the person from device to device. */
export const environmentPreferences = [
  'theme',
  'language',
  'markdownFont',
  'editorAssistance',
  'hibachiAgent',
  'yourAi',
] as const satisfies readonly (keyof DeviceSettings)[];
export type EnvironmentPreferences = Partial<
  Pick<DeviceSettings, (typeof environmentPreferences)[number]>
>;

/** A hibachi of the saved environment, and whether this device has it. */
export interface EnvironmentHibachi {
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
    /** How many hibachis would be saved. */
    hibachis: number;
    /** The names of hibachis left out because they are not on GitHub. */
    left: string[];
    /** The irori agent's repository, when its folder is one on GitHub. */
    agent?: string;
  };
  /** The environment saved on the account, absent before the first save. */
  saved?: {
    savedAt: string;
    hibachis: EnvironmentHibachi[];
    workspaces: string[];
    agent?: { repository: string; here: boolean };
  };
  /** Where restored hibachis are cloned unless another folder is chosen. */
  parent: string;
}

export interface RestoreEnvironment {
  /** The saved hibachis to clone here; ones this device has are skipped. */
  scopeIds: string[];
  /** Clone the irori agent's folder when it is absent or empty here. */
  agent: boolean;
  /** The parent folder for the clones; the default when absent. */
  parent?: string;
}

export interface EnvironmentRestore {
  /** The names of the hibachis cloned and registered. */
  restored: string[];
  failed: { name: string; message: string }[];
  /** How many workspaces were added or brought up to date. */
  workspaces: number;
  agent: 'restored' | 'unchanged' | 'failed';
}
