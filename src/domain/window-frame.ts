import type { Theme } from './types';

/**
 * irori draws its own title bar (ADR 054). The system's window controls are laid over
 * its far end at this height in CSS pixels; `.titlebar` in src/app/shell.css matches it,
 * with its hairline below.
 */
export const titleBarHeight = 36;

/**
 * What the host paints around the renderer for a theme: the window's first paint and
 * the system's window controls, which sit on the title bar. Hearth, dark and a system
 * choice keep graphite chrome; light is paper throughout. The values are the chrome's
 * `--bg` and `--tx-2` in src/app/tokens.css.
 */
export function windowChrome(theme: Theme): { background: string; symbol: string } {
  return theme === 'light'
    ? { background: '#e7e5e0', symbol: '#4a5058' }
    : { background: '#0c0d0f', symbol: '#aab0b7' };
}
