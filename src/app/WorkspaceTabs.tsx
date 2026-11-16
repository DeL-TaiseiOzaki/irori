import { memo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { WorkspaceProfile } from '../domain/types';
import { t } from '../domain/i18n';
import { Icon } from './Icon';
import { useLanguage } from './useLanguage';

/** How far a held tab moves before it is dragged rather than clicked, in CSS pixels. */
const dragFrom = 6;
/** How far below the tabs a dragged tab is out of the strip, as in a browser. */
const outBelow = 24;

/**
 * The open workspaces along the window's top, as a browser keeps its pages:
 * one on show, the others still running. + shows the start screen to open another.
 * A tab dragged out of the strip, below it or off the window, opens in a window of
 * its own (ADR 062) while two or more are open.
 * Memoised: it re-renders for its own data, not for every keystroke in the editor.
 */
export const WorkspaceTabs = memo(function WorkspaceTabs({
  tabs,
  shown,
  running,
  waiting,
  disabled,
  moving,
  onShow,
  onClose,
  onMoveOut,
  onAdd,
}: {
  tabs: WorkspaceProfile[];
  /** The tab on show; none while the start screen is. */
  shown?: string;
  running: string[];
  waiting: string[];
  disabled: boolean;
  /** Tabs on their way to a window of their own: they stay until it shows them. */
  moving: string[];
  onShow: (profile: WorkspaceProfile) => void;
  onClose: (profile: WorkspaceProfile) => void;
  /** A tab let go of out of the strip, at a point of the screen. */
  onMoveOut: (profile: WorkspaceProfile, at: { x: number; y: number }) => void;
  onAdd: () => void;
}) {
  useLanguage();
  // The tab held down, where, and the strip's foot; `dragged` once it moved far enough.
  const held = useRef<{ id: string; x: number; y: number; foot: number; dragged: boolean }>(
    undefined,
  );
  // A drag ends with a click on the tab it started on, in the same task; it shows nothing.
  const swallow = useRef(false);
  const [drag, setDrag] = useState<{
    id: string;
    name: string;
    x: number;
    y: number;
    out: boolean;
  }>();
  const state = (profile: WorkspaceProfile) =>
    profile.scopeIds.some((id) => waiting.includes(id))
      ? 'waiting'
      : profile.scopeIds.some((id) => running.includes(id))
        ? 'running'
        : undefined;
  const out = (event: PointerEvent, foot: number) =>
    event.clientY > foot + outBelow ||
    event.clientY < 0 ||
    event.clientX < 0 ||
    event.clientX > window.innerWidth;
  function hold(event: PointerEvent<HTMLButtonElement>, profile: WorkspaceProfile) {
    // Two tabs at least stay here, the one dragged out and one to show.
    if (disabled || tabs.length - moving.length < 2 || event.button !== 0 || !event.isPrimary)
      return;
    // The pointer stays the tab's when it leaves the strip, or the window.
    event.currentTarget.setPointerCapture(event.pointerId);
    const foot = event.currentTarget.closest('nav')?.getBoundingClientRect().bottom ?? 0;
    held.current = { id: profile.id, x: event.clientX, y: event.clientY, foot, dragged: false };
  }
  function follow(event: PointerEvent, profile: WorkspaceProfile) {
    const start = held.current;
    if (start?.id !== profile.id) return;
    if (!start.dragged && Math.hypot(event.clientX - start.x, event.clientY - start.y) < dragFrom)
      return;
    start.dragged = true;
    setDrag({
      id: profile.id,
      name: profile.name,
      x: event.clientX,
      y: event.clientY,
      out: out(event, start.foot),
    });
  }
  function letGo(event: PointerEvent, profile: WorkspaceProfile, cancelled = false) {
    const start = held.current;
    held.current = undefined;
    setDrag(undefined);
    if (start?.id !== profile.id || !start.dragged) return;
    swallow.current = true;
    setTimeout(() => (swallow.current = false));
    if (!cancelled && out(event, start.foot))
      onMoveOut(profile, { x: Math.round(event.screenX), y: Math.round(event.screenY) });
  }
  return (
    <nav className="workspace-tabs chrome" aria-label={t('ワークスペース', 'Workspaces')}>
      <div className="workspace-tab-list">
        {tabs.map((profile) => {
          const ai = state(profile);
          const current = profile.id === shown;
          const away = moving.includes(profile.id);
          return (
            <div
              key={profile.id}
              className="workspace-tab"
              data-current={current || undefined}
              data-moving={away || drag?.id === profile.id || undefined}
            >
              <button
                aria-current={current ? 'page' : undefined}
                className="workspace-tab-name"
                disabled={disabled || away}
                title={profile.name}
                aria-label={
                  ai === 'waiting'
                    ? t(`${profile.name}・許可待ち`, `${profile.name} · waiting`)
                    : ai === 'running'
                      ? t(`${profile.name}・実行中`, `${profile.name} · running`)
                      : profile.name
                }
                onPointerDown={(event) => hold(event, profile)}
                onPointerMove={(event) => follow(event, profile)}
                onPointerUp={(event) => letGo(event, profile)}
                onPointerCancel={(event) => letGo(event, profile, true)}
                // The system took the pointer away (another window came to the front).
                onLostPointerCapture={(event) => letGo(event, profile, true)}
                onClick={() => {
                  if (swallow.current) swallow.current = false;
                  else onShow(profile);
                }}
              >
                {ai && <i className="workspace-tab-ai" data-ai={ai} aria-hidden="true" />}
                <span>{profile.name}</span>
              </button>
              <button
                className="workspace-tab-close"
                disabled={disabled || away}
                title={t('閉じる', 'Close')}
                aria-label={t(`${profile.name} を閉じる`, `Close ${profile.name}`)}
                onClick={() => onClose(profile)}
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        className="workspace-tab-add"
        disabled={disabled}
        title={t('ワークスペースを開く', 'Open a workspace')}
        aria-label={t('ワークスペースを開く', 'Open a workspace')}
        aria-pressed={!shown}
        onClick={onAdd}
      >
        <Icon name="plus" size={15} />
      </button>
      {drag &&
        createPortal(
          <div
            className="workspace-tab-drag"
            data-out={drag.out || undefined}
            style={{ left: drag.x, top: drag.y }}
            aria-hidden="true"
          >
            <span>{drag.name}</span>
            {drag.out && <small>{t('新しいウィンドウで開く', 'Opens in a new window')}</small>}
          </div>,
          document.body,
        )}
    </nav>
  );
});
