import { z } from 'zod';
import {
  agentAccessModes,
  lineSpacings,
  markdownFonts,
  pageMargins,
  textSizes,
  themes,
  type DeviceSettings,
} from './types';
import { yourAiChoice } from './conversation';
import { skillAudience } from './skills';
import { languages } from './i18n';
import { routineRuntimeList } from './routines';
import { windowItemChoices } from './window-items';

const deviceSettingsFields = {
  theme: z.enum(themes),
  language: z.enum(languages),
  markdownFont: z.enum(markdownFonts),
  pageMargins: z.enum(pageMargins),
  textSize: z.enum(textSizes),
  lineSpacing: z.enum(lineSpacings),
  editorAssistance: z.boolean(),
  propertiesFolded: z.boolean(),
  vaultAgent: z.boolean(),
  agentAccess: z.enum(agentAccessModes),
  // The pane library owns this format; it is stored as written and bounded.
  // Keys are the library's: its prefix, the group id and every panel id.
  layouts: z
    .record(z.string().max(160), z.string().max(4096))
    .refine((value) => Object.keys(value).length <= 200),
  skillAudiences: z
    .record(z.string().max(64), skillAudience)
    .refine((value) => Object.keys(value).length <= 500),
  yourAi: yourAiChoice,
  routineRuntimes: routineRuntimeList,
  windowItems: windowItemChoices,
};

/** Stored device preferences, with defaults for missing fields. */
export const deviceSettingsSchema = z.object({
  theme: deviceSettingsFields.theme.default('system'),
  language: deviceSettingsFields.language.default('en'),
  markdownFont: deviceSettingsFields.markdownFont.default('sans'),
  pageMargins: deviceSettingsFields.pageMargins.default('standard'),
  textSize: deviceSettingsFields.textSize.default('standard'),
  lineSpacing: deviceSettingsFields.lineSpacing.default('standard'),
  editorAssistance: deviceSettingsFields.editorAssistance.default(true),
  propertiesFolded: deviceSettingsFields.propertiesFolded.default(false),
  vaultAgent: deviceSettingsFields.vaultAgent.default(false),
  agentAccess: deviceSettingsFields.agentAccess.default('default'),
  layouts: deviceSettingsFields.layouts.default({}),
  skillAudiences: deviceSettingsFields.skillAudiences.default({}),
  yourAi: deviceSettingsFields.yourAi.default({ agent: 'claude', models: {} }),
  routineRuntimes: deviceSettingsFields.routineRuntimes.default([]),
  windowItems: deviceSettingsFields.windowItems.default({}),
});

/** Validated patch accepted across the renderer/host boundary. */
export const deviceSettingsPatchSchema = z.object(deviceSettingsFields).partial();

/** A fresh copy of the default device settings. */
export function defaultDeviceSettings(): DeviceSettings {
  return deviceSettingsSchema.parse({});
}
