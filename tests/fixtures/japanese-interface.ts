import { SettingsService } from '../../src/host/settings';

/**
 * A new device starts in English (ADR 011). The UI smokes name elements by their Japanese
 * text, the interface's source text, so each chooses Japanese for its disposable device
 * before irori starts. language-ui-smoke covers the English first launch.
 */
export async function chooseJapanese(dataDir: string) {
  await new SettingsService(dataDir).save({ language: 'ja' });
}
