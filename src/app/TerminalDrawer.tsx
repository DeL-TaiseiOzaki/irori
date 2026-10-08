import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { layoutStorage } from './device-settings';
import { t } from '../domain/i18n';

const key = 'irori-terminal-drawer';
const minHeight = 120;
// What the drawer leaves above it for irori mode itself.
const keepAbove = 200;

/**
 * The irori agent's terminal at the foot of irori mode. It stays mounted while
 * a hibachi is on show, hidden, so its shell keeps running like a hibachi's.
 */
export function TerminalDrawer({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  const drawer = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; height: number } | undefined>(undefined);
  const [height, setHeight] = useState(() => Number(layoutStorage.getItem(key)) || 240);
  const [dragging, setDragging] = useState(false);
  function resize(next: number) {
    const room = (drawer.current?.parentElement?.clientHeight ?? window.innerHeight) - keepAbove;
    const value = Math.round(Math.max(minHeight, Math.min(next, room)));
    setHeight(value);
    layoutStorage.setItem(key, String(value));
  }
  function start(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { y: event.clientY, height };
    setDragging(true);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (drag.current) resize(drag.current.height + drag.current.y - event.clientY);
  }
  function end() {
    drag.current = undefined;
    setDragging(false);
  }
  function nudge(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    resize(height + (event.key === 'ArrowUp' ? 16 : -16));
  }
  return (
    <div className="terminal-drawer" ref={drawer} hidden={hidden} style={{ height }}>
      <div
        className="drawer-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('ターミナルの高さ', 'Terminal height')}
        aria-valuenow={height}
        aria-valuemin={minHeight}
        data-separator={dragging ? 'active' : undefined}
        tabIndex={0}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={nudge}
      />
      {children}
    </div>
  );
}
