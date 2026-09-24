import path from 'node:path';
import { z } from 'zod';
import { SerialQueue } from './serial-queue';
import { readLocalJson, writeLocalJson } from './local-json';
import { markdownFonts, type DeviceSettings } from '../domain/types';
import { skillAudience } from '../domain/skills';
import { languages } from '../domain/i18n';

const settings = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  language: z.enum(languages).default('ja'),
  markdownFont: z.enum(markdownFonts).default('sans'),
  editorAssistance: z.boolean().default(true),
  // The pane library owns this format; it is stored as written and bounded.
  // Keys are the library's: its prefix, the group id and every panel id.
  layouts: z.record(z.string().max(160), z.string().max(4096)).default({}),
  skillAudiences: z.record(z.string().max(64), skillAudience).default({}),
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
        language: patch.language ?? current.language,
        editorAssistance: patch.editorAssistance ?? current.editorAssistance,
        layouts: { ...current.layouts, ...(patch.layouts ?? {}) },
        skillAudiences: { ...current.skillAudiences, ...(patch.skillAudiences ?? {}) },
      });
      await writeLocalJson(this.file, next);
      return next;
    });
  }
}
