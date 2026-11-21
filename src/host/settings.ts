import path from 'node:path';
import { SerialQueue } from './serial-queue';
import { readLocalJson, writeLocalJson } from './local-json';
import type { DeviceSettings } from '../domain/types';
import { defaultDeviceSettings, deviceSettingsSchema } from '../domain/settings';

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
    const parsed = deviceSettingsSchema.safeParse(stored);
    // A damaged file becomes the defaults; preferences are not worth an error.
    return parsed.success ? parsed.data : defaultDeviceSettings();
  }
  async save(patch: Partial<DeviceSettings>): Promise<DeviceSettings> {
    return this.queue.run(async () => {
      const current = await this.read();
      const defined = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ) as Partial<DeviceSettings>;
      const next = deviceSettingsSchema.parse({
        ...current,
        ...defined,
        layouts: { ...current.layouts, ...(patch.layouts ?? {}) },
        skillAudiences: { ...current.skillAudiences, ...(patch.skillAudiences ?? {}) },
        windowItems: { ...current.windowItems, ...(patch.windowItems ?? {}) },
      });
      await writeLocalJson(this.file, next);
      return next;
    });
  }
}
