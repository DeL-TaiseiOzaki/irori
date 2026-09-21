import type { DeviceSettings } from '../domain/types';
import type { SkillAudience } from '../domain/skills';

const host = window.irori;

/**
 * The renderer is loaded from a file URL, where the browser keeps no storage
 * between sessions. Preferences therefore live in the host's device record, and
 * this module holds the copy the running window reads from.
 */
let current: DeviceSettings = {
  theme: 'system',
  markdownFont: 'sans',
  layouts: {},
  skillAudiences: {},
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

export function currentMarkdownFont() {
  return current.markdownFont;
}

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)');

/**
 * The stylesheet reads one attribute. Electron's native theme does not reach
 * prefers-color-scheme on every platform, so the choice is resolved here and the
 * result is written down, rather than hoping the query answers correctly.
 */
export function applyTheme(theme: DeviceSettings['theme'] = current.theme) {
  document.documentElement.dataset.theme =
    theme === 'system' ? (systemDark().matches ? 'dark' : 'light') : theme;
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
