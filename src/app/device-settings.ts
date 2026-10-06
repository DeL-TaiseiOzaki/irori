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

export async function chooseLanguage(language: DeviceSettings['language']) {
  const previous = current.language;
  applyLanguage(language);
  try {
    current = await host.saveDeviceSettings({ language });
  } catch (error) {
    applyLanguage(previous);
    throw error;
  }
  applyLanguage();
  return current;
}

export function currentMarkdownFont() {
  return current.markdownFont;
}

export function currentEditorAssistance() {
  return current.editorAssistance;
}

export async function chooseEditorAssistance(editorAssistance: boolean) {
  current = await host.saveDeviceSettings({ editorAssistance });
  return current;
}

/** Whether each hibachi's own agent and its Schema layer are offered (ADR 021). */
export function currentHibachiAgent() {
  return current.hibachiAgent;
}

export async function chooseHibachiAgent(hibachiAgent: boolean) {
  current = await host.saveDeviceSettings({ hibachiAgent });
  return current;
}

/** The runtimes routines may use on this device (ADR 016 D3). */
export function currentRoutineRuntimes() {
  return current.routineRuntimes;
}

export async function chooseRoutineRuntimes(routineRuntimes: DeviceSettings['routineRuntimes']) {
  current = await host.saveDeviceSettings({ routineRuntimes });
  return current;
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

export async function chooseTheme(theme: DeviceSettings['theme']) {
  const previous = current.theme;
  applyTheme(theme);
  // The host keeps it for the next launch and tells the operating system, which
  // owns the window chrome and the native dialogs.
  try {
    current = await host.saveDeviceSettings({ theme });
  } catch (error) {
    applyTheme(previous);
    throw error;
  }
  applyTheme();
  return current;
}

export async function chooseMarkdownFont(markdownFont: DeviceSettings['markdownFont']) {
  const previous = current.markdownFont;
  applyMarkdownFont(markdownFont);
  try {
    current = await host.saveDeviceSettings({ markdownFont });
  } catch (error) {
    applyMarkdownFont(previous);
    throw error;
  }
  applyMarkdownFont();
  return current;
}

/** The reader's role and project for one KB; a KB without a choice is not narrowed. */
export function currentSkillAudience(scopeId: string): SkillAudience {
  return current.skillAudiences[scopeId] ?? {};
}

export async function chooseSkillAudience(scopeId: string, audience: SkillAudience) {
  current = await host.saveDeviceSettings({ skillAudiences: { [scopeId]: audience } });
  return current;
}

/** The CLI your AI runs on and the model chosen for each CLI. */
export function currentYourAi() {
  return current.yourAi;
}

export async function chooseYourAi(yourAi: DeviceSettings['yourAi']) {
  current = await host.saveDeviceSettings({ yourAi });
  return current;
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
