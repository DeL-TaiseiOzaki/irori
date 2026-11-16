import type { Theme } from './types';

/**
 * irori draws its own title bar (ADR 054). The system's window controls are laid over
 * its far end at this height in CSS pixels; `.titlebar` in src/app/shell.css matches it,
 * with its hairline below.
 */
export const titleBarHeight = 36;

type Point = { x: number; y: number };
type Rectangle = Point & { width: number; height: number };
/** Where in a window a tab dragged out of another is held: on its first tab, in the title bar. */
const heldAt: Point = { x: 110, y: titleBarHeight / 2 };

/**
 * Where a window opened by dragging a tab out of another stands (ADR 063): its first tab
 * under the pointer that let go of it at `at`, and the whole window inside the work area
 * of that screen, shrunk to fit when it is larger.
 */
export function droppedWindowBounds(
  at: Point,
  size: { width: number; height: number },
  area: Rectangle,
): Rectangle {
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  const within = (value: number, start: number, room: number) =>
    Math.round(Math.max(start, Math.min(value, start + room)));
  return {
    x: within(at.x - heldAt.x, area.x, area.width - width),
    y: within(at.y - heldAt.y, area.y, area.height - height),
    width,
    height,
  };
}

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
