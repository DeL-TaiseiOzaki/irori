/**
 * The irori agent (formerly "your AI"): the person's own agent, run from its own
 * folder (its Schema), which hands work in each vault (a brain) to that
 * vault's agent with `irori call` (ADR 050).
 */
export interface YourAi {
  /** The id its runs, conversations and sessions are kept under. */
  id: string;
  /** Its folder on this device. */
  root: string;
  /** `missing` until the folder holds an AGENTS.md. */
  state: 'missing' | 'ready';
  /** The standard skills whose folder the ready folder lacks. */
  missingSkills: string[];
  /** The workspace on show chose this folder; otherwise it is the default (ADR 044). */
  chosen?: boolean;
  /** The chosen folder, when it is not there and the default stands in for it. */
  missing?: string;
}

/** The folder the irori agent works in for one workspace (ADR 044). */
export interface IroriAgentFolder {
  /** Where it works now, an absolute path on this device. */
  path: string;
  /** The workspace chose a folder; otherwise it is the default, `~/irori/you`. */
  chosen: boolean;
  /** The chosen folder, when it is not there and the default stands in for it. */
  missing?: string;
}

/**
 * The shared Schema (ADR 027): instructions and skills every agent in irori
 * follows beside its own, kept in this folder inside the irori agent's folder
 * and written through the settings, as `.obsidian` holds a vault's.
 */
export const sharedSchemaFolder = '.irori/shared';
/**
 * The id the Schema settings and the skill listing take for the shared Schema: a
 * fixed UUID, since every host request checks a space id as one.
 */
export const sharedSchemaId = '5f3c1e8a-7b2d-4c6e-9a1f-2d8b7e4c0a51';

/** A file or folder in your AI's folder, as the Your AI screen lists it. */
export interface YourAiEntry {
  path: string;
  name: string;
  directory: boolean;
}

/** The brains of one request, as your AI is told them. */
export interface BrainAgent {
  scopeId: string;
  name: string;
  category?: string;
  /** The vault agent's name, `vault-<slug>`, as `irori call` takes it. */
  agent: string;
  root: string;
}

/**
 * A stable vault agent name for a brain: `vault-` and lowercase letters, digits
 * and hyphens, from the brain's name when it has Latin
 * letters, otherwise from its id. Names already taken get the id's first
 * characters.
 */
export function brainAgentNames(spaces: { scopeId: string; name: string }[]) {
  const names = new Map<string, string>();
  const taken = new Set<string>();
  for (const space of spaces) {
    const slug = space.name
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const short = space.scopeId.replace(/-/g, '').slice(0, 8);
    let name = `vault-${slug || short}`;
    if (taken.has(name)) name = `${name}-${short}`;
    taken.add(name);
    names.set(space.scopeId, name);
  }
  return names;
}
