import { SettingsService } from '../../src/host/settings';
import { everyWindowItem } from '../../src/domain/window-items';

/**
 * A new device's window leaves its optional controls out (ADR 059). A smoke about one of
 * them (the access, the model, the columns, the terminal) puts them all on for its
 * disposable device before irori starts, as すべて出す in the settings does.
 * window-items-ui-smoke covers the window as a new device shows it.
 */
export async function showEveryWindowItem(dataDir: string) {
  await new SettingsService(dataDir).save({ windowItems: everyWindowItem(true) });
}
