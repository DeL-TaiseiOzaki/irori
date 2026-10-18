import type { AgentModels } from './types';

/** What the thinking-level picker offers for one model of a CLI's list. */
export interface EffortChoices {
  /** The levels to pick from, as the CLI names them. */
  levels: string[];
  /** The level the CLI thinks at when none is passed. */
  default?: string;
  /** A level may be typed in. */
  custom: boolean;
}

/**
 * The thinking levels `model` takes ('' for the CLI's default model): those the
 * CLI lists for it, else those of its default model, else the CLI's own. No
 * levels and nothing to type means the CLI takes no level (Hermes Agent).
 */
export function effortChoices(list: AgentModels, model: string): EffortChoices {
  const own =
    list.models.find((entry) => entry.id === model) ?? list.models.find((entry) => entry.default);
  return {
    levels: own?.efforts ?? list.efforts ?? [],
    ...(own?.defaultEffort && { default: own.defaultEffort }),
    custom: !!list.customEffort,
  };
}

/** A level kept from an earlier choice that `choices` no longer offers is dropped. */
export function keptEffort(choices: EffortChoices, effort: string) {
  return !effort || choices.custom || choices.levels.includes(effort) ? effort : '';
}
