import type { DeviceSettings } from '../domain/types';
import { setLanguage } from '../domain/i18n';
import type { SkillAudience } from '../domain/skills';

const host = window.irori;

/**
 * The renderer is loaded from a file URL, where the browser keeps no storage
 * between sessions. Preferences therefore live in the host's device record, and
 * this module holds the copy the running window reads from.
 */
let current: DeviceSettings = {
  theme: 'system',
  language: 'ja',
  markdownFont: 'sans',
  editorAssistance: true,
  hibachiAgent: false,
  layouts: {},
  skillAudiences: {},
  yourAi: { agent: 'claude', models: {} },
  routineRuntimes: [],
};

/**
 * Writes a choice to the device record. One the window shows is applied at once,
 * undone if the record refuses it, and applied again as the record keeps it.
 */
async function save(patch: Partial<DeviceSettings>, apply?: (shown: DeviceSettings) => void) {
  const previous = current;
  apply?.({ ...current, ...patch });
  try {
    current = await host.saveDeviceSettings(patch);
  } catch (error) {
    apply?.(previous);
    throw error;
  }
  apply?.(current);
  return current;
}

export async function loadDeviceSettings() {
  try {
    current = await host.deviceSettings();
  } catch {
    // Defaults are a working application; a broken read must not block startup.
  }
  return current;
}

export function currentTheme() {
  return current.theme;
}

export function currentLanguageChoice() {
  return current.language;
}

/** Sets the interface language and the document's, which screen readers use. */
export function applyLanguage(language: DeviceSettings['language'] = current.language) {
  document.documentElement.lang = language;
  setLanguage(language);
}

export function chooseLanguage(language: DeviceSettings['language']) {
  return save({ language }, (shown) => applyLanguage(shown.language));
}

export function currentMarkdownFont() {
  return current.markdownFont;
}

export function currentEditorAssistance() {
  return current.editorAssistance;
}

export function chooseEditorAssistance(editorAssistance: boolean) {
  return save({ editorAssistance });
}

/** Whether each hibachi's own agent and its Schema layer are offered (ADR 021). */
export function currentHibachiAgent() {
  return current.hibachiAgent;
}

export function chooseHibachiAgent(hibachiAgent: boolean) {
  return save({ hibachiAgent });
}

/** The runtimes routines may use on this device (ADR 016 D3). */
export function currentRoutineRuntimes() {
  return current.routineRuntimes;
}

export function chooseRoutineRuntimes(routineRuntimes: DeviceSettings['routineRuntimes']) {
  return save({ routineRuntimes });
}

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)');

/**
 * The stylesheet reads one attribute. Electron's native theme does not reach
 * prefers-color-scheme on every platform, so the choice is resolved here and the
 * result is written down, rather than hoping the query answers correctly.
 */
export function applyTheme(theme: DeviceSettings['theme'] = current.theme) {
  document.documentElement.dataset.theme =
    theme === 'system' ? (systemDark().matches ? 'dark' : 'hearth') : theme;
}

/** Applies the reader's type choice only to rendered Markdown through CSS. */
export function applyMarkdownFont(font: DeviceSettings['markdownFont'] = current.markdownFont) {
  document.documentElement.dataset.markdownFont = font;
}

/** Keeps a system choice in step with the desktop while it is the choice. */
export function watchSystemTheme() {
  const media = systemDark();
  const update = () => {
    if (current.theme === 'system') applyTheme('system');
  };
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}

// The host keeps it for the next launch and tells the operating system, which
// owns the window chrome and the native dialogs.
export function chooseTheme(theme: DeviceSettings['theme']) {
  return save({ theme }, (shown) => applyTheme(shown.theme));
}

export function chooseMarkdownFont(markdownFont: DeviceSettings['markdownFont']) {
  return save({ markdownFont }, (shown) => applyMarkdownFont(shown.markdownFont));
}

/** The reader's role and project for one KB; a KB without a choice is not narrowed. */
export function currentSkillAudience(scopeId: string): SkillAudience {
  return current.skillAudiences[scopeId] ?? {};
}

export function chooseSkillAudience(scopeId: string, audience: SkillAudience) {
  return save({ skillAudiences: { [scopeId]: audience } });
}

/** The CLI your AI runs on and the model chosen for each CLI. */
export function currentYourAi() {
  return current.yourAi;
}

export function chooseYourAi(yourAi: DeviceSettings['yourAi']) {
  return save({ yourAi });
}

const pending: Record<string, string> = {};
let write: ReturnType<typeof setTimeout> | undefined;

/** Pane sizes as the resizable group writes them, kept on the device. */
export const layoutStorage = {
  getItem: (key: string) => current.layouts[key] ?? null,
  setItem: (key: string, value: string) => {
    current = { ...current, layouts: { ...current.layouts, [key]: value } };
    pending[key] = value;
    clearTimeout(write);
    // One write per settled drag rather than one per frame.
    write = setTimeout(() => {
      const patch = { ...pending };
      for (const name of Object.keys(pending)) delete pending[name];
      void host.saveDeviceSettings({ layouts: patch }).catch(() => undefined);
    }, 250);
  },
};

/** Reads the device record again and applies it, after the host changed it (ADR 026). */
export async function reloadDeviceSettings() {
  current = await host.deviceSettings();
  applyTheme();
  applyMarkdownFont();
  applyLanguage();
  return current;
}
