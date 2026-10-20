import path from 'node:path';
import { z } from 'zod';
import { SerialQueue } from './serial-queue';
import { readLocalJson, writeLocalJson } from './local-json';
import {
  lineSpacings,
  markdownFonts,
  pageMargins,
  textSizes,
  themes,
  type DeviceSettings,
} from '../domain/types';
import { yourAiChoice } from '../domain/conversation';
import { skillAudience } from '../domain/skills';
import { languages } from '../domain/i18n';
import { routineRuntimes } from '../domain/routines';

const settings = z.object({
  theme: z.enum(themes).default('system'),
  language: z.enum(languages).default('en'),
  markdownFont: z.enum(markdownFonts).default('sans'),
  pageMargins: z.enum(pageMargins).default('standard'),
  textSize: z.enum(textSizes).default('standard'),
  lineSpacing: z.enum(lineSpacings).default('standard'),
  editorAssistance: z.boolean().default(true),
  propertiesFolded: z.boolean().default(false),
  vaultAgent: z.boolean().default(false),
  // The pane library owns this format; it is stored as written and bounded.
  // Keys are the library's: its prefix, the group id and every panel id.
  layouts: z.record(z.string().max(160), z.string().max(4096)).default({}),
  skillAudiences: z.record(z.string().max(64), skillAudience).default({}),
  yourAi: yourAiChoice.default({ agent: 'claude', models: {} }),
  routineRuntimes: z.array(z.enum(routineRuntimes)).default([]),
});

/**
 * Device preferences that must survive a restart. The renderer is loaded from a
 * file URL, where browser storage is not kept between sessions, so anything the
 * reader chooses is written here instead.
 */
export class SettingsService {
  private queue = new SerialQueue();
  private file: string;
  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'device-settings.json');
  }
  async read(): Promise<DeviceSettings> {
    const stored = await readLocalJson(this.file, {});
    const parsed = settings.safeParse(stored);
    // A damaged file becomes the defaults; preferences are not worth an error.
    return parsed.success ? parsed.data : settings.parse({});
  }
  async save(patch: Partial<DeviceSettings>): Promise<DeviceSettings> {
    return this.queue.run(async () => {
      const current = await this.read();
      const next = settings.parse({
        theme: patch.theme ?? current.theme,
        markdownFont: patch.markdownFont ?? current.markdownFont,
        pageMargins: patch.pageMargins ?? current.pageMargins,
        textSize: patch.textSize ?? current.textSize,
        lineSpacing: patch.lineSpacing ?? current.lineSpacing,
        language: patch.language ?? current.language,
        editorAssistance: patch.editorAssistance ?? current.editorAssistance,
        propertiesFolded: patch.propertiesFolded ?? current.propertiesFolded,
        vaultAgent: patch.vaultAgent ?? current.vaultAgent,
        layouts: { ...current.layouts, ...(patch.layouts ?? {}) },
        skillAudiences: { ...current.skillAudiences, ...(patch.skillAudiences ?? {}) },
        yourAi: patch.yourAi ?? current.yourAi,
        routineRuntimes: patch.routineRuntimes ?? current.routineRuntimes,
      });
      await writeLocalJson(this.file, next);
      return next;
    });
  }
}
