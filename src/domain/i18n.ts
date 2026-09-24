/**
 * The interface speaks Japanese or English. Japanese is the source text and the
 * English is written beside it wherever the text is used, so a message and its
 * translation are read and changed together; there is no catalogue of keys to
 * drift out of step with the code. The host and the renderer each hold their own
 * current language, set from the device settings.
 *
 * Only the interface is translated. Text written into a knowledge base, prompts
 * sent to agents and names that identify files stay as they are.
 */
export const languages = ['ja', 'en'] as const;
export type Language = (typeof languages)[number];

let current: Language = 'ja';
const listeners = new Set<() => void>();

export function currentLanguage(): Language {
  return current;
}

export function setLanguage(language: Language) {
  if (language === current) return;
  current = language;
  for (const listener of listeners) listener();
}

/** Subscribes to language changes; returns the unsubscribe function. */
export function onLanguageChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The interface text in the current language. */
export function t(ja: string, en: string) {
  return current === 'en' ? en : ja;
}

/** The locale for dates and numbers shown in the interface. */
export function displayLocale() {
  return current === 'en' ? 'en-US' : 'ja-JP';
}
