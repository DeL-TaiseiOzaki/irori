import { useSyncExternalStore } from 'react';
import { currentLanguage, onLanguageChange } from '../domain/i18n';

/** Re-renders the caller when the interface language changes. */
export function useLanguage() {
  return useSyncExternalStore(onLanguageChange, currentLanguage);
}
