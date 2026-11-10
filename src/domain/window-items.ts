import { z } from 'zod';

/**
 * What the window can show beside the work itself (ADR 059). The window shows
 * what a note or a conversation needs; a control that sets how irori behaves, or
 * that only a developer's workflow uses, is one of these items: off the window
 * unless the settings turn it on, each on its own.
 */
export const windowItems = [
  'access',
  'model',
  'skill',
  'personLines',
  'columns',
  'branch',
  'terminal',
  'version',
] as const;
export type WindowItem = (typeof windowItems)[number];

/** Each item, shown or not. */
export type WindowItems = Record<WindowItem, boolean>;

/** The person's own choices; an item they never chose follows its default. */
export type WindowItemChoices = Partial<WindowItems>;

/**
 * The choices as they are stored and sent. An object, not a record: an item a
 * later version adds is dropped by an earlier one instead of failing the read.
 */
export const windowItemChoices = z.object(
  Object.fromEntries(windowItems.map((item) => [item, z.boolean().optional()])) as Record<
    WindowItem,
    z.ZodOptional<z.ZodBoolean>
  >,
);

/**
 * What a window shows before anyone chooses. How a conversation runs is set
 * from its column: the model with its thinking level, and the access, share one
 * menu under the instruction box. The skill picker stays as well: it says which
 * skill one request uses, as an attachment does, and only a vault that has
 * skills shows it. The rest are a developer's tools.
 */
export const windowItemDefaults: WindowItems = {
  access: true,
  model: true,
  skill: true,
  personLines: false,
  columns: false,
  branch: false,
  terminal: false,
  version: false,
};

/** Where on the window each item appears, in the order the settings list them. */
export const windowItemAreas = [
  { id: 'composer', items: ['access', 'model', 'skill', 'personLines'] },
  { id: 'conversation', items: ['columns'] },
  { id: 'status', items: ['branch', 'terminal', 'version'] },
] as const satisfies readonly { id: string; items: readonly WindowItem[] }[];
export type WindowItemArea = (typeof windowItemAreas)[number]['id'];

/** Every item with the person's choice, or its default where they made none. */
export function windowItemsShown(chosen: WindowItemChoices = {}): WindowItems {
  const shown = { ...windowItemDefaults };
  for (const item of windowItems) {
    const choice = chosen[item];
    if (typeof choice === 'boolean') shown[item] = choice;
  }
  return shown;
}

/** Every item chosen at once: all on the window, or none of them. */
export function everyWindowItem(on: boolean): WindowItems {
  return Object.fromEntries(windowItems.map((item) => [item, on])) as WindowItems;
}
