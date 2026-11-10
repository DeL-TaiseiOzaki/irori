import { useSyncExternalStore } from 'react';
import { currentWindowItems, onWindowItemsChange } from './device-settings';

/** The window's optional controls, shown or not (ADR 059); re-renders when the settings change one. */
export function useWindowItems() {
  return useSyncExternalStore(onWindowItemsChange, currentWindowItems);
}
