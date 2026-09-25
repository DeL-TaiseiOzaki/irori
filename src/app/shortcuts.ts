/** A keyboard shortcut as this platform writes it: ⌘K on a Mac, Ctrl+K elsewhere. */
export function shortcut(key: string) {
  return /Mac/i.test(navigator.platform) ? `⌘${key}` : `Ctrl+${key}`;
}
