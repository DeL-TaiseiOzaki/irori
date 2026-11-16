import { Fragment, memo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { WorkspaceProfile } from '../domain/types';
import { t } from '../domain/i18n';
import { Icon } from './Icon';
import { useLanguage } from './useLanguage';

/** How far a held tab moves before it is dragged rather than clicked, in CSS pixels. */
const dragFrom = 6;
/** How far below the tabs a dragged tab is out of the strip, as in a browser. */
const outBelow = 24;

type Point = { x: number; y: number };
const onScreen = (event: PointerEvent): Point => ({
  x: Math.round(event.screenX),
  y: Math.round(event.screenY),
});

/**
 * Where a tab let go `x` across the window joins this window's tabs (ADR 064): after
 * every tab whose middle is left of it.
 */
export function stripIndexAt(x: number) {
  return [
    ...document.querySelectorAll('.workspace-tab-list > .workspace-tab:not([data-incoming])'),
  ].filter((tab) => {
    const box = tab.getBoundingClientRect();
    return box.left + box.width / 2 < x;
  }).length;
}

/**
 * The open workspaces along the window's top, as a browser keeps its pages:
 * one on show, the others still running. + shows the start screen to open another.
 * A tab dragged out of the strip, below it or off the window, joins the tabs of the
 * window it is let go on, which shows where while it is over them (ADR 064), or else
 * opens in a window of its own while two or more are open (ADR 063).
 * Memoised: it re-renders for its own data, not for every keystroke in the editor.
 */
export const WorkspaceTabs = memo(function WorkspaceTabs({
  tabs,
  shown,
  running,
  waiting,
  disabled,
  moving,
  incoming,
  onShow,
  onClose,
  onMoveOut,
  onDragOver,
  onAdd,
}: {
  tabs: WorkspaceProfile[];
  /** The tab on show; none while the start screen is. */
  shown?: string;
  running: string[];
  waiting: string[];
  disabled: boolean;
  /** Tabs on their way to another window: they stay until it shows them. */
  moving: string[];
  /** A tab dragged out of another window, over these: where it would join them. */
  incoming?: { index: number; name: string };
  onShow: (profile: WorkspaceProfile) => void;
  onClose: (profile: WorkspaceProfile) => void;
  /** A tab let go of out of the strip, at a point of the screen. */
  onMoveOut: (profile: WorkspaceProfile, at: Point) => void;
  /** Where a tab dragged out of the strip is on the screen; none once it is not. */
  onDragOver: (drag?: { name: string; at: Point }) => void;
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
  // Out of the strip, the host learns where the tab is once a frame, so the window whose
  // tabs are under it shows where it would join them. `told` once it was told any.
  const pointing = useRef<{ frame?: number; next?: { name: string; at: Point }; told: boolean }>({
    told: false,
  });
  function point(next?: { name: string; at: Point }) {
    const now = pointing.current;
    now.next = next;
    if ((!next && !now.told) || now.frame !== undefined) return;
    now.frame = requestAnimationFrame(() => {
      now.frame = undefined;
      now.told = !!now.next;
      onDragOver(now.next);
    });
  }
  /** Stops telling the host, and takes the place shown in another window away. */
  function stopPointing() {
    const now = pointing.current;
    if (now.frame !== undefined) cancelAnimationFrame(now.frame);
    if (now.told) onDragOver();
    pointing.current = { told: false };
  }
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
    if (disabled || event.button !== 0 || !event.isPrimary) return;
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
    const away = out(event, start.foot);
    setDrag({ id: profile.id, name: profile.name, x: event.clientX, y: event.clientY, out: away });
    point(away ? { name: profile.name, at: onScreen(event) } : undefined);
  }
  function letGo(event: PointerEvent, profile: WorkspaceProfile, cancelled = false) {
    const start = held.current;
    held.current = undefined;
    setDrag(undefined);
    // The place shown in another window goes, whatever the drop then does.
    stopPointing();
    if (start?.id !== profile.id || !start.dragged) return;
    swallow.current = true;
    setTimeout(() => (swallow.current = false));
    if (!cancelled && out(event, start.foot)) onMoveOut(profile, onScreen(event));
  }
  // A window's one tab moves only onto another window's tabs (ADR 064).
  const alone = tabs.length - moving.length < 2;
  const joining = incoming && (
    <div className="workspace-tab" data-incoming aria-hidden="true">
      <span>{incoming.name}</span>
    </div>
  );
  return (
    <nav className="workspace-tabs chrome" aria-label={t('ワークスペース', 'Workspaces')}>
      <div className="workspace-tab-list">
        {tabs.map((profile, index) => {
          const ai = state(profile);
          const current = profile.id === shown;
          const away = moving.includes(profile.id);
          return (
            <Fragment key={profile.id}>
              {incoming?.index === index && joining}
              <div
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
            </Fragment>
          );
        })}
        {incoming && incoming.index >= tabs.length && joining}
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
            {drag.out && (
              <small>
                {alone
                  ? t('ほかのウィンドウのタブの上で離す', "Let go on another window's tabs")
                  : t('新しいウィンドウで開く', 'Opens in a new window')}
              </small>
            )}
          </div>,
          document.body,
        )}
    </nav>
  );
});
